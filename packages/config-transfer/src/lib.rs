use anyhow::{Context, Result, bail, ensure};
use ring::{
    aead, pbkdf2,
    rand::{SecureRandom, SystemRandom},
};
use rusqlite::{Connection, OptionalExtension, params_from_iter, types::Value as SqlValue};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    fs,
    num::NonZeroU32,
    path::{Path, PathBuf},
};

const MAGIC: &[u8] = b"DIGIWORLD-CONFIG\x01";
pub const MAX_BYTES: u64 = 16 * 1024 * 1024;
const PREFIX: &str = "io.github.jesmonx.digiworld.";
const JSON_FILES: &[(&str, &str)] = &[
    ("server-monitor", "settings.json"),
    ("github-actions", "settings.json"),
    ("calendar-todo", "account.json"),
];
pub const PREFERENCES: &[&str] = &[
    "digiworld.theme.v2",
    "digiworld.font-theme.v1",
    "digiworld.font-weight.v1",
    "digiworld.glass.v1",
    "digiworld.color-scheme.v1",
    "digiworld.locale.v1",
];
const ACCOUNTS_SCHEMA: &str = "CREATE TABLE IF NOT EXISTS accounts (
 id TEXT PRIMARY KEY, provider TEXT NOT NULL, label TEXT NOT NULL, email TEXT NOT NULL,
 username TEXT NOT NULL, host TEXT NOT NULL, port INTEGER NOT NULL, use_proxy INTEGER NOT NULL DEFAULT 1,
 uid_validity INTEGER, last_uid INTEGER NOT NULL DEFAULT 0, baseline_complete INTEGER NOT NULL DEFAULT 0,
 sync_phase TEXT NOT NULL DEFAULT 'idle', indexed INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0,
 body_total INTEGER NOT NULL DEFAULT 0, body_completed INTEGER NOT NULL DEFAULT 0,
 body_attempted INTEGER NOT NULL DEFAULT 0, body_failed INTEGER NOT NULL DEFAULT 0,
 body_pending INTEGER NOT NULL DEFAULT 0, last_success_at TEXT, last_full_reconcile_at TEXT,
 last_error TEXT, next_sync_at TEXT);";

struct TableSpec {
    plugin: &'static str,
    file: &'static str,
    table: &'static str,
    columns: &'static [&'static str],
}
const TABLES: &[TableSpec] = &[
    TableSpec {
        plugin: "",
        file: "digiworld.db",
        table: "metadata",
        columns: &["key", "value"],
    },
    TableSpec {
        plugin: "mail-assistant",
        file: "mail.db",
        table: "settings",
        columns: &["key", "value"],
    },
    TableSpec {
        plugin: "mail-assistant",
        file: "mail.db",
        table: "accounts",
        columns: &[
            "id",
            "provider",
            "label",
            "email",
            "username",
            "host",
            "port",
            "use_proxy",
        ],
    },
    TableSpec {
        plugin: "agent-token-heatmap",
        file: "agent-tokens.db",
        table: "settings",
        columns: &["key", "value"],
    },
    TableSpec {
        plugin: "keyboard-heatmap",
        file: "heatmap.db",
        table: "settings",
        columns: &["key", "value"],
    },
];

#[derive(Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    version: u32,
    files: BTreeMap<usize, Value>,
    tables: BTreeMap<usize, Vec<Vec<Value>>>,
    secrets: BTreeMap<String, String>,
    pub preferences: BTreeMap<String, String>,
    pub warnings: Vec<String>,
}

