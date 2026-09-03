use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[serde(rename_all = "lowercase")]
pub enum AgentKind {
    Codex,
    Claude,
    Pi,
    Zcode,
    Agy,
}

impl AgentKind {
    pub const ALL: [Self; 5] = [Self::Codex, Self::Claude, Self::Pi, Self::Zcode, Self::Agy];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::Claude => "claude",
            Self::Pi => "pi",
            Self::Zcode => "zcode",
            Self::Agy => "agy",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    #[serde(default)]
    pub cache_available: bool,
}

impl TokenUsage {
    pub fn add_assign(&mut self, other: &Self) {
        self.input_tokens = self.input_tokens.saturating_add(other.input_tokens);
        self.output_tokens = self.output_tokens.saturating_add(other.output_tokens);
        self.cache_read_tokens = self
            .cache_read_tokens
            .saturating_add(other.cache_read_tokens);
        self.cache_write_tokens = self
            .cache_write_tokens
            .saturating_add(other.cache_write_tokens);
        self.cache_available |= other.cache_available;
    }

    pub fn total_tokens(&self) -> u64 {
        self.input_tokens.saturating_add(self.output_tokens)
    }

    pub fn is_empty(&self) -> bool {
        self.total_tokens() == 0 && self.cache_read_tokens == 0 && self.cache_write_tokens == 0
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DailyUsage {
    pub day: String,
    #[serde(default = "unknown_model")]
    pub model: String,
    #[serde(flatten)]
    pub usage: TokenUsage,
}

fn unknown_model() -> String {
    "unknown".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshSource {
    pub id: String,
    pub label: String,
    pub host: String,
    #[serde(default = "all_agents")]
    pub enabled_agents: Vec<AgentKind>,
    #[serde(default)]
    pub roots: BTreeMap<AgentKind, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSettings {
    #[serde(default = "all_agents")]
    pub local_agents: Vec<AgentKind>,
    #[serde(default)]
    pub local_roots: BTreeMap<AgentKind, String>,
    #[serde(default)]
    pub ssh_sources: Vec<SshSource>,
    #[serde(default)]
    pub codex_quota: CodexQuotaSettings,
}

impl Default for UsageSettings {
    fn default() -> Self {
        Self {
            local_agents: all_agents(),
            local_roots: BTreeMap::new(),
            ssh_sources: Vec::new(),
            codex_quota: CodexQuotaSettings::default(),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum ShellPreset {
    #[default]
    Auto,
    Powershell,
    Zsh,
    Bash,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexQuotaSettings {
    #[serde(default = "default_quota_source")]
    pub source_id: Option<String>,
    #[serde(default)]
    pub shell_preset: ShellPreset,
    #[serde(default)]
    pub pre_command: String,
    #[serde(default = "default_quota_refresh_interval")]
    pub refresh_interval_seconds: Option<u64>,
}

impl Default for CodexQuotaSettings {
    fn default() -> Self {
        Self {
            source_id: default_quota_source(),
            shell_preset: ShellPreset::Auto,
            pre_command: String::new(),
            refresh_interval_seconds: default_quota_refresh_interval(),
        }
    }
}

fn default_quota_source() -> Option<String> {
    Some("local".into())
}

fn default_quota_refresh_interval() -> Option<u64> {
    Some(60)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexQuotaWindow {
    pub used_percent: u32,
    pub window_duration_mins: Option<i64>,
    pub resets_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexQuotaSnapshot {
    pub status: String,
    pub source_id: Option<String>,
    pub source_label: Option<String>,
    pub fetched_at: Option<String>,
    pub plan_type: Option<String>,
    pub windows: Vec<CodexQuotaWindow>,
    pub error: Option<String>,
}

impl CodexQuotaSnapshot {
    pub fn unconfigured() -> Self {
        Self {
            status: "unconfigured".into(),
            source_id: None,
            source_label: None,
            fetched_at: None,
            plan_type: None,
            windows: Vec::new(),
            error: None,
        }
    }

    pub fn unavailable(source_id: String, source_label: String, error: String) -> Self {
        Self {
            status: "unavailable".into(),
            source_id: Some(source_id),
            source_label: Some(source_label),
            fetched_at: None,
            plan_type: None,
            windows: Vec::new(),
            error: Some(error),
        }
    }
}

fn all_agents() -> Vec<AgentKind> {
    AgentKind::ALL.to_vec()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileUsage {
    pub agent: AgentKind,
    pub file_hash: String,
    pub size: u64,
    pub modified: i64,
    pub daily: Vec<DailyUsage>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanBatch {
    pub files: Vec<FileUsage>,
    pub seen: BTreeMap<AgentKind, Vec<String>>,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceStatus {
    pub source_id: String,
    pub status: String,
    pub last_scanned_at: Option<String>,
    pub error: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotRequest {
    #[serde(default = "default_range")]
    pub range: String,
    #[serde(default = "all_agents")]
    pub agents: Vec<AgentKind>,
    #[serde(default)]
    pub sources: Vec<String>,
}

fn default_range() -> String {
    "365".into()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DaySnapshot {
    pub day: String,
    #[serde(flatten)]
    pub usage: TokenUsage,
    pub total_tokens: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Breakdown {
    pub source_id: String,
    pub source_label: String,
    pub agent: AgentKind,
    #[serde(flatten)]
    pub usage: TokenUsage,
    pub total_tokens: u64,
    pub cache_rate: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelBreakdown {
    pub source_id: String,
    pub source_label: String,
    pub agent: AgentKind,
    pub model: String,
    #[serde(flatten)]
    pub usage: TokenUsage,
    pub total_tokens: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageTotals {
    #[serde(flatten)]
    pub usage: TokenUsage,
    pub total_tokens: u64,
    pub cache_rate: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSnapshot {
    pub start_day: Option<String>,
    pub end_day: String,
    pub totals: UsageTotals,
    pub days: Vec<DaySnapshot>,
    pub breakdown: Vec<Breakdown>,
    pub model_breakdown: Vec<ModelBreakdown>,
    pub statuses: Vec<SourceStatus>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshStatus {
    pub running: bool,
    pub job_id: Option<String>,
    pub completed: usize,
    pub total: usize,
    pub current_source: Option<String>,
    pub errors: Vec<String>,
}
