use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountInput {
    #[serde(default)]
    pub id: Option<String>,
    pub provider: String,
    pub label: String,
    pub email: String,
    pub username: String,
    pub host: String,
    pub port: u16,
    #[serde(default = "default_use_proxy")]
    pub use_proxy: bool,
    #[serde(default)]
    pub secret: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub provider: String,
    pub label: String,
    pub email: String,
    pub username: String,
    pub host: String,
    pub port: u16,
    pub use_proxy: bool,
    pub has_credential: bool,
    pub sync_phase: String,
    pub indexed: u64,
    pub total: u64,
    pub baseline_complete: bool,
    pub last_success_at: Option<String>,
    pub last_error: Option<String>,
    pub next_sync_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub poll_minutes: u64,
}

impl Default for Settings {
    fn default() -> Self {
        Self { poll_minutes: 10 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageSummary {
    pub id: i64,
    pub account_id: String,
    pub account_label: String,
    pub subject: String,
    pub sender: String,
    pub received_at: Option<String>,
    pub snippet: String,
    pub server_seen: bool,
    pub locally_viewed: bool,
    pub size: u64,
    pub has_body: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentInfo {
    pub filename: String,
    pub mime_type: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageDetail {
    #[serde(flatten)]
    pub summary: MessageSummary,
    pub recipients: String,
    pub body: String,
    pub body_truncated: bool,
    pub attachments: Vec<AttachmentInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagePage {
    pub items: Vec<MessageSummary>,
    pub next_cursor: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub accounts: Vec<Account>,
    pub syncing_account_ids: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ParsedMessage {
    pub subject: String,
    pub sender: String,
    pub recipients: String,
    pub received_at: Option<String>,
    pub body: String,
    pub body_truncated: bool,
    pub attachments: Vec<AttachmentInfo>,
}

fn default_use_proxy() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_input_defaults_to_proxy_for_older_requests() {
        let input: AccountInput = serde_json::from_str(
            r#"{
                "provider": "custom",
                "label": "工作邮箱",
                "email": "me@example.com",
                "username": "me@example.com",
                "host": "imap.example.com",
                "port": 993
            }"#,
        )
        .unwrap();
        assert!(input.use_proxy);
    }
}
