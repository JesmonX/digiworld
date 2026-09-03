use crate::model::{AgentKind, ScanBatch, SshSource};
use crate::scanner::default_remote_root;
use anyhow::{Context, Result, bail};
use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const MAX_REMOTE_OUTPUT: usize = 64 * 1024 * 1024;

pub fn validate_source(source: &SshSource) -> Result<()> {
    if source.id.trim().is_empty()
        || source.id.len() > 80
        || !source
            .id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte))
    {
        bail!("SSH source id must be between 1 and 80 characters");
    }
    if source.label.trim().is_empty() || source.label.len() > 80 {
        bail!("SSH source label must be between 1 and 80 characters");
    }
    if source.host.is_empty()
        || source.host.starts_with('-')
        || source.host.len() > 253
        || !source
            .host
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
    {
        bail!("SSH Host must be a safe OpenSSH config alias");
    }
    if source.enabled_agents.is_empty() {
        bail!("select at least one agent for the SSH source");
    }
    Ok(())
}

pub fn scan_remote(
    source: &SshSource,
    known: &BTreeMap<AgentKind, BTreeMap<String, String>>,
) -> Result<ScanBatch> {
    validate_source(source)?;
    let roots: BTreeMap<_, _> = source
        .enabled_agents
        .iter()
        .map(|&agent| {
            (
                agent.as_str(),
                source
                    .roots
                    .get(&agent)
                    .cloned()
                    .unwrap_or_else(|| default_remote_root(agent).into()),
            )
        })
        .collect();
    let request = serde_json::json!({
        "agents": source.enabled_agents.iter().map(|agent| agent.as_str()).collect::<Vec<_>>(),
        "roots": roots,
        "known": known,
        "offsetMinutes": chrono::Local::now().offset().local_minus_utc() / 60,
    });
    run_helper(&source.host, &serde_json::to_vec(&request)?)
}

fn run_helper(host: &str, request: &[u8]) -> Result<ScanBatch> {
    let encoded = hex_encode(REMOTE_HELPER.as_bytes());
    let remote_command = format!("python3 -c 'exec(bytes.fromhex(\"{encoded}\").decode())'");
    let mut child = Command::new(ssh_executable())
        .args([
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
            "ServerAliveCountMax=2",
            host,
            &remote_command,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .with_context(|| "start system OpenSSH client")?;
    child
        .stdin
        .take()
        .context("SSH stdin unavailable")?
        .write_all(request)?;
    let mut stdout = child.stdout.take().context("SSH stdout unavailable")?;
    let mut stderr = child.stderr.take().context("SSH stderr unavailable")?;
    let stdout_reader = thread::spawn(move || {
        let mut value = Vec::new();
        stdout.read_to_end(&mut value).map(|_| value)
    });
    let stderr_reader = thread::spawn(move || {
        let mut value = Vec::new();
        stderr.read_to_end(&mut value).map(|_| value)
    });
    let started = Instant::now();
    let mut timed_out = false;
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if started.elapsed() > Duration::from_secs(120) {
            let _ = child.kill();
            let status = child.wait()?;
            timed_out = true;
            break status;
        }
        thread::sleep(Duration::from_millis(50));
    };
    let stdout = stdout_reader
        .join()
        .map_err(|_| anyhow::anyhow!("SSH stdout reader failed"))??;
    let stderr = stderr_reader
        .join()
        .map_err(|_| anyhow::anyhow!("SSH stderr reader failed"))??;
    if timed_out {
        bail!("SSH usage scan timed out after 120 seconds");
    }
    if !status.success() {
        let message = String::from_utf8_lossy(&stderr);
        bail!(
            "SSH scan failed: {}",
            message.trim().chars().take(500).collect::<String>()
        );
    }
    if stdout.len() > MAX_REMOTE_OUTPUT {
        bail!("SSH usage result exceeds 64 MiB");
    }
    serde_json::from_slice(&stdout).context("parse SSH usage result")
}

fn ssh_executable() -> &'static str {
    if cfg!(windows) { "ssh.exe" } else { "ssh" }
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

const REMOTE_HELPER: &str = r#"
import datetime, hashlib, json, os, sys

request = json.load(sys.stdin)
offset = datetime.timezone(datetime.timedelta(minutes=int(request.get('offsetMinutes', 0))))
result = {'files': [], 'seen': {}, 'warnings': []}

def n(value, key):
    candidate = value.get(key, 0) if isinstance(value, dict) else 0
    return int(candidate) if isinstance(candidate, (int, float)) and candidate >= 0 else 0

def day(value):
    if not value:
        return datetime.datetime.now(offset).strftime('%Y-%m-%d')
    try:
        if isinstance(value, (int, float)) or (isinstance(value, str) and value.strip().isdigit()):
            stamp = float(value)
            if stamp > 1e11: stamp /= 1000.0
            return datetime.datetime.fromtimestamp(stamp, offset).strftime('%Y-%m-%d')
        parsed = datetime.datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=datetime.timezone.utc)
        return parsed.astimezone(offset).strftime('%Y-%m-%d')
    except Exception:
        return datetime.datetime.now(offset).strftime('%Y-%m-%d')

