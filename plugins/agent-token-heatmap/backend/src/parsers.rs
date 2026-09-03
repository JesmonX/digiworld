use crate::model::{AgentKind, DailyUsage, TokenUsage};
use anyhow::Result;
use chrono::{DateTime, FixedOffset, Local, TimeZone, Utc};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::Path;

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
            AgentKind::Zcode => parse_zcode(&value),
            AgentKind::Agy => parse_agy(&value),
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
        AgentKind::Zcode => value
            .pointer("/model")
            .or_else(|| value.pointer("/model_id"))
            .or_else(|| value.pointer("/context/model"))
            .or_else(|| value.pointer("/payload/model")),
        AgentKind::Agy => value
            .pointer("/model")
            .or_else(|| value.pointer("/model_name"))
            .or_else(|| value.pointer("/payload/model")),
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

fn parse_zcode(value: &Value) -> Option<(String, TokenUsage)> {
    let usage = value.get("usage").unwrap_or(value);
    let stamp = timestamp(value)
        .or_else(|| {
            value
                .get("started_at")
                .and_then(Value::as_i64)
                .map(|ms| (if ms > 100_000_000_000 { ms / 1000 } else { ms }).to_string())
        })
        .or_else(|| {
            value
                .get("time")
                .and_then(Value::as_i64)
                .map(|ms| (if ms > 100_000_000_000 { ms / 1000 } else { ms }).to_string())
        })?;
    let input = number(usage, "input_tokens")
        .max(number(usage, "inputTokens"))
        .max(number(usage, "input"));
    let output = number(usage, "output_tokens")
        .max(number(usage, "outputTokens"))
        .max(number(usage, "output"));
    let read = number(usage, "cache_read_input_tokens")
        .max(number(usage, "cacheReadInputTokens"))
        .max(number(usage, "cache_read_tokens"))
        .max(number(usage, "cacheReadTokens"))
        .max(number(usage, "cacheRead"));
    let write = number(usage, "cache_creation_input_tokens")
        .max(number(usage, "cacheCreationInputTokens"))
        .max(number(usage, "cache_write_tokens"))
        .max(number(usage, "cacheWriteTokens"))
        .max(number(usage, "cacheWrite"));
    let has_cache = usage.get("cache_read_input_tokens").is_some()
        || usage.get("cacheReadInputTokens").is_some()
        || usage.get("cache_read_tokens").is_some()
        || usage.get("cacheReadTokens").is_some()
        || usage.get("cacheRead").is_some();
    if input == 0 && output == 0 && read == 0 && write == 0 {
        return None;
    }
    Some((
        stamp,
        TokenUsage {
            input_tokens: input.saturating_add(read).saturating_add(write),
            output_tokens: output,
            cache_read_tokens: read,
            cache_write_tokens: write,
            cache_available: has_cache,
        },
    ))
}

fn parse_agy(value: &Value) -> Option<(String, TokenUsage)> {
    let usage = value.get("usage").unwrap_or(value);
    let stamp = timestamp(value)
        .or_else(|| value.get("created_at").and_then(Value::as_str).map(str::to_string))?;
    let prompt = number(usage, "prompt_token_count")
        .max(number(usage, "promptTokenCount"))
        .max(number(usage, "input_tokens"))
        .max(number(usage, "input"));
    let candidates = number(usage, "candidates_token_count")
        .max(number(usage, "candidatesTokenCount"))
        .max(number(usage, "output_tokens"))
        .max(number(usage, "output"));
    let cached = number(usage, "cached_content_token_count")
        .max(number(usage, "cachedContentTokenCount"))
        .max(number(usage, "cache_read_tokens"))
        .max(number(usage, "cacheRead"));
    let has_cache = usage.get("cached_content_token_count").is_some()
        || usage.get("cachedContentTokenCount").is_some()
        || usage.get("cache_read_tokens").is_some();
    if prompt == 0 && candidates == 0 && cached == 0 {
        return None;
    }
    Some((
        stamp,
        TokenUsage {
            input_tokens: prompt,
            output_tokens: candidates,
            cache_read_tokens: cached,
            cache_write_tokens: 0,
            cache_available: has_cache,
        },
    ))
}

pub fn parse_sqlite(agent: AgentKind, path: &Path) -> Result<(Vec<DailyUsage>, usize)> {
    match agent {
        AgentKind::Agy => parse_agy_sqlite(path),
        AgentKind::Zcode => parse_zcode_sqlite(path),
        _ => Ok((Vec::new(), 0)),
    }
}

