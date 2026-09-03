use crate::error::{DigiworldError, Result};
use crate::model::ProxySettings;
use crate::network;
use serde_json::{Value, json};
use std::path::Path;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::mpsc;

#[cfg(windows)]
use windows::Win32::{
    Foundation::{CloseHandle, HANDLE},
    System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
        SetInformationJobObject,
    },
};

const MAX_RPC_LINE: usize = 4 * 1024 * 1024;

#[derive(Debug)]
pub struct PluginEvent {
    pub method: String,
    pub params: Value,
}

pub struct PluginProcess {
    #[cfg(windows)]
    _job: WindowsJob,
    child: Child,
    stdin: ChildStdin,
    responses: mpsc::UnboundedReceiver<Value>,
    reader: tokio::task::JoinHandle<()>,
    next_id: u64,
    needs_restart: bool,
}

#[cfg(windows)]
struct WindowsJob(HANDLE);

#[cfg(windows)]
unsafe impl Send for WindowsJob {}

#[cfg(windows)]
impl Drop for WindowsJob {
    fn drop(&mut self) {
        // SAFETY: this object exclusively owns the handle returned by CreateJobObjectW.
        let _ = unsafe { CloseHandle(self.0) };
    }
}

#[cfg(windows)]
fn assign_kill_on_close_job(child: &Child) -> Result<WindowsJob> {
    use windows::core::PCWSTR;

    // SAFETY: all pointers reference initialized values for the duration of each call.
    unsafe {
        let job = CreateJobObjectW(None, PCWSTR::null()).map_err(|error| {
            DigiworldError::Plugin(format!("create plugin job object: {error}"))
        })?;
        let mut information = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        information.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if let Err(error) = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            (&raw const information).cast(),
            std::mem::size_of_val(&information) as u32,
        ) {
            let _ = CloseHandle(job);
            return Err(DigiworldError::Plugin(format!(
                "configure plugin job object: {error}"
            )));
        }
        let process = child
            .raw_handle()
            .ok_or_else(|| DigiworldError::Plugin("plugin process handle is unavailable".into()))?;
        if let Err(error) = AssignProcessToJobObject(job, HANDLE(process.cast())) {
            let _ = CloseHandle(job);
            return Err(DigiworldError::Plugin(format!(
                "assign plugin process to job object: {error}"
            )));
        }
        Ok(WindowsJob(job))
    }
}

impl PluginProcess {
    pub async fn spawn(
        executable: &Path,
        data_dir: &Path,
        proxy: Option<&ProxySettings>,
    ) -> Result<(Self, mpsc::UnboundedReceiver<PluginEvent>)> {
        tokio::fs::create_dir_all(data_dir).await?;
        let mut command = Command::new(executable);
        command
            .arg("--stdio")
            .arg("--data-dir")
            .arg(data_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if let Some(proxy) = proxy {
            network::configure_plugin_command(&mut command, proxy);
        }
        #[cfg(windows)]
        command.creation_flags(0x0800_0000);
        let mut child = command.spawn().map_err(|error| {
            DigiworldError::Plugin(format!("failed to start {}: {error}", executable.display()))
        })?;
        #[cfg(windows)]
        let job = assign_kill_on_close_job(&child)?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| DigiworldError::Plugin("plugin stdin unavailable".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| DigiworldError::Plugin("plugin stdout unavailable".into()))?;
        let (response_tx, responses) = mpsc::unbounded_channel();
        let (event_tx, events) = mpsc::unbounded_channel();
        let reader = tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if line.len() > MAX_RPC_LINE {
                    tracing::warn!("ignored oversized plugin output");
                    continue;
                }
                let value: Value = match serde_json::from_str(&line) {
                    Ok(value) => value,
                    Err(error) => {
                        tracing::warn!(%error, "ignored malformed plugin output");
                        continue;
                    }
                };
                if value.get("id").is_some() {
                    if response_tx.send(value).is_err() {
                        break;
                    }
                    continue;
                }
                let Some(method) = value.get("method").and_then(Value::as_str) else {
                    tracing::warn!("ignored plugin output without id or method");
                    continue;
                };
                let event = PluginEvent {
                    method: method.to_string(),
                    params: value.get("params").cloned().unwrap_or(Value::Null),
                };
                if event_tx.send(event).is_err() {
                    break;
                }
            }
        });
        if let Some(stderr) = child.stderr.take() {
            let name = executable
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    tracing::warn!(plugin = %name, message = %line, "plugin diagnostic");
                }
            });
        }
        Ok((
            Self {
                #[cfg(windows)]
                _job: job,
                child,
                stdin,
                responses,
                reader,
                next_id: 0,
                needs_restart: false,
            },
            events,
        ))
    }

    pub async fn request(&mut self, method: &str, params: Value) -> Result<Value> {
        self.next_id += 1;
        let id = self.next_id;
        let line = serde_json::to_vec(&json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        }))?;
        if line.len() > MAX_RPC_LINE {
            return Err(DigiworldError::Plugin(
                "plugin request exceeds 4 MiB".into(),
            ));
        }
        self.stdin.write_all(&line).await?;
        self.stdin.write_all(b"\n").await?;
        self.stdin.flush().await?;

        let value =
            match tokio::time::timeout(std::time::Duration::from_secs(15), self.responses.recv())
                .await
            {
                Ok(Some(value)) => value,
                Ok(None) => {
                    return Err(DigiworldError::Plugin(
                        "plugin process closed its output".into(),
                    ));
                }
                Err(_) => {
                    self.needs_restart = true;
                    let _ = self.child.start_kill();
                    let _ = self.child.wait().await;
                    return Err(DigiworldError::Plugin(format!(
                        "plugin request timed out; the process is being restarted: {method}"
                    )));
                }
            };
        if value.get("id").and_then(Value::as_u64) != Some(id) {
            return Err(DigiworldError::Plugin(
                "plugin returned an unexpected response id".into(),
            ));
        }
        if let Some(error) = value.get("error") {
            return Err(DigiworldError::Plugin(
                error
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown plugin error")
                    .to_string(),
            ));
        }
        Ok(value.get("result").cloned().unwrap_or(Value::Null))
    }

    pub async fn health(&mut self) -> Result<()> {
        let response = self.request("health", Value::Null).await?;
        if response.get("status").and_then(Value::as_str) != Some("ok") {
            return Err(DigiworldError::Plugin("plugin health check failed".into()));
        }
        Ok(())
    }

    pub fn needs_restart(&self) -> bool {
        self.needs_restart
    }

    pub async fn stop(&mut self) {
        let _ = self.request("shutdown", Value::Null).await;
        if tokio::time::timeout(std::time::Duration::from_secs(3), self.child.wait())
            .await
            .is_err()
        {
            let _ = self.child.kill().await;
        }
        self.reader.abort();
    }
}
