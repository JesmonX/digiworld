mod catalog;
mod error;
mod manager;
mod model;
mod network;
mod process;
mod store;

use crate::error::{DigiworldError, Result};
use crate::manager::PluginManager;
use crate::model::{
    AppState, CatalogIndex, InstallResult, PluginSummary, PluginUpdateInfo, PluginUpdateRequest,
    ProxySettings, ProxyTestResult, UpdateInfo, UpdateProgress, target_key,
};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;

struct LogGuard {
    _guard: tracing_appender::non_blocking::WorkerGuard,
}

#[derive(Default)]
struct CoreUpdateCache {
    update: tokio::sync::Mutex<Option<tauri_plugin_updater::Update>>,
}

#[tauri::command]
async fn get_app_state(app: AppHandle, manager: State<'_, Arc<PluginManager>>) -> Result<AppState> {
    let launch_at_startup = app
        .autolaunch()
        .is_enabled()
        .map_err(|error| DigiworldError::Plugin(error.to_string()))?;
    Ok(AppState {
        version: env!("CARGO_PKG_VERSION").to_string(),
        platform: std::env::consts::OS.to_string(),
        target: target_key(),
        plugins: manager.summaries()?,
        catalog_sequence: manager.store().metadata_u64("catalog_sequence")?,
        launch_at_startup,
        update_available: None,
    })
}

#[tauri::command]
async fn get_catalog(
    refresh: bool,
    manager: State<'_, Arc<PluginManager>>,
) -> Result<CatalogIndex> {
    manager.load_catalog(refresh).await
}

#[tauri::command]
async fn install_plugin(
    app: AppHandle,
    plugin_id: String,
    version: String,
    manager: State<'_, Arc<PluginManager>>,
) -> Result<InstallResult> {
    let progress_app = app.clone();
    let progress_id = plugin_id.clone();
    let result = manager
        .install(
            &plugin_id,
            &version,
            move |stage, name, downloaded, total| {
                let _ = progress_app.emit(
                    "update-progress",
                    UpdateProgress {
                        operation: "plugin-install".into(),
                        item_id: Some(progress_id.clone()),
                        item_name: name.into(),
                        stage: stage.into(),
                        downloaded,
                        total,
                        completed_items: usize::from(stage == "completed"),
                        total_items: 1,
                    },
                );
            },
        )
        .await;
    if result.is_err() {
        let _ = app.emit(
            "update-progress",
            UpdateProgress {
                operation: "plugin-install".into(),
                item_id: Some(plugin_id.clone()),
                item_name: plugin_id,
                stage: "failed".into(),
                downloaded: 0,
                total: None,
                completed_items: 0,
                total_items: 1,
            },
        );
    }
    result
}

#[tauri::command]
async fn check_plugin_updates(
    manager: State<'_, Arc<PluginManager>>,
) -> Result<Vec<PluginUpdateInfo>> {
    manager.available_updates().await
}

#[tauri::command]
async fn install_plugin_updates(
    app: AppHandle,
    updates: Vec<PluginUpdateRequest>,
    manager: State<'_, Arc<PluginManager>>,
) -> Result<Vec<InstallResult>> {
    let positions: HashMap<_, _> = updates
        .iter()
        .enumerate()
        .map(|(index, update)| (update.id.clone(), index))
        .collect();
    let total_items = updates.len();
    let completed_items = Arc::new(AtomicUsize::new(0));
    let progress_completed_items = completed_items.clone();
    let progress_app = app.clone();
    let result = manager
        .install_updates(&updates, move |id, name, stage, downloaded, total| {
            let index = positions.get(id).copied().unwrap_or_default();
            let progress_completed = index + usize::from(stage == "completed");
            if stage == "completed" {
                progress_completed_items.fetch_max(progress_completed, Ordering::Relaxed);
            }
            let _ = progress_app.emit(
                "update-progress",
                UpdateProgress {
                    operation: "plugin-update".into(),
                    item_id: Some(id.into()),
                    item_name: name.into(),
                    stage: stage.into(),
                    downloaded,
                    total,
                    completed_items: progress_completed,
                    total_items,
                },
            );
        })
        .await;
    if result.is_err() {
        let _ = app.emit(
            "update-progress",
            UpdateProgress {
                operation: "plugin-update".into(),
                item_id: None,
                item_name: "插件更新".into(),
                stage: "failed".into(),
                downloaded: 0,
                total: None,
                completed_items: completed_items.load(Ordering::Relaxed),
                total_items,
            },
        );
    }
    result
}

#[tauri::command]
async fn set_plugin_enabled(
    plugin_id: String,
    enabled: bool,
    manager: State<'_, Arc<PluginManager>>,
) -> Result<PluginSummary> {
    manager.set_enabled(&plugin_id, enabled).await
}

