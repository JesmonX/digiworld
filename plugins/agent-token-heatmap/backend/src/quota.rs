use crate::model::{
    CodexQuotaSettings, CodexQuotaSnapshot, CodexQuotaWindow, CodexResetCreditsSummary,
    ShellPreset, SshSource,
};
use anyhow::{Context, Result, anyhow, bail};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{Value, json};
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::{Duration, Instant};

const QUERY_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_PROTOCOL_OUTPUT: usize = 1024 * 1024;
const MAX_ERROR_OUTPUT: usize = 16 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppServerResponse {
    rate_limits: RateLimitSnapshot,
    rate_limits_by_limit_id: Option<std::collections::BTreeMap<String, RateLimitSnapshot>>,
    #[serde(default)]
    rate_limit_reset_credits: Option<CodexResetCreditsSummary>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RateLimitSnapshot {
    plan_type: Option<String>,
    primary: Option<RateLimitWindow>,
    secondary: Option<RateLimitWindow>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RateLimitWindow {
    used_percent: u32,
    window_duration_mins: Option<i64>,
    resets_at: Option<i64>,
}

pub fn query(
    settings: &CodexQuotaSettings,
    source: Option<&SshSource>,
    source_id: String,
    source_label: String,
) -> Result<CodexQuotaSnapshot> {
    let mut command = build_command(settings, source)?;
    let result = run_protocol(&mut command)?;
    parse_response(result, source_id, source_label)
}

fn build_command(settings: &CodexQuotaSettings, source: Option<&SshSource>) -> Result<Command> {
    let powershell = settings.shell_preset == ShellPreset::Powershell
        || (source.is_none() && settings.shell_preset == ShellPreset::Auto && cfg!(windows));
    let script = shell_script(&settings.pre_command, powershell);
    if let Some(source) = source {
        let invocation = remote_shell_invocation(settings.shell_preset, &script);
        let mut command = Command::new(if cfg!(windows) { "ssh.exe" } else { "ssh" });
        command.args([
            "-T",
            "-o",
            "BatchMode=yes",
            "-o",
            "StrictHostKeyChecking=yes",
            "-o",
            "ConnectTimeout=10",
            "-o",
            "ServerAliveInterval=15",
            "-o",
            "ServerAliveCountMax=1",
            source.host.as_str(),
            invocation.as_str(),
        ]);
        return Ok(command);
    }

    let (executable, args) = local_shell(settings.shell_preset)?;
    let mut command = Command::new(executable);
    command.args(args).arg(script);
    Ok(command)
}

fn local_shell(preset: ShellPreset) -> Result<(String, Vec<&'static str>)> {
    match preset {
        ShellPreset::Zsh => Ok(("zsh".into(), vec!["-lic"])),
        ShellPreset::Bash => Ok(("bash".into(), vec!["-lc"])),
        ShellPreset::Powershell => Ok((
            if cfg!(windows) {
                "powershell.exe"
            } else {
                "pwsh"
            }
            .into(),
            vec!["-NoLogo", "-NoProfile", "-Command"],
        )),
        ShellPreset::Auto if cfg!(windows) => Ok((
            "powershell.exe".into(),
            vec!["-NoLogo", "-NoProfile", "-Command"],
        )),
        ShellPreset::Auto => {
            let configured = std::env::var("SHELL").unwrap_or_default();
            let name = std::path::Path::new(&configured)
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default();
            match name {
                "zsh" => Ok((configured, vec!["-lic"])),
                "bash" => Ok((configured, vec!["-lc"])),
                _ => Ok(("zsh".into(), vec!["-lic"])),
            }
        }
    }
}

fn shell_script(pre_command: &str, powershell: bool) -> String {
    let launch = if powershell {
        "& codex app-server --stdio"
    } else {
        "exec codex app-server --stdio"
    };
    if pre_command.trim().is_empty() {
        launch.into()
    } else {
        format!("{}\n{launch}", pre_command.trim())
    }
}

fn remote_shell_invocation(preset: ShellPreset, script: &str) -> String {
    let quoted = shell_quote(script);
    match preset {
        ShellPreset::Auto => format!("exec \"${{SHELL:-sh}}\" -lc {quoted}"),
        ShellPreset::Zsh => format!("exec zsh -lic {quoted}"),
        ShellPreset::Bash => format!("exec bash -lc {quoted}"),
        ShellPreset::Powershell => {
            format!("exec pwsh -NoLogo -NoProfile -Command {quoted}")
        }
    }
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn run_protocol(command: &mut Command) -> Result<Value> {
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("start configured shell for Codex quota query")?;
    let stdout = child
        .stdout
        .take()
        .context("Codex app-server stdout unavailable")?;
    let stderr = child
        .stderr
        .take()
        .context("Codex app-server stderr unavailable")?;
    let (sender, receiver) = mpsc::channel();
    let stdout_reader = thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut total = 0_usize;
        loop {
            let mut line = String::new();
            match reader.read_line(&mut line) {
                Ok(0) => break,
                Ok(size) => {
                    total = total.saturating_add(size);
                    if total > MAX_PROTOCOL_OUTPUT {
                        let _ = sender.send(Err("Codex app-server output exceeded 1 MiB".into()));
                        break;
                    }
                    if let Ok(value) = serde_json::from_str::<Value>(&line) {
                        let _ = sender.send(Ok(value));
                    }
                }
                Err(error) => {
                    let _ = sender.send(Err(format!("read Codex app-server output: {error}")));
                    break;
                }
            }
        }
    });
    let stderr_reader = thread::spawn(move || {
        let mut output = Vec::new();
        stderr
            .take((MAX_ERROR_OUTPUT + 1) as u64)
            .read_to_end(&mut output)
            .map(|_| output)
    });

    let result = protocol_exchange(&mut child, &receiver);
    let status = stop_child(&mut child);
    let _ = stdout_reader.join();
    let stderr = stderr_reader
        .join()
        .ok()
        .and_then(Result::ok)
        .unwrap_or_default();
    result.map_err(|error| {
        let detail = String::from_utf8_lossy(&stderr);
        let detail = detail.trim().chars().take(500).collect::<String>();
        if detail.is_empty() {
            if status.is_some_and(|value| !value.success()) {
                anyhow!("{error}; configured shell exited before returning limits")
            } else {
                error
            }
        } else {
            anyhow!("{error}: {detail}")
        }
    })
}

fn stop_child(child: &mut Child) -> Option<std::process::ExitStatus> {
    // Closing the protocol pipe lets app-server and shell wrappers exit cleanly.
    // This is especially important for PowerShell, where killing only the
    // wrapper could otherwise leave the Codex child alive.
    drop(child.stdin.take());
    let deadline = Instant::now() + Duration::from_millis(750);
    while Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(status)) => return Some(status),
            Ok(None) => thread::sleep(Duration::from_millis(15)),
            Err(_) => break,
        }
    }
    let _ = child.kill();
    child.wait().ok()
}

