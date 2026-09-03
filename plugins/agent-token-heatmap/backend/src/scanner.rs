use crate::model::{AgentKind, FileUsage, ScanBatch};
use crate::parsers;
use anyhow::Result;
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
        AgentKind::Zcode => home.join(".zcode/cli"),
        AgentKind::Agy => home.join(".gemini/antigravity-cli/conversations"),
    }
}

pub fn default_remote_root(agent: AgentKind) -> &'static str {
    match agent {
        AgentKind::Codex => "~/.codex/sessions",
        AgentKind::Claude => "~/.claude/projects",
        AgentKind::Pi => "~/.pi/agent/sessions",
        AgentKind::Zcode => "~/.zcode/cli",
        AgentKind::Agy => "~/.gemini/antigravity-cli/conversations",
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
        collect_session_files(&root, &mut paths)?;
        let mut seen = Vec::new();
        for path in paths {
            let relative = path.strip_prefix(&root).unwrap_or(&path);
            let hash = file_hash(agent, relative);
            let metadata = match fs::metadata(&path) {
                Ok(metadata) => metadata,
                Err(error) => {
                    batch.warnings.push(format!(
                        "{} skipped an unreadable session file: {error}",
                        agent.as_str()
                    ));
                    continue;
                }
            };
            let size = metadata.len();
            let modified = metadata
                .modified()
                .ok()
                .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
                .map(|value| value.as_secs() as i64)
                .unwrap_or(0);
            let fingerprint = format!("{size}:{modified}");
            if known.get(&agent).and_then(|items| items.get(&hash)) == Some(&fingerprint) {
                seen.push(hash);
                continue;
            }

            let is_sqlite = path
                .extension()
                .is_some_and(|ext| ext == "db" || ext == "sqlite");

            let (daily, invalid) = if is_sqlite {
                match parsers::parse_sqlite(agent, &path) {
                    Ok(parsed) => parsed,
                    Err(error) => {
                        batch.warnings.push(format!(
                            "{} skipped an unreadable database file: {error}",
                            agent.as_str()
                        ));
                        continue;
                    }
                }
            } else {
                let content = match fs::read_to_string(&path) {
                    Ok(content) => content,
                    Err(error) => {
                        batch.warnings.push(format!(
                            "{} skipped an unreadable session file: {error}",
                            agent.as_str()
                        ));
                        continue;
                    }
                };
                parsers::parse(agent, &content)
            };

            seen.push(hash.clone());

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

fn collect_session_files(root: &Path, output: &mut Vec<PathBuf>) -> Result<()> {
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if file_type.is_dir() {
            if matches!(
                name_str.as_ref(),
                "node_modules" | "asset-cache" | ".git" | "tools" | "build" | "dist"
            ) {
                continue;
            }
            collect_session_files(&path, output)?;
        } else if file_type.is_file() {
            if name_str.ends_with("-wal")
                || name_str.ends_with("-shm")
                || name_str.ends_with("-journal")
            {
                continue;
            }
            let is_supported = path
                .extension()
                .is_some_and(|ext| ext == "jsonl" || ext == "db" || ext == "sqlite");
            if is_supported {
                output.push(path);
            }
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

    #[test]
    fn unreadable_session_files_do_not_abort_a_scan() {
        let root = std::env::temp_dir().join(format!(
            "digiworld-invalid-session-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("invalid.jsonl"), [0xff, 0xfe]).unwrap();
        let batch = scan_local(
            &[AgentKind::Codex],
            &BTreeMap::from([(AgentKind::Codex, root.to_string_lossy().into_owned())]),
            &BTreeMap::new(),
        )
        .unwrap();
        assert!(batch.files.is_empty());
        assert!(batch.seen[&AgentKind::Codex].is_empty());
        assert_eq!(batch.warnings.len(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn collect_session_files_filters_and_finds_supported_extensions() {
        let root = std::env::temp_dir().join(format!(
            "digiworld-collect-files-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::create_dir_all(root.join("sub")).unwrap();
        fs::create_dir_all(root.join("node_modules/sub")).unwrap();
        fs::write(root.join("test.jsonl"), "").unwrap();
        fs::write(root.join("sub/session.db"), "").unwrap();
        fs::write(root.join("sub/data.sqlite"), "").unwrap();
        fs::write(root.join("sub/data.sqlite-wal"), "").unwrap();
        fs::write(root.join("sub/data.sqlite-shm"), "").unwrap();
        fs::write(root.join("node_modules/sub/skip.jsonl"), "").unwrap();

        let mut output = Vec::new();
        collect_session_files(&root, &mut output).unwrap();
        assert_eq!(output.len(), 3);
        let names: Vec<String> = output
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert!(names.contains(&"test.jsonl".to_string()));
        assert!(names.contains(&"session.db".to_string()));
        assert!(names.contains(&"data.sqlite".to_string()));
        assert!(!names.contains(&"skip.jsonl".to_string()));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn scans_real_agy_conversations_if_present() {
        let root = default_root(AgentKind::Agy);
        if !root.exists() {
            return;
        }
        let batch = scan_local(&[AgentKind::Agy], &BTreeMap::new(), &BTreeMap::new()).unwrap();
        assert!(!batch.files.is_empty());
        let total_in: u64 = batch
            .files
            .iter()
            .flat_map(|f| &f.daily)
            .map(|d| d.usage.input_tokens)
            .sum();
        assert!(total_in > 0);
    }
}
