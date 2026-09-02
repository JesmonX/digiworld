use crate::catalog::{CatalogClient, sha256_hex, verify_package};
use crate::error::{DigiworldError, Result};
use crate::model::{
    CORE_VERSION, CatalogIndex, InstallResult, MANIFEST_SCHEMA_VERSION, PROTOCOL_VERSION,
    PluginManifest, PluginSummary, target_key,
};
use crate::process::PluginProcess;
use crate::store::Store;
use semver::Version;
use serde_json::Value;
use std::collections::HashMap;
use std::io::Cursor;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Mutex;

const MAX_EXTRACTED_BYTES: u64 = 256 * 1024 * 1024;
const MAX_UI_BYTES: u64 = 8 * 1024 * 1024;

pub struct PluginManager {
    root: PathBuf,
    plugins_dir: PathBuf,
    data_dir: PathBuf,
    store: Store,
    catalog: CatalogClient,
    processes: Mutex<HashMap<String, Arc<Mutex<PluginProcess>>>>,
    catalog_cache: Mutex<Option<CatalogIndex>>,
}

impl PluginManager {
    pub async fn new(root: PathBuf) -> Result<Arc<Self>> {
        let plugins_dir = root.join("plugins");
        let data_dir = root.join("plugin-data");
        tokio::fs::create_dir_all(&plugins_dir).await?;
        tokio::fs::create_dir_all(&data_dir).await?;
        let store = Store::open(&root.join("digiworld.db"))?;
        let catalog = CatalogClient::new(root.join("cache/catalog-v1.json"))?;
        Ok(Arc::new(Self {
            root,
            plugins_dir,
            data_dir,
            store,
            catalog,
            processes: Mutex::new(HashMap::new()),
            catalog_cache: Mutex::new(None),
        }))
    }

    pub fn store(&self) -> &Store {
        &self.store
    }

    pub async fn load_catalog(&self, refresh: bool) -> Result<CatalogIndex> {
        if !refresh {
            if let Some(catalog) = self.catalog_cache.lock().await.clone() {
                return Ok(catalog);
            }
        }
        let accepted = self.store.metadata_u64("catalog_sequence")?;
        let catalog = self.catalog.load(refresh, accepted).await?;
        if catalog.sequence > accepted {
            self.store
                .set_metadata("catalog_sequence", &catalog.sequence.to_string())?;
        }
        *self.catalog_cache.lock().await = Some(catalog.clone());
        Ok(catalog)
    }

    pub async fn start_enabled(&self) {
        let manifests = match self.store.manifests(true) {
            Ok(value) => value,
            Err(error) => {
                tracing::error!(%error, "failed to load enabled plugins");
                return;
            }
        };
        for manifest in manifests {
            if let Err(error) = self.start(&manifest).await {
                let _ = self
                    .store
                    .set_state(&manifest.id, "failed", Some(&error.to_string()));
            }
        }
    }

