use crate::database::Database;
#[cfg(test)]
use crate::model::AgentKind;
use crate::model::{
    AgyQuotaBucket, AgyQuotaSnapshot, CodexQuotaSnapshot, RefreshStatus, SnapshotRequest,
    SshSource, StatusBarQuota, StatusBarSummary, StatusBarWindow, UsageSettings, UsageSnapshot,
};
use crate::{agy_quota, quota, remote, scanner};
use anyhow::{Result, bail};
use std::collections::BTreeSet;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Clone)]
pub struct UsageEngine {
    database: Arc<Mutex<Database>>,
    refresh: Arc<Mutex<RefreshStatus>>,
    quota_cache: Arc<Mutex<Option<CachedCodexQuota>>>,
    agy_quota_cache: Arc<Mutex<Option<CachedAgyQuota>>>,
}

#[derive(Clone)]
struct CachedCodexQuota {
    snapshot: CodexQuotaSnapshot,
    cached_at: Instant,
}

impl CachedCodexQuota {
    fn is_fresh(&self, refresh_interval_seconds: Option<u64>, now: Instant) -> bool {
        refresh_interval_seconds.is_none_or(|seconds| {
            now.saturating_duration_since(self.cached_at) < Duration::from_secs(seconds)
        })
    }
}

#[derive(Clone)]
struct CachedAgyQuota {
    snapshot: AgyQuotaSnapshot,
    cached_at: Instant,
}

impl CachedAgyQuota {
    fn is_fresh(&self, refresh_interval_seconds: Option<u64>, now: Instant) -> bool {
        refresh_interval_seconds.is_none_or(|seconds| {
            now.saturating_duration_since(self.cached_at) < Duration::from_secs(seconds)
        })
    }
}

enum RefreshSource {
    Local,
    Ssh(SshSource),
}

impl UsageEngine {
    pub fn open(path: &Path) -> Result<Self> {
        Ok(Self {
            database: Arc::new(Mutex::new(Database::open(path)?)),
            refresh: Arc::new(Mutex::new(RefreshStatus::default())),
            quota_cache: Arc::new(Mutex::new(None)),
            agy_quota_cache: Arc::new(Mutex::new(None)),
        })
    }

    pub fn settings(&self) -> Result<UsageSettings> {
        self.database
            .lock()
            .expect("database lock poisoned")
            .settings()
    }

    pub fn save_settings(&self, mut settings: UsageSettings) -> Result<UsageSettings> {
        normalize_settings(&mut settings)?;
        self.database
            .lock()
            .expect("database lock poisoned")
            .save_settings(&settings)?;
        *self.quota_cache.lock().expect("quota cache lock poisoned") = None;
        *self
            .agy_quota_cache
            .lock()
            .expect("agy quota cache lock poisoned") = None;
        Ok(settings)
    }

    pub fn save_filters(
        &self,
        agents: Option<Vec<crate::model::AgentKind>>,
        sources: Option<Vec<String>>,
    ) -> Result<UsageSettings> {
        let mut settings = self.settings()?;
        if let Some(mut agents) = agents {
            let mut unique = BTreeSet::new();
            agents.retain(|a| unique.insert(*a));
            if !agents.is_empty() {
                settings.selected_agents = Some(agents);
            }
        }
        if let Some(mut sources) = sources {
            let mut unique = BTreeSet::new();
            let valid_sources: BTreeSet<String> = std::iter::once("local".to_string())
                .chain(settings.ssh_sources.iter().map(|s| s.id.clone()))
                .collect();
            sources.retain(|s| valid_sources.contains(s) && unique.insert(s.clone()));
            if !sources.is_empty() {
                settings.selected_sources = Some(sources);
            }
        }
        self.database
            .lock()
            .expect("database lock poisoned")
            .save_settings(&settings)?;
        Ok(settings)
    }

    pub fn snapshot(&self, request: SnapshotRequest) -> Result<UsageSnapshot> {
        let database = self.database.lock().expect("database lock poisoned");
        let settings = database.settings()?;
        database.snapshot(&request, &settings)
    }