fn parse_agy_sqlite(path: &Path) -> Result<(Vec<DailyUsage>, usize)> {
    let conn = rusqlite::Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    let table_exists: bool = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='steps'",
            [],
            |_| Ok(true),
        )
        .unwrap_or(false);
    if !table_exists {
        return Ok((Vec::new(), 0));
    }

    let mut stmt = conn.prepare("SELECT metadata FROM steps WHERE metadata IS NOT NULL")?;
    let rows = stmt.query_map([], |row| row.get::<_, Vec<u8>>(0))?;
    let mut daily = BTreeMap::<(String, String), TokenUsage>::new();
    let mut warnings = 0;

    for row in rows {
        let metadata = match row {
            Ok(bytes) => bytes,
            Err(_) => {
                warnings += 1;
                continue;
            }
        };
        if let Some((stamp_sec, model, usage)) = parse_agy_proto_step(&metadata) {
            if usage.is_empty() {
                continue;
            }
            let day = Utc
                .timestamp_opt(stamp_sec, 0)
                .single()
                .map(|t| t.with_timezone(&Local).format("%Y-%m-%d").to_string())
                .unwrap_or_else(|| Local::now().format("%Y-%m-%d").to_string());
            daily.entry((day, model)).or_default().add_assign(&usage);
        }
    }

    Ok((
        daily
            .into_iter()
            .map(|((day, model), usage)| DailyUsage { day, model, usage })
            .collect(),
        warnings,
    ))
}

fn parse_zcode_sqlite(path: &Path) -> Result<(Vec<DailyUsage>, usize)> {
    let conn = rusqlite::Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    let table_exists: bool = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='model_usage'",
            [],
            |_| Ok(true),
        )
        .unwrap_or(false);
    if !table_exists {
        return Ok((Vec::new(), 0));
    }

    let mut stmt = conn.prepare(
        "SELECT started_at, model_id, input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens
         FROM model_usage",
    )?;
    let mut daily = BTreeMap::<(String, String), TokenUsage>::new();
    let mut warnings = 0;
    let rows = stmt.query_map([], |row| {
        let stamp_i64 = parse_sqlite_timestamp(row, 0);
        let model: Option<String> = row.get(1).ok();
        let input: u64 = row.get::<_, Option<u64>>(2).ok().flatten().unwrap_or(0);
        let output: u64 = row.get::<_, Option<u64>>(3).ok().flatten().unwrap_or(0);
        let read: u64 = row.get::<_, Option<u64>>(4).ok().flatten().unwrap_or(0);
        let write: u64 = row.get::<_, Option<u64>>(5).ok().flatten().unwrap_or(0);
        Ok((stamp_i64, model, input, output, read, write))
    })?;

    for row in rows {
        let (started_at, model_id, input, output, read, write) = match row {
            Ok(values) => values,
            Err(_) => {
                warnings += 1;
                continue;
            }
        };
        let usage = TokenUsage {
            input_tokens: input.saturating_add(read).saturating_add(write),
            output_tokens: output,
            cache_read_tokens: read,
            cache_write_tokens: write,
            cache_available: read > 0 || write > 0,
        };
        if usage.is_empty() {
            continue;
        }
        let model = model_id
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "unknown".into());
        let day = started_at
            .and_then(|raw| {
                let secs = if raw > 100_000_000_000 { raw / 1000 } else { raw };
                Utc.timestamp_opt(secs, 0)
                    .single()
                    .map(|t| t.with_timezone(&Local).format("%Y-%m-%d").to_string())
            })
            .unwrap_or_else(|| Local::now().format("%Y-%m-%d").to_string());
        daily.entry((day, model)).or_default().add_assign(&usage);
    }

    Ok((
        daily
            .into_iter()
            .map(|((day, model), usage)| DailyUsage { day, model, usage })
            .collect(),
        warnings,
    ))
}

fn parse_sqlite_timestamp(row: &rusqlite::Row, idx: usize) -> Option<i64> {
    if let Ok(num) = row.get::<_, i64>(idx) {
        return Some(if num > 100_000_000_000 { num / 1000 } else { num });
    }
    if let Ok(s) = row.get::<_, String>(idx) {
        if let Ok(parsed) = DateTime::parse_from_rfc3339(&s) {
            return Some(parsed.timestamp());
        }
        if let Ok(num) = s.parse::<i64>() {
            return Some(if num > 100_000_000_000 { num / 1000 } else { num });
        }
    }
    None
}