    pub async fn install(&self, plugin_id: &str) -> Result<InstallResult> {
        validate_plugin_id(plugin_id)?;
        let catalog = self.load_catalog(true).await?;
        let entry = catalog
            .plugins
            .iter()
            .find(|plugin| plugin.id == plugin_id)
            .ok_or_else(|| DigiworldError::Catalog(format!("plugin not found: {plugin_id}")))?;
        ensure_core_compatible(&entry.min_core_version)?;
        let target = target_key();
        let artifact = entry
            .artifacts
            .iter()
            .find(|artifact| artifact.target == target)
            .ok_or_else(|| {
                DigiworldError::Catalog(format!("plugin has no artifact for {target}"))
            })?;
        let bytes = self
            .catalog
            .download_plugin(&artifact.url, artifact.size)
            .await?;
        verify_package(&bytes, &artifact.sha256, &artifact.signature)?;

        let staging = self
            .plugins_dir
            .join(format!(".staging-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&staging).await?;
        let extraction = extract_package(bytes, staging.clone()).await;
        if let Err(error) = extraction {
            let _ = tokio::fs::remove_dir_all(&staging).await;
            return Err(error);
        }
        let manifest =
            load_and_validate_manifest(&staging, plugin_id, &entry.version, &target).await?;
        let old_manifest = self.store.manifest(plugin_id)?;
        self.stop(plugin_id).await;
        let destination = self.plugins_dir.join(plugin_id);
        let rollback = self.plugins_dir.join(format!(".rollback-{plugin_id}"));
        if rollback.exists() {
            tokio::fs::remove_dir_all(&rollback).await?;
        }
        if destination.exists() {
            tokio::fs::rename(&destination, &rollback).await?;
        }
        tokio::fs::rename(&staging, &destination).await?;

        let permissions_changed = self.store.install(&manifest, true)?;
        if let Err(error) = self.start(&manifest).await {
            let _ = tokio::fs::remove_dir_all(&destination).await;
            if rollback.exists() {
                let _ = tokio::fs::rename(&rollback, &destination).await;
            }
            if let Some(old) = old_manifest {
                let _ = self.store.install(&old, true);
                let _ = self.start(&old).await;
            } else {
                let _ = self.store.remove(plugin_id);
            }
            return Err(error);
        }
        if rollback.exists() {
            tokio::fs::remove_dir_all(&rollback).await?;
        }
        let summary = self.summary(plugin_id)?;
        Ok(InstallResult {
            plugin: summary,
            permissions_changed,
        })
    }

    pub async fn set_enabled(&self, plugin_id: &str, enabled: bool) -> Result<PluginSummary> {
        validate_plugin_id(plugin_id)?;
        let manifest = self.store.manifest(plugin_id)?.ok_or_else(|| {
            DigiworldError::Plugin(format!("plugin is not installed: {plugin_id}"))
        })?;
        if enabled {
            self.store.set_enabled(plugin_id, true)?;
            if let Err(error) = self.start(&manifest).await {
                self.store
                    .set_state(plugin_id, "failed", Some(&error.to_string()))?;
                return Err(error);
            }
        } else {
            self.stop(plugin_id).await;
            self.store.set_enabled(plugin_id, false)?;
        }
        self.summary(plugin_id)
    }

    pub async fn uninstall(&self, plugin_id: &str, delete_data: bool) -> Result<()> {
        validate_plugin_id(plugin_id)?;
        self.stop(plugin_id).await;
        let package = self.plugins_dir.join(plugin_id);
        if package.exists() {
            tokio::fs::remove_dir_all(package).await?;
        }
        if delete_data {
            let data = self.data_dir.join(plugin_id);
            if data.exists() {
                tokio::fs::remove_dir_all(data).await?;
            }
        }
        self.store.remove(plugin_id)
    }

    pub async fn plugin_ui(&self, plugin_id: &str) -> Result<String> {
        validate_plugin_id(plugin_id)?;
        let manifest = self
            .store
            .manifest(plugin_id)?
            .ok_or_else(|| DigiworldError::Plugin("plugin is not installed".into()))?;
        let path = safe_join(&self.plugins_dir.join(plugin_id), &manifest.ui)?;
        let metadata = tokio::fs::metadata(&path).await?;
        if metadata.len() > MAX_UI_BYTES {
            return Err(DigiworldError::Plugin("plugin UI exceeds 8 MiB".into()));
        }
        Ok(tokio::fs::read_to_string(path).await?)
    }

    pub async fn request(&self, plugin_id: &str, method: &str, payload: Value) -> Result<Value> {
        validate_plugin_id(plugin_id)?;
        validate_method(method)?;
        let process = self
            .processes
            .lock()
            .await
            .get(plugin_id)
            .cloned()
            .ok_or_else(|| DigiworldError::Plugin(format!("plugin is not running: {plugin_id}")))?;
        process.lock().await.request(method, payload).await
    }

    pub async fn stop_all(&self) {
        let ids: Vec<_> = self.processes.lock().await.keys().cloned().collect();
        for id in ids {
            self.stop(&id).await;
        }
    }

    pub fn summaries(&self) -> Result<Vec<PluginSummary>> {
        self.store.summaries()
    }

    pub fn summary(&self, id: &str) -> Result<PluginSummary> {
        self.store
            .summaries()?
            .into_iter()
            .find(|plugin| plugin.id == id)
            .ok_or_else(|| DigiworldError::Plugin(format!("plugin not found: {id}")))
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    async fn start(&self, manifest: &PluginManifest) -> Result<()> {
        if self.processes.lock().await.contains_key(&manifest.id) {
            return Ok(());
        }
        let target = target_key();
        let artifact = manifest
            .platforms
            .get(&target)
            .ok_or_else(|| DigiworldError::Plugin(format!("no backend for {target}")))?;
        let executable = safe_join(&self.plugins_dir.join(&manifest.id), &artifact.backend)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = tokio::fs::metadata(&executable).await?.permissions();
            permissions.set_mode(0o700);
            tokio::fs::set_permissions(&executable, permissions).await?;
        }
        let actual = sha256_hex(&tokio::fs::read(&executable).await?);
        if actual != artifact.sha256.to_ascii_lowercase() {
            return Err(DigiworldError::Signature(
                "installed backend hash mismatch".into(),
            ));
        }
        let mut process =
            PluginProcess::spawn(&executable, &self.data_dir.join(&manifest.id)).await?;
        process.health().await?;
        self.processes
            .lock()
            .await
            .insert(manifest.id.clone(), Arc::new(Mutex::new(process)));
        self.store.set_state(&manifest.id, "running", None)?;
        Ok(())
    }

    async fn stop(&self, plugin_id: &str) {
        if let Some(process) = self.processes.lock().await.remove(plugin_id) {
            process.lock().await.stop().await;
        }
    }
}

async fn extract_package(bytes: Vec<u8>, destination: PathBuf) -> Result<()> {
    tokio::task::spawn_blocking(move || -> Result<()> {
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes))?;
        let mut total = 0_u64;
        for index in 0..archive.len() {
            let mut entry = archive.by_index(index)?;
            if entry.is_symlink() {
                return Err(DigiworldError::Archive(
                    zip::result::ZipError::InvalidArchive("symbolic links are not allowed".into()),
                ));
            }
            total = total.saturating_add(entry.size());
            if total > MAX_EXTRACTED_BYTES {
                return Err(DigiworldError::Plugin(
                    "extracted plugin exceeds 256 MiB".into(),
                ));
            }
            let enclosed = entry.enclosed_name().ok_or_else(|| {
                DigiworldError::Archive(zip::result::ZipError::InvalidArchive(
                    "unsafe archive path".into(),
                ))
            })?;
            let output = destination.join(enclosed);
            if entry.is_dir() {
                std::fs::create_dir_all(&output)?;
                continue;
            }
            if let Some(parent) = output.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut file = std::fs::File::create(output)?;
            std::io::copy(&mut entry, &mut file)?;
        }
        Ok(())
    })
    .await
    .map_err(|error| DigiworldError::Plugin(error.to_string()))?
}

