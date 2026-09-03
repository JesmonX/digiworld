use crate::credentials;
use crate::database::Database;
use crate::model::{
    Account, AccountInput, AttachmentInfo, MessagePage, ParsedMessage, Settings, SyncStatus,
};
use crate::{parser, transport};
use anyhow::{Context, Result, bail};
use imap::types::Flag;
use imap_proto::types::{
    BodyContentCommon, BodyParams, BodyStructure, ContentEncoding, SectionPath,
};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const FETCH_BATCH: usize = 100;
const MAX_BODY_BYTES: usize = 1024 * 1024;

type Notify = dyn Fn(String, String) + Send + Sync;

pub struct MailEngine {
    database: Database,
    syncing: Mutex<HashSet<String>>,
    last_started: Mutex<HashMap<String, Instant>>,
    shutdown: AtomicBool,
    notify: Arc<Notify>,
}

impl MailEngine {
    pub fn open(path: &std::path::Path, notify: Arc<Notify>) -> Result<Arc<Self>> {
        let engine = Arc::new(Self {
            database: Database::open(path)?,
            syncing: Mutex::new(HashSet::new()),
            last_started: Mutex::new(HashMap::new()),
            shutdown: AtomicBool::new(false),
            notify,
        });
        engine.start_scheduler();
        Ok(engine)
    }

    fn start_scheduler(self: &Arc<Self>) {
        let engine = self.clone();
        std::thread::spawn(move || {
            let mut elapsed = 60_u64;
            while !engine.shutdown.load(Ordering::Relaxed) {
                if elapsed >= 60 {
                    elapsed = 0;
                    let poll = engine
                        .settings()
                        .map(|value| value.poll_minutes)
                        .unwrap_or(10);
                    if let Ok(accounts) = engine.accounts() {
                        for account in accounts {
                            let due = engine
                                .last_started
                                .lock()
                                .expect("scheduler lock poisoned")
                                .get(&account.id)
                                .is_none_or(|started| {
                                    started.elapsed() >= Duration::from_secs(poll * 60)
                                });
                            if due {
                                engine.start_sync(Some(&account.id));
                            }
                        }
                    }
                }
                std::thread::sleep(Duration::from_secs(1));
                elapsed += 1;
            }
        });
    }

    pub fn shutdown(&self) {
        self.shutdown.store(true, Ordering::Relaxed);
    }

    pub fn settings(&self) -> Result<Settings> {
        self.database.settings()
    }

    pub fn save_settings(&self, settings: Settings) -> Result<Settings> {
        if !matches!(settings.poll_minutes, 5 | 10 | 15 | 30) {
            bail!("轮询间隔只能是 5、10、15 或 30 分钟")
        }
        self.database.save_settings(&settings)?;
        Ok(settings)
    }

    pub fn accounts(&self) -> Result<Vec<Account>> {
        let mut accounts = self.database.accounts()?;
        for account in &mut accounts {
            account.has_credential = credentials::exists(&account.id);
        }
        Ok(accounts)
    }

    pub fn test_account(&self, input: AccountInput) -> Result<serde_json::Value> {
        validate_account(&input)?;
        let secret = match input.secret.as_deref() {
            Some(secret) if !secret.trim().is_empty() => secret.trim().to_string(),
            _ => input
                .id
                .as_deref()
                .map(credentials::get)
                .transpose()?
                .context("请输入应用专用密码或客户端授权码")?,
        };
        let mut session = connect(&input, &secret)?;
        session
            .examine("INBOX")
            .context("无法以只读方式打开 INBOX")?;
        let _ = session.logout();
        Ok(json!({ "ok": true }))
    }

    pub fn save_account(self: &Arc<Self>, input: AccountInput) -> Result<Account> {
        validate_account(&input)?;
        let id = input
            .id
            .clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let connection_changed = input.id.as_deref().is_some_and(|existing_id| {
            self.database.account(existing_id).is_ok_and(|old| {
                old.host != input.host
                    || old.port != input.port
                    || old.username != input.username
                    || old.email != input.email
            })
        });
        let secret = match input.secret.as_deref() {
            Some(secret) if !secret.trim().is_empty() => secret.trim().to_string(),
            _ if input.id.is_some() => credentials::get(&id)?,
            _ => bail!("请输入应用专用密码或客户端授权码"),
        };
        let mut session = connect(&input, &secret)?;
        session
            .examine("INBOX")
            .context("无法以只读方式打开 INBOX")?;
        let _ = session.logout();
        credentials::set(&id, &secret)?;
        if let Err(error) = self.database.save_account(&id, &input) {
            if input.id.is_none() {
                let _ = credentials::delete(&id);
            }
            return Err(error);
        }
        if connection_changed {
            self.database.reset_account_cache(&id)?;
        }
        self.start_sync(Some(&id));
        let mut account = self.database.account(&id)?;
        account.has_credential = true;
        Ok(account)
    }

