use crate::model::{AgentKind, DailyUsage, TokenUsage};
use chrono::{DateTime, FixedOffset, Local, TimeZone, Utc};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, Default)]
struct NativeUsage {
    input: u64,
    output: u64,
    read: u64,
    write: u64,
    cache_available: bool,
}

pub fn parse(agent: AgentKind, content: &str) -> (Vec<DailyUsage>, usize) {
    let mut daily = BTreeMap::<(String, String), TokenUsage>::new();
    let mut warnings = 0;
    let mut codex_previous = BTreeMap::<String, NativeUsage>::new();
    let mut current_model = String::from("unknown");
    for line in content.lines().filter(|line| !line.trim().is_empty()) {
        let value: Value = match serde_json::from_str(line) {
            Ok(value) => value,
            Err(_) => {
                warnings += 1;
                continue;
            }
        };
        if let Some(model) = model_name(agent, &value) {
            current_model = model;
        }
        let item = match agent {
            AgentKind::Codex => parse_codex(&value, &current_model, &mut codex_previous),
            AgentKind::Claude => parse_claude(&value),
            AgentKind::Pi => parse_pi(&value),
        };
        let Some((timestamp, usage)) = item else {
            continue;
        };
        if usage.is_empty() {
            continue;
        }
        let day =
            local_day(&timestamp).unwrap_or_else(|| Local::now().format("%Y-%m-%d").to_string());
        daily
            .entry((day, current_model.clone()))
            .or_default()
            .add_assign(&usage);
    }
    (
        daily
            .into_iter()
            .map(|((day, model), usage)| DailyUsage { day, model, usage })
            .collect(),
        warnings,
    )
}

fn model_name(agent: AgentKind, value: &Value) -> Option<String> {
    let candidate = match agent {
        AgentKind::Codex => value
            .pointer("/payload/model")
            .or_else(|| value.pointer("/payload/thread_settings/model")),
        AgentKind::Claude | AgentKind::Pi => value
            .pointer("/message/model")
            .or_else(|| value.get("model")),
    }?
    .as_str()?
    .trim();
    (!candidate.is_empty() && candidate != "<synthetic>").then(|| candidate.to_string())
}

fn parse_codex(
    value: &Value,
    model: &str,
    previous_by_model: &mut BTreeMap<String, NativeUsage>,
) -> Option<(String, TokenUsage)> {
    if value.get("type")?.as_str()? != "event_msg"
        || value.pointer("/payload/type")?.as_str()? != "token_count"
    {
        return None;
    }
    let total = value
        .pointer("/payload/info/total_token_usage")
        .and_then(native_codex);
    let last = value
        .pointer("/payload/info/last_token_usage")
        .and_then(native_codex);
    let native = if let Some(current) = total {
        let previous = previous_by_model.get(model).copied();
        let delta = previous
            .map(|old| NativeUsage {
                input: if current.input < old.input {
                    current.input
                } else {
                    current.input - old.input
                },
                output: if current.output < old.output {
                    current.output
                } else {
                    current.output - old.output
                },
                read: if current.read < old.read {
                    current.read
                } else {
                    current.read - old.read
                },
                write: if current.write < old.write {
                    current.write
                } else {
                    current.write - old.write
                },
                cache_available: current.cache_available,
            })
            .unwrap_or(current);
        previous_by_model.insert(model.to_string(), current);
        delta
    } else {
        last?
    };
    Some((
        timestamp(value)?,
        TokenUsage {
            input_tokens: native.input,
            output_tokens: native.output,
            cache_read_tokens: native.read.min(native.input),
            cache_write_tokens: native.write.min(native.input),
            cache_available: native.cache_available,
        },
    ))
}

fn native_codex(value: &Value) -> Option<NativeUsage> {
    Some(NativeUsage {
        input: number(value, "input_tokens"),
        output: number(value, "output_tokens"),
        read: number(value, "cached_input_tokens"),
        write: number(value, "cache_write_input_tokens"),
        cache_available: value.get("cached_input_tokens").is_some()
            || value.get("cache_write_input_tokens").is_some(),
    })
}

fn parse_claude(value: &Value) -> Option<(String, TokenUsage)> {
    let usage = value
        .pointer("/message/usage")
        .or_else(|| value.get("usage"))?;
    let raw = number(usage, "input_tokens");
    let read = number(usage, "cache_read_input_tokens");
    let write = number(usage, "cache_creation_input_tokens");
    Some((
        timestamp(value).or_else(|| {
            value
                .pointer("/message/timestamp")?
                .as_str()
                .map(str::to_string)
        })?,
        TokenUsage {
            input_tokens: raw.saturating_add(read).saturating_add(write),
            output_tokens: number(usage, "output_tokens"),
            cache_read_tokens: read,
            cache_write_tokens: write,
            cache_available: usage.get("cache_read_input_tokens").is_some()
                || usage.get("cache_creation_input_tokens").is_some(),
        },
    ))
}

fn parse_pi(value: &Value) -> Option<(String, TokenUsage)> {
    let usage = value
        .pointer("/message/usage")
        .or_else(|| value.get("usage"))?;
    let raw = number(usage, "input");
    let read = number(usage, "cacheRead");
    let write = number(usage, "cacheWrite");
    Some((
        timestamp(value).or_else(|| {
            value
                .pointer("/message/timestamp")?
                .as_str()
                .map(str::to_string)
        })?,
        TokenUsage {
            input_tokens: raw.saturating_add(read).saturating_add(write),
            output_tokens: number(usage, "output"),
            cache_read_tokens: read,
            cache_write_tokens: write,
            cache_available: usage.get("cacheRead").is_some() || usage.get("cacheWrite").is_some(),
        },
    ))
}