    pub fn codex_quota(&self, force: bool) -> Result<CodexQuotaSnapshot> {
        let settings = self.settings()?;
        if !force {
            let cached = self
                .quota_cache
                .lock()
                .expect("quota cache lock poisoned")
                .clone();
            if let Some(cached) = cached
                && cached.is_fresh(
                    settings.codex_quota.refresh_interval_seconds,
                    Instant::now(),
                )
            {
                return Ok(cached.snapshot);
            }
        }
        let snapshot = self.query_codex_quota(settings)?;
        *self.quota_cache.lock().expect("quota cache lock poisoned") = Some(CachedCodexQuota {
            snapshot: snapshot.clone(),
            cached_at: Instant::now(),
        });
        Ok(snapshot)
    }

    pub fn test_codex_quota(&self, mut settings: UsageSettings) -> Result<CodexQuotaSnapshot> {
        normalize_settings(&mut settings)?;
        self.query_codex_quota(settings)
    }

    fn query_codex_quota(&self, settings: UsageSettings) -> Result<CodexQuotaSnapshot> {
        let Some(source_id) = settings.codex_quota.source_id.clone() else {
            return Ok(CodexQuotaSnapshot::unconfigured());
        };
        let (source, label) = if source_id == "local" {
            (None, "本机".to_string())
        } else if let Some(source) = settings
            .ssh_sources
            .iter()
            .find(|source| source.id == source_id)
        {
            (Some(source), source.label.clone())
        } else {
            return Ok(CodexQuotaSnapshot::unconfigured());
        };
        Ok(quota::query(
            &settings.codex_quota,
            source,
            source_id.clone(),
            label.clone(),
        )
        .unwrap_or_else(|error| {
            CodexQuotaSnapshot::unavailable(
                source_id,
                label,
                error.to_string().chars().take(500).collect(),
            )
        }))
    }

    pub fn agy_quota(&self, force: bool) -> Result<AgyQuotaSnapshot> {
        let settings = self.settings()?;
        if !force {
            let cached = self
                .agy_quota_cache
                .lock()
                .expect("agy quota cache lock poisoned")
                .clone();
            if let Some(cached) = cached
                && cached.is_fresh(settings.agy_quota.refresh_interval_seconds, Instant::now())
            {
                return Ok(cached.snapshot);
            }
        }
        let snapshot = self.query_agy_quota(settings)?;
        *self
            .agy_quota_cache
            .lock()
            .expect("agy quota cache lock poisoned") = Some(CachedAgyQuota {
            snapshot: snapshot.clone(),
            cached_at: Instant::now(),
        });
        Ok(snapshot)
    }

    pub fn test_agy_quota(&self, mut settings: UsageSettings) -> Result<AgyQuotaSnapshot> {
        normalize_settings(&mut settings)?;
        self.query_agy_quota(settings)
    }

    fn query_agy_quota(&self, settings: UsageSettings) -> Result<AgyQuotaSnapshot> {
        let Some(source_id) = settings.agy_quota.source_id.clone() else {
            return Ok(AgyQuotaSnapshot::unconfigured());
        };
        let (source, label) = if source_id == "local" {
            (None, "本机".to_string())
        } else if let Some(source) = settings
            .ssh_sources
            .iter()
            .find(|source| source.id == source_id)
        {
            (Some(source), source.label.clone())
        } else {
            return Ok(AgyQuotaSnapshot::unconfigured());
        };
        Ok(agy_quota::query(
            &settings.agy_quota,
            source,
            source_id.clone(),
            label.clone(),
        )
        .unwrap_or_else(|error| {
            AgyQuotaSnapshot::unavailable(
                source_id,
                label,
                error.to_string().chars().take(500).collect(),
            )
        }))
    }