    pub fn remove_account(&self, id: &str) -> Result<()> {
        if self
            .syncing
            .lock()
            .expect("sync lock poisoned")
            .contains(id)
        {
            bail!("账号正在同步，请稍后再删除")
        }
        credentials::delete(id)?;
        self.database.remove_account(id)
    }

    pub fn start_sync(self: &Arc<Self>, account_id: Option<&str>) -> Vec<String> {
        let ids = if let Some(id) = account_id {
            vec![id.to_string()]
        } else {
            self.accounts()
                .unwrap_or_default()
                .into_iter()
                .map(|account| account.id)
                .collect()
        };
        let mut started = Vec::new();
        for id in ids {
            {
                let mut syncing = self.syncing.lock().expect("sync lock poisoned");
                if !syncing.insert(id.clone()) {
                    continue;
                }
            }
            self.last_started
                .lock()
                .expect("scheduler lock poisoned")
                .insert(id.clone(), Instant::now());
            started.push(id.clone());
            let engine = self.clone();
            std::thread::spawn(move || {
                if let Err(error) = engine.sync_account(&id) {
                    let message = redact_error(&error.to_string());
                    let _ = engine.database.fail_sync(&id, &message, 5);
                }
                engine
                    .syncing
                    .lock()
                    .expect("sync lock poisoned")
                    .remove(&id);
            });
        }
        started
    }

    pub fn status(&self) -> Result<SyncStatus> {
        let mut syncing_account_ids = self
            .syncing
            .lock()
            .expect("sync lock poisoned")
            .iter()
            .cloned()
            .collect::<Vec<_>>();
        syncing_account_ids.sort();
        Ok(SyncStatus {
            accounts: self.accounts()?,
            syncing_account_ids,
        })
    }

    pub fn list_messages(
        &self,
        account: Option<&str>,
        query: &str,
        cursor: i64,
    ) -> Result<MessagePage> {
        self.database.list_messages(account, query, cursor.max(0))
    }

    pub fn message(&self, id: i64) -> Result<crate::model::MessageDetail> {
        self.database.message(id)
    }