fn plugin_dir(root: &Path, plugin: &str) -> PathBuf {
    root.join("plugin-data").join(format!("{PREFIX}{plugin}"))
}
fn db_path(root: &Path, spec: &TableSpec) -> PathBuf {
    if spec.plugin.is_empty() {
        root.join(spec.file)
    } else {
        plugin_dir(root, spec.plugin).join(spec.file)
    }
}
fn secret_entry(key: &str) -> Result<keyring::Entry> {
    let (plugin, user) = key
        .split_once('/')
        .context("Invalid credential identifier")?;
    keyring::Entry::new(&format!("{PREFIX}{plugin}"), user)
        .context("Cannot access system credential store")
}
fn get_secret(key: &str) -> Result<Option<String>> {
    match secret_entry(key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => bail!("Cannot read system credential store; export/import was stopped"),
    }
}
fn set_secret(key: &str, value: Option<&str>) -> Result<()> {
    let entry = secret_entry(key)?;
    match value {
        Some(value) => entry
            .set_password(value)
            .map_err(|_| anyhow::anyhow!("Cannot write system credential store")),
        None => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => bail!("Cannot restore system credential store"),
        },
    }
}

impl Config {
    pub fn proxy_json(&self) -> Option<&str> {
        self.tables.get(&0)?.first()?.get(1)?.as_str()
    }
    fn credential_keys(&self) -> Vec<String> {
        let mut keys = vec![
            "github-actions/github-token".into(),
            "calendar-todo/icloud-app-password".into(),
        ];
        if let Some(rows) = self.tables.get(&2) {
            for row in rows {
                if let Some(id) = row.first().and_then(Value::as_str) {
                    keys.push(format!("mail-assistant/{id}"));
                }
            }
        }
        keys
    }

    pub fn validate(&self) -> Result<()> {
        ensure!(self.version == 1, "Unsupported configuration version");
        ensure!(
            self.preferences
                .iter()
                .all(|(k, v)| PREFERENCES.contains(&k.as_str()) && v.len() <= 256),
            "Invalid appearance preferences"
        );
        for (&id, value) in &self.files {
            ensure!(
                id < JSON_FILES.len() && value.is_object(),
                "Unsupported configuration file"
            );
        }
        for (&id, rows) in &self.tables {
            let spec = TABLES.get(id).context("Unsupported configuration table")?;
            ensure!(rows.len() <= 10000, "Too many configuration rows");
            for row in rows {
                ensure!(row.len() == spec.columns.len(), "Invalid configuration row");
                ensure!(
                    row.iter().all(|v| v.is_string() || v.as_i64().is_some()),
                    "Invalid configuration value"
                );
                ensure!(
                    row[0]
                        .as_str()
                        .is_some_and(|s| !s.is_empty() && s.len() <= 1024),
                    "Invalid configuration identifier"
                );
                if id == 0 {
                    ensure!(row[0] == "proxy_settings", "Unsupported host setting");
                }
                if id == 2 {
                    ensure!(
                        row[..6].iter().all(Value::is_string)
                            && row[6].as_i64().is_some_and(|v| (1..=65535).contains(&v))
                            && matches!(row[7].as_i64(), Some(0 | 1)),
                        "Invalid mail account"
                    );
                } else {
                    ensure!(row[1].is_string(), "Invalid setting value");
                }
            }
        }
        let allowed = self.credential_keys();
        ensure!(
            self.secrets.keys().all(|key| allowed.contains(key)),
            "Unsupported credential"
        );
        Ok(())
    }
}

