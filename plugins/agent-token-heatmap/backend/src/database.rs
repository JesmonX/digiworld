use crate::model::{
    AgentKind, Breakdown, DaySnapshot, FileUsage, ScanBatch, SnapshotRequest, SourceStatus,
    TokenUsage, UsageSettings, UsageSnapshot, UsageTotals,
};
use anyhow::{Context, Result};
use chrono::{Duration, Local};
use rusqlite::{Connection, OptionalExtension, params};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

const PARSER_VERSION: i64 = 1;

pub struct Database {
    connection: Connection,
}

impl Database {
    pub fn open(path: &Path) -> Result<Self> {
        let connection = Connection::open(path)
            .with_context(|| format!("open token database at {}", path.display()))?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS source_files (
                source_id TEXT NOT NULL,
                agent TEXT NOT NULL,
                file_hash TEXT NOT NULL,
                size INTEGER NOT NULL,
                modified INTEGER NOT NULL,
                parser_version INTEGER NOT NULL,
                PRIMARY KEY(source_id, agent, file_hash)
            );
            CREATE TABLE IF NOT EXISTS daily_file_usage (
                source_id TEXT NOT NULL,
                agent TEXT NOT NULL,
                file_hash TEXT NOT NULL,
                day TEXT NOT NULL,
                input_tokens INTEGER NOT NULL CHECK(input_tokens >= 0),
                output_tokens INTEGER NOT NULL CHECK(output_tokens >= 0),
                cache_read_tokens INTEGER NOT NULL CHECK(cache_read_tokens >= 0),
                cache_write_tokens INTEGER NOT NULL CHECK(cache_write_tokens >= 0),
                cache_available INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY(source_id, agent, file_hash, day)
            );
            CREATE TABLE IF NOT EXISTS source_status (
                source_id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                last_scanned_at TEXT,
                error TEXT,
                warnings_json TEXT NOT NULL DEFAULT '[]'
            );
            PRAGMA user_version = 1;
            ",
        )?;
        Ok(Self { connection })
    }

    pub fn settings(&self) -> Result<UsageSettings> {
        let value: Option<String> = self
            .connection
            .query_row(
                "SELECT value FROM settings WHERE key = 'usage'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        Ok(value
            .and_then(|value| serde_json::from_str(&value).ok())
            .unwrap_or_default())
    }

    pub fn save_settings(&self, settings: &UsageSettings) -> Result<()> {
        self.connection.execute(
            "INSERT INTO settings(key, value) VALUES('usage', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [serde_json::to_string(settings)?],
        )?;
        Ok(())
    }

    pub fn fingerprints(
        &self,
        source_id: &str,
    ) -> Result<BTreeMap<AgentKind, BTreeMap<String, String>>> {
        let mut statement = self.connection.prepare(
            "SELECT agent, file_hash, size, modified, parser_version
             FROM source_files WHERE source_id = ?1",
        )?;
        let rows = statement.query_map([source_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, u64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })?;
        let mut result = BTreeMap::<AgentKind, BTreeMap<String, String>>::new();
        for row in rows {
            let (agent, hash, size, modified, version) = row?;
            if version != PARSER_VERSION {
                continue;
            }
            if let Some(agent) = parse_agent(&agent) {
                result
                    .entry(agent)
                    .or_default()
                    .insert(hash, format!("{size}:{modified}"));
            }
        }
        Ok(result)
    }

    pub fn apply_scan(&mut self, source_id: &str, batch: &ScanBatch) -> Result<()> {
        let transaction = self.connection.transaction()?;
        for file in &batch.files {
            replace_file(&transaction, source_id, file)?;
        }
        for agent in AgentKind::ALL {
            let Some(seen) = batch.seen.get(&agent) else {
                continue;
            };
            let seen: BTreeSet<_> = seen.iter().map(String::as_str).collect();
            let mut statement = transaction.prepare(
                "SELECT file_hash FROM source_files WHERE source_id = ?1 AND agent = ?2",
            )?;
            let existing: Vec<String> = statement
                .query_map(params![source_id, agent.as_str()], |row| row.get(0))?
                .collect::<std::result::Result<_, _>>()?;
            drop(statement);
            for hash in existing
                .into_iter()
                .filter(|hash| !seen.contains(hash.as_str()))
            {
                transaction.execute(
                    "DELETE FROM daily_file_usage WHERE source_id = ?1 AND agent = ?2 AND file_hash = ?3",
                    params![source_id, agent.as_str(), hash],
                )?;
                transaction.execute(
                    "DELETE FROM source_files WHERE source_id = ?1 AND agent = ?2 AND file_hash = ?3",
                    params![source_id, agent.as_str(), hash],
                )?;
            }
        }
        transaction.execute(
            "INSERT INTO source_status(source_id, status, last_scanned_at, error, warnings_json)
             VALUES(?1, 'ready', ?2, NULL, ?3)
             ON CONFLICT(source_id) DO UPDATE SET status='ready', last_scanned_at=excluded.last_scanned_at,
               error=NULL, warnings_json=excluded.warnings_json",
            params![source_id, chrono::Utc::now().to_rfc3339(), serde_json::to_string(&batch.warnings)?],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn mark_error(&self, source_id: &str, error: &str) -> Result<()> {
        self.connection.execute(
            "INSERT INTO source_status(source_id, status, last_scanned_at, error, warnings_json)
             VALUES(?1, 'stale', NULL, ?2, '[]')
             ON CONFLICT(source_id) DO UPDATE SET status='stale', error=excluded.error",
            params![source_id, error],
        )?;
        Ok(())
    }

    pub fn snapshot(
        &self,
        request: &SnapshotRequest,
        settings: &UsageSettings,
    ) -> Result<UsageSnapshot> {
        let end = Local::now().date_naive();
        let start = match request.range.as_str() {
            "30" => Some(end - Duration::days(29)),
            "90" => Some(end - Duration::days(89)),
            "365" => Some(end - Duration::days(364)),
            "all" => None,
            _ => Some(end - Duration::days(364)),
        };
        let agents: BTreeSet<_> = request.agents.iter().copied().collect();
        let source_ids: BTreeSet<_> = if request.sources.is_empty() {
            std::iter::once("local".to_string())
                .chain(settings.ssh_sources.iter().map(|source| source.id.clone()))
                .collect()
        } else {
            request.sources.iter().cloned().collect()
        };
        let labels: BTreeMap<_, _> = std::iter::once(("local".to_string(), "本机".to_string()))
            .chain(
                settings
                    .ssh_sources
                    .iter()
                    .map(|source| (source.id.clone(), source.label.clone())),
            )
            .collect();

        let mut statement = self.connection.prepare(
            "SELECT source_id, agent, day, input_tokens, output_tokens,
                    cache_read_tokens, cache_write_tokens, cache_available
             FROM daily_file_usage ORDER BY day",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                TokenUsage {
                    input_tokens: row.get(3)?,
                    output_tokens: row.get(4)?,
                    cache_read_tokens: row.get(5)?,
                    cache_write_tokens: row.get(6)?,
                    cache_available: row.get(7)?,
                },
            ))
        })?;
        let mut totals = TokenUsage::default();
        let mut by_day = BTreeMap::<String, TokenUsage>::new();
        let mut breakdown = BTreeMap::<(String, AgentKind), TokenUsage>::new();
        for row in rows {
            let (source_id, agent, day, usage) = row?;
            let Some(agent) = parse_agent(&agent) else {
                continue;
            };
            if !source_ids.contains(&source_id) || (!agents.is_empty() && !agents.contains(&agent))
            {
                continue;
            }
            if start
                .is_some_and(|start| day.as_str() < start.format("%Y-%m-%d").to_string().as_str())
                || day.as_str() > end.format("%Y-%m-%d").to_string().as_str()
            {
                continue;
            }
            totals.add_assign(&usage);
            by_day.entry(day).or_default().add_assign(&usage);
            breakdown
                .entry((source_id, agent))
                .or_default()
                .add_assign(&usage);
        }
        let statuses = self.statuses(&source_ids)?;
        let total_tokens = totals.total_tokens();
        let cache_rate = (totals.cache_available && totals.input_tokens > 0)
            .then_some(totals.cache_read_tokens as f64 / totals.input_tokens as f64);
        Ok(UsageSnapshot {
            start_day: start.map(|day| day.format("%Y-%m-%d").to_string()),
            end_day: end.format("%Y-%m-%d").to_string(),
            totals: UsageTotals {
                usage: totals,
                total_tokens,
                cache_rate,
            },
            days: by_day
                .into_iter()
                .map(|(day, usage)| DaySnapshot {
                    total_tokens: usage.total_tokens(),
                    day,
                    usage,
                })
                .collect(),
            breakdown: breakdown
                .into_iter()
                .map(|((source_id, agent), usage)| Breakdown {
                    source_label: labels
                        .get(&source_id)
                        .cloned()
                        .unwrap_or_else(|| source_id.clone()),
                    total_tokens: usage.total_tokens(),
                    cache_rate: (usage.cache_available && usage.input_tokens > 0)
                        .then_some(usage.cache_read_tokens as f64 / usage.input_tokens as f64),
                    source_id,
                    agent,
                    usage,
                })
                .collect(),
            statuses,
        })
    }

    fn statuses(&self, sources: &BTreeSet<String>) -> Result<Vec<SourceStatus>> {
        let mut statement = self.connection.prepare(
            "SELECT source_id, status, last_scanned_at, error, warnings_json FROM source_status",
        )?;
        let rows = statement.query_map([], |row| {
            let warnings: String = row.get(4)?;
            Ok(SourceStatus {
                source_id: row.get(0)?,
                status: row.get(1)?,
                last_scanned_at: row.get(2)?,
                error: row.get(3)?,
                warnings: serde_json::from_str(&warnings).unwrap_or_default(),
            })
        })?;
        let mut values: BTreeMap<String, SourceStatus> = rows
            .collect::<std::result::Result<Vec<_>, _>>()?
            .into_iter()
            .map(|value| (value.source_id.clone(), value))
            .collect();
        Ok(sources
            .iter()
            .map(|id| {
                values.remove(id).unwrap_or(SourceStatus {
                    source_id: id.clone(),
                    status: "never".into(),
                    last_scanned_at: None,
                    error: None,
                    warnings: Vec::new(),
                })
            })
            .collect())
    }
}