def clean_model(value):
    return value.strip() if isinstance(value, str) and value.strip() and value != '<synthetic>' else None

def add(rows, stamp, model, usage):
    if not any(value for key, value in usage.items() if key != 'cacheAvailable'): return
    key = (day(stamp), model)
    target = rows.setdefault(key, {'day': key[0], 'model': model, 'inputTokens': 0, 'outputTokens': 0, 'cacheReadTokens': 0, 'cacheWriteTokens': 0, 'cacheAvailable': False})
    for name in ('inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'): target[name] += max(0, int(usage.get(name, 0)))
    target['cacheAvailable'] = target['cacheAvailable'] or bool(usage.get('cacheAvailable', False))

def parse_file(agent, path):
    rows, previous, invalid, model = {}, None, 0, 'unknown'
    with open(path, 'r', encoding='utf-8', errors='replace') as handle:
        for line in handle:
            if not line.strip(): continue
            try: value = json.loads(line)
            except Exception:
                invalid += 1
                continue
            stamp, usage = value.get('timestamp'), None
            payload = value.get('payload') or {}
            message = value.get('message') or {}
            candidate = clean_model(payload.get('model') or (payload.get('thread_settings') or {}).get('model')) if agent == 'codex' else clean_model(message.get('model') or value.get('model'))
            if candidate: model = candidate
            if agent == 'codex' and value.get('type') == 'event_msg' and (value.get('payload') or {}).get('type') == 'token_count':
                info = ((value.get('payload') or {}).get('info') or {})
                raw = info.get('total_token_usage') or info.get('last_token_usage')
                if isinstance(raw, dict):
                    current = {'inputTokens': n(raw, 'input_tokens'), 'outputTokens': n(raw, 'output_tokens'), 'cacheReadTokens': n(raw, 'cached_input_tokens'), 'cacheWriteTokens': n(raw, 'cache_write_input_tokens'), 'cacheAvailable': 'cached_input_tokens' in raw or 'cache_write_input_tokens' in raw}
                    if info.get('total_token_usage') and previous is not None:
                        usage = {key: current[key] if current[key] < previous[key] else current[key] - previous[key] for key in ('inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens')}
                        usage['cacheAvailable'] = current['cacheAvailable']
                    else: usage = current
                    if info.get('total_token_usage'): previous = current
            elif agent == 'claude':
                raw = message.get('usage') or value.get('usage')
                stamp = stamp or message.get('timestamp')
                if isinstance(raw, dict):
                    read, write = n(raw, 'cache_read_input_tokens'), n(raw, 'cache_creation_input_tokens')
                    usage = {'inputTokens': n(raw, 'input_tokens') + read + write, 'outputTokens': n(raw, 'output_tokens'), 'cacheReadTokens': read, 'cacheWriteTokens': write, 'cacheAvailable': 'cache_read_input_tokens' in raw or 'cache_creation_input_tokens' in raw}
            elif agent == 'pi':
                raw = message.get('usage') or value.get('usage')
                stamp = stamp or message.get('timestamp')
                if isinstance(raw, dict):
                    read, write = n(raw, 'cacheRead'), n(raw, 'cacheWrite')
                    usage = {'inputTokens': n(raw, 'input') + read + write, 'outputTokens': n(raw, 'output'), 'cacheReadTokens': read, 'cacheWriteTokens': write, 'cacheAvailable': 'cacheRead' in raw or 'cacheWrite' in raw}
            if usage: add(rows, stamp, model, usage)
    return [value for key, value in sorted(rows.items())], invalid