fn parse_agy_proto_step(data: &[u8]) -> Option<(i64, String, TokenUsage)> {
    let mut offset = 0;
    let mut timestamp_sec: Option<i64> = None;
    let mut usage_metadata: Option<&[u8]> = None;

    while offset < data.len() {
        let tag_wire = read_varint(data, &mut offset)?;
        let tag = tag_wire >> 3;
        let wire = (tag_wire & 7) as u8;

        if wire == 2 {
            let len = read_varint(data, &mut offset)? as usize;
            if offset + len > data.len() {
                return None;
            }
            let sub = &data[offset..offset + len];
            offset += len;

            if tag == 9 {
                usage_metadata = Some(sub);
            } else if (tag == 1 || tag == 6) && timestamp_sec.is_none() {
                let mut sub_offset = 0;
                while sub_offset < sub.len() {
                    if let Some(sub_tw) = read_varint(sub, &mut sub_offset) {
                        let sub_tag = sub_tw >> 3;
                        let sub_wire = (sub_tw & 7) as u8;
                        if sub_tag == 1 && sub_wire == 0 {
                            if let Some(val) = read_varint(sub, &mut sub_offset) {
                                timestamp_sec = Some(val as i64);
                                break;
                            }
                        } else if !skip_wire_field(sub_wire, sub, &mut sub_offset) {
                            break;
                        }
                    } else {
                        break;
                    }
                }
            }
        } else if !skip_wire_field(wire, data, &mut offset) {
            return None;
        }
    }

    let usage_slice = usage_metadata?;
    let mut sub_offset = 0;
    let mut model_id = 0u64;
    let mut input_tokens = 0u64;
    let mut output_tokens = 0u64;
    let mut cache_read = 0u64;

    while sub_offset < usage_slice.len() {
        let sub_tw = read_varint(usage_slice, &mut sub_offset)?;
        let sub_tag = sub_tw >> 3;
        let sub_wire = (sub_tw & 7) as u8;
        if sub_wire == 0 {
            let val = read_varint(usage_slice, &mut sub_offset)?;
            match sub_tag {
                1 => model_id = val,
                2 => input_tokens = val,
                3 => output_tokens = val,
                5 => cache_read = val,
                _ => {}
            }
        } else if !skip_wire_field(sub_wire, usage_slice, &mut sub_offset) {
            break;
        }
    }

    if input_tokens == 0 && output_tokens == 0 && cache_read == 0 {
        return None;
    }

    let model = agy_model_name(model_id);
    let stamp = timestamp_sec.unwrap_or_else(|| Utc::now().timestamp());
    Some((
        stamp,
        model,
        TokenUsage {
            input_tokens,
            output_tokens,
            cache_read_tokens: cache_read,
            cache_write_tokens: 0,
            cache_available: true,
        },
    ))
}

fn read_varint(data: &[u8], offset: &mut usize) -> Option<u64> {
    let mut result = 0u64;
    let mut shift = 0;
    while *offset < data.len() {
        let byte = data[*offset];
        *offset += 1;
        result |= ((byte & 0x7f) as u64) << shift;
        if (byte & 0x80) == 0 {
            return Some(result);
        }
        shift += 7;
        if shift >= 64 {
            return None;
        }
    }
    None
}

fn skip_wire_field(wire_type: u8, data: &[u8], offset: &mut usize) -> bool {
    match wire_type {
        0 => read_varint(data, offset).is_some(),
        1 => {
            if *offset + 8 <= data.len() {
                *offset += 8;
                true
            } else {
                false
            }
        }
        2 => {
            if let Some(len) = read_varint(data, offset) {
                let len = len as usize;
                if *offset + len <= data.len() {
                    *offset += len;
                    true
                } else {
                    false
                }
            } else {
                false
            }
        }
        5 => {
            if *offset + 4 <= data.len() {
                *offset += 4;
                true
            } else {
                false
            }
        }
        _ => false,
    }
}

