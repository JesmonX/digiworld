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

def read_varint(data, offset):
    res, shift = 0, 0
    while offset < len(data):
        b = data[offset]
        offset += 1
        res |= (b & 0x7f) << shift
        if not (b & 0x80): return res, offset
        shift += 7
    return None, offset

def agy_proto(data):
    offset, t_sec, usage_bytes = 0, None, None
    while offset < len(data):
        tw, offset = read_varint(data, offset)
        if tw is None: break
        tag, wire = tw >> 3, tw & 7
        if wire == 2:
            l, offset = read_varint(data, offset)
            if l is None or offset + l > len(data): break
            sub = data[offset:offset+l]
            offset += l
            if tag == 9: usage_bytes = sub
            elif tag in (1, 6) and t_sec is None:
                so = 0
                while so < len(sub):
                    stw, so = read_varint(sub, so)
                    if stw is None: break
                    stag, swire = stw >> 3, stw & 7
                    if stag == 1 and swire == 0:
                        val, so = read_varint(sub, so)
                        if val is not None: t_sec = val; break
                    elif swire == 0: _, so = read_varint(sub, so)
                    elif swire == 2:
                        sl, so = read_varint(sub, so)
                        if sl is not None: so += sl
                    elif swire == 1: so += 8
                    elif swire == 5: so += 4
                    else: break
        elif wire == 0: _, offset = read_varint(data, offset)
        elif wire == 1: offset += 8
        elif wire == 5: offset += 4
        else: break
    if not usage_bytes: return None
    so, m_id, inp, out, cache = 0, 0, 0, 0, 0
    while so < len(usage_bytes):
        tw, so = read_varint(usage_bytes, so)
        if tw is None: break
        tag, wire = tw >> 3, tw & 7
        if wire == 0:
            val, so = read_varint(usage_bytes, so)
            if val is None: break
            if tag == 1: m_id = val
            elif tag == 2: inp = val
            elif tag == 3: out = val
            elif tag == 5: cache = val
        elif wire == 2:
            l, so = read_varint(usage_bytes, so)
            if l is not None: so += l
        elif wire == 1: so += 8
        elif wire == 5: so += 4
        else: break
    if inp == 0 and out == 0 and cache == 0: return None
    names = {1318: 'gemini-3.8-flash', 1016: 'gemini-3.5-flash', 1026: 'claude-opus-4-6', 1050: 'gemini-3.1-pro', 0: 'gemini'}
    model = names.get(m_id, f'model-{m_id}')
    return t_sec, model, {'inputTokens': inp + cache, 'outputTokens': out, 'cacheReadTokens': cache, 'cacheWriteTokens': 0, 'cacheAvailable': True}

def parse_sqlite(agent, path):
    rows, invalid = {}, 0
    import sqlite3
    try:
        conn = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
        cur = conn.cursor()
        if agent == 'agy':
            cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='steps'")
            if not cur.fetchone(): return [], 0
            cur.execute("SELECT metadata FROM steps WHERE metadata IS NOT NULL")
            for (meta,) in cur.fetchall():
                if not meta: continue
                parsed = agy_proto(meta)
                if parsed:
                    stamp, model, usage = parsed
                    add(rows, stamp, model, usage)
        elif agent == 'zcode':
            cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='model_usage'")
            if not cur.fetchone(): return [], 0
            cur.execute("SELECT started_at, model_id, input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens FROM model_usage")
            for r in cur.fetchall():
                stamp, m_id, inp, out, cr, cw = r[0], r[1], int(r[2] or 0), int(r[3] or 0), int(r[4] or 0), int(r[5] or 0)
                model = str(m_id).strip() if m_id else 'unknown'
                usage = {'inputTokens': inp + cr + cw, 'outputTokens': out, 'cacheReadTokens': cr, 'cacheWriteTokens': cw, 'cacheAvailable': cr > 0 or cw > 0}
                add(rows, stamp, model, usage)
        conn.close()
    except Exception:
        invalid += 1
    return [value for key, value in sorted(rows.items())], invalid

