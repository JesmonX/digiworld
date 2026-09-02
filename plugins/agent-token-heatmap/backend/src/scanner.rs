use crate::model::{AgentKind, FileUsage, ScanBatch};
use crate::parsers;
use anyhow::{Context, Result};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

pub fn default_root(agent: AgentKind) -> PathBuf {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    match agent {
        AgentKind::Codex => home.join(".codex/sessions"),
        AgentKind::Claude => home.join(".claude/projects"),
        AgentKind::Pi => home.join(".pi/agent/sessions"),
    }
}

pub fn default_remote_root(agent: AgentKind) -> &'static str {
    match agent {
        AgentKind::Codex => "~/.codex/sessions",
        AgentKind::Claude => "~/.claude/projects",
        AgentKind::Pi => "~/.pi/agent/sessions",
    }
}

pub fn scan_local(
    agents: &[AgentKind],
    roots: &BTreeMap<AgentKind, String>,
    known: &BTreeMap<AgentKind, BTreeMap<String, String>>,
) -> Result<ScanBatch> {
    let mut batch = ScanBatch::default();
    for &agent in agents {
        let root = roots
            .get(&agent)
            .map(|value| expand_home(value))
            .unwrap_or_else(|| default_root(agent));
        if !root.exists() {
            batch
                .warnings
                .push(format!("{} data directory was not found", agent.as_str()));
            // Do not mark the agent as fully scanned: keeping `seen` absent makes
            // the database retain the last good aggregate if a configured mount
            // or home directory is temporarily unavailable.
            continue;
        }
        let mut paths = Vec::new();
        collect_jsonl(&root, &mut paths)?;
        let mut seen = Vec::new();
        for path in paths {
            let relative = path.strip_prefix(&root).unwrap_or(&path);
            let hash = file_hash(agent, relative);
            let metadata = fs::metadata(&path)?;
            let size = metadata.len();
            let modified = metadata
                .modified()
                .ok()
                .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
                .map(|value| value.as_secs() as i64)
                .unwrap_or(0);
            seen.push(hash.clone());
            let fingerprint = format!("{size}:{modified}");
            if known.get(&agent).and_then(|items| items.get(&hash)) == Some(&fingerprint) {
                continue;
            }
            let content = fs::read_to_string(&path)
                .with_context(|| format!("read {} session data", agent.as_str()))?;
            let (daily, invalid) = parsers::parse(agent, &content);
            if invalid > 0 {
                batch.warnings.push(format!(
                    "{} skipped {invalid} malformed record(s)",
                    agent.as_str()
                ));
            }
            batch.files.push(FileUsage {
                agent,
                file_hash: hash,
                size,
                modified,
                daily,
            });
        }
        batch.seen.insert(agent, seen);
    }
    Ok(batch)
}

pub fn file_hash(agent: AgentKind, relative: &Path) -> String {
    let mut digest = Sha256::new();
    digest.update(agent.as_str().as_bytes());
    digest.update([0]);
    digest.update(relative.to_string_lossy().replace('\\', "/").as_bytes());
    hex_string(&digest.finalize())
}

fn collect_jsonl(root: &Path, output: &mut Vec<PathBuf>) -> Result<()> {
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            collect_jsonl(&entry.path(), output)?;
        } else if file_type.is_file()
            && entry
                .path()
                .extension()
                .is_some_and(|value| value == "jsonl")
        {
            output.push(entry.path());
        }
    }
    Ok(())
}

fn expand_home(value: &str) -> PathBuf {
    let value = value.trim();
    if value == "~" || value.starts_with("~/") || value.starts_with("~\\") {
        let home = std::env::var_os("USERPROFILE")
            .or_else(|| std::env::var_os("HOME"))
            .map(PathBuf::from)
            .unwrap_or_default();
        return if value.len() == 1 {
            home
        } else {
            home.join(&value[2..])
        };
    }
    PathBuf::from(value)
}

fn hex_string(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0xf) as usize] as char);
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_do_not_expose_paths() {
        let hash = file_hash(
            AgentKind::Claude,
            Path::new("private-project/session.jsonl"),
        );
        assert_eq!(hash.len(), 64);
        assert!(!hash.contains("private"));
    }

    #[test]
    fn missing_roots_do_not_request_cached_data_deletion() {
        let missing = std::env::temp_dir().join(format!(
            "digiworld-missing-root-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let batch = scan_local(
            &[AgentKind::Codex],
            &BTreeMap::from([(AgentKind::Codex, missing.to_string_lossy().into_owned())]),
            &BTreeMap::new(),
        )
        .unwrap();
        assert!(!batch.seen.contains_key(&AgentKind::Codex));
        assert_eq!(batch.warnings.len(), 1);
    }
}