    fn sync_account(&self, id: &str) -> Result<()> {
        let account = self.database.account(id)?;
        let input = AccountInput {
            id: Some(account.id.clone()),
            provider: account.provider.clone(),
            label: account.label.clone(),
            email: account.email.clone(),
            username: account.username.clone(),
            host: account.host.clone(),
            port: account.port,
            secret: None,
        };
        let secret = credentials::get(id)?;
        let (stored_validity, old_last_uid, baseline_complete, last_reconcile) =
            self.database.sync_cursor(id)?;
        let reconcile = !baseline_complete
            || last_reconcile
                .as_deref()
                .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
                .is_none_or(|value| {
                    chrono::Utc::now()
                        .signed_duration_since(value.with_timezone(&chrono::Utc))
                        .num_hours()
                        >= 24
                });
        let mut session = connect(&input, &secret)?;
        let mailbox = session
            .examine("INBOX")
            .context("无法以只读方式打开 INBOX")?;
        let uid_validity = mailbox.uid_validity.unwrap_or(0);
        if stored_validity.is_some_and(|value| value != uid_validity) {
            self.database.reset_for_uid_validity(id, uid_validity)?;
        }
        let effective_baseline = baseline_complete && stored_validity == Some(uid_validity);
        let criteria = if effective_baseline && !reconcile && old_last_uid > 0 {
            format!("UID {}:*", old_last_uid.saturating_add(1))
        } else {
            "ALL".to_string()
        };
        let mut uids = session
            .uid_search(criteria)
            .context("无法读取 INBOX 邮件索引")?
            .into_iter()
            .collect::<Vec<_>>();
        uids.sort_unstable_by(|left, right| right.cmp(left));
        if reconcile {
            self.database.reconcile_uids(id, uid_validity, &uids)?;
        }
        self.database
            .begin_sync(id, "indexing", uids.len() as u64)?;
        let mut indexed = 0_u64;
        let mut new_messages = Vec::new();
        let mut metadata = HashMap::new();
        for batch in uids.chunks(FETCH_BATCH) {
            let sequence = batch
                .iter()
                .map(u32::to_string)
                .collect::<Vec<_>>()
                .join(",");
            let fetches = session
                .uid_fetch(
                    sequence,
                    "(UID FLAGS RFC822.SIZE BODY.PEEK[HEADER] BODYSTRUCTURE)",
                )
                .context("读取邮件头失败")?;
            for fetch in fetches.iter() {
                let Some(uid) = fetch.uid else { continue };
                let size = fetch.size.unwrap_or(0) as u64;
                let seen = fetch.flags().iter().any(|flag| matches!(flag, Flag::Seen));
                let header = fetch.header().unwrap_or_default();
                let parsed = parser::parse(header);
                let plan = fetch.bodystructure().map(plan_body).unwrap_or_default();
                metadata.insert(uid, (size, seen, parsed.clone(), plan));
                self.database
                    .upsert_message(id, uid_validity, uid, size, seen, &parsed, false)?;
                if effective_baseline && uid > old_last_uid {
                    new_messages.push((parsed.sender.clone(), parsed.subject.clone()));
                }
                indexed += 1;
            }
            self.database.progress(id, indexed, "indexing")?;
        }
        self.database.progress(id, 0, "downloading")?;
        let mut downloaded = 0_u64;
        for uid in &uids {
            if self.database.has_body(id, uid_validity, *uid)? {
                downloaded += 1;
                continue;
            }
            let (size, seen, mut parsed, plan) =
                metadata
                    .remove(uid)
                    .unwrap_or((0, false, empty_message(), BodyPlan::default()));
            let (body, truncated) = fetch_text_body(&mut session, *uid, &plan)?;
            parsed.body = body;
            parsed.body_truncated = truncated;
            parsed.attachments = plan.attachments;
            self.database
                .upsert_message(id, uid_validity, *uid, size, seen, &parsed, true)?;
            downloaded += 1;
            self.database.progress(id, downloaded, "downloading")?;
        }
        let last_uid = uids.iter().copied().max().unwrap_or(old_last_uid);
        self.database
            .complete_sync(id, uid_validity, last_uid, reconcile)?;
        let _ = session.logout();
        if effective_baseline && !new_messages.is_empty() {
            if new_messages.len() == 1 {
                let (sender, subject) = &new_messages[0];
                (self.notify)(
                    account.label,
                    format!("{} · {}", compact(sender, 80), compact(subject, 120)),
                );
            } else {
                (self.notify)(
                    account.label,
                    format!("收到 {} 封新邮件", new_messages.len()),
                );
            }
        }
        Ok(())
    }
}

type Session = imap::Session<transport::BoxedIo>;

fn connect(input: &AccountInput, secret: &str) -> Result<Session> {
    let stream = transport::connect_tls(&input.host, input.port)?;
    let client = imap::Client::new(stream);
    client
        .login(&input.username, secret)
        .map_err(|(error, _)| anyhow::anyhow!("IMAP 认证失败: {error}"))
}

#[derive(Default)]
struct BodyPlan {
    text: Vec<TextPart>,
    html: Vec<TextPart>,
    attachments: Vec<AttachmentInfo>,
}

struct TextPart {
    path: Vec<u32>,
    mime_type: String,
    charset: Option<String>,
    encoding: String,
    octets: usize,
}

fn plan_body(body: &BodyStructure<'_>) -> BodyPlan {
    let mut plan = BodyPlan::default();
    collect_body_plan(body, &mut Vec::new(), &mut plan);
    plan
}

fn collect_body_plan(body: &BodyStructure<'_>, path: &mut Vec<u32>, plan: &mut BodyPlan) {
    match body {
        BodyStructure::Multipart { bodies, .. } => {
            for (index, child) in bodies.iter().enumerate() {
                path.push(index as u32 + 1);
                collect_body_plan(child, path, plan);
                path.pop();
            }
        }
        BodyStructure::Text { common, other, .. } => {
            if is_attachment(common) {
                push_attachment(common, other.octets, plan);
                return;
            }
            let part = TextPart {
                path: path.clone(),
                mime_type: format!("{}/{}", common.ty.ty, common.ty.subtype),
                charset: param(&common.ty.params, "charset").map(str::to_string),
                encoding: encoding_name(&other.transfer_encoding),
                octets: other.octets as usize,
            };
            if common.ty.subtype.eq_ignore_ascii_case("plain") {
                plan.text.push(part);
            } else if common.ty.subtype.eq_ignore_ascii_case("html") {
                plan.html.push(part);
            }
        }
        BodyStructure::Basic { common, other, .. }
        | BodyStructure::Message { common, other, .. } => {
            push_attachment(common, other.octets, plan);
        }
    }
}

