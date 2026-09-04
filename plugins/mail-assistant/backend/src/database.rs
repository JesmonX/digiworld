use crate::model::{
    Account, AccountInput, AttachmentInfo, MessageDetail, MessagePage, MessageSummary,
    ParsedMessage, Settings,
};
use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, params};
use std::collections::HashSet;
use std::path::Path;
use std::sync::Mutex;

pub struct Database {
    connection: Mutex<Connection>,
}

impl Database {
    pub fn open(path: &Path) -> Result<Self> {
        let connection = Connection::open(path)?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS accounts (
                id TEXT PRIMARY KEY,
                provider TEXT NOT NULL,
                label TEXT NOT NULL,
                email TEXT NOT NULL,
                username TEXT NOT NULL,
                host TEXT NOT NULL,
                port INTEGER NOT NULL,
                uid_validity INTEGER,
                last_uid INTEGER NOT NULL DEFAULT 0,
                baseline_complete INTEGER NOT NULL DEFAULT 0,
                sync_phase TEXT NOT NULL DEFAULT 'idle',
                indexed INTEGER NOT NULL DEFAULT 0,
                total INTEGER NOT NULL DEFAULT 0,
                last_success_at TEXT,
                last_full_reconcile_at TEXT,
                last_error TEXT,
                next_sync_at TEXT
            );
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id TEXT NOT NULL,
                uid_validity INTEGER NOT NULL,
                uid INTEGER NOT NULL,
                subject TEXT NOT NULL DEFAULT '',
                sender TEXT NOT NULL DEFAULT '',
                recipients TEXT NOT NULL DEFAULT '',
                received_at TEXT,
                snippet TEXT NOT NULL DEFAULT '',
                body TEXT NOT NULL DEFAULT '',
                body_truncated INTEGER NOT NULL DEFAULT 0,
                attachments_json TEXT NOT NULL DEFAULT '[]',
                size INTEGER NOT NULL DEFAULT 0,
                server_seen INTEGER NOT NULL DEFAULT 0,
                locally_viewed INTEGER NOT NULL DEFAULT 0,
                has_body INTEGER NOT NULL DEFAULT 0,
                UNIQUE(account_id, uid_validity, uid),
                FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS messages_account_received
                ON messages(account_id, received_at DESC, id DESC);
            CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
                subject, sender, recipients, body,
                content='messages', content_rowid='id', tokenize='trigram'
            );
            CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
                INSERT INTO messages_fts(rowid, subject, sender, recipients, body)
                VALUES (new.id, new.subject, new.sender, new.recipients, new.body);
            END;
            CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
                INSERT INTO messages_fts(messages_fts, rowid, subject, sender, recipients, body)
                VALUES ('delete', old.id, old.subject, old.sender, old.recipients, old.body);
            END;
            CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
                INSERT INTO messages_fts(messages_fts, rowid, subject, sender, recipients, body)
                VALUES ('delete', old.id, old.subject, old.sender, old.recipients, old.body);
                INSERT INTO messages_fts(rowid, subject, sender, recipients, body)
                VALUES (new.id, new.subject, new.sender, new.recipients, new.body);
            END;
            ",
        )?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn settings(&self) -> Result<Settings> {
        let connection = self.connection.lock().expect("database lock poisoned");
        let value: Option<String> = connection
            .query_row(
                "SELECT value FROM settings WHERE key='poll_minutes'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        Ok(Settings {
            poll_minutes: value.and_then(|value| value.parse().ok()).unwrap_or(10),
        })
    }

    pub fn save_settings(&self, settings: &Settings) -> Result<()> {
        self.connection
            .lock()
            .expect("database lock poisoned")
            .execute(
                "INSERT INTO settings(key, value) VALUES('poll_minutes', ?1)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                [settings.poll_minutes.to_string()],
            )?;
        Ok(())
    }

    pub fn save_account_with_reset(
        &self,
        id: &str,
        input: &AccountInput,
        reset_cache: bool,
    ) -> Result<()> {
        let mut connection = self.connection.lock().expect("database lock poisoned");
        let transaction = connection.transaction()?;
        transaction.execute(
            "INSERT INTO accounts(id, provider, label, email, username, host, port)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET provider=excluded.provider, label=excluded.label,
                email=excluded.email, username=excluded.username, host=excluded.host,
                port=excluded.port, last_error=NULL, next_sync_at=NULL",
            params![
                id,
                input.provider,
                input.label,
                input.email,
                input.username,
                input.host,
                input.port
            ],
        )?;
        if reset_cache {
            transaction.execute("DELETE FROM messages WHERE account_id=?1", [id])?;
            transaction.execute(
                "UPDATE accounts SET uid_validity=NULL, last_uid=0, baseline_complete=0,
                    indexed=0, total=0, sync_phase='idle', last_success_at=NULL,
                    last_full_reconcile_at=NULL, last_error=NULL, next_sync_at=NULL WHERE id=?1",
                [id],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn account(&self, id: &str) -> Result<Account> {
        self.connection
            .lock()
            .expect("database lock poisoned")
            .query_row(
                "SELECT id, provider, label, email, username, host, port, sync_phase,
                        indexed, total, baseline_complete, last_success_at, last_error, next_sync_at
                 FROM accounts WHERE id=?1",
                [id],
                account_from_row,
            )
            .context("邮箱账号不存在")
    }

    pub fn accounts(&self) -> Result<Vec<Account>> {
        let connection = self.connection.lock().expect("database lock poisoned");
        let mut statement = connection.prepare(
            "SELECT id, provider, label, email, username, host, port, sync_phase,
                    indexed, total, baseline_complete, last_success_at, last_error, next_sync_at
             FROM accounts ORDER BY label COLLATE NOCASE, email COLLATE NOCASE",
        )?;
        Ok(statement
            .query_map([], account_from_row)?
            .collect::<std::result::Result<Vec<_>, _>>()?)
    }

    pub fn remove_account(&self, id: &str) -> Result<()> {
        let mut connection = self.connection.lock().expect("database lock poisoned");
        let transaction = connection.transaction()?;
        transaction.execute("DELETE FROM messages WHERE account_id=?1", [id])?;
        transaction.execute("DELETE FROM accounts WHERE id=?1", [id])?;
        transaction.commit()?;
        Ok(())
    }

    pub fn sync_cursor(&self, id: &str) -> Result<(Option<u32>, u32, bool, Option<String>)> {
        self.connection
            .lock()
            .expect("database lock poisoned")
            .query_row(
                "SELECT uid_validity, last_uid, baseline_complete, last_full_reconcile_at
                 FROM accounts WHERE id=?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .context("邮箱账号不存在")
    }

    pub fn begin_sync(&self, id: &str, phase: &str, total: u64) -> Result<()> {
        self.connection
            .lock()
            .expect("database lock poisoned")
            .execute(
                "UPDATE accounts SET sync_phase=?2, total=?3, last_error=NULL WHERE id=?1",
                params![id, phase, total],
            )?;
        Ok(())
    }

    pub fn progress(&self, id: &str, indexed: u64, phase: &str) -> Result<()> {
        self.connection
            .lock()
            .expect("database lock poisoned")
            .execute(
                "UPDATE accounts SET indexed=?2, sync_phase=?3 WHERE id=?1",
                params![id, indexed, phase],
            )?;
        Ok(())
    }

    pub fn complete_sync(
        &self,
        id: &str,
        uid_validity: u32,
        last_uid: u32,
        reconciled: bool,
    ) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        self.connection
            .lock()
            .expect("database lock poisoned")
            .execute(
                "UPDATE accounts SET uid_validity=?2, last_uid=?3, baseline_complete=1,
                sync_phase='idle', indexed=total, last_success_at=?4,
                last_full_reconcile_at=CASE WHEN ?5 THEN ?4 ELSE last_full_reconcile_at END,
                last_error=NULL, next_sync_at=NULL WHERE id=?1",
                params![id, uid_validity, last_uid, now, reconciled],
            )?;
        Ok(())
    }

    pub fn fail_sync(&self, id: &str, error: &str, retry_minutes: u64) -> Result<()> {
        let next = chrono::Utc::now() + chrono::Duration::minutes(retry_minutes as i64);
        self.connection.lock().expect("database lock poisoned").execute(
            "UPDATE accounts SET sync_phase='error', last_error=?2, next_sync_at=?3 WHERE id=?1",
            params![id, error, next.to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn reset_for_uid_validity(&self, id: &str, uid_validity: u32) -> Result<()> {
        let mut connection = self.connection.lock().expect("database lock poisoned");
        let transaction = connection.transaction()?;
        transaction.execute("DELETE FROM messages WHERE account_id=?1", [id])?;
        transaction.execute(
            "UPDATE accounts SET uid_validity=?2, last_uid=0, baseline_complete=0,
                indexed=0, total=0, sync_phase='indexing' WHERE id=?1",
            params![id, uid_validity],
        )?;
        transaction.commit()?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn upsert_message(
        &self,
        account_id: &str,
        uid_validity: u32,
        uid: u32,
        size: u64,
        server_seen: bool,
        parsed: &ParsedMessage,
        has_body: bool,
    ) -> Result<()> {
        let snippet: String = parsed.body.chars().take(180).collect();
        self.connection.lock().expect("database lock poisoned").execute(
            "INSERT INTO messages(account_id, uid_validity, uid, subject, sender, recipients,
                received_at, snippet, body, body_truncated, attachments_json, size, server_seen, has_body)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
             ON CONFLICT(account_id, uid_validity, uid) DO UPDATE SET
                subject=CASE WHEN excluded.subject <> '' OR messages.subject = '' THEN excluded.subject ELSE messages.subject END,
                sender=CASE WHEN excluded.sender <> '' OR messages.sender = '' THEN excluded.sender ELSE messages.sender END,
                recipients=CASE WHEN excluded.recipients <> '' OR messages.recipients = '' THEN excluded.recipients ELSE messages.recipients END,
                received_at=COALESCE(excluded.received_at, messages.received_at),
                snippet=CASE WHEN excluded.has_body THEN excluded.snippet ELSE messages.snippet END,
                body=CASE WHEN excluded.has_body THEN excluded.body ELSE messages.body END,
                body_truncated=CASE WHEN excluded.has_body THEN excluded.body_truncated ELSE messages.body_truncated END,
                attachments_json=CASE WHEN excluded.has_body THEN excluded.attachments_json ELSE messages.attachments_json END,
                size=CASE WHEN excluded.size > 0 THEN excluded.size ELSE messages.size END,
                server_seen=CASE WHEN excluded.has_body THEN messages.server_seen ELSE excluded.server_seen END,
                has_body=MAX(messages.has_body, excluded.has_body)",
            params![
                account_id,
                uid_validity,
                uid,
                parsed.subject,
                parsed.sender,
                parsed.recipients,
                parsed.received_at,
                snippet,
                parsed.body,
                parsed.body_truncated,
                serde_json::to_string(&parsed.attachments)?,
                size,
                server_seen,
                has_body,
            ],
        )?;
        Ok(())
    }

    pub fn update_message_body(
        &self,
        account_id: &str,
        uid_validity: u32,
        uid: u32,
        body: &str,
        body_truncated: bool,
        attachments: &[AttachmentInfo],
    ) -> Result<bool> {
        let snippet: String = body.chars().take(180).collect();
        let changed = self
            .connection
            .lock()
            .expect("database lock poisoned")
            .execute(
                "UPDATE messages SET snippet=?4, body=?5, body_truncated=?6,
                attachments_json=?7, has_body=1
             WHERE account_id=?1 AND uid_validity=?2 AND uid=?3",
                params![
                    account_id,
                    uid_validity,
                    uid,
                    snippet,
                    body,
                    body_truncated,
                    serde_json::to_string(attachments)?,
                ],
            )?;
        Ok(changed > 0)
    }

    pub fn has_body(&self, account_id: &str, uid_validity: u32, uid: u32) -> Result<bool> {
        Ok(self
            .connection
            .lock()
            .expect("database lock poisoned")
            .query_row(
                "SELECT has_body FROM messages WHERE account_id=?1 AND uid_validity=?2 AND uid=?3",
                params![account_id, uid_validity, uid],
                |row| row.get(0),
            )
            .optional()?
            .unwrap_or(false))
    }

    pub fn incomplete_body_uids(&self, account_id: &str, uid_validity: u32) -> Result<Vec<u32>> {
        let connection = self.connection.lock().expect("database lock poisoned");
        let mut statement = connection.prepare(
            "SELECT uid FROM messages
             WHERE account_id=?1 AND uid_validity=?2 AND has_body=0
             ORDER BY uid DESC",
        )?;
        statement
            .query_map(params![account_id, uid_validity], |row| row.get(0))?
            .collect::<std::result::Result<Vec<u32>, _>>()
            .map_err(Into::into)
    }

    pub fn reconcile_uids(
        &self,
        account_id: &str,
        uid_validity: u32,
        remote: &[u32],
    ) -> Result<()> {
        let mut connection = self.connection.lock().expect("database lock poisoned");
        let local = {
            let mut statement = connection
                .prepare("SELECT uid FROM messages WHERE account_id=?1 AND uid_validity=?2")?;
            statement
                .query_map(params![account_id, uid_validity], |row| {
                    row.get::<_, u32>(0)
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?
        };
        let remote: std::collections::HashSet<_> = remote.iter().copied().collect();
        let transaction = connection.transaction()?;
        for uid in local.into_iter().filter(|uid| !remote.contains(uid)) {
            transaction.execute(
                "DELETE FROM messages WHERE account_id=?1 AND uid_validity=?2 AND uid=?3",
                params![account_id, uid_validity, uid],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn list_messages(
        &self,
        account_id: Option<&str>,
        query: &str,
        offset: i64,
    ) -> Result<MessagePage> {
        let connection = self.connection.lock().expect("database lock poisoned");
        let account = account_id.unwrap_or("");
        let search = fts_query(query);
        let base = "SELECT m.id, m.account_id, a.label, m.subject, m.sender, m.received_at,
                    m.snippet, m.server_seen, m.locally_viewed, m.size, m.has_body
             FROM messages m JOIN accounts a ON a.id=m.account_id";
        let rows = if search.is_empty() {
            let sql = format!(
                "{base} WHERE (?1='' OR m.account_id=?1)
                 ORDER BY COALESCE(m.received_at, '') DESC, m.id DESC LIMIT 51 OFFSET ?2"
            );
            let mut statement = connection.prepare(&sql)?;
            statement
                .query_map(params![account, offset], message_summary_from_row)?
                .collect::<std::result::Result<Vec<_>, _>>()?
        } else {
            let sql = format!(
                "{base} JOIN messages_fts f ON f.rowid=m.id
                 WHERE messages_fts MATCH ?1 AND (?2='' OR m.account_id=?2)
                 ORDER BY rank, COALESCE(m.received_at, '') DESC LIMIT 51 OFFSET ?3"
            );
            let mut statement = connection.prepare(&sql)?;
            statement
                .query_map(params![search, account, offset], message_summary_from_row)?
                .collect::<std::result::Result<Vec<_>, _>>()?
        };
        let has_more = rows.len() > 50;
        let items = rows.into_iter().take(50).collect::<Vec<_>>();
        Ok(MessagePage {
            next_cursor: has_more.then_some(offset + 50),
            items,
        })
    }

    pub fn message(&self, id: i64) -> Result<MessageDetail> {
        let connection = self.connection.lock().expect("database lock poisoned");
        connection.execute("UPDATE messages SET locally_viewed=1 WHERE id=?1", [id])?;
        let detail = connection
            .query_row(
                "SELECT m.id, m.account_id, a.label, m.subject, m.sender, m.received_at,
                        m.snippet, m.server_seen, m.locally_viewed, m.size, m.has_body,
                        m.recipients, m.body, m.body_truncated, m.attachments_json
                 FROM messages m JOIN accounts a ON a.id=m.account_id WHERE m.id=?1",
                [id],
                |row| {
                    let attachments_json: String = row.get(14)?;
                    Ok(MessageDetail {
                        summary: message_summary_from_row(row)?,
                        recipients: row.get(11)?,
                        body: row.get(12)?,
                        body_truncated: row.get(13)?,
                        attachments: serde_json::from_str::<Vec<AttachmentInfo>>(&attachments_json)
                            .unwrap_or_default(),
                    })
                },
            )
            .context("邮件不存在")?;
        Ok(detail)
    }

    pub fn existing_uids(&self, account_id: &str, uid_validity: u32) -> Result<HashSet<u32>> {
        let connection = self.connection.lock().expect("database lock poisoned");
        let mut statement = connection
            .prepare("SELECT uid FROM messages WHERE account_id=?1 AND uid_validity=?2")?;
        let uids = statement
            .query_map(params![account_id, uid_validity], |row| row.get(0))?
            .collect::<std::result::Result<HashSet<u32>, _>>()?;
        Ok(uids)
    }

    pub fn update_seen_flags(
        &self,
        account_id: &str,
        uid_validity: u32,
        unseen_uids: &HashSet<u32>,
    ) -> Result<()> {
        let mut connection = self.connection.lock().expect("database lock poisoned");
        let transaction = connection.transaction()?;
        let old_server_seen = unseen_uids
            .iter()
            .map(|uid| {
                transaction
                    .query_row(
                        "SELECT server_seen FROM messages
                         WHERE account_id=?1 AND uid_validity=?2 AND uid=?3",
                        params![account_id, uid_validity, uid],
                        |row| row.get::<_, bool>(0),
                    )
                    .optional()
                    .map(|value| (*uid, value.unwrap_or(true)))
            })
            .collect::<rusqlite::Result<Vec<_>>>()?;
        transaction.execute(
            "UPDATE messages SET server_seen=1 WHERE account_id=?1 AND uid_validity=?2",
            params![account_id, uid_validity],
        )?;
        let mut statement = transaction.prepare(
            "UPDATE messages SET server_seen=0,
                locally_viewed=CASE WHEN ?4 THEN locally_viewed ELSE 0 END
             WHERE account_id=?1 AND uid_validity=?2 AND uid=?3",
        )?;
        for (uid, was_server_seen) in old_server_seen {
            statement.execute(params![account_id, uid_validity, uid, !was_server_seen])?;
        }
        drop(statement);
        transaction.commit()?;
        Ok(())
    }

    pub fn pending_locally_read_uids(
        &self,
        account_id: &str,
        uid_validity: u32,
    ) -> Result<Vec<u32>> {
        let connection = self.connection.lock().expect("database lock poisoned");
        let mut statement = connection.prepare(
            "SELECT uid FROM messages
             WHERE account_id=?1 AND uid_validity=?2 AND locally_viewed=1 AND server_seen=0
             ORDER BY uid ASC",
        )?;
        let uids = statement
            .query_map(params![account_id, uid_validity], |row| row.get(0))?
            .collect::<std::result::Result<Vec<u32>, _>>()?;
        Ok(uids)
    }

    pub fn mark_server_seen(
        &self,
        account_id: &str,
        uid_validity: u32,
        uids: &[u32],
    ) -> Result<()> {
        let mut connection = self.connection.lock().expect("database lock poisoned");
        let transaction = connection.transaction()?;
        let mut statement = transaction.prepare(
            "UPDATE messages SET server_seen=1
             WHERE account_id=?1 AND uid_validity=?2 AND uid=?3",
        )?;
        for uid in uids {
            statement.execute(params![account_id, uid_validity, uid])?;
        }
        drop(statement);
        transaction.commit()?;
        Ok(())
    }

    pub fn mark_all_read(&self, account_id: &str) -> Result<u64> {
        let changed = self
            .connection
            .lock()
            .expect("database lock poisoned")
            .execute(
                "UPDATE messages SET locally_viewed=1
             WHERE account_id=?1 AND locally_viewed=0",
                [account_id],
            )?;
        Ok(changed as u64)
    }

    pub fn mark_all_server_seen(&self, account_id: &str, uid_validity: u32) -> Result<u64> {
        let changed = self
            .connection
            .lock()
            .expect("database lock poisoned")
            .execute(
                "UPDATE messages SET server_seen=1
             WHERE account_id=?1 AND uid_validity=?2 AND server_seen=0",
                params![account_id, uid_validity],
            )?;
        Ok(changed as u64)
    }
}

fn account_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Account> {
    Ok(Account {
        id: row.get(0)?,
        provider: row.get(1)?,
        label: row.get(2)?,
        email: row.get(3)?,
        username: row.get(4)?,
        host: row.get(5)?,
        port: row.get(6)?,
        has_credential: false,
        sync_phase: row.get(7)?,
        indexed: row.get(8)?,
        total: row.get(9)?,
        baseline_complete: row.get(10)?,
        last_success_at: row.get(11)?,
        last_error: row.get(12)?,
        next_sync_at: row.get(13)?,
    })
}

fn message_summary_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<MessageSummary> {
    Ok(MessageSummary {
        id: row.get(0)?,
        account_id: row.get(1)?,
        account_label: row.get(2)?,
        subject: row.get(3)?,
        sender: row.get(4)?,
        received_at: row.get(5)?,
        snippet: row.get(6)?,
        server_seen: row.get(7)?,
        locally_viewed: row.get(8)?,
        size: row.get(9)?,
        has_body: row.get(10)?,
    })
}

fn fts_query(value: &str) -> String {
    value
        .split_whitespace()
        .filter(|term| !term.is_empty())
        .map(|term| format!("\"{}\"*", term.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" AND ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stores_and_searches_unicode_mail() {
        let database = Database::open(Path::new(":memory:")).unwrap();
        let account = AccountInput {
            id: Some("account-1".into()),
            provider: "custom".into(),
            label: "工作".into(),
            email: "me@example.com".into(),
            username: "me@example.com".into(),
            host: "imap.example.com".into(),
            port: 993,
            secret: None,
        };
        database
            .save_account_with_reset("account-1", &account, false)
            .unwrap();
        database
            .upsert_message(
                "account-1",
                7,
                9,
                12,
                false,
                &ParsedMessage {
                    subject: "项目进展".into(),
                    sender: "同事 <team@example.com>".into(),
                    recipients: "me@example.com".into(),
                    received_at: Some("2026-09-03T00:00:00Z".into()),
                    body: "今天完成邮件助手".into(),
                    body_truncated: false,
                    attachments: vec![],
                },
                true,
            )
            .unwrap();
        let page = database.list_messages(None, "邮件助手", 0).unwrap();
        assert_eq!(page.items.len(), 1);
        assert_eq!(
            database.message(page.items[0].id).unwrap().body,
            "今天完成邮件助手"
        );
    }

    #[test]
    fn resets_account_cache_in_the_same_transaction() {
        let database = Database::open(Path::new(":memory:")).unwrap();
        let mut account = AccountInput {
            id: Some("account-1".into()),
            provider: "custom".into(),
            label: "工作".into(),
            email: "me@example.com".into(),
            username: "me@example.com".into(),
            host: "imap.example.com".into(),
            port: 993,
            secret: None,
        };
        database
            .save_account_with_reset("account-1", &account, false)
            .unwrap();
        database
            .upsert_message(
                "account-1",
                7,
                9,
                12,
                false,
                &ParsedMessage {
                    subject: "旧邮件".into(),
                    sender: String::new(),
                    recipients: String::new(),
                    received_at: None,
                    body: "old".into(),
                    body_truncated: false,
                    attachments: vec![],
                },
                true,
            )
            .unwrap();
        account.host = "imap2.example.com".into();

        database
            .save_account_with_reset("account-1", &account, true)
            .unwrap();

        assert_eq!(
            database.account("account-1").unwrap().host,
            "imap2.example.com"
        );
        assert!(
            database
                .list_messages(Some("account-1"), "", 0)
                .unwrap()
                .items
                .is_empty()
        );
    }

    #[test]
    fn syncs_seen_flags_and_preserves_on_body_update() {
        let database = Database::open(Path::new(":memory:")).unwrap();
        let account = AccountInput {
            id: Some("acc".into()),
            provider: "qq".into(),
            label: "QQ".into(),
            email: "user@qq.com".into(),
            username: "user@qq.com".into(),
            host: "imap.qq.com".into(),
            port: 993,
            secret: None,
        };
        database
            .save_account_with_reset("acc", &account, false)
            .unwrap();
        let parsed = ParsedMessage {
            subject: "测试".into(),
            sender: "a@qq.com".into(),
            recipients: "user@qq.com".into(),
            received_at: None,
            body: "正文".into(),
            body_truncated: false,
            attachments: vec![],
        };
        database
            .upsert_message("acc", 1, 100, 10, false, &parsed, false)
            .unwrap();
        database
            .upsert_message("acc", 1, 101, 10, false, &parsed, false)
            .unwrap();

        let mut unseen = HashSet::new();
        unseen.insert(100);
        assert_eq!(database.mark_all_read("acc").unwrap(), 2);
        database.update_seen_flags("acc", 1, &unseen).unwrap();

        let msgs = database.list_messages(Some("acc"), "", 0).unwrap().items;
        let m100 = msgs.iter().find(|m| m.id == 1).unwrap();
        let m101 = msgs.iter().find(|m| m.id == 2).unwrap();
        assert!(!m100.server_seen);
        assert!(m100.locally_viewed);
        assert!(m101.server_seen);
        assert!(m101.locally_viewed);

        // Updating a cached body should preserve the header and server flags.
        database
            .update_message_body("acc", 1, 101, "更新后的正文", false, &[])
            .unwrap();
        let m101_after = database.message(2).unwrap();
        assert!(m101_after.summary.server_seen);
        assert!(m101_after.summary.locally_viewed);
        assert_eq!(m101_after.summary.subject, "测试");
        assert_eq!(m101_after.body, "更新后的正文");
        assert!(m101_after.summary.has_body);
        assert_eq!(database.incomplete_body_uids("acc", 1).unwrap(), vec![100]);
        assert_eq!(
            database.pending_locally_read_uids("acc", 1).unwrap(),
            vec![100]
        );
    }
}
