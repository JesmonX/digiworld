use crate::model::{
    AgyQuotaBucket, AgyQuotaGroup, AgyQuotaSettings, AgyQuotaSnapshot, ShellPreset, SshSource,
};
use crate::quota::{local_shell, remote_shell_invocation};
use anyhow::{Context, Result, bail};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use std::io::{BufReader, Read};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const QUERY_TIMEOUT: Duration = Duration::from_secs(25);

#[derive(Debug, Deserialize)]
struct AgyJsonRoot {
    #[serde(default)]
    pub command: Option<AgyCommandObj>,
}

#[derive(Debug, Deserialize)]
struct AgyCommandObj {
    #[serde(default)]
    pub data: Option<AgyDataObj>,
}

#[derive(Debug, Deserialize)]
struct AgyDataObj {
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub groups: Option<Vec<AgyRawGroup>>,
}

#[derive(Debug, Deserialize)]
struct AgyRawGroup {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub buckets: Option<Vec<AgyRawBucket>>,
}

#[derive(Debug, Deserialize)]
struct AgyRawBucket {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub window: Option<String>,
    #[serde(default)]
    pub remaining_fraction: Option<f64>,
    #[serde(default)]
    pub reset_time: Option<String>,
}

pub fn query(
    settings: &AgyQuotaSettings,
    source: Option<&SshSource>,
    source_id: String,
    source_label: String,
) -> Result<AgyQuotaSnapshot> {
    let mut command = build_command(settings, source)?;
    let output = run_command(&mut command)?;
    parse_response(&output, source_id, source_label)
}

fn build_command(settings: &AgyQuotaSettings, source: Option<&SshSource>) -> Result<Command> {
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

fn shell_script(pre_command: &str, powershell: bool) -> String {
    let launch = if powershell {
        "& agy -p \"/quota\" --output-format json"
    } else {
        "exec agy -p \"/quota\" --output-format json"
    };
    if pre_command.trim().is_empty() {
        launch.into()
    } else {
        format!("{}\n{launch}", pre_command.trim())
    }
}

fn run_command(command: &mut Command) -> Result<String> {
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("start configured shell for Antigravity (agy) quota query")?;

    let stdout = child.stdout.take().context("agy stdout unavailable")?;
    let stderr = child.stderr.take().context("agy stderr unavailable")?;

    let stdout_reader = thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut output = String::new();
        let _ = reader.read_to_string(&mut output);
        output
    });

    let stderr_reader = thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut output = String::new();
        let _ = reader.read_to_string(&mut output);
        output
    });

    let start = Instant::now();
    let mut exit_status = None;
    while start.elapsed() < QUERY_TIMEOUT {
        match child.try_wait() {
            Ok(Some(status)) => {
                exit_status = Some(status);
                break;
            }
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(e) => {
                bail!("failed waiting for agy command: {e}");
            }
        }
    }

    if exit_status.is_none() {
        let _ = child.kill();
        let _ = child.wait();
        bail!("Antigravity (agy) quota query timed out after 25 seconds");
    }

    let stdout_out = stdout_reader.join().unwrap_or_default();
    let stderr_out = stderr_reader.join().unwrap_or_default();

    let status = exit_status.unwrap();
    if !status.success() {
        let err = stderr_out.trim();
        if err.is_empty() {
            bail!("agy command failed with exit code: {}", status);
        } else {
            bail!("agy command failed: {}", err);
        }
    }

    Ok(stdout_out)
}

pub fn parse_response(
    raw_output: &str,
    source_id: String,
    source_label: String,
) -> Result<AgyQuotaSnapshot> {
    let trimmed = raw_output.trim();
    if let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}'))
        && start <= end
        && let Ok(root) = serde_json::from_str::<AgyJsonRoot>(&trimmed[start..=end])
        && let Some(cmd) = root.command
        && let Some(data) = cmd.data
        && let Some(raw_groups) = data.groups
        && !raw_groups.is_empty()
    {
        return parse_json_groups(raw_groups, data.description, source_id, source_label);
    }

    parse_text_output(trimmed, source_id, source_label)
}