fn replace_file(
    transaction: &rusqlite::Transaction<'_>,
    source_id: &str,
    file: &FileUsage,
) -> Result<()> {
    transaction.execute(
        "DELETE FROM daily_file_usage WHERE source_id = ?1 AND agent = ?2 AND file_hash = ?3",
        params![source_id, file.agent.as_str(), file.file_hash],
    )?;
    for row in &file.daily {
        transaction.execute(
            "INSERT INTO daily_file_usage(source_id, agent, file_hash, day, input_tokens,
             output_tokens, cache_read_tokens, cache_write_tokens, cache_available)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                source_id,
                file.agent.as_str(),
                file.file_hash,
                row.day,
                row.usage.input_tokens,
                row.usage.output_tokens,
                row.usage.cache_read_tokens,
                row.usage.cache_write_tokens,
                row.usage.cache_available
            ],
        )?;
    }
    transaction.execute(
        "INSERT INTO source_files(source_id, agent, file_hash, size, modified, parser_version)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(source_id, agent, file_hash) DO UPDATE SET size=excluded.size,
           modified=excluded.modified, parser_version=excluded.parser_version",
        params![
            source_id,
            file.agent.as_str(),
            file.file_hash,
            file.size,
            file.modified,
            PARSER_VERSION
        ],
    )?;
    Ok(())
}

