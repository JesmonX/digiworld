use crate::error::{DigiworldError, Result};
use crate::model::{ProxyMode, ProxySettings};
use reqwest::{Client, ClientBuilder, Proxy};
use std::time::Duration;
use tauri::{AppHandle, Runtime};
use tauri_plugin_updater::{Updater, UpdaterExt};
use url::Url;

const PROXY_ENVIRONMENT: &[&str] = &[
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
];

pub fn normalized(settings: ProxySettings) -> Result<ProxySettings> {
    match settings.mode {
        ProxyMode::System | ProxyMode::Direct => Ok(ProxySettings {
            mode: settings.mode,
            url: None,
        }),
        ProxyMode::Custom => {
            let raw = settings
                .url
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    DigiworldError::NetworkConfig("custom proxy URL is required".into())
                })?;
            let parsed = Url::parse(raw).map_err(|error| {
                DigiworldError::NetworkConfig(format!("invalid proxy URL: {error}"))
            })?;
            if !matches!(parsed.scheme(), "http" | "https" | "socks5") {
                return Err(DigiworldError::NetworkConfig(
                    "proxy scheme must be http, https, or socks5".into(),
                ));
            }
            if parsed.host_str().is_none() || parsed.port().is_none() {
                return Err(DigiworldError::NetworkConfig(
                    "custom proxy URL must include a host and port".into(),
                ));
            }
            if !parsed.username().is_empty() || parsed.password().is_some() {
                return Err(DigiworldError::NetworkConfig(
                    "authenticated proxy URLs are not supported".into(),
                ));
            }
            if parsed.query().is_some() || parsed.fragment().is_some() {
                return Err(DigiworldError::NetworkConfig(
                    "proxy URL must not contain a query or fragment".into(),
                ));
            }
            if parsed.path() != "/" && !parsed.path().is_empty() {
                return Err(DigiworldError::NetworkConfig(
                    "proxy URL must not contain a path".into(),
                ));
            }
            Ok(ProxySettings {
                mode: ProxyMode::Custom,
                url: Some(parsed.to_string().trim_end_matches('/').to_string()),
            })
        }
    }
}

pub fn http_client(settings: &ProxySettings, user_agent: &str) -> Result<Client> {
    let mut builder = ClientBuilder::new()
        .user_agent(user_agent)
        .https_only(true)
        .timeout(Duration::from_secs(30));
    builder = match settings.mode {
        ProxyMode::System => builder,
        ProxyMode::Direct => builder.no_proxy(),
        ProxyMode::Custom => builder
            .no_proxy()
            .proxy(Proxy::all(settings.url.as_deref().unwrap_or_default())?),
    };
    Ok(builder.build()?)
}

pub fn updater<R: Runtime>(app: &AppHandle<R>, settings: &ProxySettings) -> Result<Updater> {
    let mut builder = app.updater_builder();
    match settings.mode {
        ProxyMode::System => {}
        ProxyMode::Direct => builder = builder.no_proxy(),
        ProxyMode::Custom => {
            let proxy = Url::parse(settings.url.as_deref().unwrap_or_default())
                .map_err(|error| DigiworldError::NetworkConfig(error.to_string()))?;
            builder = builder.proxy(proxy);
        }
    }
    builder
        .build()
        .map_err(|error| DigiworldError::Update(error.to_string()))
}

pub fn configure_plugin_command(command: &mut tokio::process::Command, settings: &ProxySettings) {
    command.env(
        "DIGIWORLD_PROXY_MODE",
        match settings.mode {
            ProxyMode::System => "system",
            ProxyMode::Custom => "custom",
            ProxyMode::Direct => "direct",
        },
    );
    match settings.mode {
        ProxyMode::System => {}
        ProxyMode::Direct => {
            for name in PROXY_ENVIRONMENT {
                command.env_remove(name);
            }
        }
        ProxyMode::Custom => {
            let value = settings.url.as_deref().unwrap_or_default();
            for name in PROXY_ENVIRONMENT {
                command.env(name, value);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_and_normalizes_proxy_settings() {
        let value = normalized(ProxySettings {
            mode: ProxyMode::Custom,
            url: Some(" socks5://127.0.0.1:7890/ ".into()),
        })
        .unwrap();
        assert_eq!(value.url.as_deref(), Some("socks5://127.0.0.1:7890"));
        assert!(
            normalized(ProxySettings {
                mode: ProxyMode::Custom,
                url: Some("http://user:pass@localhost:8080".into()),
            })
            .is_err()
        );
        assert!(
            normalized(ProxySettings {
                mode: ProxyMode::Custom,
                url: Some("http://localhost".into()),
            })
            .is_err()
        );
    }

    #[test]
    fn direct_and_system_discard_stale_urls() {
        for mode in [ProxyMode::System, ProxyMode::Direct] {
            assert_eq!(
                normalized(ProxySettings {
                    mode,
                    url: Some("http://localhost:1".into())
                })
                .unwrap()
                .url,
                None
            );
        }
    }
}
