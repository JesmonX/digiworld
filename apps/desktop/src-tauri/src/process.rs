use crate::error::{DigiworldError, Result};
use crate::model::ProxySettings;
use crate::network;
use serde_json::{Value, json};
use std::path::Path;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

const MAX_RPC_LINE: usize = 4 * 1024 * 1024;

pub struct PluginProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_id: u64,
}

impl PluginProcess {
    pub async fn spawn(
        executable: &Path,
        data_dir: &Path,
        proxy: Option<&ProxySettings>,
    ) -> Result<Self> {
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
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| DigiworldError::Plugin("plugin stdin unavailable".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| DigiworldError::Plugin("plugin stdout unavailable".into()))?;
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
        Ok(Self {
            child,
            stdin,
            stdout: BufReader::new(stdout),
            next_id: 0,
        })
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

        let mut response = String::new();
        let read = tokio::time::timeout(
            std::time::Duration::from_secs(15),
            self.stdout.read_line(&mut response),
        )
        .await
        .map_err(|_| DigiworldError::Plugin(format!("plugin request timed out: {method}")))??;
        if read == 0 {
            return Err(DigiworldError::Plugin(
                "plugin process closed its output".into(),
            ));
        }
        if response.len() > MAX_RPC_LINE {
            return Err(DigiworldError::Plugin(
                "plugin response exceeds 4 MiB".into(),
            ));
        }
        let value: Value = serde_json::from_str(&response)?;
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

    pub async fn stop(&mut self) {
        let _ = self.request("shutdown", Value::Null).await;
        if tokio::time::timeout(std::time::Duration::from_secs(3), self.child.wait())
            .await
            .is_err()
        {
            let _ = self.child.kill().await;
        }
    }
}