fn agy_model_name(model_id: u64) -> String {
    match model_id {
        1318 => "gemini-3.8-flash".into(),
        1016 => "gemini-3.5-flash".into(),
        1026 => "claude-opus-4-6".into(),
        1050 => "gemini-3.1-pro".into(),
        0 => "gemini".into(),
        other => format!("model-{}", other),
    }
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

    #[test]
    fn parses_zcode_and_agy_jsonl() {
        let zcode = r#"{"timestamp":"2026-09-02T01:00:00Z","model":"GLM-5.3","usage":{"input_tokens":50,"output_tokens":20,"cache_read_input_tokens":30,"cache_creation_input_tokens":10}}"#;
        let (z_rows, z_warn) = parse(AgentKind::Zcode, zcode);
        assert_eq!(z_warn, 0);
        assert_eq!(z_rows.len(), 1);
        assert_eq!(z_rows[0].model, "GLM-5.3");
        assert_eq!(z_rows[0].usage.input_tokens, 90);
        assert_eq!(z_rows[0].usage.output_tokens, 20);
        assert_eq!(z_rows[0].usage.cache_read_tokens, 30);
        assert_eq!(z_rows[0].usage.cache_write_tokens, 10);

        let agy = r#"{"created_at":"2026-09-02T01:00:00Z","model":"gemini-3.8-flash","usage":{"prompt_token_count":100,"candidates_token_count":40,"cached_content_token_count":60}}"#;
        let (a_rows, a_warn) = parse(AgentKind::Agy, agy);
        assert_eq!(a_warn, 0);
        assert_eq!(a_rows.len(), 1);
        assert_eq!(a_rows[0].model, "gemini-3.8-flash");
        assert_eq!(a_rows[0].usage.input_tokens, 100);
        assert_eq!(a_rows[0].usage.output_tokens, 40);
        assert_eq!(a_rows[0].usage.cache_read_tokens, 60);
    }

    #[test]
    fn parses_zcode_sqlite_database() {
        let temp_dir = std::env::temp_dir().join(format!(
            "digiworld-zcode-test-{}",
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let db_path = temp_dir.join("db.sqlite");
        {
            let conn = rusqlite::Connection::open(&db_path).unwrap();
            conn.execute(
                "CREATE TABLE model_usage (
                    id TEXT PRIMARY KEY,
                    started_at INTEGER,
                    model_id TEXT,
                    input_tokens INTEGER,
                    output_tokens INTEGER,
                    cache_read_input_tokens INTEGER,
                    cache_creation_input_tokens INTEGER
                )",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO model_usage VALUES ('1', 1788422828000, 'GLM-5.3', 100, 25, 40, 10)",
                [],
            )
            .unwrap();
        }

        let (rows, warnings) = parse_sqlite(AgentKind::Zcode, &db_path).unwrap();
        assert_eq!(warnings, 0);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].model, "GLM-5.3");
        assert_eq!(rows[0].usage.input_tokens, 150);
        assert_eq!(rows[0].usage.output_tokens, 25);
        assert_eq!(rows[0].usage.cache_read_tokens, 40);
        assert_eq!(rows[0].usage.cache_write_tokens, 10);
        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn parses_agy_sqlite_database_with_proto_metadata() {
        let temp_dir = std::env::temp_dir().join(format!(
            "digiworld-agy-test-{}",
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let db_path = temp_dir.join("conv.db");
        {
            let conn = rusqlite::Connection::open(&db_path).unwrap();
            conn.execute(
                "CREATE TABLE steps (idx INTEGER PRIMARY KEY, metadata BLOB)",
                [],
            )
            .unwrap();

            // Craft synthetic protobuf metadata:
            // field 6 (time submessage): tag 6 (0x32), len 2: tag 1 (0x08), varint seconds 1788422828
            // 1788422828 in varint: 0xac, 0x86, 0xeb, 0x54 (4 bytes) -> tag 1 len 4
            // Let's encode varint for 1788422828:
            let mut time_sub = Vec::new();
            time_sub.push(0x08); // tag 1 wire 0
            let mut sec = 1788422828u64;
            while sec >= 0x80 {
                time_sub.push((sec as u8 & 0x7f) | 0x80);
                sec >>= 7;
            }
            time_sub.push(sec as u8);

            // field 9 (UsageMetadata submessage):
            // tag 1 (model_id 1318): 0x08, varint 1318 (0xa6, 0x0a)
            // tag 2 (input 200): 0x10, varint 200 (0xc8, 0x01)
            // tag 3 (output 50): 0x18, varint 50 (0x32)
            // tag 5 (cache 80): 0x28, varint 80 (0x50)
            let mut usage_sub = Vec::new();
            usage_sub.extend_from_slice(&[0x08, 0xa6, 0x0a]); // tag 1: 1318
            usage_sub.extend_from_slice(&[0x10, 0xc8, 0x01]); // tag 2: 200
            usage_sub.extend_from_slice(&[0x18, 0x32]);       // tag 3: 50
            usage_sub.extend_from_slice(&[0x28, 0x50]);       // tag 5: 80

            let mut metadata = Vec::new();
            metadata.push(0x32); // tag 6 (6 << 3 | 2)
            metadata.push(time_sub.len() as u8);
            metadata.extend_from_slice(&time_sub);

            metadata.push(0x4a); // tag 9 (9 << 3 | 2)
            metadata.push(usage_sub.len() as u8);
            metadata.extend_from_slice(&usage_sub);

            conn.execute(
                "INSERT INTO steps VALUES (1, ?1)",
                [&metadata],
            )
            .unwrap();
        }

        let (rows, warnings) = parse_sqlite(AgentKind::Agy, &db_path).unwrap();
        assert_eq!(warnings, 0);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].model, "gemini-3.8-flash");
        assert_eq!(rows[0].usage.input_tokens, 200);
        assert_eq!(rows[0].usage.output_tokens, 50);
        assert_eq!(rows[0].usage.cache_read_tokens, 80);
        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