    pub fn status_bar_summary(&self) -> Result<StatusBarSummary> {
        let settings = self.settings()?;
        let today = self
            .database
            .lock()
            .expect("database lock poisoned")
            .today_usage(&settings)?;

        let codex = match self.codex_quota(false) {
            Ok(snapshot) if snapshot.status == "ready" || snapshot.status == "stale" => {
                let windows: Vec<StatusBarWindow> = snapshot
                    .windows
                    .into_iter()
                    .map(|w| {
                        let window_label = match w.window_duration_mins {
                            Some(300) => "5h".to_string(),
                            Some(10080) => "7d".to_string(),
                            Some(m) if m % 1440 == 0 => format!("{}d", m / 1440),
                            Some(m) if m % 60 == 0 => format!("{}h", m / 60),
                            Some(m) => format!("{}m", m),
                            None => "limit".to_string(),
                        };
                        let remaining_percent = 100_u32.saturating_sub(w.used_percent.min(100));
                        StatusBarWindow {
                            window: window_label,
                            window_duration_mins: w.window_duration_mins,
                            used_percent: w.used_percent,
                            remaining_percent,
                            resets_at: w.resets_at,
                        }
                    })
                    .collect();
                let balance = snapshot.credits.as_ref().and_then(|c| {
                    if c.unlimited {
                        Some("无限".to_string())
                    } else {
                        c.balance.clone()
                    }
                });
                let reset_cards = snapshot.reset_credits.as_ref().map(|r| r.available_count);
                if windows.is_empty() && balance.is_none() && reset_cards.is_none() {
                    None
                } else {
                    Some(StatusBarQuota {
                        name: "Codex".to_string(),
                        plan_type: snapshot.plan_type,
                        windows,
                        balance,
                        reset_cards,
                    })
                }
            }
            _ => None,
        };

        let agy = match self.agy_quota(false) {
            Ok(snapshot) if snapshot.status == "ready" || snapshot.status == "stale" => {
                // Must NOT display Claude/GPT: only keep non-Claude, non-GPT buckets (e.g. Gemini Models)
                let buckets: Vec<AgyQuotaBucket> = if !snapshot.groups.is_empty() {
                    snapshot
                        .groups
                        .into_iter()
                        .filter(|g| {
                            let lower = g.name.to_lowercase();
                            !lower.contains("claude")
                                && !lower.contains("gpt")
                                && !lower.contains("3p")
                        })
                        .flat_map(|g| g.buckets)
                        .collect()
                } else {
                    snapshot.windows
                };

                let mut windows: Vec<StatusBarWindow> = buckets
                    .into_iter()
                    .filter(|b| {
                        let lower_id = b.id.to_lowercase();
                        let lower_name = b.name.to_lowercase();
                        !lower_id.contains("claude")
                            && !lower_id.contains("gpt")
                            && !lower_name.contains("claude")
                            && !lower_name.contains("gpt")
                    })
                    .map(|b| {
                        let window_label = match b.window_duration_mins {
                            Some(300) => "5h".to_string(),
                            Some(10080) => "7d".to_string(),
                            Some(m) if m % 1440 == 0 => format!("{}d", m / 1440),
                            Some(m) if m % 60 == 0 => format!("{}h", m / 60),
                            Some(m) => format!("{}m", m),
                            None => {
                                if b.id.contains("5h") || b.window.contains("5h") {
                                    "5h".to_string()
                                } else if b.id.contains("weekly") || b.window.contains("weekly") {
                                    "7d".to_string()
                                } else {
                                    b.window
                                }
                            }
                        };
                        let remaining_percent =
                            (b.remaining_fraction * 100.0).round().clamp(0.0, 100.0) as u32;
                        let used_percent = 100_u32.saturating_sub(remaining_percent);
                        StatusBarWindow {
                            window: window_label,
                            window_duration_mins: b.window_duration_mins,
                            used_percent,
                            remaining_percent,
                            resets_at: b.resets_at,
                        }
                    })
                    .collect();
                windows.sort_by_key(|w| w.window_duration_mins.unwrap_or(i64::MAX));
                windows.dedup_by(|a, b| a.window == b.window && a.resets_at == b.resets_at);
                if windows.is_empty() {
                    None
                } else {
                    Some(StatusBarQuota {
                        name: "AGY".to_string(),
                        plan_type: snapshot.plan_type,
                        windows,
                        balance: None,
                        reset_cards: None,
                    })
                }
            }
            _ => None,
        };

        Ok(StatusBarSummary { today, codex, agy })
    }

