use crate::error::{DigiworldError, Result};
use crate::model::{CatalogIndex, MANIFEST_SCHEMA_VERSION, ProxySettings};
use crate::network;
use base64::Engine;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

const CATALOG_URL: &str = "https://jesmonx.github.io/digiworld/catalog/v1/index.json";
const MAX_CATALOG_BYTES: usize = 2 * 1024 * 1024;
const MAX_PLUGIN_BYTES: usize = 128 * 1024 * 1024;

pub struct CatalogClient {
    cache_path: PathBuf,
}

impl CatalogClient {
    pub fn new(cache_path: PathBuf) -> Result<Self> {
        Ok(Self { cache_path })
    }

    pub async fn load(
        &self,
        refresh: bool,
        accepted_sequence: u64,
        proxy: &ProxySettings,
    ) -> Result<CatalogIndex> {
        if cfg!(debug_assertions)
            && let Ok(path) = std::env::var("DIGIWORLD_DEV_CATALOG")
        {
            let bytes = tokio::fs::read(path).await?;
            return Self::parse(&bytes, accepted_sequence, true);
        }

        if !refresh && self.cache_path.exists() {
            let bytes = tokio::fs::read(&self.cache_path).await?;
            if let Ok(catalog) = Self::parse(&bytes, accepted_sequence, false) {
                return Ok(catalog);
            }
        }

        let http = self.http(proxy)?;
        let response = http.get(CATALOG_URL).send().await?.error_for_status()?;
        let bytes = response.bytes().await?;
        if bytes.len() > MAX_CATALOG_BYTES {
            return Err(DigiworldError::Catalog(
                "catalog exceeds the 2 MiB limit".into(),
            ));
        }
        let signature = http
            .get(format!("{CATALOG_URL}.sig"))
            .send()
            .await?
            .error_for_status()?
            .text()
            .await?;
        verify_release_signature(&bytes, signature.trim())?;
        let catalog = Self::parse(&bytes, accepted_sequence, false)?;
        atomic_write(&self.cache_path, &bytes).await?;
        Ok(catalog)
    }

    fn parse(bytes: &[u8], accepted_sequence: u64, development: bool) -> Result<CatalogIndex> {
        if bytes.len() > MAX_CATALOG_BYTES {
            return Err(DigiworldError::Catalog(
                "catalog exceeds the 2 MiB limit".into(),
            ));
        }
        let catalog: CatalogIndex = serde_json::from_slice(bytes)?;
        if catalog.schema_version != MANIFEST_SCHEMA_VERSION {
            return Err(DigiworldError::Catalog(format!(
                "unsupported catalog schema {}",
                catalog.schema_version
            )));
        }
        if !development && catalog.sequence < accepted_sequence {
            return Err(DigiworldError::Catalog(format!(
                "catalog rollback rejected: {} < {}",
                catalog.sequence, accepted_sequence
            )));
        }
        Ok(catalog)
    }

    pub async fn download_plugin(
        &self,
        url: &str,
        expected_size: u64,
        proxy: &ProxySettings,
    ) -> Result<Vec<u8>> {
        if expected_size as usize > MAX_PLUGIN_BYTES {
            return Err(DigiworldError::Catalog(
                "plugin exceeds the 128 MiB limit".into(),
            ));
        }
        if cfg!(debug_assertions)
            && let Some(path) = url.strip_prefix("file://")
        {
            let bytes = tokio::fs::read(path).await?;
            if bytes.len() > MAX_PLUGIN_BYTES {
                return Err(DigiworldError::Catalog(
                    "plugin exceeds the 128 MiB limit".into(),
                ));
            }
            return Ok(bytes);
        }
        if !url.starts_with("https://") {
            return Err(DigiworldError::Catalog(
                "release downloads require HTTPS".into(),
            ));
        }
        let response = self
            .http(proxy)?
            .get(url)
            .send()
            .await?
            .error_for_status()?;
        if let Some(length) = response.content_length()
            && length as usize > MAX_PLUGIN_BYTES
        {
            return Err(DigiworldError::Catalog(
                "plugin exceeds the 128 MiB limit".into(),
            ));
        }
        let bytes = response.bytes().await?;
        if bytes.len() > MAX_PLUGIN_BYTES {
            return Err(DigiworldError::Catalog(
                "plugin exceeds the 128 MiB limit".into(),
            ));
        }
        Ok(bytes.to_vec())
    }