#[tauri::command]
async fn uninstall_plugin(
    plugin_id: String,
    delete_data: bool,
    manager: State<'_, Arc<PluginManager>>,
) -> Result<()> {
    manager.uninstall(&plugin_id, delete_data).await
}

#[tauri::command]
async fn get_plugin_ui(
    plugin_id: String,
    manager: State<'_, Arc<PluginManager>>,
) -> Result<String> {
    manager.plugin_ui(&plugin_id).await
}

#[tauri::command]
async fn plugin_request(
    plugin_id: String,
    method: String,
    payload: Option<Value>,
    manager: State<'_, Arc<PluginManager>>,
) -> Result<Value> {
    manager
        .request(&plugin_id, &method, payload.unwrap_or(Value::Null))
        .await
}

#[tauri::command]
async fn set_launch_at_startup(app: AppHandle, enabled: bool) -> Result<()> {
    let autostart = app.autolaunch();
    if enabled {
        autostart
            .enable()
            .map_err(|error| DigiworldError::Plugin(error.to_string()))?;
    } else {
        autostart
            .disable()
            .map_err(|error| DigiworldError::Plugin(error.to_string()))?;
    }
    Ok(())
}

#[tauri::command]
async fn get_proxy_settings(manager: State<'_, Arc<PluginManager>>) -> Result<ProxySettings> {
    Ok(manager.proxy_settings().await)
}

#[tauri::command]
async fn set_proxy_settings(
    settings: ProxySettings,
    manager: State<'_, Arc<PluginManager>>,
) -> Result<ProxySettings> {
    manager.set_proxy_settings(settings).await
}

#[tauri::command]
async fn test_proxy_settings(
    settings: ProxySettings,
    manager: State<'_, Arc<PluginManager>>,
) -> Result<ProxyTestResult> {
    manager.test_proxy_settings(settings).await
}

fn updater_configured() -> bool {
    option_env!("DIGIWORLD_UPDATER_PUBLIC_KEY").is_some_and(|value| !value.trim().is_empty())
}

async fn query_core_update(
    app: &AppHandle,
    settings: &ProxySettings,
) -> Result<Option<tauri_plugin_updater::Update>> {
    let updater = network::updater(app, settings)?;
    tokio::time::timeout(network::UPDATE_CHECK_TIMEOUT, updater.check())
        .await
        .map_err(|_| {
            DigiworldError::Update("update check did not finish within 30 seconds".into())
        })?
        .map_err(|error| DigiworldError::Update(error.to_string()))
}

#[tauri::command]
async fn check_core_update(
    app: AppHandle,
    manager: State<'_, Arc<PluginManager>>,
    cache: State<'_, CoreUpdateCache>,
) -> Result<Option<UpdateInfo>> {
    if !updater_configured() {
        return Err(DigiworldError::Update(
            "release updater key is not configured".into(),
        ));
    }
    let update = query_core_update(&app, &manager.proxy_settings().await).await?;
    *cache.update.lock().await = update.clone();
    Ok(update.map(|update| UpdateInfo {
        version: update.version,
        notes: update.body,
    }))
}

#[tauri::command]
async fn install_core_update(
    app: AppHandle,
    version: String,
    manager: State<'_, Arc<PluginManager>>,
    cache: State<'_, CoreUpdateCache>,
) -> Result<()> {
    if !updater_configured() {
        return Err(DigiworldError::Update(
            "release updater key is not configured".into(),
        ));
    }
    let cached = cache.update.lock().await.clone();
    let update = match cached {
        Some(update) if update.version == version => update,
        Some(_) => {
            return Err(DigiworldError::Update(
                "available version changed; check for updates again".into(),
            ));
        }
        None => {
            let Some(update) = query_core_update(&app, &manager.proxy_settings().await).await?
            else {
                return Err(DigiworldError::Update(
                    "the update is no longer available; check for updates again".into(),
                ));
            };
            update
        }
    };
    if update.version != version {
        return Err(DigiworldError::Update(
            "available version changed; check for updates again".into(),
        ));
    }
    let download_app = app.clone();
    let install_app = app.clone();
    let progress_version = update.version.clone();
    let install_version = progress_version.clone();
    let mut downloaded = 0_u64;
    let install_result = update
        .download_and_install(
            move |chunk_size, total| {
                downloaded = downloaded.saturating_add(chunk_size as u64);
                let _ = download_app.emit(
                    "update-progress",
                    UpdateProgress {
                        operation: "core-update".into(),
                        item_id: None,
                        item_name: format!("Digiworld {progress_version}"),
                        stage: "downloading".into(),
                        downloaded,
                        total,
                        completed_items: 0,
                        total_items: 1,
                    },
                );
            },
            move || {
                let _ = install_app.emit(
                    "update-progress",
                    UpdateProgress {
                        operation: "core-update".into(),
                        item_id: None,
                        item_name: format!("Digiworld {install_version}"),
                        stage: "installing".into(),
                        downloaded: 0,
                        total: None,
                        completed_items: 0,
                        total_items: 1,
                    },
                );
            },
        )
        .await;
    if let Err(error) = install_result {
        let _ = app.emit(
            "update-progress",
            UpdateProgress {
                operation: "core-update".into(),
                item_id: None,
                item_name: format!("Digiworld {version}"),
                stage: "failed".into(),
                downloaded: 0,
                total: None,
                completed_items: 0,
                total_items: 1,
            },
        );
        return Err(DigiworldError::Update(error.to_string()));
    }
    let _ = app.emit(
        "update-progress",
        UpdateProgress {
            operation: "core-update".into(),
            item_id: None,
            item_name: format!("Digiworld {version}"),
            stage: "completed".into(),
            downloaded: 0,
            total: None,
            completed_items: 1,
            total_items: 1,
        },
    );
    *cache.update.lock().await = None;
    manager.stop_all().await;
    app.restart();
}