fn is_attachment(common: &BodyContentCommon<'_>) -> bool {
    common
        .disposition
        .as_ref()
        .is_some_and(|value| value.ty.eq_ignore_ascii_case("attachment"))
        || common
            .disposition
            .as_ref()
            .and_then(|value| param(&value.params, "filename"))
            .is_some()
        || param(&common.ty.params, "name").is_some()
}

fn push_attachment(common: &BodyContentCommon<'_>, octets: u32, plan: &mut BodyPlan) {
    let filename = common
        .disposition
        .as_ref()
        .and_then(|value| param(&value.params, "filename"))
        .or_else(|| param(&common.ty.params, "name"))
        .unwrap_or("未命名附件");
    if is_attachment(common) || !common.ty.ty.eq_ignore_ascii_case("text") {
        plan.attachments.push(AttachmentInfo {
            filename: filename.to_string(),
            mime_type: format!("{}/{}", common.ty.ty, common.ty.subtype),
            size: octets as u64,
        });
    }
}

fn param<'a>(params: &'a BodyParams<'a>, name: &str) -> Option<&'a str> {
    params
        .as_ref()?
        .iter()
        .find_map(|(key, value)| key.eq_ignore_ascii_case(name).then_some(*value))
}

fn encoding_name(value: &ContentEncoding<'_>) -> String {
    match value {
        ContentEncoding::SevenBit => "7bit".into(),
        ContentEncoding::EightBit => "8bit".into(),
        ContentEncoding::Binary => "binary".into(),
        ContentEncoding::Base64 => "base64".into(),
        ContentEncoding::QuotedPrintable => "quoted-printable".into(),
        ContentEncoding::Other(value) => (*value).to_string(),
    }
}

fn fetch_text_body(session: &mut Session, uid: u32, plan: &BodyPlan) -> Result<(String, bool)> {
    let parts = if plan.text.is_empty() {
        &plan.html
    } else {
        &plan.text
    };
    let mut remaining = MAX_BODY_BYTES;
    let mut bodies = Vec::new();
    let total = parts.iter().map(|part| part.octets).sum::<usize>();
    for part in parts {
        if remaining == 0 {
            break;
        }
        let limit = part.octets.min(remaining);
        let section = if part.path.is_empty() {
            "TEXT".to_string()
        } else {
            part.path
                .iter()
                .map(u32::to_string)
                .collect::<Vec<_>>()
                .join(".")
        };
        let query = format!("BODY.PEEK[{section}]<0.{limit}>");
        let fetches = session
            .uid_fetch(uid.to_string(), query)
            .context("读取邮件正文失败")?;
        let raw = fetches.iter().next().and_then(|fetch| {
            if part.path.is_empty() {
                fetch.text()
            } else {
                fetch.section(&SectionPath::Part(part.path.clone(), None))
            }
        });
        if let Some(raw) = raw {
            let body = parser::decode_text_part(
                raw,
                &part.mime_type,
                part.charset.as_deref(),
                &part.encoding,
            );
            remaining = remaining.saturating_sub(raw.len());
            if !body.trim().is_empty() {
                bodies.push(body);
            }
        }
    }
    let body = bodies.join("\n\n");
    let char_truncated = body.chars().count() > MAX_BODY_BYTES;
    Ok((
        body.chars().take(MAX_BODY_BYTES).collect(),
        total > MAX_BODY_BYTES || char_truncated,
    ))
}

fn empty_message() -> ParsedMessage {
    ParsedMessage {
        subject: String::new(),
        sender: String::new(),
        recipients: String::new(),
        received_at: None,
        body: String::new(),
        body_truncated: false,
        attachments: vec![],
    }
}

fn validate_account(input: &AccountInput) -> Result<()> {
    if !matches!(input.provider.as_str(), "gmail" | "qq" | "163" | "custom") {
        bail!("不支持的邮箱服务")
    }
    if input.label.trim().is_empty() || input.label.chars().count() > 60 {
        bail!("账号名称不能为空且不能超过 60 个字符")
    }
    if !input.email.contains('@') || input.email.chars().count() > 254 {
        bail!("邮箱地址无效")
    }
    if input.username.trim().is_empty() || input.username.chars().count() > 254 {
        bail!("IMAP 用户名无效")
    }
    if input.host.is_empty()
        || input.host.len() > 253
        || !input
            .host
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-'))
    {
        bail!("IMAP 主机无效")
    }
    if input.port == 0 {
        bail!("IMAP 端口无效")
    }
    Ok(())
}

fn redact_error(value: &str) -> String {
    value.chars().take(500).collect()
}

fn compact(value: &str, limit: usize) -> String {
    let value = value.split_whitespace().collect::<Vec<_>>().join(" ");
    value.chars().take(limit).collect()
}
