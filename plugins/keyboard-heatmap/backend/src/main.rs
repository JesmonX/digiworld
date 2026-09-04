mod capture;
mod database;
mod engine;
mod keymap;

use anyhow::{Context, Result, bail};
use capture::CaptureHandle;
use engine::StatsEngine;
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
    let engine = StatsEngine::open(&data_dir.join("heatmap.db"))?;
    let capture = CaptureHandle::start(engine.clone())?;
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
    capture.stop();
    engine.shutdown()?;
    Ok(())
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

fn handle(engine: &StatsEngine, method: &str, params: Value) -> Result<Value> {
    match method {
        "health" => Ok(json!({ "status": "ok", "protocolVersion": 1 })),
        "shutdown" => Ok(json!({ "stopped": true })),
        "heatmap.snapshot" => {
            let scope = params
                .get("scope")
                .and_then(Value::as_str)
                .unwrap_or("today");
            Ok(serde_json::to_value(engine.snapshot(scope)?)?)
        }
        "heatmap.setPaused" => {
            let paused = params
                .get("paused")
                .and_then(Value::as_bool)
                .context("paused must be a boolean")?;
            engine.set_paused(paused)?;
            Ok(json!({ "paused": paused }))
        }
        "heatmap.privacyStatus" => Ok(json!({ "accepted": engine.privacy_accepted()? })),
        "heatmap.acceptPrivacy" => {
            engine.accept_privacy()?;
            Ok(json!({ "accepted": true }))
        }
        "heatmap.getLayout" => Ok(json!({ "layout": engine.layout()? })),
        "heatmap.setLayout" => {
            let layout = params
                .get("layout")
                .and_then(Value::as_str)
                .context("layout must be a string")?;
            engine.set_layout(layout)?;
            Ok(json!({ "layout": layout }))
        }
        "heatmap.clear" => {
            let scope = params
                .get("scope")
                .and_then(Value::as_str)
                .unwrap_or("today");
            engine.clear(scope)?;
            Ok(json!({ "cleared": scope }))
        }
        "heatmap.export" => {
            let format = params
                .get("format")
                .and_then(Value::as_str)
                .unwrap_or("json");
            let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
            match format {
                "json" => Ok(
                    json!({ "content": engine.json_backup()?, "filename": format!("digiworld-heatmap-{stamp}.json"), "mime": "application/json" }),
                ),
                "csv" => Ok(
                    json!({ "content": engine.csv()?, "filename": format!("digiworld-heatmap-{stamp}.csv"), "mime": "text/csv" }),
                ),
                _ => bail!("unsupported export format"),
            }
        }
        "heatmap.import" => {
            let content = params
                .get("content")
                .and_then(Value::as_str)
                .context("content must be a string")?;
            if content.len() > 32 * 1024 * 1024 {
                bail!("backup exceeds 32 MiB");
            }
            let mode = params
                .get("mode")
                .and_then(Value::as_str)
                .unwrap_or("merge");
            if mode == "replace" {
                let backup_dir = std::env::temp_dir().join("digiworld-heatmap-backups");
                std::fs::create_dir_all(&backup_dir)?;
                std::fs::write(
                    backup_dir.join(format!(
                        "before-import-{}.json",
                        chrono::Utc::now().format("%Y%m%d-%H%M%S")
                    )),
                    engine.json_backup()?,
                )?;
            }
            engine.import(content, mode)?;
            Ok(json!({ "imported": true, "mode": mode }))
        }
        _ => bail!("unknown method: {method}"),
    }
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