#[tauri::command]
async fn export_diagnostics(manager: State<'_, Arc<PluginManager>>) -> Result<String> {
    let directory = manager.root().join("diagnostics");
    tokio::fs::create_dir_all(&directory).await?;
    let path = directory.join(format!(
        "digiworld-diagnostics-{}.json",
        chrono::Utc::now().format("%Y%m%d-%H%M%S")
    ));
    let proxy = manager.proxy_settings().await;
    let payload = serde_json::json!({
        "generatedAt": chrono::Utc::now().to_rfc3339(),
        "coreVersion": env!("CARGO_PKG_VERSION"),
        "platform": std::env::consts::OS,
        "target": target_key(),
        "proxyMode": proxy.mode,
        "plugins": manager.summaries()?,
        "privacy": "No keyboard counts, key events, credentials, or user files are included."
    });
    tokio::fs::write(&path, serde_json::to_vec_pretty(&payload)?).await?;
    Ok(path.display().to_string())
}

fn open_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn create_tray(app: &tauri::App) -> anyhow::Result<()> {
    let open = MenuItem::with_id(app, "open", "打开 Digiworld", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut builder = TrayIconBuilder::new()
        .tooltip("Digiworld")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => open_main(app),
            "quit" => {
                let manager = app.state::<Arc<PluginManager>>().inner().clone();
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    manager.stop_all().await;
                    handle.exit(0);
                });
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                open_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let log_directory = std::env::temp_dir().join("digiworld-logs");
    let _ = std::fs::create_dir_all(&log_directory);
    let appender = tracing_appender::rolling::daily(log_directory, "digiworld.log");
    let (writer, guard) = tracing_appender::non_blocking(appender);
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive(tracing::Level::INFO.into()),
        )
        .with_writer(writer)
        .with_ansi(false)
        .try_init();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args(["--background"])
                .build(),
        )
        .manage(LogGuard { _guard: guard })
        .manage(CoreUpdateCache::default());
    if let Some(public_key) =
        option_env!("DIGIWORLD_UPDATER_PUBLIC_KEY").filter(|value| !value.trim().is_empty())
    {
        builder = builder.plugin(
            tauri_plugin_updater::Builder::new()
                .pubkey(public_key)
                .build(),
        );
    }

    builder
        .setup(|app| {
            let root = app.path().app_local_data_dir()?.join("Digiworld");
            std::fs::create_dir_all(&root)?;
            let manager =
                tauri::async_runtime::block_on(PluginManager::new(root, app.handle().clone()))?;
            app.manage(manager.clone());
            create_tray(app)?;

            let background = std::env::args().any(|argument| argument == "--background");
            if background && let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }
            let startup_manager = manager.clone();
            tauri::async_runtime::spawn(async move {
                startup_manager.start_enabled().await;
            });

            if let Some(window) = app.get_webview_window("main") {
                let close_manager = manager.clone();
                let handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        if close_manager
                            .store()
                            .has_enabled_background()
                            .unwrap_or(false)
                        {
                            api.prevent_close();
                            if let Some(window) = handle.get_webview_window("main") {
                                let _ = window.hide();
                            }
                        } else {
                            api.prevent_close();
                            let manager = close_manager.clone();
                            let exit_handle = handle.clone();
                            tauri::async_runtime::spawn(async move {
                                manager.stop_all().await;
                                exit_handle.exit(0);
                            });
                        }
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_state,
            get_catalog,
            install_plugin,
            check_plugin_updates,
            install_plugin_updates,
            set_plugin_enabled,
            uninstall_plugin,
            get_plugin_ui,
            plugin_request,
            set_launch_at_startup,
            get_proxy_settings,
            set_proxy_settings,
            test_proxy_settings,
            check_core_update,
            install_core_update,
            export_diagnostics,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Digiworld");
}