fn protocol_exchange(
    child: &mut Child,
    receiver: &Receiver<std::result::Result<Value, String>>,
) -> Result<Value> {
    let stdin = child
        .stdin
        .as_mut()
        .context("Codex app-server stdin unavailable")?;
    write_message(
        stdin,
        &json!({"id": 1, "method": "initialize", "params": {"clientInfo": {"name": "digiworld-agent-token-heatmap", "version": env!("CARGO_PKG_VERSION")}}}),
    )?;
    let deadline = Instant::now() + QUERY_TIMEOUT;
    wait_for_response(receiver, 1, deadline)?;
    write_message(stdin, &json!({"method": "initialized"}))?;
    write_message(
        stdin,
        &json!({"id": 2, "method": "account/rateLimits/read"}),
    )?;
    wait_for_response(receiver, 2, deadline)
}

fn write_message(stdin: &mut impl Write, message: &Value) -> Result<()> {
    serde_json::to_writer(&mut *stdin, message)?;
    stdin.write_all(b"\n")?;
    stdin.flush()?;
    Ok(())
}

fn wait_for_response(
    receiver: &Receiver<std::result::Result<Value, String>>,
    id: i64,
    deadline: Instant,
) -> Result<Value> {
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            bail!("Codex app-server quota query timed out after 15 seconds");
        }
        let value = receiver
            .recv_timeout(remaining)
            .map_err(|_| anyhow!("Codex app-server closed before returning limits"))?
            .map_err(|error| anyhow!(error))?;
        if value.get("id").and_then(Value::as_i64) != Some(id) {
            continue;
        }
        if let Some(error) = value.get("error") {
            let message = error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("Codex app-server returned an error");
            bail!(message.to_string());
        }
        return value
            .get("result")
            .cloned()
            .context("Codex app-server response did not contain a result");
    }
}

