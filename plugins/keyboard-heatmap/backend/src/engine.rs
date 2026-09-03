use crate::database::{Backup, Database, Snapshot};
use anyhow::{Context, Result};
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

pub struct StatsEngine {
    database: Mutex<Database>,
    pending: Mutex<BTreeMap<String, u64>>,
    paused: AtomicBool,
    stopping: AtomicBool,
}

impl StatsEngine {
    pub fn open(path: &Path) -> Result<Arc<Self>> {
        let database = Database::open(path)?;
        let paused = database.paused()?;
        let engine = Arc::new(Self {
            database: Mutex::new(database),
            pending: Mutex::new(BTreeMap::new()),
            paused: AtomicBool::new(paused),
            stopping: AtomicBool::new(false),
        });
        let weak = Arc::downgrade(&engine);
        std::thread::Builder::new()
            .name("heatmap-flusher".into())
            .spawn(move || {
                while let Some(engine) = weak.upgrade() {
                    if engine.stopping.load(Ordering::Relaxed) {
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_secs(5));
                    if let Err(error) = engine.flush() {
                        tracing::error!(%error, "failed to flush key counts");
                    }
                }
            })?;
        Ok(engine)
    }

    #[cfg_attr(not(windows), allow(dead_code))]
    pub fn note_key(&self, key: &str) {
        if self.paused.load(Ordering::Relaxed) {
            return;
        }
        let mut pending = self.pending.lock().expect("pending count lock poisoned");
        *pending.entry(key.to_string()).or_default() += 1;
        if pending.values().sum::<u64>() >= 100 {
            drop(pending);
            if let Err(error) = self.flush() {
                tracing::error!(%error, "failed to flush key counts");
            }
        }
    }

    pub fn flush(&self) -> Result<()> {
        let counts = {
            let mut pending = self.pending.lock().expect("pending count lock poisoned");
            std::mem::take(&mut *pending)
        };
        if counts.is_empty() {
            return Ok(());
        }
        if let Err(error) = self
            .database
            .lock()
            .expect("database lock poisoned")
            .add_counts(&counts)
        {
            let mut pending = self.pending.lock().expect("pending count lock poisoned");
            for (key, count) in counts {
                *pending.entry(key).or_default() += count;
            }
            return Err(error);
        }
        Ok(())
    }

    pub fn snapshot(&self, scope: &str) -> Result<Snapshot> {
        self.flush()?;
        self.database
            .lock()
            .expect("database lock poisoned")
            .snapshot(scope)
    }

    pub fn set_paused(&self, paused: bool) -> Result<()> {
        if paused {
            self.flush()?;
        }
        self.database
            .lock()
            .expect("database lock poisoned")
            .set_paused(paused)?;
        self.paused.store(paused, Ordering::Relaxed);
        Ok(())
    }

    pub fn privacy_accepted(&self) -> Result<bool> {
        self.database
            .lock()
            .expect("database lock poisoned")
            .setting_bool("privacy_accepted")
    }

    pub fn accept_privacy(&self) -> Result<()> {
        self.database
            .lock()
            .expect("database lock poisoned")
            .set_setting_bool("privacy_accepted", true)
    }

    pub fn layout(&self) -> Result<String> {
        let value = self
            .database
            .lock()
            .expect("database lock poisoned")
            .setting("keyboard_layout")?
            .unwrap_or_else(|| "full".into());
        Ok(if valid_layout(&value) {
            value
        } else {
            "full".into()
        })
    }

    pub fn set_layout(&self, layout: &str) -> Result<()> {
        if !valid_layout(layout) {
            anyhow::bail!("unsupported keyboard layout: {layout}");
        }
        self.database
            .lock()
            .expect("database lock poisoned")
            .set_setting("keyboard_layout", layout)
    }

    pub fn clear(&self, scope: &str) -> Result<()> {
        self.flush()?;
        self.database
            .lock()
            .expect("database lock poisoned")
            .clear(scope)
    }

    pub fn json_backup(&self) -> Result<String> {
        self.flush()?;
        serde_json::to_string_pretty(
            &self
                .database
                .lock()
                .expect("database lock poisoned")
                .backup()?,
        )
        .context("serialize backup")
    }

    pub fn csv(&self) -> Result<String> {
        self.flush()?;
        self.database.lock().expect("database lock poisoned").csv()
    }

    pub fn import(&self, content: &str, mode: &str) -> Result<()> {
        self.flush()?;
        let backup: Backup = serde_json::from_str(content).context("parse backup")?;
        self.database
            .lock()
            .expect("database lock poisoned")
            .import(backup, mode)
    }

    pub fn shutdown(&self) -> Result<()> {
        self.stopping.store(true, Ordering::Relaxed);
        self.flush()
    }
}

fn valid_layout(layout: &str) -> bool {
    matches!(layout, "full" | "tkl" | "75" | "65" | "60")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn persists_supported_keyboard_layouts() {
        let engine = StatsEngine::open(Path::new(":memory:")).unwrap();
        assert_eq!(engine.layout().unwrap(), "full");
        engine.set_layout("65").unwrap();
        assert_eq!(engine.layout().unwrap(), "65");
        assert!(engine.set_layout("ergonomic").is_err());
    }
}