async fn load_and_validate_manifest(
    root: &Path,
    expected_id: &str,
    expected_version: &str,
    target: &str,
) -> Result<PluginManifest> {
    let bytes = tokio::fs::read(root.join("manifest.json")).await?;
    let manifest: PluginManifest = serde_json::from_slice(&bytes)?;
    if manifest.schema_version != MANIFEST_SCHEMA_VERSION
        || manifest.protocol_version != PROTOCOL_VERSION
    {
        return Err(DigiworldError::Plugin(
            "unsupported plugin schema or protocol".into(),
        ));
    }
    if manifest.id != expected_id || manifest.version != expected_version {
        return Err(DigiworldError::Plugin(
            "catalog and manifest identity do not match".into(),
        ));
    }
    validate_plugin_id(&manifest.id)?;
    ensure_core_compatible(&manifest.min_core_version)?;
    let artifact = manifest
        .platforms
        .get(target)
        .ok_or_else(|| DigiworldError::Plugin(format!("manifest has no backend for {target}")))?;
    let ui = safe_join(root, &manifest.ui)?;
    let backend = safe_join(root, &artifact.backend)?;
    if !ui.is_file() || !backend.is_file() {
        return Err(DigiworldError::Plugin(
            "plugin UI or backend is missing".into(),
        ));
    }
    let actual = sha256_hex(&tokio::fs::read(&backend).await?);
    if actual != artifact.sha256.to_ascii_lowercase() {
        return Err(DigiworldError::Signature(
            "manifest backend hash mismatch".into(),
        ));
    }
    Ok(manifest)
}

fn ensure_core_compatible(minimum: &str) -> Result<()> {
    if Version::parse(CORE_VERSION)? < Version::parse(minimum)? {
        return Err(DigiworldError::Plugin(format!(
            "Digiworld {minimum} or newer is required"
        )));
    }
    Ok(())
}

fn validate_plugin_id(id: &str) -> Result<()> {
    if id.len() > 120
        || id.is_empty()
        || !id.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'-')
        })
    {
        return Err(DigiworldError::Plugin(format!("invalid plugin id: {id}")));
    }
    Ok(())
}

fn validate_method(method: &str) -> Result<()> {
    if method.is_empty()
        || method.len() > 100
        || !method
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        return Err(DigiworldError::Plugin("invalid plugin method".into()));
    }
    Ok(())
}

fn safe_join(root: &Path, relative: &str) -> Result<PathBuf> {
    let path = Path::new(relative);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(DigiworldError::Plugin(format!(
            "unsafe plugin path: {relative}"
        )));
    }
    Ok(root.join(path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unsafe_plugin_ids_and_paths() {
        assert!(validate_plugin_id("io.github.jesmonx.digiworld.keyboard-heatmap").is_ok());
        assert!(validate_plugin_id("../escape").is_err());
        assert!(safe_join(Path::new("/tmp/root"), "ui/index.html").is_ok());
        assert!(safe_join(Path::new("/tmp/root"), "../secret").is_err());
        assert!(safe_join(Path::new("/tmp/root"), "/secret").is_err());
    }
}