pub fn collect(root: &Path, preferences: BTreeMap<String, String>) -> Result<Config> {
    let mut config = Config {
        version: 1,
        preferences,
        ..Default::default()
    };
    for (id, (plugin, file)) in JSON_FILES.iter().enumerate() {
        let path = plugin_dir(root, plugin).join(file);
        if path.exists() {
            config
                .files
                .insert(id, serde_json::from_slice(&fs::read(path)?)?);
        }
    }
    for (id, spec) in TABLES.iter().enumerate() {
        let path = db_path(root, spec);
        if !path.exists() {
            continue;
        }
        let db = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        if !db
            .query_row(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1",
                [spec.table],
                |_| Ok(true),
            )
            .optional()?
            .unwrap_or(false)
        {
            continue;
        }
        let filter = if id == 0 {
            " WHERE key='proxy_settings'"
        } else {
            ""
        };
        let mut stmt = db.prepare(&format!(
            "SELECT {} FROM {}{}",
            spec.columns.join(","),
            spec.table,
            filter
        ))?;
        let rows = stmt
            .query_map([], |row| {
                (0..spec.columns.len())
                    .map(|index| {
                        Ok(match row.get::<_, SqlValue>(index)? {
                            SqlValue::Text(value) => Value::String(value),
                            SqlValue::Integer(value) => Value::from(value),
                            _ => Value::Null,
                        })
                    })
                    .collect::<rusqlite::Result<Vec<_>>>()
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        config.tables.insert(id, rows);
    }
    for key in config.credential_keys() {
        let plugin = key.split_once('/').unwrap().0;
        if !plugin_dir(root, plugin).exists() {
            continue;
        }
        match get_secret(&key)? {
            Some(value) => {
                config.secrets.insert(key, value);
            }
            None => config.warnings.push(format!("Credential missing: {key}")),
        }
    }
    config.validate()?;
    Ok(config)
}

fn key(password: &str, salt: &[u8]) -> Result<aead::LessSafeKey> {
    ensure!(
        password.chars().count() >= 8,
        "Backup password must contain at least 8 characters"
    );
    let mut bytes = [0u8; 32];
    pbkdf2::derive(
        pbkdf2::PBKDF2_HMAC_SHA256,
        NonZeroU32::new(600_000).unwrap(),
        salt,
        password.as_bytes(),
        &mut bytes,
    );
    let key = aead::UnboundKey::new(&aead::AES_256_GCM, &bytes)
        .map_err(|_| anyhow::anyhow!("Encryption unavailable"))?;
    bytes.fill(0);
    Ok(aead::LessSafeKey::new(key))
}
pub fn encrypt(config: &Config, password: &str) -> Result<Vec<u8>> {
    config.validate()?;
    let rng = SystemRandom::new();
    let mut salt = [0; 16];
    let mut nonce = [0; 12];
    rng.fill(&mut salt)
        .map_err(|_| anyhow::anyhow!("Random generator unavailable"))?;
    rng.fill(&mut nonce)
        .map_err(|_| anyhow::anyhow!("Random generator unavailable"))?;
    let mut payload = serde_json::to_vec(config)?;
    ensure!(
        payload.len() as u64 + 64 <= MAX_BYTES,
        "Configuration too large"
    );
    key(password, &salt)?
        .seal_in_place_append_tag(
            aead::Nonce::assume_unique_for_key(nonce),
            aead::Aad::from(MAGIC),
            &mut payload,
        )
        .map_err(|_| anyhow::anyhow!("Encryption failed"))?;
    Ok([MAGIC, &salt, &nonce, &payload].concat())
}
pub fn decrypt(bytes: &[u8], password: &str) -> Result<Config> {
    let offset = MAGIC.len();
    ensure!(
        bytes.len() >= offset + 44 && bytes.len() as u64 <= MAX_BYTES && bytes.starts_with(MAGIC),
        "Invalid or unsupported backup file"
    );
    let nonce = bytes[offset + 16..offset + 28].try_into().unwrap();
    let mut ciphertext = bytes[offset + 28..].to_vec();
    let plaintext = key(password, &bytes[offset..offset + 16])?
        .open_in_place(
            aead::Nonce::assume_unique_for_key(nonce),
            aead::Aad::from(MAGIC),
            &mut ciphertext,
        )
        .map_err(|_| anyhow::anyhow!("Incorrect password or damaged backup"))?;
    let config: Config =
        serde_json::from_slice(plaintext).context("Invalid configuration format")?;
    config.validate()?;
    Ok(config)
}

/// Plugins must be stopped for the duration of collection/restoration.
pub fn restore(root: &Path, config: &Config) -> Result<()> {
    restore_with_credentials(root, config, get_secret, set_secret)
}

fn restore_with_credentials(
    root: &Path,
    config: &Config,
    get: impl Fn(&str) -> Result<Option<String>>,
    set: impl Fn(&str, Option<&str>) -> Result<()>,
) -> Result<()> {
    config.validate()?;
    // Open all databases before changing credentials or files. One transaction covers all tables.
    let mut db = Connection::open_in_memory()?;
    let mut aliases = BTreeMap::new();
    for &id in config.tables.keys() {
        let path = db_path(root, &TABLES[id]);
        if !aliases.contains_key(&path) {
            fs::create_dir_all(path.parent().unwrap())?;
            let alias = format!("db{}", aliases.len());
            db.execute(
                &format!("ATTACH DATABASE ?1 AS {alias}"),
                [path.to_string_lossy().as_ref()],
            )?;
            aliases.insert(path, alias);
        }
    }
    let transaction = db.transaction()?;
    for (&id, rows) in &config.tables {
        let spec = &TABLES[id];
        let alias = &aliases[&db_path(root, spec)];
        let table = format!("{alias}.{}", spec.table);
        if id == 2 {
            transaction.execute_batch(
                &ACCOUNTS_SCHEMA.replace("EXISTS accounts", &format!("EXISTS {table}")),
            )?;
        } else {
            transaction.execute_batch(&format!(
                "CREATE TABLE IF NOT EXISTS {table} (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
            ))?;
        }
        let updates = spec.columns[1..]
            .iter()
            .map(|c| format!("{c}=excluded.{c}"))
            .collect::<Vec<_>>()
            .join(",");
        let placeholders = vec!["?"; spec.columns.len()].join(",");
        let sql = format!(
            "INSERT INTO {table} ({}) VALUES ({placeholders}) ON CONFLICT({}) DO UPDATE SET {updates}",
            spec.columns.join(","),
            spec.columns[0]
        );
        for row in rows {
            let values = row.iter().map(|v| match v.as_str() {
                Some(s) => SqlValue::Text(s.into()),
                None => SqlValue::Integer(v.as_i64().unwrap()),
            });
            transaction.execute(&sql, params_from_iter(values))?;
        }
    }
    let old_secrets = config
        .secrets
        .keys()
        .map(|k| Ok((k.clone(), get(k)?)))
        .collect::<Result<BTreeMap<_, _>>>()?;
    let old_files = config
        .files
        .keys()
        .map(|&id| {
            let (plugin, file) = JSON_FILES[id];
            let path = plugin_dir(root, plugin).join(file);
            let bytes = if path.exists() {
                Some(fs::read(&path)?)
            } else {
                None
            };
            Ok((path, bytes))
        })
        .collect::<Result<BTreeMap<_, _>>>()?;
    let result = (|| -> Result<()> {
        for (key, value) in &config.secrets {
            set(key, Some(value))?;
        }
        for (&id, value) in &config.files {
            let (plugin, file) = JSON_FILES[id];
            let path = plugin_dir(root, plugin).join(file);
            fs::create_dir_all(path.parent().unwrap())?;
            fs::write(path, serde_json::to_vec_pretty(value)?)?;
        }
        transaction.commit()?;
        Ok(())
    })();
    if let Err(error) = result {
        let mut rollback_failed = false;
        for (key, value) in &old_secrets {
            rollback_failed |= set(key, value.as_deref()).is_err();
        }
        for (path, bytes) in old_files {
            rollback_failed |= match bytes {
                Some(bytes) => fs::write(path, bytes).is_err(),
                None => path.exists() && fs::remove_file(path).is_err(),
            };
        }
        if rollback_failed {
            bail!("Import failed and rollback was incomplete. Keep the backup and retry: {error}");
        }
        return Err(error.context("Import failed; original configuration restored"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn encrypted_roundtrip_rejects_wrong_password_and_tampering() {
        let config = Config {
            version: 1,
            ..Default::default()
        };
        let mut bytes = encrypt(&config, "test-password").unwrap();
        assert_eq!(decrypt(&bytes, "test-password").unwrap().version, 1);
        assert!(decrypt(&bytes, "wrong-password").is_err());
        *bytes.last_mut().unwrap() ^= 1;
        assert!(decrypt(&bytes, "test-password").is_err());
        assert!(decrypt(b"short", "test-password").is_err());
    }
    #[test]
    fn refuses_unknown_targets_and_credentials() {
        let mut config = Config {
            version: 1,
            ..Default::default()
        };
        config.files.insert(999, serde_json::json!({}));
        assert!(config.validate().is_err());
        config.files.clear();
        config
            .secrets
            .insert("other/password".into(), "secret".into());
        assert!(config.validate().is_err());
    }
    #[test]
    fn merges_settings_without_deleting_history() {
        let mut nonce = [0; 12];
        SystemRandom::new().fill(&mut nonce).unwrap();
        let root = std::env::temp_dir().join(format!("digiworld-config-test-{nonce:?}"));
        fs::create_dir_all(&root).unwrap();
        let db = Connection::open(root.join("digiworld.db")).unwrap();
        db.execute_batch("CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO metadata VALUES('catalog_sequence','99');").unwrap();
        let mut config = Config {
            version: 1,
            ..Default::default()
        };
        config.tables.insert(
            0,
            vec![vec![
                Value::from("proxy_settings"),
                Value::from("{\"mode\":\"direct\"}"),
            ]],
        );
        restore(&root, &config).unwrap();
        restore(&root, &config).unwrap();
        assert_eq!(
            db.query_row(
                "SELECT value FROM metadata WHERE key='catalog_sequence'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "99"
        );
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM metadata", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            2
        );
        drop(db);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn credential_failure_rolls_back_database_and_prior_credentials() {
        use std::cell::RefCell;
        let mut nonce = [0; 12];
        SystemRandom::new().fill(&mut nonce).unwrap();
        let root = std::env::temp_dir().join(format!("digiworld-rollback-test-{nonce:?}"));
        fs::create_dir_all(&root).unwrap();
        let db = Connection::open(root.join("digiworld.db")).unwrap();
        db.execute_batch("CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO metadata VALUES('proxy_settings','old');").unwrap();
        let mut config = Config {
            version: 1,
            ..Default::default()
        };
        config.tables.insert(
            0,
            vec![vec![Value::from("proxy_settings"), Value::from("new")]],
        );
        config.secrets.insert(
            "calendar-todo/icloud-app-password".into(),
            "new-calendar".into(),
        );
        config
            .secrets
            .insert("github-actions/github-token".into(), "new-github".into());
        let secrets = RefCell::new(BTreeMap::from([(
            "calendar-todo/icloud-app-password".to_string(),
            "old-calendar".to_string(),
        )]));
        let result = restore_with_credentials(
            &root,
            &config,
            |key| Ok(secrets.borrow().get(key).cloned()),
            |key, value| {
                if value == Some("new-github") {
                    bail!("simulated credential write failure");
                }
                if let Some(value) = value {
                    secrets
                        .borrow_mut()
                        .insert(key.to_string(), value.to_string());
                } else {
                    secrets.borrow_mut().remove(key);
                }
                Ok(())
            },
        );
        assert!(result.is_err());
        assert_eq!(
            secrets.borrow()["calendar-todo/icloud-app-password"],
            "old-calendar"
        );
        assert_eq!(
            db.query_row(
                "SELECT value FROM metadata WHERE key='proxy_settings'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "old"
        );
        drop(db);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn imports_mail_configuration_without_sync_cursor_or_messages() {
        let mut nonce = [0; 12];
        SystemRandom::new().fill(&mut nonce).unwrap();
        let root = std::env::temp_dir().join(format!("digiworld-mail-test-{nonce:?}"));
        let mut config = Config {
            version: 1,
            ..Default::default()
        };
        config.tables.insert(
            2,
            vec![vec![
                "test-id".into(),
                "custom".into(),
                "Test".into(),
                "a@example.com".into(),
                "a@example.com".into(),
                "imap.example.com".into(),
                993.into(),
                1.into(),
            ]],
        );
        restore(&root, &config).unwrap();
        let db = Connection::open(db_path(&root, &TABLES[2])).unwrap();
        assert_eq!(
            db.query_row("SELECT last_uid FROM accounts", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
        db.execute("UPDATE accounts SET last_uid=123", []).unwrap();
        restore(&root, &config).unwrap();
        assert_eq!(
            db.query_row("SELECT last_uid FROM accounts", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            123
        );
        drop(db);
        fs::remove_dir_all(root).unwrap();
    }
}
