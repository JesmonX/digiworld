use anyhow::{Context, Result, bail};
use chrono::Local;
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RankingEntry {
    pub key: String,
    pub count: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub scope: String,
    pub paused: bool,
    pub total: u64,
    pub unique_keys: usize,
    pub top_key: Option<String>,
    pub counts: BTreeMap<String, u64>,
    pub top_ten: Vec<RankingEntry>,
}

pub struct Database {
    connection: Connection,
}

impl Database {
    pub fn open(path: &Path) -> Result<Self> {
        let connection =
            Connection::open(path).with_context(|| format!("open {}", path.display()))?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS daily_key_counts (
                day TEXT NOT NULL,
                key_id TEXT NOT NULL,
                count INTEGER NOT NULL CHECK(count >= 0),
                PRIMARY KEY(day, key_id)
            );
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            PRAGMA user_version = 1;
            ",
        )?;
        Ok(Self { connection })
    }

    pub fn add_counts(&mut self, counts: &BTreeMap<String, u64>) -> Result<()> {
        if counts.is_empty() {
            return Ok(());
        }
        let day = Local::now().date_naive().format("%Y-%m-%d").to_string();
        let transaction = self.connection.transaction()?;
        for (key, count) in counts {
            transaction.execute(
                "INSERT INTO daily_key_counts(day, key_id, count) VALUES(?1, ?2, ?3)
                 ON CONFLICT(day, key_id) DO UPDATE SET count = count + excluded.count",
                params![day, key, count],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn paused(&self) -> Result<bool> {
        let value: Option<String> = self
            .connection
            .query_row(
                "SELECT value FROM settings WHERE key = 'paused'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        Ok(value.as_deref() == Some("true"))
    }

    pub fn set_paused(&self, paused: bool) -> Result<()> {
        self.connection.execute(
            "INSERT INTO settings(key, value) VALUES('paused', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [if paused { "true" } else { "false" }],
        )?;
        Ok(())
    }

    pub fn setting_bool(&self, key: &str) -> Result<bool> {
        Ok(self.setting(key)?.as_deref() == Some("true"))
    }

    pub fn setting(&self, key: &str) -> Result<Option<String>> {
        let value: Option<String> = self
            .connection
            .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
                row.get(0)
            })
            .optional()?;
        Ok(value)
    }

    pub fn set_setting_bool(&self, key: &str, value: bool) -> Result<()> {
        self.set_setting(key, if value { "true" } else { "false" })
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        self.connection.execute(
            "INSERT INTO settings(key, value) VALUES(?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn snapshot(&self, scope: &str) -> Result<Snapshot> {
        let (query, day) = match scope {
            "today" => (
                "SELECT key_id, SUM(count) FROM daily_key_counts WHERE day = ?1 GROUP BY key_id",
                Some(Local::now().date_naive().format("%Y-%m-%d").to_string()),
            ),
            "all" => (
                "SELECT key_id, SUM(count) FROM daily_key_counts WHERE ?1 IS NULL GROUP BY key_id",
                None,
            ),
            _ => bail!("unsupported scope: {scope}"),
        };
        let mut statement = self.connection.prepare(query)?;
        let rows = statement.query_map([day], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, u64>(1)?))
        })?;
        let counts: BTreeMap<_, _> = rows.collect::<std::result::Result<_, _>>()?;
        let total = counts.values().sum();
        let mut ranking: Vec<_> = counts
            .iter()
            .map(|(key, count)| RankingEntry {
                key: key.clone(),
                count: *count,
            })
            .collect();
        ranking.sort_by(|left, right| {
            right
                .count
                .cmp(&left.count)
                .then_with(|| left.key.cmp(&right.key))
        });
        Ok(Snapshot {
            scope: scope.to_string(),
            paused: self.paused()?,
            total,
            unique_keys: counts.len(),
            top_key: ranking.first().map(|entry| entry.key.clone()),
            counts,
            top_ten: ranking.into_iter().take(10).collect(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aggregates_counts() {
        let mut database = Database::open(Path::new(":memory:")).unwrap();
        database
            .add_counts(&BTreeMap::from([("KeyA".into(), 2), ("Space".into(), 4)]))
            .unwrap();
        let snapshot = database.snapshot("all").unwrap();
        assert_eq!(snapshot.total, 6);
        assert_eq!(snapshot.top_key.as_deref(), Some("Space"));
    }
}
