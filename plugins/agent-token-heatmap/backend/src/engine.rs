use crate::database::Database;
#[cfg(test)]
use crate::model::AgentKind;
use crate::model::{RefreshStatus, SnapshotRequest, SshSource, UsageSettings, UsageSnapshot};
use crate::{remote, scanner};
use anyhow::{Result, bail};
use std::collections::BTreeSet;
use std::path::Path;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct UsageEngine {
    database: Arc<Mutex<Database>>,
    refresh: Arc<Mutex<RefreshStatus>>,
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
        Ok(settings)
    }

    pub fn snapshot(&self, request: SnapshotRequest) -> Result<UsageSnapshot> {
        let database = self.database.lock().expect("database lock poisoned");
        let settings = database.settings()?;
        database.snapshot(&request, &settings)
    }

    pub fn refresh_status(&self) -> RefreshStatus {
        self.refresh.lock().expect("refresh lock poisoned").clone()
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
        if self.refresh.lock().expect("refresh lock poisoned").running {
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
        *self.refresh.lock().expect("refresh lock poisoned") = initial.clone();
        let database = self.database.clone();
        let refresh = self.refresh.clone();
        std::thread::spawn(move || {
            for source in sources {
                let (source_id, label) = match &source {
                    RefreshSource::Local => ("local".to_string(), "本机".to_string()),
                    RefreshSource::Ssh(source) => (source.id.clone(), source.label.clone()),
                };
                refresh
                    .lock()
                    .expect("refresh lock poisoned")
                    .current_source = Some(label.clone());
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
                refresh.lock().expect("refresh lock poisoned").completed += 1;
            }
            let mut status = refresh.lock().expect("refresh lock poisoned");
            status.running = false;
            status.current_source = None;
        });
        Ok(initial)
    }
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
    refresh
        .lock()
        .expect("refresh lock poisoned")
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
}