fn parse_json_groups(
    raw_groups: Vec<AgyRawGroup>,
    description: Option<String>,
    source_id: String,
    source_label: String,
) -> Result<AgyQuotaSnapshot> {
    let mut groups = Vec::new();
    let mut primary_windows = Vec::new();

    for (g_idx, rg) in raw_groups.into_iter().enumerate() {
        let is_gemini = rg.name == "Gemini Models";
        let mut buckets = Vec::new();
        for rb in rg.buckets.unwrap_or_default() {
            let window_str = rb.window.unwrap_or_else(|| {
                if rb.id.contains("5h") {
                    "5h".into()
                } else {
                    "weekly".into()
                }
            });
            let duration_mins = match window_str.as_str() {
                "5h" => Some(300),
                "weekly" => Some(10080),
                _ => {
                    if rb.id.contains("5h") {
                        Some(300)
                    } else if rb.id.contains("weekly") {
                        Some(10080)
                    } else {
                        None
                    }
                }
            };
            let fraction = rb.remaining_fraction.unwrap_or(1.0);
            let remaining_percent = (fraction * 100.0).round().clamp(0.0, 100.0) as u32;
            let used_percent = 100_u32.saturating_sub(remaining_percent);
            let resets_at = rb.reset_time.as_deref().and_then(parse_iso_to_unix);

            let bucket = AgyQuotaBucket {
                id: rb.id,
                name: rb.name,
                description: rb.description,
                window: window_str,
                window_duration_mins: duration_mins,
                used_percent,
                remaining_percent,
                remaining_fraction: fraction,
                reset_time: rb.reset_time,
                resets_at,
            };
            buckets.push(bucket);
        }

        buckets.sort_by_key(|b| b.window_duration_mins.unwrap_or(i64::MAX));

        if is_gemini || (g_idx == 0 && primary_windows.is_empty()) {
            primary_windows = buckets.clone();
        }

        groups.push(AgyQuotaGroup {
            name: rg.name,
            description: rg.description,
            buckets,
        });
    }

    if groups.is_empty() || primary_windows.is_empty() {
        bail!("No quota buckets found in agy response");
    }

    Ok(AgyQuotaSnapshot {
        status: "ready".into(),
        source_id: Some(source_id),
        source_label: Some(source_label),
        fetched_at: Some(Utc::now().to_rfc3339()),
        plan_type: Some("AI Pro".to_string()),
        description,
        groups,
        windows: primary_windows,
        error: None,
    })
}

fn parse_text_output(
    text: &str,
    source_id: String,
    source_label: String,
) -> Result<AgyQuotaSnapshot> {
    let mut groups_map: std::collections::BTreeMap<String, Vec<AgyQuotaBucket>> =
        std::collections::BTreeMap::new();

    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("Quota:") {
            continue;
        }
        let parts: Vec<&str> = if line.contains('\t') {
            line.split('\t')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .collect()
        } else {
            line.split("  ")
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .collect()
        };
        if parts.len() >= 4 {
            let group_name = parts[0].to_string();
            let bucket_name = parts[1].to_string();
            let pct_str = parts[2].trim_end_matches('%');
            let reset_time = parts[3].to_string();

            let remaining_percent = pct_str.parse::<u32>().unwrap_or(100);
            let used_percent = 100_u32.saturating_sub(remaining_percent);
            let remaining_fraction = (remaining_percent as f64) / 100.0;
            let window =
                if bucket_name.to_lowercase().contains("five") || bucket_name.contains("5h") {
                    "5h".to_string()
                } else {
                    "weekly".to_string()
                };
            let window_duration_mins = if window == "5h" {
                Some(300)
            } else {
                Some(10080)
            };
            let resets_at = parse_iso_to_unix(&reset_time);

            let bucket = AgyQuotaBucket {
                id: format!("{}-{}", group_name.to_lowercase().replace(' ', "-"), window),
                name: bucket_name,
                description: None,
                window,
                window_duration_mins,
                used_percent,
                remaining_percent,
                remaining_fraction,
                reset_time: Some(reset_time),
                resets_at,
            };
            groups_map.entry(group_name).or_default().push(bucket);
        }
    }

    if groups_map.is_empty() {
        bail!(
            "Could not parse agy quota output: {}",
            text.chars().take(200).collect::<String>()
        );
    }

    let mut groups = Vec::new();
    let mut primary_windows = Vec::new();

    for (group_name, mut buckets) in groups_map {
        buckets.sort_by_key(|b| b.window_duration_mins.unwrap_or(i64::MAX));
        let is_gemini = group_name == "Gemini Models";
        if primary_windows.is_empty() || is_gemini {
            primary_windows = buckets.clone();
        }
        groups.push(AgyQuotaGroup {
            name: group_name,
            description: None,
            buckets,
        });
    }

    Ok(AgyQuotaSnapshot {
        status: "ready".into(),
        source_id: Some(source_id),
        source_label: Some(source_label),
        fetched_at: Some(Utc::now().to_rfc3339()),
        plan_type: Some("AI Pro".to_string()),
        description: None,
        groups,
        windows: primary_windows,
        error: None,
    })
}