fn parse_response(
    value: Value,
    source_id: String,
    source_label: String,
) -> Result<CodexQuotaSnapshot> {
    let response: AppServerResponse =
        serde_json::from_value(value).context("parse Codex rate-limit response")?;
    let rate_limits = response
        .rate_limits_by_limit_id
        .as_ref()
        .and_then(|items| items.get("codex"))
        .unwrap_or(&response.rate_limits);
    let mut windows: Vec<_> = [rate_limits.primary.clone(), rate_limits.secondary.clone()]
        .into_iter()
        .flatten()
        .map(|window| CodexQuotaWindow {
            used_percent: window.used_percent,
            window_duration_mins: window.window_duration_mins,
            resets_at: window.resets_at,
        })
        .collect();
    windows.sort_by_key(|window| window.window_duration_mins.unwrap_or(i64::MAX));
    windows.dedup_by(|left, right| {
        left.window_duration_mins == right.window_duration_mins && left.resets_at == right.resets_at
    });
    if windows.is_empty() {
        bail!("Codex account did not return any rate-limit windows");
    }
    Ok(CodexQuotaSnapshot {
        status: "ready".into(),
        source_id: Some(source_id),
        source_label: Some(source_label),
        fetched_at: Some(Utc::now().to_rfc3339()),
        plan_type: rate_limits.plan_type.clone(),
        windows,
        reset_credits: response.rate_limit_reset_credits,
        error: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_multi_bucket_codex_windows_in_duration_order() {
        let value = json!({
            "rateLimits": {"primary": null, "secondary": null, "planType": null},
            "rateLimitsByLimitId": {"codex": {
                "primary": {"usedPercent": 64, "windowDurationMins": 10080, "resetsAt": 200},
                "secondary": {"usedPercent": 60, "windowDurationMins": 300, "resetsAt": 100},
                "planType": "plus"
            }},
            "rateLimitResetCredits": {
                "availableCount": 1,
                "credits": [{
                    "id": "credit-1",
                    "title": "里程碑赠送",
                    "description": "系统赠送",
                    "grantedAt": 1788500000,
                    "expiresAt": 1789500000,
                    "status": "available",
                    "resetType": "codexRateLimits"
                }]
            }
        });
        let parsed = parse_response(value, "local".into(), "本机".into()).unwrap();
        assert_eq!(parsed.status, "ready");
        assert_eq!(parsed.plan_type.as_deref(), Some("plus"));
        assert_eq!(parsed.windows[0].window_duration_mins, Some(300));
        assert_eq!(parsed.windows[1].window_duration_mins, Some(10080));
        let resets = parsed.reset_credits.unwrap();
        assert_eq!(resets.available_count, 1);
        let credits = resets.credits.unwrap();
        assert_eq!(credits[0].id, "credit-1");
        assert_eq!(credits[0].title.as_deref(), Some("里程碑赠送"));
        assert_eq!(credits[0].granted_at, 1788500000);
        assert_eq!(credits[0].expires_at, Some(1789500000));
    }

    #[test]
    fn safely_quotes_remote_preludes() {
        let command =
            remote_shell_invocation(ShellPreset::Zsh, "source ~/proxy\nprintf '%s' 'hello'");
        assert!(command.starts_with("exec zsh -lic '"));
        assert!(command.contains("'\"'\"'"));
        assert!(command.ends_with('\''));
    }

    #[test]
    fn builds_platform_neutral_shell_scripts() {
        assert_eq!(
            shell_script("source ~/awsproxy", false),
            "source ~/awsproxy\nexec codex app-server --stdio"
        );
        assert_eq!(shell_script("", true), "& codex app-server --stdio");
    }
}