    pub async fn test_proxy(&self, proxy: &ProxySettings) -> Result<()> {
        let http = self.http(proxy)?;
        let response = http.get(CATALOG_URL).send().await?.error_for_status()?;
        let bytes = response.bytes().await?;
        if bytes.len() > MAX_CATALOG_BYTES {
            return Err(DigiworldError::Catalog(
                "catalog exceeds the 2 MiB limit".into(),
            ));
        }
        let signature = http
            .get(format!("{CATALOG_URL}.sig"))
            .send()
            .await?
            .error_for_status()?
            .text()
            .await?;
        if option_env!("DIGIWORLD_PLUGIN_PUBLIC_KEY_B64")
            .unwrap_or("")
            .is_empty()
        {
            Self::parse(&bytes, 0, true)?;
            if signature.trim().is_empty() {
                return Err(DigiworldError::Signature(
                    "catalog signature response is empty".into(),
                ));
            }
            Ok(())
        } else {
            verify_release_signature(&bytes, signature.trim())
        }
    }

    fn http(&self, proxy: &ProxySettings) -> Result<reqwest::Client> {
        network::http_client(proxy, &format!("Digiworld/{}", env!("CARGO_PKG_VERSION")))
    }
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

pub fn verify_package(bytes: &[u8], sha256: &str, signature: &str) -> Result<()> {
    let actual = sha256_hex(bytes);
    if !constant_time_eq(actual.as_bytes(), sha256.to_ascii_lowercase().as_bytes()) {
        return Err(DigiworldError::Signature(format!(
            "SHA-256 mismatch: expected {sha256}, got {actual}"
        )));
    }
    if cfg!(debug_assertions) && signature == "development-unsigned" {
        return Ok(());
    }
    verify_release_signature(bytes, signature)
}

fn verify_release_signature(bytes: &[u8], signature: &str) -> Result<()> {
    let public_key = option_env!("DIGIWORLD_PLUGIN_PUBLIC_KEY_B64").unwrap_or("");
    if public_key.is_empty() {
        return Err(DigiworldError::Signature(
            "release public key is not embedded; set DIGIWORLD_PLUGIN_PUBLIC_KEY_B64 at build time"
                .into(),
        ));
    }
    let key_bytes = base64::engine::general_purpose::STANDARD
        .decode(public_key)
        .map_err(|error| DigiworldError::Signature(error.to_string()))?;
    let key_array: [u8; 32] = key_bytes
        .try_into()
        .map_err(|_| DigiworldError::Signature("Ed25519 public key must be 32 bytes".into()))?;
    let verifying_key = VerifyingKey::from_bytes(&key_array)
        .map_err(|error| DigiworldError::Signature(error.to_string()))?;
    let signature_bytes = base64::engine::general_purpose::STANDARD
        .decode(signature)
        .map_err(|error| DigiworldError::Signature(error.to_string()))?;
    let parsed = Signature::from_slice(&signature_bytes)
        .map_err(|error| DigiworldError::Signature(error.to_string()))?;
    verifying_key
        .verify(bytes, &parsed)
        .map_err(|error| DigiworldError::Signature(error.to_string()))
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |acc, (a, b)| acc | (a ^ b))
        == 0
}

pub async fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let temporary = path.with_extension(format!("tmp-{}", uuid::Uuid::new_v4()));
    tokio::fs::write(&temporary, bytes).await?;
    tokio::fs::rename(&temporary, path).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_are_stable() {
        assert_eq!(
            sha256_hex(b"digiworld"),
            "4704f39ef7fdce2ca8fdfb1257681ae17c800135be0a876d556dcd1a199e5a22"
        );
    }

    #[test]
    fn constant_time_comparison_checks_length_and_bytes() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"ab"));
    }
}