def parse_file(agent, path):
    if path.endswith('.db') or path.endswith('.sqlite'):
        return parse_sqlite(agent, path)
    rows, previous, invalid, model = {}, {}, 0, 'unknown'
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
            candidate = None
            if agent == 'codex':
                candidate = clean_model(payload.get('model') or (payload.get('thread_settings') or {}).get('model'))
            elif agent in ('claude', 'pi'):
                candidate = clean_model(message.get('model') or value.get('model'))
            elif agent == 'zcode':
                candidate = clean_model(value.get('model') or value.get('model_id') or (value.get('context') or {}).get('model'))
            elif agent == 'agy':
                candidate = clean_model(value.get('model') or value.get('model_name'))
            if candidate: model = candidate
            if agent == 'codex' and value.get('type') == 'event_msg' and (value.get('payload') or {}).get('type') == 'token_count':
                info = ((value.get('payload') or {}).get('info') or {})
                last_raw = info.get('last_token_usage')
                tot_raw = info.get('total_token_usage')
                if isinstance(last_raw, dict):
                    usage = {'inputTokens': n(last_raw, 'input_tokens'), 'outputTokens': n(last_raw, 'output_tokens'), 'cacheReadTokens': n(last_raw, 'cached_input_tokens'), 'cacheWriteTokens': n(last_raw, 'cache_write_input_tokens'), 'cacheAvailable': 'cached_input_tokens' in last_raw or 'cache_write_input_tokens' in last_raw}
                    if isinstance(tot_raw, dict):
                        previous[model] = {'inputTokens': n(tot_raw, 'input_tokens'), 'outputTokens': n(tot_raw, 'output_tokens'), 'cacheReadTokens': n(tot_raw, 'cached_input_tokens'), 'cacheWriteTokens': n(tot_raw, 'cache_write_input_tokens'), 'cacheAvailable': 'cached_input_tokens' in tot_raw or 'cache_write_input_tokens' in tot_raw}
                elif isinstance(tot_raw, dict):
                    current = {'inputTokens': n(tot_raw, 'input_tokens'), 'outputTokens': n(tot_raw, 'output_tokens'), 'cacheReadTokens': n(tot_raw, 'cached_input_tokens'), 'cacheWriteTokens': n(tot_raw, 'cache_write_input_tokens'), 'cacheAvailable': 'cached_input_tokens' in tot_raw or 'cache_write_input_tokens' in tot_raw}
                    prev = previous.get(model)
                    if prev is not None:
                        usage = {key: current[key] if current[key] < prev[key] else current[key] - prev[key] for key in ('inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens')}
                        usage['cacheAvailable'] = current['cacheAvailable']
                    else: usage = current
                    previous[model] = current
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
            elif agent == 'zcode':
                raw = value.get('usage') or value
                stamp = stamp or value.get('started_at') or value.get('time')
                inp = n(raw, 'input_tokens') or n(raw, 'inputTokens') or n(raw, 'input')
                out = n(raw, 'output_tokens') or n(raw, 'outputTokens') or n(raw, 'output')
                read = n(raw, 'cache_read_input_tokens') or n(raw, 'cacheReadInputTokens') or n(raw, 'cache_read_tokens') or n(raw, 'cacheReadTokens') or n(raw, 'cacheRead')
                write = n(raw, 'cache_creation_input_tokens') or n(raw, 'cacheCreationInputTokens') or n(raw, 'cache_write_tokens') or n(raw, 'cacheWriteTokens') or n(raw, 'cacheWrite')
                if inp or out or read or write:
                    usage = {'inputTokens': inp + read + write, 'outputTokens': out, 'cacheReadTokens': read, 'cacheWriteTokens': write, 'cacheAvailable': bool(read or write)}
            elif agent == 'agy':
                raw = value.get('usage') or value
                stamp = stamp or value.get('created_at')
                prompt = n(raw, 'prompt_token_count') or n(raw, 'promptTokenCount') or n(raw, 'input_tokens') or n(raw, 'input')
                cand = n(raw, 'candidates_token_count') or n(raw, 'candidatesTokenCount') or n(raw, 'output_tokens') or n(raw, 'output')
                cached = n(raw, 'cached_content_token_count') or n(raw, 'cachedContentTokenCount') or n(raw, 'cache_read_tokens') or n(raw, 'cacheRead')
                if prompt or cand or cached:
                    usage = {'inputTokens': prompt + cached, 'outputTokens': cand, 'cacheReadTokens': cached, 'cacheWriteTokens': 0, 'cacheAvailable': bool(cached)}
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
        dirs[:] = [name for name in dirs if not os.path.islink(os.path.join(base, name)) and name not in ('node_modules', 'asset-cache', '.git', 'tools', 'build', 'dist')]
        for name in files:
            if not (name.endswith('.jsonl') or name.endswith('.db') or name.endswith('.sqlite')): continue
            if name.endswith('-wal') or name.endswith('-shm') or name.endswith('-journal'): continue
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

    #[test]
    fn python_helper_counts_agy_cached_tokens_as_input() {
        let root = std::env::temp_dir().join(format!(
            "digiworld-remote-agy-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::create_dir_all(&root).unwrap();
        fs::write(
            root.join("session.jsonl"),
            r#"{"created_at":"2026-09-02T01:00:00Z","model":"gemini-3.8-flash","usage":{"prompt_token_count":100,"candidates_token_count":40,"cached_content_token_count":60}}"#,
        )
        .unwrap();
        let request = serde_json::json!({
            "agents": ["agy"],
            "roots": {"agy": root.to_string_lossy()},
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
        let batch: ScanBatch = serde_json::from_slice(&output.stdout).unwrap();
        let usage = &batch.files[0].daily[0].usage;
        assert_eq!(usage.input_tokens, 160);
        assert_eq!(usage.output_tokens, 40);
        assert_eq!(usage.cache_read_tokens, 60);
        assert!(usage.cache_read_tokens <= usage.input_tokens);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn python_helper_parses_zcode_sqlite() {
        let root = std::env::temp_dir().join(format!(
            "digiworld-remote-zcode-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::create_dir_all(&root).unwrap();
        let db_path = root.join("db.sqlite");
        {
            let conn = rusqlite::Connection::open(&db_path).unwrap();
            conn.execute(
                "CREATE TABLE model_usage (
                    id TEXT PRIMARY KEY,
                    started_at INTEGER,
                    model_id TEXT,
                    input_tokens INTEGER,
                    output_tokens INTEGER,
                    cache_read_input_tokens INTEGER,
                    cache_creation_input_tokens INTEGER
                )",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO model_usage VALUES ('1', 1788422828000, 'GLM-5.3', 50, 10, 20, 5)",
                [],
            )
            .unwrap();
        }
        let request = serde_json::json!({
            "agents": ["zcode"],
            "roots": {"zcode": root.to_string_lossy()},
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
        let batch: ScanBatch = serde_json::from_str(&text).unwrap();
        assert_eq!(batch.files.len(), 1);
        assert_eq!(batch.files[0].daily.len(), 1);
        assert_eq!(batch.files[0].daily[0].model, "GLM-5.3");
        assert_eq!(batch.files[0].daily[0].usage.input_tokens, 75);
        assert_eq!(batch.files[0].daily[0].usage.output_tokens, 10);
        assert_eq!(batch.files[0].daily[0].usage.cache_read_tokens, 20);
        fs::remove_dir_all(root).unwrap();
    }
}
