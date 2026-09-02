use anyhow::{Context, Result, bail};
use chrono::Local;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
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

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
    pub schema_version: u32,
    pub exported_at: String,
    pub daily_counts: BTreeMap<String, BTreeMap<String, u64>>,
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
        let value: Option<String> = self
            .connection
            .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
                row.get(0)
            })
            .optional()?;
        Ok(value.as_deref() == Some("true"))
    }

    pub fn set_setting_bool(&self, key: &str, value: bool) -> Result<()> {
        self.connection.execute(
            "INSERT INTO settings(key, value) VALUES(?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, if value { "true" } else { "false" }],
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

    pub fn clear(&self, scope: &str) -> Result<()> {
        match scope {
            "today" => {
                let day = Local::now().date_naive().format("%Y-%m-%d").to_string();
                self.connection
                    .execute("DELETE FROM daily_key_counts WHERE day = ?1", [day])?;
            }
            "all" => {
                self.connection
                    .execute("DELETE FROM daily_key_counts", [])?;
            }
            _ => bail!("unsupported scope: {scope}"),
        }
        Ok(())
    }

    pub fn backup(&self) -> Result<Backup> {
        let mut statement = self
            .connection
            .prepare("SELECT day, key_id, count FROM daily_key_counts ORDER BY day, key_id")?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, u64>(2)?,
            ))
        })?;
        let mut daily_counts = BTreeMap::<String, BTreeMap<String, u64>>::new();
        for row in rows {
            let (day, key, count) = row?;
            daily_counts.entry(day).or_default().insert(key, count);
        }
        Ok(Backup {
            schema_version: 1,
            exported_at: chrono::Utc::now().to_rfc3339(),
            daily_counts,
        })
    }

    pub fn csv(&self) -> Result<String> {
        let backup = self.backup()?;
        let mut csv = String::from("date,key,count\n");
        for (day, counts) in backup.daily_counts {
            for (key, count) in counts {
                csv.push_str(&format!("{day},{key},{count}\n"));
            }
        }
        Ok(csv)
    }

    pub fn import(&mut self, backup: Backup, mode: &str) -> Result<()> {
        if backup.schema_version != 1 {
            bail!("unsupported backup schema");
        }
        let transaction = self.connection.transaction()?;
        if mode == "replace" {
            transaction.execute("DELETE FROM daily_key_counts", [])?;
        } else if mode != "merge" {
            bail!("import mode must be merge or replace");
        }
        for (day, counts) in backup.daily_counts {
            if !valid_day(&day) {
                bail!("invalid backup date: {day}");
            }
            for (key, count) in counts {
                if key.len() > 40 || !key.bytes().all(|byte| byte.is_ascii_alphanumeric()) {
                    bail!("invalid key id in backup");
                }
                transaction.execute(
                    "INSERT INTO daily_key_counts(day, key_id, count) VALUES(?1, ?2, ?3)
                     ON CONFLICT(day, key_id) DO UPDATE SET count = CASE
                       WHEN ?4 = 'merge' THEN count + excluded.count ELSE excluded.count END",
                    params![day, key, count, mode],
                )?;
            }
        }
        transaction.commit()?;
        Ok(())
    }
}

fn valid_day(day: &str) -> bool {
    chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d").is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aggregates_and_round_trips_backups() {
        let mut database = Database::open(Path::new(":memory:")).unwrap();
        database
            .add_counts(&BTreeMap::from([("KeyA".into(), 2), ("Space".into(), 4)]))
            .unwrap();
        let snapshot = database.snapshot("all").unwrap();
        assert_eq!(snapshot.total, 6);
        assert_eq!(snapshot.top_key.as_deref(), Some("Space"));
        let backup = database.backup().unwrap();
        database.clear("all").unwrap();
        database.import(backup, "replace").unwrap();
        assert_eq!(database.snapshot("all").unwrap().total, 6);
    }
}