for agent in request.get('agents', []):
    root = os.path.abspath(os.path.expanduser(request.get('roots', {}).get(agent, '')))
    known = request.get('known', {}).get(agent, {})
    seen = []
    if not os.path.isdir(root):
        result['warnings'].append(agent + ' data directory was not found')
        continue
    for base, dirs, files in os.walk(root, followlinks=False):
        dirs[:] = [name for name in dirs if not os.path.islink(os.path.join(base, name))]
        for name in files:
            if not name.endswith('.jsonl'): continue
            path = os.path.join(base, name)
            try:
                relative = os.path.relpath(path, root).replace(os.sep, '/')
                file_hash = hashlib.sha256((agent + '\0' + relative).encode()).hexdigest()
                seen.append(file_hash)
                stat = os.stat(path)
                fingerprint = str(stat.st_size) + ':' + str(int(stat.st_mtime))
                if known.get(file_hash) == fingerprint: continue
                daily, invalid = parse_file(agent, path)
                if invalid: result['warnings'].append(agent + ' skipped ' + str(invalid) + ' malformed record(s)')
                result['files'].append({'agent': agent, 'fileHash': file_hash, 'size': stat.st_size, 'modified': int(stat.st_mtime), 'daily': daily})
            except Exception:
                result['warnings'].append(agent + ' could not read one session file')
    result['seen'][agent] = seen
json.dump(result, sys.stdout, separators=(',', ':'))
"#;

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn python_helper_returns_usage_without_content_or_paths() {
        let root = std::env::temp_dir().join(format!(
            "digiworld-remote-helper-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::create_dir_all(&root).unwrap();
        let session = root.join("private-project.jsonl");
        fs::write(
            &session,
            concat!(
                r#"{"timestamp":"2026-09-02T01:00:00Z","message":{"model":"glm-5.3","content":"TOP_SECRET","usage":{"input":10,"output":3,"cacheRead":20,"cacheWrite":2}}}"#,
                "\n",
                r#"{"timestamp":1719878400000,"message":{"model":"glm-5.3","usage":{"input":4,"output":1}}}"#,
            ),
        )
        .unwrap();
        let request = serde_json::json!({
            "agents": ["pi"],
            "roots": {"pi": root.to_string_lossy()},
            "known": {},
            "offsetMinutes": 0,
        });
        let mut child = Command::new("python3")
            .args(["-c", REMOTE_HELPER])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(&serde_json::to_vec(&request).unwrap())
            .unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(output.status.success());
        let text = String::from_utf8(output.stdout).unwrap();
        assert!(!text.contains("TOP_SECRET"));
        assert!(!text.contains("private-project"));
        let batch: ScanBatch = serde_json::from_str(&text).unwrap();
        assert_eq!(batch.files[0].daily.len(), 2);
        assert!(
            batch.files[0]
                .daily
                .iter()
                .any(|row| row.day == "2024-07-02")
        );
        assert_eq!(
            batch.files[0]
                .daily
                .iter()
                .map(|row| row.usage.input_tokens)
                .sum::<u64>(),
            36
        );
        fs::remove_dir_all(root).unwrap();
    }
}