    pub fn refresh_status(&self) -> RefreshStatus {
        lock_unpoisoned(&self.refresh).clone()
    }

    pub fn start_refresh(&self, only_source: Option<&str>) -> Result<RefreshStatus> {
        let settings = self.settings()?;
        let mut sources = Vec::new();
        if only_source.is_none() || only_source == Some("local") {
            sources.push(RefreshSource::Local);
        }
        for source in settings.ssh_sources.iter().cloned() {
            if only_source.is_none() || only_source == Some(source.id.as_str()) {
                sources.push(RefreshSource::Ssh(source));
            }
        }
        if sources.is_empty() {
            bail!("usage source was not found");
        }
        self.launch_refresh(settings, sources)
    }

    pub fn test_ssh(&self, mut source: SshSource) -> Result<RefreshStatus> {
        normalize_source(&mut source)?;
        remote::validate_source(&source)?;
        self.launch_refresh(self.settings()?, vec![RefreshSource::Ssh(source)])
    }

    fn launch_refresh(
        &self,
        settings: UsageSettings,
        sources: Vec<RefreshSource>,
    ) -> Result<RefreshStatus> {
        let mut status = lock_unpoisoned(&self.refresh);
        if status.running {
            bail!("a usage refresh is already running");
        }
        let job_id = format!("refresh-{}", chrono::Utc::now().timestamp_millis());
        let initial = RefreshStatus {
            running: true,
            job_id: Some(job_id),
            completed: 0,
            total: sources.len(),
            current_source: None,
            errors: Vec::new(),
        };
        *status = initial.clone();
        drop(status);
        let database = self.database.clone();
        let refresh = self.refresh.clone();
        std::thread::spawn(move || {
            let _reset = RefreshReset(refresh.clone());
            for source in sources {
                let (source_id, label) = match &source {
                    RefreshSource::Local => ("local".to_string(), "本机".to_string()),
                    RefreshSource::Ssh(source) => (source.id.clone(), source.label.clone()),
                };
                lock_unpoisoned(&refresh).current_source = Some(label.clone());
                let known = database
                    .lock()
                    .expect("database lock poisoned")
                    .fingerprints(&source_id)
                    .unwrap_or_default();
                let result = match source {
                    RefreshSource::Local => {
                        scanner::scan_local(&settings.local_agents, &settings.local_roots, &known)
                    }
                    RefreshSource::Ssh(source) => remote::scan_remote(&source, &known),
                };
                match result {
                    Ok(batch) => {
                        if let Err(error) = database
                            .lock()
                            .expect("database lock poisoned")
                            .apply_scan(&source_id, &batch)
                        {
                            record_error(
                                &database,
                                &refresh,
                                &source_id,
                                &label,
                                &error.to_string(),
                            );
                        }
                    }
                    Err(error) => {
                        record_error(&database, &refresh, &source_id, &label, &error.to_string())
                    }
                }
                lock_unpoisoned(&refresh).completed += 1;
            }
        });
        Ok(initial)
    }
}

struct RefreshReset(Arc<Mutex<RefreshStatus>>);

impl Drop for RefreshReset {
    fn drop(&mut self) {
        let mut status = lock_unpoisoned(&self.0);
        status.running = false;
        status.current_source = None;
    }
}

fn lock_unpoisoned<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn record_error(
    database: &Arc<Mutex<Database>>,
    refresh: &Arc<Mutex<RefreshStatus>>,
    source_id: &str,
    label: &str,
    error: &str,
) {
    let safe = error.chars().take(500).collect::<String>();
    let _ = database
        .lock()
        .expect("database lock poisoned")
        .mark_error(source_id, &safe);
    lock_unpoisoned(refresh)
        .errors
        .push(format!("{label}: {safe}"));
}

