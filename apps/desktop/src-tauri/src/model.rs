use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const MANIFEST_SCHEMA_VERSION: u32 = 1;
pub const PROTOCOL_VERSION: u32 = 1;
pub const CORE_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum ProxyMode {
    #[default]
    System,
    Custom,
    Direct,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProxySettings {
    pub mode: ProxyMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyTestResult {
    pub ok: bool,
    pub latency_ms: u128,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRequest {
    pub id: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformArtifact {
    pub backend: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ui_design_version: Option<u32>,
    pub schema_version: u32,
    pub protocol_version: u32,
    pub id: String,
    pub version: String,
    pub name: String,
    pub description: String,
    pub author: String,
    pub license: String,
    pub min_core_version: String,
    pub icon: Option<String>,
    pub ui: String,
    pub background: String,
    pub permissions: Vec<PermissionRequest>,
    pub platforms: BTreeMap<String, PlatformArtifact>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogArtifact {
    pub target: String,
    pub url: String,
    pub sha256: String,
    pub signature: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogPlugin {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ui_design_version: Option<u32>,
    pub id: String,
    pub version: String,
    pub name: String,
    pub description: String,
    pub author: String,
    pub icon: Option<String>,
    pub min_core_version: String,
    pub permissions: Vec<PermissionRequest>,
    pub artifacts: Vec<CatalogArtifact>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogIndex {
    pub schema_version: u32,
    pub sequence: u64,
    pub generated_at: String,
    pub plugins: Vec<CatalogPlugin>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginSummary {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ui_design_version: Option<u32>,
    pub id: String,
    pub version: String,
    pub name: String,
    pub description: String,
    pub icon: Option<String>,
    pub enabled: bool,
    pub state: String,
    pub permissions: Vec<PermissionRequest>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppState {
    pub version: String,
    pub platform: String,
    pub target: String,
    pub plugins: Vec<PluginSummary>,
    pub catalog_sequence: u64,
    pub launch_at_startup: bool,
    pub update_available: Option<UpdateInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginUpdateInfo {
    pub id: String,
    pub name: String,
    pub current_version: String,
    pub version: String,
    pub min_core_version: String,
    pub compatible: bool,
    pub permissions_changed: bool,
    pub added_permissions: Vec<PermissionRequest>,
    pub removed_permissions: Vec<PermissionRequest>,
    pub changed_permissions: Vec<PermissionChange>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PermissionChange {
    pub id: String,
    pub old_reason: String,
    pub new_reason: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginUpdateRequest {
    pub id: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    pub operation: String,
    pub item_id: Option<String>,
    pub item_name: String,
    pub stage: String,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub completed_items: usize,
    pub total_items: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub plugin: PluginSummary,
    pub permissions_changed: bool,
}

pub fn target_key() -> String {
    let os = match std::env::consts::OS {
        "windows" => "windows",
        "macos" => "darwin",
        value => value,
    };
    let arch = std::env::consts::ARCH;
    format!("{os}-{arch}")
}
