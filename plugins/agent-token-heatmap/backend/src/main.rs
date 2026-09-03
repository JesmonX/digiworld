mod database;
mod engine;
mod model;
mod parsers;
mod quota;
mod remote;
mod scanner;

use anyhow::{Context, Result, bail};
use engine::UsageEngine;
use model::{SnapshotRequest, UsageSettings};
use serde::Deserialize;
use serde_json::{Value, json};
use std::io::{BufRead, Write};
use std::path::PathBuf;

#[derive(Deserialize)]
struct RpcRequest {
    id: Value,
    method: String,
    #[serde(default)]
    params: Value,
}

fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_ansi(false)
        .init();
    let data_dir = parse_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    let engine = UsageEngine::open(&data_dir.join("agent-tokens.db"))?;
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let line = line?;
        if line.len() > 4 * 1024 * 1024 {
            write_error(&mut stdout, Value::Null, -32600, "request exceeds 4 MiB")?;
            continue;
        }
        let request: RpcRequest = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(error) => {
                write_error(&mut stdout, Value::Null, -32700, &error.to_string())?;
                continue;
            }
        };
        let shutdown = request.method == "shutdown";
        match handle(&engine, &request.method, request.params) {
            Ok(result) => write_json(
                &mut stdout,
                &json!({ "jsonrpc": "2.0", "id": request.id, "result": result }),
            )?,
            Err(error) => write_error(&mut stdout, request.id, -32000, &error.to_string())?,
        }
        if shutdown {
            break;
        }
    }
    Ok(())
}

fn handle(engine: &UsageEngine, method: &str, params: Value) -> Result<Value> {
    match method {
        "health" => Ok(json!({ "status": "ok", "protocolVersion": 1 })),
        "shutdown" => Ok(json!({ "stopped": true })),
        "usage.getSettings" => Ok(serde_json::to_value(engine.settings()?)?),
        "usage.saveSettings" => {
            let settings: UsageSettings =
                serde_json::from_value(params.get("settings").cloned().unwrap_or(params))
                    .context("invalid usage settings")?;
            Ok(serde_json::to_value(engine.save_settings(settings)?)?)
        }
        "usage.startRefresh" => {
            let source = params.get("sourceId").and_then(Value::as_str);
            Ok(serde_json::to_value(engine.start_refresh(source)?)?)
        }
        "usage.testSsh" => {
            let source = serde_json::from_value(params.get("source").cloned().unwrap_or(params))
                .context("invalid SSH source")?;
            Ok(serde_json::to_value(engine.test_ssh(source)?)?)
        }
        "usage.refreshStatus" => Ok(serde_json::to_value(engine.refresh_status())?),
        "usage.getCodexQuota" => {
            let force = params
                .get("force")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            Ok(serde_json::to_value(engine.codex_quota(force)?)?)
        }
        "usage.testCodexQuota" => {
            let settings: UsageSettings =
                serde_json::from_value(params.get("settings").cloned().unwrap_or(params))
                    .context("invalid usage settings")?;
            Ok(serde_json::to_value(engine.test_codex_quota(settings)?)?)
        }
        "usage.snapshot" => {
            let request: SnapshotRequest =
                serde_json::from_value(params).context("invalid snapshot request")?;
            Ok(serde_json::to_value(engine.snapshot(request)?)?)
        }
        _ => bail!("unknown method: {method}"),
    }
}

fn parse_data_dir() -> Result<PathBuf> {
    let mut arguments = std::env::args_os().skip(1);
    while let Some(argument) = arguments.next() {
        if argument == "--data-dir" {
            return arguments
                .next()
                .map(PathBuf::from)
                .context("--data-dir requires a path");
        }
    }
    bail!("--data-dir is required")
}

fn write_json(writer: &mut impl Write, value: &Value) -> Result<()> {
    serde_json::to_writer(&mut *writer, value)?;
    writer.write_all(b"\n")?;
    writer.flush()?;
    Ok(())
}

fn write_error(writer: &mut impl Write, id: Value, code: i32, message: &str) -> Result<()> {
    write_json(
        writer,
        &json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }),
    )
}
