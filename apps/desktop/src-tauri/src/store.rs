use crate::error::Result;
use crate::model::{PluginManifest, PluginSummary};
use rusqlite::{Connection, OptionalExtension, params};
use std::path::Path;
use std::sync::Mutex;

pub struct Store {
    connection: Mutex<Connection>,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        let connection = Connection::open(path)?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS installed_plugins (
                id TEXT PRIMARY KEY,
                version TEXT NOT NULL,
                manifest_json TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 0,
                state TEXT NOT NULL DEFAULT 'installed',
                last_error TEXT,
                installed_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS granted_permissions (
                plugin_id TEXT NOT NULL,
                permission TEXT NOT NULL,
                reason TEXT NOT NULL,
                PRIMARY KEY(plugin_id, permission),
                FOREIGN KEY(plugin_id) REFERENCES installed_plugins(id) ON DELETE CASCADE
            );
            ",
        )?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn metadata_u64(&self, key: &str) -> Result<u64> {
        let connection = self.connection.lock().expect("store lock poisoned");
        let value: Option<String> = connection
            .query_row("SELECT value FROM metadata WHERE key = ?1", [key], |row| {
                row.get(0)
            })
            .optional()?;
        Ok(value.and_then(|value| value.parse().ok()).unwrap_or(0))
    }

    pub fn metadata_string(&self, key: &str) -> Result<Option<String>> {
        let connection = self.connection.lock().expect("store lock poisoned");
        Ok(connection
            .query_row("SELECT value FROM metadata WHERE key = ?1", [key], |row| {
                row.get(0)
            })
            .optional()?)
    }

    pub fn set_metadata(&self, key: &str, value: &str) -> Result<()> {
        self.connection
            .lock()
            .expect("store lock poisoned")
            .execute(
                "INSERT INTO metadata(key, value) VALUES(?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, value],
            )?;
        Ok(())
    }

    pub fn install(&self, manifest: &PluginManifest, enabled: bool) -> Result<bool> {
        let mut connection = self.connection.lock().expect("store lock poisoned");
        let transaction = connection.transaction()?;
        let old_permissions: Vec<String> = {
            let mut statement = transaction.prepare(
                "SELECT permission FROM granted_permissions WHERE plugin_id = ?1 ORDER BY permission",
            )?;
            statement
                .query_map([&manifest.id], |row| row.get(0))?
                .collect::<std::result::Result<_, _>>()?
        };
        let mut new_permissions: Vec<_> = manifest
            .permissions
            .iter()
            .map(|value| value.id.clone())
            .collect();
        new_permissions.sort();
        let permissions_changed = old_permissions != new_permissions;

        transaction.execute(
            "INSERT INTO installed_plugins(id, version, manifest_json, enabled, state, installed_at)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
               version = excluded.version,
               manifest_json = excluded.manifest_json,
               enabled = excluded.enabled,
               state = excluded.state,
               last_error = NULL,
               installed_at = excluded.installed_at",
            params![
                manifest.id,
                manifest.version,
                serde_json::to_string(manifest)?,
                enabled,
                if enabled { "starting" } else { "installed" },
                chrono::Utc::now().to_rfc3339(),
            ],
        )?;
        transaction.execute(
            "DELETE FROM granted_permissions WHERE plugin_id = ?1",
            [&manifest.id],
        )?;
        for permission in &manifest.permissions {
            transaction.execute(
                "INSERT INTO granted_permissions(plugin_id, permission, reason) VALUES(?1, ?2, ?3)",
                params![manifest.id, permission.id, permission.reason],
            )?;
        }
        transaction.commit()?;
        Ok(permissions_changed)
    }

    pub fn manifests(&self, only_enabled: bool) -> Result<Vec<PluginManifest>> {
        let connection = self.connection.lock().expect("store lock poisoned");
        let query = if only_enabled {
            "SELECT manifest_json FROM installed_plugins WHERE enabled = 1 ORDER BY id"
        } else {
            "SELECT manifest_json FROM installed_plugins ORDER BY id"
        };
        let mut statement = connection.prepare(query)?;
        let values: Vec<String> = statement
            .query_map([], |row| row.get(0))?
            .collect::<std::result::Result<_, _>>()?;
        values
            .into_iter()
            .map(|value| serde_json::from_str(&value).map_err(Into::into))
            .collect()
    }

    pub fn manifest(&self, id: &str) -> Result<Option<PluginManifest>> {
        let connection = self.connection.lock().expect("store lock poisoned");
        let value: Option<String> = connection
            .query_row(
                "SELECT manifest_json FROM installed_plugins WHERE id = ?1",
                [id],
                |row| row.get(0),
            )
            .optional()?;
        value
            .map(|value| serde_json::from_str(&value).map_err(Into::into))
            .transpose()
    }

    pub fn summaries(&self) -> Result<Vec<PluginSummary>> {
        let connection = self.connection.lock().expect("store lock poisoned");
        let mut statement = connection.prepare(
            "SELECT manifest_json, enabled, state, last_error FROM installed_plugins ORDER BY id",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, bool>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })?;
        let mut summaries = Vec::new();
        for row in rows {
            let (json, enabled, state, error) = row?;
            let manifest: PluginManifest = serde_json::from_str(&json)?;
            summaries.push(PluginSummary {
                id: manifest.id,
                version: manifest.version,
                name: manifest.name,
                description: manifest.description,
                enabled,
                state,
                permissions: manifest.permissions,
                error,
            });
        }
        Ok(summaries)
    }

    pub fn set_enabled(&self, id: &str, enabled: bool) -> Result<()> {
        self.connection.lock().expect("store lock poisoned").execute(
            "UPDATE installed_plugins SET enabled = ?2, state = ?3, last_error = NULL WHERE id = ?1",
            params![id, enabled, if enabled { "starting" } else { "disabled" }],
        )?;
        Ok(())
    }

    pub fn set_state(&self, id: &str, state: &str, error: Option<&str>) -> Result<()> {
        self.connection
            .lock()
            .expect("store lock poisoned")
            .execute(
                "UPDATE installed_plugins SET state = ?2, last_error = ?3 WHERE id = ?1",
                params![id, state, error],
            )?;
        Ok(())
    }

    pub fn remove(&self, id: &str) -> Result<()> {
        let mut connection = self.connection.lock().expect("store lock poisoned");
        let transaction = connection.transaction()?;
        transaction.execute("DELETE FROM granted_permissions WHERE plugin_id = ?1", [id])?;
        transaction.execute("DELETE FROM installed_plugins WHERE id = ?1", [id])?;
        transaction.commit()?;
        Ok(())
    }

    pub fn has_enabled_background(&self) -> Result<bool> {
        let manifests = self.manifests(true)?;
        Ok(manifests
            .iter()
            .any(|manifest| manifest.background != "none"))
    }
}
