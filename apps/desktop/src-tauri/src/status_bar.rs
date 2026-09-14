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

pub fn render_progress_bar(percent: u32, slots: usize) -> String {
    let percent = percent.min(100);
    let filled = if percent == 0 {
        0
    } else if percent >= 100 {
        slots
    } else {
        ((percent as f64 / 100.0) * slots as f64).round() as usize
    };
    let empty = slots.saturating_sub(filled);
    format!("{}{}", "█".repeat(filled), "░".repeat(empty))
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
    format!(
        "今日 Token: {} | 缓存命中率: {}",
        tokens_str, cache_rate_str
    )
}

pub fn format_window_line(w: &StatusBarWindow) -> String {
    let bar = render_progress_bar(w.remaining_percent, 10);
    let reset_str = w.resets_at.map(format_reset_time).unwrap_or_default();
    if reset_str.is_empty() {
        format!("  {} 剩余: {} {}%", w.window, bar, w.remaining_percent)
    } else {
        format!(
            "  {} 剩余: {} {}% ({})",
            w.window, bar, w.remaining_percent, reset_str
        )
    }
}

pub fn format_codex_extra_line(codex: &StatusBarQuota) -> Option<String> {
    let mut parts = Vec::new();
    if let Some(balance) = &codex.balance {
        parts.push(format!("余额: {}", balance));
    }
    if let Some(cards) = codex.reset_cards {
        parts.push(format!("重置卡: {} 张", cards));
    }
    if parts.is_empty() {
        None
    } else {
        Some(format!("  {}", parts.join(" | ")))
    }
}

pub fn format_codex_lines(codex: &StatusBarQuota) -> Vec<String> {
    let extra = format_codex_extra_line(codex);
    if codex.windows.is_empty() && extra.is_none() {
        return Vec::new();
    }
    let mut lines = Vec::new();
    lines.push("Codex".to_string());
    for w in &codex.windows {
        lines.push(format_window_line(w));
    }
    if let Some(extra_line) = extra {
        lines.push(extra_line);
    }
    lines
}

pub fn format_agy_lines(agy: &StatusBarQuota) -> Vec<String> {
    if agy.windows.is_empty() {
        return Vec::new();
    }
    let mut lines = Vec::new();
    lines.push("AGY".to_string());
    for w in &agy.windows {
        lines.push(format_window_line(w));
    }
    lines
}

enum TrayItem {
    Item(MenuItem<tauri::Wry>),
    Sep(PredefinedMenuItem<tauri::Wry>),
}

impl TrayItem {
    fn as_menu_item(&self) -> &dyn IsMenuItem<tauri::Wry> {
        match self {
            TrayItem::Item(item) => item,
            TrayItem::Sep(sep) => sep,
        }
    }
}

pub fn build_tray_menu(
    app: &AppHandle,
    summary: Option<&StatusBarSummary>,
) -> anyhow::Result<Menu<tauri::Wry>> {
    let mut items: Vec<TrayItem> = Vec::new();

    if let Some(summary) = summary {
        let today_text = format_today_line(&summary.today);
        items.push(TrayItem::Item(MenuItem::with_id(
            app,
            "status_today",
            &today_text,
            true,
            None::<&str>,
        )?));

        if let Some(codex) = &summary.codex {
            let codex_lines = format_codex_lines(codex);
            if !codex_lines.is_empty() {
                items.push(TrayItem::Sep(PredefinedMenuItem::separator(app)?));
                for (idx, line) in codex_lines.into_iter().enumerate() {
                    let id = format!("status_codex_{idx}");
                    items.push(TrayItem::Item(MenuItem::with_id(
                        app,
                        &id,
                        &line,
                        true,
                        None::<&str>,
                    )?));
                }
            }
        }

        if let Some(agy) = &summary.agy {
            let agy_lines = format_agy_lines(agy);
            if !agy_lines.is_empty() {
                items.push(TrayItem::Sep(PredefinedMenuItem::separator(app)?));
                for (idx, line) in agy_lines.into_iter().enumerate() {
                    let id = format!("status_agy_{idx}");
                    items.push(TrayItem::Item(MenuItem::with_id(
                        app,
                        &id,
                        &line,
                        true,
                        None::<&str>,
                    )?));
                }
            }
        }
    }

    if !items.is_empty() {
        items.push(TrayItem::Sep(PredefinedMenuItem::separator(app)?));
    }

    let open = MenuItem::with_id(app, "open", "打开 Digiworld", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    items.push(TrayItem::Item(open));
    items.push(TrayItem::Item(quit));

    let refs: Vec<&dyn IsMenuItem<tauri::Wry>> = items.iter().map(|it| it.as_menu_item()).collect();
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
        .request(
            AGENT_PLUGIN_ID,
            "usage.statusBarSummary",
            serde_json::Value::Null,
        )
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
    fn renders_progress_bars() {
        assert_eq!(render_progress_bar(0, 10), "░░░░░░░░░░");
        assert_eq!(render_progress_bar(20, 10), "██░░░░░░░░");
        assert_eq!(render_progress_bar(38, 10), "████░░░░░░");
        assert_eq!(render_progress_bar(45, 10), "█████░░░░░");
        assert_eq!(render_progress_bar(80, 10), "████████░░");
        assert_eq!(render_progress_bar(86, 10), "█████████░");
        assert_eq!(render_progress_bar(100, 10), "██████████");
        assert_eq!(render_progress_bar(120, 10), "██████████");
    }

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
    fn formats_window_line_with_progress_bar() {
        let win_with_reset = StatusBarWindow {
            window: "5h".into(),
            window_duration_mins: Some(300),
            used_percent: 20,
            remaining_percent: 80,
            resets_at: None,
        };
        assert_eq!(
            format_window_line(&win_with_reset),
            "  5h 剩余: ████████░░ 80%"
        );
    }

    #[test]
    fn formats_codex_lines_with_limits_balance_and_cards() {
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
            reset_cards: Some(2),
        };
        let lines = format_codex_lines(&codex);
        assert_eq!(
            lines,
            vec![
                "Codex",
                "  5h 剩余: ████████░░ 80%",
                "  7d 剩余: █████░░░░░ 45%",
                "  余额: $12.5 | 重置卡: 2 张",
            ]
        );
    }

    #[test]
    fn formats_agy_lines_with_windows() {
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
        let lines = format_agy_lines(&agy);
        assert_eq!(
            lines,
            vec![
                "AGY",
                "  5h 剩余: █████████░ 86%",
                "  7d 剩余: ████░░░░░░ 38%",
            ]
        );
    }
}
