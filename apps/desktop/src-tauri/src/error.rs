use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum DigiworldError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("network error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("invalid JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("invalid archive: {0}")]
    Archive(#[from] zip::result::ZipError),
    #[error("invalid semantic version: {0}")]
    Version(#[from] semver::Error),
    #[error("signature verification failed: {0}")]
    Signature(String),
    #[error("catalog error: {0}")]
    Catalog(String),
    #[error("plugin error: {0}")]
    Plugin(String),
    #[error("permission denied: {0}")]
    Permission(String),
    #[error("update error: {0}")]
    Update(String),
}

impl Serialize for DigiworldError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, DigiworldError>;
