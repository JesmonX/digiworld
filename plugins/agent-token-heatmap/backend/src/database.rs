use crate::model::{
    AgentKind, Breakdown, DailyModelSnapshot, DaySnapshot, FileUsage, ModelBreakdown, ScanBatch,
    SnapshotRequest, SourceStatus, TokenUsage, UsageSettings, UsageSnapshot, UsageTotals,
};
use anyhow::{Context, Result};
use chrono::{Duration, Local};
use rusqlite::{Connection, OptionalExtension, params};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

const PARSER_VERSION: i64 = 4;
const DATABASE_VERSION: i64 = 2;

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
            CREATE TABLE IF NOT EXISTS source_status (
                source_id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                last_scanned_at TEXT,
                error TEXT,
                warnings_json TEXT NOT NULL DEFAULT '[]'
            );
            ",
        )?;
        let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        match version {
            0 => connection.execute_batch(
                "
                CREATE TABLE daily_file_usage (
                    source_id TEXT NOT NULL,
                    agent TEXT NOT NULL,
                    file_hash TEXT NOT NULL,
                    day TEXT NOT NULL,
                    model TEXT NOT NULL DEFAULT 'unknown',
                    input_tokens INTEGER NOT NULL CHECK(input_tokens >= 0),
                    output_tokens INTEGER NOT NULL CHECK(output_tokens >= 0),
                    cache_read_tokens INTEGER NOT NULL CHECK(cache_read_tokens >= 0),
                    cache_write_tokens INTEGER NOT NULL CHECK(cache_write_tokens >= 0),
                    cache_available INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY(source_id, agent, file_hash, day, model)
                );
                PRAGMA user_version = 2;
                ",
            )?,
            1 => connection.execute_batch(
                "
                BEGIN IMMEDIATE;
                ALTER TABLE daily_file_usage RENAME TO daily_file_usage_v1;
                CREATE TABLE daily_file_usage (
                    source_id TEXT NOT NULL,
                    agent TEXT NOT NULL,
                    file_hash TEXT NOT NULL,
                    day TEXT NOT NULL,
                    model TEXT NOT NULL DEFAULT 'unknown',
                    input_tokens INTEGER NOT NULL CHECK(input_tokens >= 0),
                    output_tokens INTEGER NOT NULL CHECK(output_tokens >= 0),
                    cache_read_tokens INTEGER NOT NULL CHECK(cache_read_tokens >= 0),
                    cache_write_tokens INTEGER NOT NULL CHECK(cache_write_tokens >= 0),
                    cache_available INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY(source_id, agent, file_hash, day, model)
                );
                INSERT INTO daily_file_usage(
                    source_id, agent, file_hash, day, model, input_tokens, output_tokens,
                    cache_read_tokens, cache_write_tokens, cache_available
                )
                SELECT source_id, agent, file_hash, day, 'unknown', input_tokens, output_tokens,
                    cache_read_tokens, cache_write_tokens, cache_available
                FROM daily_file_usage_v1;
                DROP TABLE daily_file_usage_v1;
                PRAGMA user_version = 2;
                COMMIT;
                ",
            )?,
            DATABASE_VERSION => {}
            other => anyhow::bail!("unsupported token database schema version: {other}"),
        }
        connection.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_daily_usage_day_source_agent
             ON daily_file_usage(day, source_id, agent);",
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

        let start_day = start.map(|day| day.format("%Y-%m-%d").to_string());
        let end_day = end.format("%Y-%m-%d").to_string();
        let mut statement = self.connection.prepare(
            "SELECT source_id, agent, day, model,
                    SUM(input_tokens), SUM(output_tokens),
                    SUM(cache_read_tokens), SUM(cache_write_tokens), MAX(cache_available)
             FROM daily_file_usage
             WHERE day <= ?1 AND (?2 IS NULL OR day >= ?2)
             GROUP BY source_id, agent, day, model
             ORDER BY day",
        )?;
        let rows = statement.query_map(params![end_day, start_day], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                TokenUsage {
                    input_tokens: row.get(4)?,
                    output_tokens: row.get(5)?,
                    cache_read_tokens: row.get(6)?,
                    cache_write_tokens: row.get(7)?,
                    cache_available: row.get(8)?,
                },
            ))
        })?;
        let mut totals = TokenUsage::default();
        let mut by_day = BTreeMap::<String, TokenUsage>::new();
        let mut by_day_model = BTreeMap::<(String, String), u64>::new();
        let mut breakdown = BTreeMap::<(String, AgentKind), TokenUsage>::new();
        let mut model_breakdown = BTreeMap::<(String, AgentKind, String), TokenUsage>::new();
        for row in rows {
            let (source_id, agent, day, model, usage) = row?;
            let Some(agent) = parse_agent(&agent) else {
                continue;
            };
            if !source_ids.contains(&source_id) || (!agents.is_empty() && !agents.contains(&agent))
            {
                continue;
            }
            totals.add_assign(&usage);
            by_day.entry(day.clone()).or_default().add_assign(&usage);
            let day_model_total = by_day_model.entry((day, model.clone())).or_default();
            *day_model_total = day_model_total.saturating_add(usage.total_tokens());
            breakdown
                .entry((source_id.clone(), agent))
                .or_default()
                .add_assign(&usage);
            model_breakdown
                .entry((source_id, agent, model))
                .or_default()
                .add_assign(&usage);
        }
        let mut models_by_day = BTreeMap::<String, Vec<DailyModelSnapshot>>::new();
        for ((day, model), total_tokens) in by_day_model {
            if total_tokens > 0 {
                models_by_day
                    .entry(day)
                    .or_default()
                    .push(DailyModelSnapshot {
                        model,
                        total_tokens,
                    });
            }
        }
        let statuses = self.statuses(&source_ids)?;
        let total_tokens = totals.total_tokens();
        let cache_rate = (totals.cache_available && totals.input_tokens > 0)
            .then_some(totals.cache_read_tokens as f64 / totals.input_tokens as f64);
        Ok(UsageSnapshot {
            start_day,
            end_day,
            totals: UsageTotals {
                usage: totals,
                total_tokens,
                cache_rate,
            },
            days: by_day
                .into_iter()
                .map(|(day, usage)| {
                    let models = models_by_day.remove(&day).unwrap_or_default();
                    DaySnapshot {
                        total_tokens: usage.total_tokens(),
                        day,
                        models,
                        usage,
                    }
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
            model_breakdown: model_breakdown
                .into_iter()
                .map(|((source_id, agent, model), usage)| ModelBreakdown {
                    source_label: labels
                        .get(&source_id)
                        .cloned()
                        .unwrap_or_else(|| source_id.clone()),
                    total_tokens: usage.total_tokens(),
                    source_id,
                    agent,
                    model,
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
            "INSERT INTO daily_file_usage(source_id, agent, file_hash, day, model, input_tokens,
             output_tokens, cache_read_tokens, cache_write_tokens, cache_available)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                source_id,
                file.agent.as_str(),
                file.file_hash,
                row.day,
                row.model,
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
        "zcode" => Some(AgentKind::Zcode),
        "agy" => Some(AgentKind::Agy),
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
                    model: "gpt-5.6-sol".into(),
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
        assert_eq!(snapshot.days[0].models.len(), 1);
        assert_eq!(snapshot.days[0].models[0].model, "gpt-5.6-sol");
        assert_eq!(snapshot.days[0].models[0].total_tokens, 110);
        assert_eq!(snapshot.model_breakdown.len(), 1);
        assert_eq!(snapshot.model_breakdown[0].model, "gpt-5.6-sol");
    }

    #[test]
    fn groups_daily_tokens_by_model_after_source_and_agent_filters() {
        let mut database = Database::open(Path::new(":memory:")).unwrap();
        let day = Local::now().format("%Y-%m-%d").to_string();
        let batch = ScanBatch {
            files: vec![
                FileUsage {
                    agent: AgentKind::Codex,
                    file_hash: "codex-one".into(),
                    size: 10,
                    modified: 1,
                    daily: vec![DailyUsage {
                        day: day.clone(),
                        model: "gpt-5.6-sol".into(),
                        usage: TokenUsage {
                            input_tokens: 100,
                            output_tokens: 10,
                            ..TokenUsage::default()
                        },
                    }],
                },
                FileUsage {
                    agent: AgentKind::Codex,
                    file_hash: "codex-two".into(),
                    size: 10,
                    modified: 1,
                    daily: vec![DailyUsage {
                        day: day.clone(),
                        model: "gpt-5.6-mini".into(),
                        usage: TokenUsage {
                            input_tokens: 40,
                            output_tokens: 5,
                            ..TokenUsage::default()
                        },
                    }],
                },
                FileUsage {
                    agent: AgentKind::Claude,
                    file_hash: "claude-one".into(),
                    size: 10,
                    modified: 1,
                    daily: vec![DailyUsage {
                        day,
                        model: "claude-opus-4-8".into(),
                        usage: TokenUsage {
                            input_tokens: 900,
                            output_tokens: 90,
                            ..TokenUsage::default()
                        },
                    }],
                },
            ],
            seen: BTreeMap::from([(
                AgentKind::Codex,
                vec!["codex-one".into(), "codex-two".into()],
            )]),
            warnings: vec![],
        };
        database.apply_scan("local", &batch).unwrap();

        let snapshot = database
            .snapshot(
                &SnapshotRequest {
                    range: "365".into(),
                    agents: vec![AgentKind::Codex],
                    sources: vec!["local".into()],
                },
                &UsageSettings::default(),
            )
            .unwrap();

        assert_eq!(snapshot.days.len(), 1);
        assert_eq!(snapshot.days[0].total_tokens, 155);
        assert_eq!(
            snapshot.days[0]
                .models
                .iter()
                .map(|model| (model.model.as_str(), model.total_tokens))
                .collect::<Vec<_>>(),
            vec![("gpt-5.6-mini", 45), ("gpt-5.6-sol", 110)]
        );
    }

    #[test]
    fn migrates_v1_rows_as_unknown_model() {
        let path = std::env::temp_dir().join(format!(
            "digiworld-token-migration-{}-{}.db",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let connection = Connection::open(&path).unwrap();
        connection.execute_batch(
            "
            CREATE TABLE daily_file_usage (
                source_id TEXT NOT NULL, agent TEXT NOT NULL, file_hash TEXT NOT NULL,
                day TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
                cache_read_tokens INTEGER NOT NULL, cache_write_tokens INTEGER NOT NULL,
                cache_available INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY(source_id, agent, file_hash, day)
            );
            INSERT INTO daily_file_usage VALUES('local', 'codex', 'one', '2026-09-02', 10, 2, 0, 0, 0);
            PRAGMA user_version = 1;
            ",
        )
        .unwrap();
        drop(connection);

        let database = Database::open(&path).unwrap();
        let model: String = database
            .connection
            .query_row("SELECT model FROM daily_file_usage", [], |row| row.get(0))
            .unwrap();
        assert_eq!(model, "unknown");
        drop(database);
        std::fs::remove_file(path).unwrap();
    }
}