fn timestamp(value: &Value) -> Option<String> {
    value.get("timestamp")?.as_str().map(str::to_string)
}

fn number(value: &Value, key: &str) -> u64 {
    value.get(key).and_then(Value::as_u64).unwrap_or(0)
}

fn local_day(value: &str) -> Option<String> {
    if let Ok(timestamp) = DateTime::parse_from_rfc3339(value) {
        return Some(
            timestamp
                .with_timezone(&Local)
                .format("%Y-%m-%d")
                .to_string(),
        );
    }
    if let Ok(seconds) = value.parse::<i64>() {
        return Utc
            .timestamp_opt(seconds, 0)
            .single()
            .map(|value| value.with_timezone(&Local).format("%Y-%m-%d").to_string());
    }
    let _ = FixedOffset::east_opt(0);
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_uses_cumulative_deltas_without_double_counting_cache() {
        let input = r#"{"timestamp":"2026-09-02T00:59:00Z","type":"turn_context","payload":{"model":"gpt-5.6-sol"}}
{"timestamp":"2026-09-02T01:00:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":60,"cache_write_input_tokens":0,"output_tokens":10}}}}
{"timestamp":"2026-09-02T02:00:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":140,"cached_input_tokens":80,"cache_write_input_tokens":0,"output_tokens":15}}}}"#;
        let (rows, warnings) = parse(AgentKind::Codex, input);
        assert_eq!(warnings, 0);
        assert_eq!(rows[0].model, "gpt-5.6-sol");
        assert_eq!(
            rows.iter().map(|row| row.usage.input_tokens).sum::<u64>(),
            140
        );
        assert_eq!(
            rows.iter().map(|row| row.usage.output_tokens).sum::<u64>(),
            15
        );
        assert_eq!(
            rows.iter()
                .map(|row| row.usage.cache_read_tokens)
                .sum::<u64>(),
            80
        );
    }

    #[test]
    fn normalizes_claude_and_pi_inputs() {
        let claude = r#"{"timestamp":"2026-09-02T01:00:00Z","message":{"model":"claude-opus-4-8","usage":{"input_tokens":10,"output_tokens":4,"cache_read_input_tokens":20,"cache_creation_input_tokens":5}}}"#;
        let pi = r#"{"timestamp":"2026-09-02T01:00:00Z","message":{"model":"glm-5.3","usage":{"input":10,"output":4,"cacheRead":20,"cacheWrite":5}}}"#;
        for (agent, data, model) in [
            (AgentKind::Claude, claude, "claude-opus-4-8"),
            (AgentKind::Pi, pi, "glm-5.3"),
        ] {
            let (rows, _) = parse(agent, data);
            assert_eq!(rows[0].model, model);
            assert_eq!(rows[0].usage.input_tokens, 35);
            assert_eq!(rows[0].usage.output_tokens, 4);
            assert_eq!(rows[0].usage.cache_read_tokens, 20);
            assert_eq!(rows[0].usage.cache_write_tokens, 5);
        }
    }

    #[test]
    fn keeps_models_separate_on_the_same_day() {
        let input = r#"{"timestamp":"2026-09-02T01:00:00Z","message":{"model":"glm-5.2","usage":{"input":10,"output":2}}}
{"timestamp":"2026-09-02T02:00:00Z","message":{"model":"glm-5.3","usage":{"input":20,"output":4}}}"#;
        let (rows, _) = parse(AgentKind::Pi, input);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].model, "glm-5.2");
        assert_eq!(rows[1].model, "glm-5.3");
    }

    #[test]
    fn skips_malformed_lines() {
        let (rows, warnings) = parse(AgentKind::Pi, "not-json\n{}");
        assert!(rows.is_empty());
        assert_eq!(warnings, 1);
    }

    #[test]
    fn codex_tracks_deltas_separately_when_models_switch_in_the_same_session() {
        let input = r#"{"timestamp":"2026-09-02T00:50:00Z","type":"turn_context","payload":{"model":"gpt-5.6-sol"}}
{"timestamp":"2026-09-02T01:00:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":60,"cache_write_input_tokens":0,"output_tokens":10}}}}
{"timestamp":"2026-09-02T01:50:00Z","type":"turn_context","payload":{"model":"gpt-5.6-mini"}}
{"timestamp":"2026-09-02T02:00:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":50,"cached_input_tokens":20,"cache_write_input_tokens":0,"output_tokens":5}}}}
{"timestamp":"2026-09-02T02:50:00Z","type":"turn_context","payload":{"model":"gpt-5.6-sol"}}
{"timestamp":"2026-09-02T03:00:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":160,"cached_input_tokens":90,"cache_write_input_tokens":0,"output_tokens":15}}}}"#;
        let (rows, warnings) = parse(AgentKind::Codex, input);
        assert_eq!(warnings, 0);
        let sol = rows.iter().find(|r| r.model == "gpt-5.6-sol").unwrap();
        let mini = rows.iter().find(|r| r.model == "gpt-5.6-mini").unwrap();
        assert_eq!(sol.usage.input_tokens, 160);
        assert_eq!(sol.usage.output_tokens, 15);
        assert_eq!(mini.usage.input_tokens, 50);
        assert_eq!(mini.usage.output_tokens, 5);
    }
}