fn parse_agent(value: &str) -> Option<AgentKind> {
    match value {
        "codex" => Some(AgentKind::Codex),
        "claude" => Some(AgentKind::Claude),
        "pi" => Some(AgentKind::Pi),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{DailyUsage, FileUsage, ScanBatch};

    #[test]
    fn replaces_changed_files_and_filters_agents() {
        let mut database = Database::open(Path::new(":memory:")).unwrap();
        let batch = ScanBatch {
            files: vec![FileUsage {
                agent: AgentKind::Codex,
                file_hash: "one".into(),
                size: 10,
                modified: 1,
                daily: vec![DailyUsage {
                    day: Local::now().format("%Y-%m-%d").to_string(),
                    usage: TokenUsage {
                        input_tokens: 100,
                        output_tokens: 10,
                        cache_read_tokens: 60,
                        cache_write_tokens: 0,
                        cache_available: true,
                    },
                }],
            }],
            seen: BTreeMap::from([(AgentKind::Codex, vec!["one".into()])]),
            warnings: vec![],
        };
        database.apply_scan("local", &batch).unwrap();
        let settings = UsageSettings::default();
        let snapshot = database
            .snapshot(
                &SnapshotRequest {
                    range: "365".into(),
                    agents: vec![AgentKind::Codex],
                    sources: vec!["local".into()],
                },
                &settings,
            )
            .unwrap();
        assert_eq!(snapshot.totals.total_tokens, 110);
        assert_eq!(snapshot.totals.cache_rate, Some(0.6));
    }
}
