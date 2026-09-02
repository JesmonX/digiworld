mod catalog;
mod error;
mod manager;
mod model;
mod process;
mod store;

use crate::error::{DigiworldError, Result};
use crate::manager::PluginManager;
use crate::model::{AppState, CatalogIndex, InstallResult, PluginSummary, UpdateInfo, target_key};
use serde_json::Value;
use std::sync::Arc;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, State, WindowEvent};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;
use tauri_plugin_updater::UpdaterExt;

struct LogGuard(tracing_appender::non_blocking::WorkerGuard);

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
    plugin_id: String,
    manager: State<'_, Arc<PluginManager>>,
) -> Result<InstallResult> {
    manager.install(&plugin_id).await
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

fn updater_configured() -> bool {
    option_env!("DIGIWORLD_UPDATER_PUBLIC_KEY").is_some()
}

#[tauri::command]
async fn check_core_update(app: AppHandle) -> Result<Option<UpdateInfo>> {
    if !updater_configured() {
        return Ok(None);
    }
    let update = app
        .updater()
        .map_err(|error| DigiworldError::Update(error.to_string()))?
        .check()
        .await
        .map_err(|error| DigiworldError::Update(error.to_string()))?;
    Ok(update.map(|update| UpdateInfo {
        version: update.version,
        notes: update.body,
    }))
}

#[tauri::command]
async fn install_core_update(app: AppHandle) -> Result<()> {
    if !updater_configured() {
        return Err(DigiworldError::Update(
            "release updater key is not configured".into(),
        ));
    }
    let Some(update) = app
        .updater()
        .map_err(|error| DigiworldError::Update(error.to_string()))?
        .check()
        .await
        .map_err(|error| DigiworldError::Update(error.to_string()))?
    else {
        return Ok(());
    };
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| DigiworldError::Update(error.to_string()))?;
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
    let payload = serde_json::json!({
        "generatedAt": chrono::Utc::now().to_rfc3339(),
        "coreVersion": env!("CARGO_PKG_VERSION"),
        "platform": std::env::consts::OS,
        "target": target_key(),
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args(["--background"])
                .build(),
        )
        .manage(LogGuard(guard));
    if let Some(public_key) = option_env!("DIGIWORLD_UPDATER_PUBLIC_KEY") {
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
            let manager = tauri::async_runtime::block_on(PluginManager::new(root))?;
            app.manage(manager.clone());
            create_tray(app)?;

            let background = std::env::args().any(|argument| argument == "--background");
            if background {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
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
                            handle.exit(0);
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
            set_plugin_enabled,
            uninstall_plugin,
            get_plugin_ui,
            plugin_request,
            set_launch_at_startup,
            check_core_update,
            install_core_update,
            export_diagnostics,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Digiworld");
}