fn normalize_settings(settings: &mut UsageSettings) -> Result<()> {
    let mut local = BTreeSet::new();
    settings.local_agents.retain(|agent| local.insert(*agent));
    if settings.local_agents.is_empty() {
        bail!("select at least one local agent");
    }
    if settings.ssh_sources.len() > 20 {
        bail!("at most 20 SSH sources are supported");
    }
    settings.local_roots.retain(|_, value| {
        *value = value.trim().to_string();
        !value.is_empty()
    });
    let mut ids = BTreeSet::from(["local".to_string()]);
    for source in &mut settings.ssh_sources {
        normalize_source(source)?;
        remote::validate_source(source)?;
        if !ids.insert(source.id.clone()) {
            bail!("SSH source ids must be unique");
        }
    }
    for roots in std::iter::once(&settings.local_roots)
        .chain(settings.ssh_sources.iter().map(|source| &source.roots))
    {
        for value in roots.values() {
            if value.len() > 4096 || value.contains('\0') {
                bail!("agent data root is invalid");
            }
        }
    }
    settings.codex_quota.pre_command = settings.codex_quota.pre_command.trim().to_string();
    if settings.codex_quota.pre_command.len() > 8192
        || settings.codex_quota.pre_command.contains('\0')
    {
        bail!("Codex quota pre-command is invalid");
    }
    if settings
        .codex_quota
        .refresh_interval_seconds
        .is_some_and(|seconds| !(30..=3600).contains(&seconds))
    {
        bail!("Codex quota refresh interval must be between 30 and 3600 seconds");
    }
    if settings
        .codex_quota
        .source_id
        .as_ref()
        .is_some_and(|source_id| !ids.contains(source_id))
    {
        settings.codex_quota.source_id = None;
    }
    settings.agy_quota.pre_command = settings.agy_quota.pre_command.trim().to_string();
    if settings.agy_quota.pre_command.len() > 8192 || settings.agy_quota.pre_command.contains('\0')
    {
        bail!("Antigravity quota pre-command is invalid");
    }
    if settings
        .agy_quota
        .refresh_interval_seconds
        .is_some_and(|seconds| !(30..=3600).contains(&seconds))
    {
        bail!("Antigravity quota refresh interval must be between 30 and 3600 seconds");
    }
    if settings
        .agy_quota
        .source_id
        .as_ref()
        .is_some_and(|source_id| !ids.contains(source_id))
    {
        settings.agy_quota.source_id = None;
    }
    if let Some(ref mut agents) = settings.selected_agents {
        let mut unique = BTreeSet::new();
        agents.retain(|a| unique.insert(*a));
        if agents.is_empty() {
            settings.selected_agents = None;
        }
    }
    if let Some(ref mut sources) = settings.selected_sources {
        let mut unique = BTreeSet::new();
        sources.retain(|s| ids.contains(s) && unique.insert(s.clone()));
        if sources.is_empty() {
            settings.selected_sources = None;
        }
    }
    Ok(())
}

