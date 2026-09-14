use crate::manager::PluginManager;
use chrono::{DateTime, Local};
use serde::Deserialize;
use std::sync::Arc;
use tauri::menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::{AppHandle, Manager};

pub const AGENT_PLUGIN_ID: &str = "io.github.jesmonx.digiworld.agent-token-heatmap";

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatusBarSummary {
    pub today: StatusBarToday,
    pub codex: Option<StatusBarQuota>,
    pub agy: Option<StatusBarQuota>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct StatusBarToday {
    pub day: String,
    pub total_tokens: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    pub cache_rate: Option<f64>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatusBarWindow {
    pub window: String,
    pub window_duration_mins: Option<i64>,
    pub used_percent: u32,
    pub remaining_percent: u32,
    pub resets_at: Option<i64>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatusBarQuota {
    pub name: String,
    pub plan_type: Option<String>,
    pub windows: Vec<StatusBarWindow>,
    pub balance: Option<String>,
    pub reset_cards: Option<i64>,
}

pub fn format_tokens(tokens: u64) -> String {
    if tokens >= 1_000_000_000 {
        format_compact(tokens as f64 / 1_000_000_000.0, "B")
    } else if tokens >= 1_000_000 {
        format_compact(tokens as f64 / 1_000_000.0, "M")
    } else if tokens >= 1_000 {
        format_compact(tokens as f64 / 1_000.0, "K")
    } else {
        tokens.to_string()
    }
}

fn format_compact(val: f64, suffix: &str) -> String {
    let s = if val >= 100.0 {
        format!("{:.0}", val)
    } else if val >= 10.0 {
        format!("{:.1}", val)
    } else {
        format!("{:.2}", val)
    };
    let trimmed = if s.contains('.') {
        s.trim_end_matches('0').trim_end_matches('.').to_string()
    } else {
        s
    };
    format!("{}{}", trimmed, suffix)
}

pub fn format_reset_time(ts: i64) -> String {
    let seconds = if ts > 100_000_000_000 { ts / 1000 } else { ts };
    let Some(dt) = DateTime::from_timestamp(seconds, 0).map(|d| d.with_timezone(&Local)) else {
        return String::new();
    };
    let today = Local::now().date_naive();
    if dt.date_naive() == today {
        format!("{} 重置", dt.format("%H:%M"))
    } else {
        format!("{} 重置", dt.format("%m-%d %H:%M"))
    }
}

pub fn format_today_line(today: &StatusBarToday) -> String {
    let tokens_str = format_tokens(today.total_tokens);
    let cache_rate_str = match today.cache_rate {
        Some(rate) => format!("{:.1}%", rate * 100.0),
        None => "--".to_string(),
    };
    format!("今日 Token: {} | 缓存命中率: {}", tokens_str, cache_rate_str)
}

pub fn format_codex_line(codex: &StatusBarQuota) -> String {
    let mut parts = Vec::new();
    for w in &codex.windows {
        let reset_str = w.resets_at.map(format_reset_time).unwrap_or_default();
        if reset_str.is_empty() {
            parts.push(format!("{} 剩余 {}%", w.window, w.remaining_percent));
        } else {
            parts.push(format!("{} 剩余 {}% ({})", w.window, w.remaining_percent, reset_str));
        }
    }
    if let Some(balance) = &codex.balance {
        parts.push(format!("余额: {}", balance));
    }
    if let Some(cards) = codex.reset_cards {
        parts.push(format!("重置卡: {} 张", cards));
    }
    if parts.is_empty() {
        String::new()
    } else {
        format!("Codex: {}", parts.join(" | "))
    }
}

pub fn format_agy_line(agy: &StatusBarQuota) -> String {
    let mut parts = Vec::new();
    for w in &agy.windows {
        let reset_str = w.resets_at.map(format_reset_time).unwrap_or_default();
        if reset_str.is_empty() {
            parts.push(format!("{} 剩余 {}%", w.window, w.remaining_percent));
        } else {
            parts.push(format!("{} 剩余 {}% ({})", w.window, w.remaining_percent, reset_str));
        }
    }
    if parts.is_empty() {
        String::new()
    } else {
        format!("AGY: {}", parts.join(" | "))
    }
}

pub fn build_tray_menu(
    app: &AppHandle,
    summary: Option<&StatusBarSummary>,
) -> anyhow::Result<Menu> {
    let mut has_status = false;

    let item_today = if let Some(summary) = summary {
        let today_text = format_today_line(&summary.today);
        has_status = true;
        Some(MenuItem::with_id(app, "status_today", &today_text, true, None::<&str>)?)
    } else {
        None
    };

    let item_codex = if let Some(codex) = summary.and_then(|s| s.codex.as_ref()) {
        let codex_text = format_codex_line(codex);
        if !codex_text.is_empty() {
            Some(MenuItem::with_id(app, "status_codex", &codex_text, true, None::<&str>)?)
        } else {
            None
        }
    } else {
        None
    };

    let item_agy = if let Some(agy) = summary.and_then(|s| s.agy.as_ref()) {
        let agy_text = format_agy_line(agy);
        if !agy_text.is_empty() {
            Some(MenuItem::with_id(app, "status_agy", &agy_text, true, None::<&str>)?)
        } else {
            None
        }
    } else {
        None
    };

    let sep = if has_status {
        Some(PredefinedMenuItem::separator(app)?)
    } else {
        None
    };

    let open = MenuItem::with_id(app, "open", "打开 Digiworld", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

    let mut refs: Vec<&dyn IsMenuItem<tauri::Wry>> = Vec::new();
    if let Some(ref item) = item_today {
        refs.push(item);
    }
    if let Some(ref item) = item_codex {
        refs.push(item);
    }
    if let Some(ref item) = item_agy {
        refs.push(item);
    }
    if let Some(ref item) = sep {
        refs.push(item);
    }
    refs.push(&open);
    refs.push(&quit);

    let menu = Menu::with_items(app, &refs)?;
    Ok(menu)
}

pub async fn fetch_status_summary(manager: &PluginManager) -> Option<StatusBarSummary> {
    let is_enabled = manager.store().is_enabled(AGENT_PLUGIN_ID).unwrap_or(false);
    if !is_enabled {
        return None;
    }
    if let Err(error) = manager.ensure_running(AGENT_PLUGIN_ID).await {
        tracing::warn!(%error, "failed to ensure agent plugin is running for status bar");
        return None;
    }
    match manager
        .request(AGENT_PLUGIN_ID, "usage.statusBarSummary", serde_json::Value::Null)
        .await
    {
        Ok(value) => match serde_json::from_value::<StatusBarSummary>(value) {
            Ok(summary) => Some(summary),
            Err(error) => {
                tracing::warn!(%error, "failed to deserialize status bar summary");
                None
            }
        },
        Err(error) => {
            tracing::warn!(%error, "failed to request status bar summary");
            None
        }
    }
}

pub async fn update_tray(app: &AppHandle) -> anyhow::Result<()> {
    let manager = match app.try_state::<Arc<PluginManager>>() {
        Some(m) => m.inner().clone(),
        None => return Ok(()),
    };
    let summary = fetch_status_summary(&manager).await;
    let menu = build_tray_menu(app, summary.as_ref())?;
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_menu(Some(menu));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_tokens_compactly() {
        assert_eq!(format_tokens(0), "0");
        assert_eq!(format_tokens(950), "950");
        assert_eq!(format_tokens(1000), "1K");
        assert_eq!(format_tokens(1200), "1.2K");
        assert_eq!(format_tokens(125400), "125K");
        assert_eq!(format_tokens(2500000), "2.5M");
        assert_eq!(format_tokens(1000000000), "1B");
    }

    #[test]
    fn formats_today_line_with_and_without_cache() {
        let today_with_cache = StatusBarToday {
            day: "2026-09-14".into(),
            total_tokens: 125400,
            input_tokens: 100000,
            output_tokens: 25400,
            cache_read_tokens: 85200,
            cache_write_tokens: 1000,
            cache_rate: Some(0.852),
        };
        assert_eq!(
            format_today_line(&today_with_cache),
            "今日 Token: 125K | 缓存命中率: 85.2%"
        );

        let today_no_cache = StatusBarToday {
            day: "2026-09-14".into(),
            total_tokens: 0,
            input_tokens: 0,
            output_tokens: 0,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
            cache_rate: None,
        };
        assert_eq!(
            format_today_line(&today_no_cache),
            "今日 Token: 0 | 缓存命中率: --"
        );
    }

    #[test]
    fn formats_codex_line_with_limits_balance_and_cards() {
        let codex = StatusBarQuota {
            name: "Codex".into(),
            plan_type: Some("plus".into()),
            windows: vec![
                StatusBarWindow {
                    window: "5h".into(),
                    window_duration_mins: Some(300),
                    used_percent: 20,
                    remaining_percent: 80,
                    resets_at: None,
                },
                StatusBarWindow {
                    window: "7d".into(),
                    window_duration_mins: Some(10080),
                    used_percent: 55,
                    remaining_percent: 45,
                    resets_at: None,
                },
            ],
            balance: Some("$12.5".into()),
            reset_cards: Some(1),
        };
        assert_eq!(
            format_codex_line(&codex),
            "Codex: 5h 剩余 80% | 7d 剩余 45% | 余额: $12.5 | 重置卡: 1 张"
        );
    }

    #[test]
    fn formats_agy_line_with_windows() {
        let agy = StatusBarQuota {
            name: "AGY".into(),
            plan_type: Some("AI Pro".into()),
            windows: vec![
                StatusBarWindow {
                    window: "5h".into(),
                    window_duration_mins: Some(300),
                    used_percent: 14,
                    remaining_percent: 86,
                    resets_at: None,
                },
                StatusBarWindow {
                    window: "7d".into(),
                    window_duration_mins: Some(10080),
                    used_percent: 62,
                    remaining_percent: 38,
                    resets_at: None,
                },
            ],
            balance: None,
            reset_cards: None,
        };
        assert_eq!(
            format_agy_line(&agy),
            "AGY: 5h 剩余 86% | 7d 剩余 38%"
        );
    }
}