fn parse_iso_to_unix(s: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|dt| dt.timestamp())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_agy_json_quota_with_5h_and_weekly_buckets() {
        let raw = json!({
            "conversation_id": "",
            "status": "SUCCESS",
            "command": {
                "name": "usage",
                "data": {
                    "description": "Models within each group share limits",
                    "groups": [
                        {
                            "name": "Gemini Models",
                            "description": "Gemini Flash, Gemini Pro",
                            "buckets": [
                                {
                                    "id": "gemini-weekly",
                                    "name": "Weekly Limit Remaining",
                                    "window": "weekly",
                                    "remaining_fraction": 0.375,
                                    "reset_time": "2026-09-11T04:56:07Z"
                                },
                                {
                                    "id": "gemini-5h",
                                    "name": "Five Hour Limit Remaining",
                                    "window": "5h",
                                    "remaining_fraction": 0.855,
                                    "reset_time": "2026-09-07T15:52:25Z"
                                }
                            ]
                        },
                        {
                            "name": "Claude and GPT models",
                            "description": "Claude Opus, GPT-OSS",
                            "buckets": [
                                {
                                    "id": "3p-weekly",
                                    "name": "Weekly Limit Remaining",
                                    "window": "weekly",
                                    "remaining_fraction": 1.0,
                                    "reset_time": "2026-09-14T14:19:01Z"
                                },
                                {
                                    "id": "3p-5h",
                                    "name": "Five Hour Limit Remaining",
                                    "window": "5h",
                                    "remaining_fraction": 1.0,
                                    "reset_time": "2026-09-07T19:19:01Z"
                                }
                            ]
                        }
                    ]
                }
            }
        })
        .to_string();

        let parsed = parse_response(&raw, "local".into(), "本机".into()).unwrap();
        assert_eq!(parsed.status, "ready");
        assert_eq!(parsed.plan_type.as_deref(), Some("AI Pro"));
        assert_eq!(parsed.groups.len(), 2);
        assert_eq!(parsed.windows.len(), 2);

        // First window should be 5h (sorted by duration)
        assert_eq!(parsed.windows[0].window, "5h");
        assert_eq!(parsed.windows[0].window_duration_mins, Some(300));
        assert_eq!(parsed.windows[0].remaining_percent, 86);
        assert_eq!(parsed.windows[0].used_percent, 14);
        assert_eq!(
            parsed.windows[0].reset_time.as_deref(),
            Some("2026-09-07T15:52:25Z")
        );
        assert!(parsed.windows[0].resets_at.is_some());

        // Second window should be weekly
        assert_eq!(parsed.windows[1].window, "weekly");
        assert_eq!(parsed.windows[1].window_duration_mins, Some(10080));
        assert_eq!(parsed.windows[1].remaining_percent, 38);
        assert_eq!(parsed.windows[1].used_percent, 62);
        assert_eq!(
            parsed.windows[1].reset_time.as_deref(),
            Some("2026-09-11T04:56:07Z")
        );
        assert!(parsed.windows[1].resets_at.is_some());
    }

    #[test]
    fn parses_agy_plain_text_quota() {
        let text = "Quota:\nGemini Models\tWeekly Limit Remaining\t38%\t2026-09-11T04:56:07Z\nGemini Models\tFive Hour Limit Remaining\t86%\t2026-09-07T15:52:25Z\n";
        let parsed = parse_response(text, "local".into(), "本机".into()).unwrap();
        assert_eq!(parsed.status, "ready");
        assert_eq!(parsed.plan_type.as_deref(), Some("AI Pro"));
        assert_eq!(parsed.windows.len(), 2);
        assert_eq!(parsed.windows[0].window, "5h");
        assert_eq!(parsed.windows[0].remaining_percent, 86);
        assert_eq!(parsed.windows[1].window, "weekly");
        assert_eq!(parsed.windows[1].remaining_percent, 38);
    }
}