fn normalize_source(source: &mut SshSource) -> Result<()> {
    source.id = source.id.trim().to_string();
    source.label = source.label.trim().to_string();
    source.host = source.host.trim().to_string();
    let mut agents = BTreeSet::new();
    source.enabled_agents.retain(|agent| agents.insert(*agent));
    source.roots.retain(|_, value| {
        *value = value.trim().to_string();
        !value.is_empty()
    });
    for value in source.roots.values() {
        if value.len() > 4096 || value.contains('\0') {
            bail!("agent data root is invalid");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_duplicate_or_unsafe_sources() {
        let mut settings = UsageSettings::default();
        settings.ssh_sources.push(SshSource {
            id: "local".into(),
            label: "Remote".into(),
            host: "-unsafe".into(),
            enabled_agents: AgentKind::ALL.to_vec(),
            roots: Default::default(),
        });
        assert!(normalize_settings(&mut settings).is_err());
    }

    #[test]
    fn normalizes_quota_source_and_interval_without_reenabling_disabled_refresh() {
        let mut settings: UsageSettings = serde_json::from_value(serde_json::json!({
            "localAgents": ["codex"],
            "localRoots": {},
            "sshSources": [],
            "codexQuota": {
                "sourceId": "missing",
                "shellPreset": "bash",
                "preCommand": "  source ~/proxy  ",
                "refreshIntervalSeconds": null
            }
        }))
        .unwrap();
        normalize_settings(&mut settings).unwrap();
        assert_eq!(settings.codex_quota.source_id, None);
        assert_eq!(settings.codex_quota.refresh_interval_seconds, None);
        assert_eq!(settings.codex_quota.pre_command, "source ~/proxy");

        settings.codex_quota.refresh_interval_seconds = Some(10);
        assert!(normalize_settings(&mut settings).is_err());
    }

    #[test]
    fn old_settings_receive_quota_defaults() {
        let settings: UsageSettings = serde_json::from_value(serde_json::json!({
            "localAgents": ["codex"],
            "localRoots": {},
            "sshSources": []
        }))
        .unwrap();
        assert_eq!(settings.codex_quota.source_id.as_deref(), Some("local"));
        assert_eq!(settings.codex_quota.refresh_interval_seconds, Some(60));
        assert_eq!(settings.agy_quota.source_id.as_deref(), Some("local"));
        assert_eq!(settings.agy_quota.refresh_interval_seconds, Some(60));
    }

    #[test]
    fn quota_cache_uses_the_refresh_interval_and_supports_disabled_refresh() {
        let cached_at = Instant::now();
        let cached = CachedCodexQuota {
            snapshot: CodexQuotaSnapshot::unconfigured(),
            cached_at,
        };
        assert!(cached.is_fresh(Some(60), cached_at + Duration::from_secs(59)));
        assert!(!cached.is_fresh(Some(60), cached_at + Duration::from_secs(60)));
        assert!(cached.is_fresh(None, cached_at + Duration::from_secs(86_400)));
    }

    #[test]
    fn saving_settings_invalidates_the_quota_cache() {
        let path = std::env::temp_dir().join(format!(
            "digiworld-agent-token-quota-cache-{}-{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let engine = UsageEngine::open(&path).unwrap();
        *engine
            .quota_cache
            .lock()
            .expect("quota cache lock poisoned") = Some(CachedCodexQuota {
            snapshot: CodexQuotaSnapshot::unconfigured(),
            cached_at: Instant::now(),
        });

        engine.save_settings(UsageSettings::default()).unwrap();
        assert!(
            engine
                .quota_cache
                .lock()
                .expect("quota cache lock poisoned")
                .is_none()
        );
        drop(engine);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn save_filters_persists_selection_without_invalidating_quota_cache() {
        let path = std::env::temp_dir().join(format!(
            "digiworld-agent-token-filter-cache-{}-{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let engine = UsageEngine::open(&path).unwrap();
        *engine
            .quota_cache
            .lock()
            .expect("quota cache lock poisoned") = Some(CachedCodexQuota {
            snapshot: CodexQuotaSnapshot::unconfigured(),
            cached_at: Instant::now(),
        });

        let updated = engine
            .save_filters(
                Some(vec![AgentKind::Codex, AgentKind::Claude]),
                Some(vec!["local".to_string()]),
            )
            .unwrap();

        assert_eq!(
            updated.selected_agents,
            Some(vec![AgentKind::Codex, AgentKind::Claude])
        );
        assert_eq!(updated.selected_sources, Some(vec!["local".to_string()]));

        // Quota cache should NOT be invalidated by filter changes
        assert!(
            engine
                .quota_cache
                .lock()
                .expect("quota cache lock poisoned")
                .is_some()
        );

        let reloaded = engine.settings().unwrap();
        assert_eq!(
            reloaded.selected_agents,
            Some(vec![AgentKind::Codex, AgentKind::Claude])
        );
        assert_eq!(reloaded.selected_sources, Some(vec!["local".to_string()]));

        drop(engine);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn status_bar_summary_extracts_today_codex_and_agy_gemini_only() {
        use crate::model::{CodexQuotaCredits, CodexQuotaWindow, CodexResetCreditsSummary};
        let path = std::env::temp_dir().join(format!(
            "digiworld-status-bar-test-{}-{}.db",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let engine = UsageEngine::open(&path).unwrap();

        // Populate Codex quota cache
        *engine.quota_cache.lock().unwrap() = Some(CachedCodexQuota {
            snapshot: CodexQuotaSnapshot {
                status: "ready".into(),
                source_id: Some("local".into()),
                source_label: Some("本机".into()),
                fetched_at: Some("2026-09-14T08:00:00Z".into()),
                plan_type: Some("plus".into()),
                windows: vec![
                    CodexQuotaWindow {
                        used_percent: 20,
                        window_duration_mins: Some(300),
                        resets_at: Some(1788500000),
                    },
                    CodexQuotaWindow {
                        used_percent: 55,
                        window_duration_mins: Some(10080),
                        resets_at: Some(1788900000),
                    },
                ],
                credits: Some(CodexQuotaCredits {
                    balance: Some("$12.5".into()),
                    has_credits: true,
                    unlimited: false,
                }),
                reset_credits: Some(CodexResetCreditsSummary {
                    available_count: 2,
                    credits: None,
                }),
                error: None,
            },
            cached_at: Instant::now(),
        });

        // Populate AGY quota cache with Gemini Models and Claude/GPT models
        *engine.agy_quota_cache.lock().unwrap() = Some(CachedAgyQuota {
            snapshot: AgyQuotaSnapshot {
                status: "ready".into(),
                source_id: Some("local".into()),
                source_label: Some("本机".into()),
                fetched_at: Some("2026-09-14T08:00:00Z".into()),
                plan_type: Some("AI Pro".into()),
                description: None,
                groups: vec![
                    crate::model::AgyQuotaGroup {
                        name: "Gemini Models".into(),
                        description: None,
                        buckets: vec![
                            AgyQuotaBucket {
                                id: "gemini-5h".into(),
                                name: "Five Hour Limit Remaining".into(),
                                description: None,
                                window: "5h".into(),
                                window_duration_mins: Some(300),
                                used_percent: 14,
                                remaining_percent: 86,
                                remaining_fraction: 0.86,
                                reset_time: Some("2026-09-14T15:52:25Z".into()),
                                resets_at: Some(1788501000),
                            },
                            AgyQuotaBucket {
                                id: "gemini-weekly".into(),
                                name: "Weekly Limit Remaining".into(),
                                description: None,
                                window: "weekly".into(),
                                window_duration_mins: Some(10080),
                                used_percent: 62,
                                remaining_percent: 38,
                                remaining_fraction: 0.38,
                                reset_time: Some("2026-09-18T04:56:07Z".into()),
                                resets_at: Some(1788902000),
                            },
                        ],
                    },
                    crate::model::AgyQuotaGroup {
                        name: "Claude and GPT models".into(),
                        description: None,
                        buckets: vec![AgyQuotaBucket {
                            id: "claude-5h".into(),
                            name: "Five Hour Limit Remaining".into(),
                            description: None,
                            window: "5h".into(),
                            window_duration_mins: Some(300),
                            used_percent: 0,
                            remaining_percent: 100,
                            remaining_fraction: 1.0,
                            reset_time: None,
                            resets_at: None,
                        }],
                    },
                ],
                windows: vec![],
                error: None,
            },
            cached_at: Instant::now(),
        });

        let summary = engine.status_bar_summary().unwrap();

        // Codex verification
        let codex = summary.codex.unwrap();
        assert_eq!(codex.name, "Codex");
        assert_eq!(codex.balance.as_deref(), Some("$12.5"));
        assert_eq!(codex.reset_cards, Some(2));
        assert_eq!(codex.windows.len(), 2);
        assert_eq!(codex.windows[0].window, "5h");
        assert_eq!(codex.windows[0].remaining_percent, 80);
        assert_eq!(codex.windows[1].window, "7d");
        assert_eq!(codex.windows[1].remaining_percent, 45);

        // AGY verification: must NOT include Claude or GPT
        let agy = summary.agy.unwrap();
        assert_eq!(agy.name, "AGY");
        assert_eq!(agy.windows.len(), 2);
        assert_eq!(agy.windows[0].window, "5h");
        assert_eq!(agy.windows[0].remaining_percent, 86);
        assert_eq!(agy.windows[1].window, "7d");
        assert_eq!(agy.windows[1].remaining_percent, 38);
        assert_eq!(agy.balance, None);
        assert_eq!(agy.reset_cards, None);

        drop(engine);
        let _ = std::fs::remove_file(path);
    }
}
