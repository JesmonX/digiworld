mod credentials;
mod database;
mod engine;
mod model;
mod parser;
mod transport;

use anyhow::{Context, Result, bail};
use engine::MailEngine;
use model::{AccountInput, Settings};
use serde::Deserialize;
use serde_json::{Value, json};
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

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
    let stdout = Arc::new(Mutex::new(std::io::stdout()));
    let event_stdout = stdout.clone();
    let notify = Arc::new(move |title: String, body: String| {
        let event = json!({
            "jsonrpc": "2.0",
            "method": "host.notification",
            "params": { "title": title, "body": body }
        });
        if let Ok(mut writer) = event_stdout.lock() {
            let _ = write_json(&mut *writer, &event);
        }
    });
    let engine = MailEngine::open(&data_dir.join("mail.db"), notify)?;
    for line in std::io::stdin().lock().lines() {
        let line = line?;
        if line.len() > 4 * 1024 * 1024 {
            write_error(&stdout, Value::Null, -32600, "request exceeds 4 MiB")?;
            continue;
        }
        let request: RpcRequest = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(error) => {
                write_error(&stdout, Value::Null, -32700, &error.to_string())?;
                continue;
            }
        };
        let shutdown = request.method == "shutdown";
        match handle(&engine, &request.method, request.params) {
            Ok(result) => write_response(
                &stdout,
                &json!({
                    "jsonrpc": "2.0", "id": request.id, "result": result
                }),
            )?,
            Err(error) => write_error(&stdout, request.id, -32000, &error.to_string())?,
        }
        if shutdown {
            engine.shutdown();
            break;
        }
    }
    Ok(())
}

fn handle(engine: &Arc<MailEngine>, method: &str, params: Value) -> Result<Value> {
    match method {
        "health" => Ok(json!({ "status": "ok", "protocolVersion": 1 })),
        "shutdown" => Ok(json!({ "stopped": true })),
        "mail.accounts.list" => Ok(serde_json::to_value(engine.accounts()?)?),
        "mail.accounts.test" => {
            let input: AccountInput =
                serde_json::from_value(params.get("account").cloned().unwrap_or(params))
                    .context("账号设置无效")?;
            engine.test_account(input)
        }
        "mail.accounts.save" => {
            let input: AccountInput =
                serde_json::from_value(params.get("account").cloned().unwrap_or(params))
                    .context("账号设置无效")?;
            Ok(serde_json::to_value(engine.save_account(input)?)?)
        }
        "mail.accounts.remove" => {
            let id = params
                .get("id")
                .and_then(Value::as_str)
                .context("缺少账号 ID")?;
            engine.remove_account(id)?;
            Ok(json!({ "removed": true }))
        }
        "mail.settings.get" => Ok(serde_json::to_value(engine.settings()?)?),
        "mail.settings.save" => {
            let settings: Settings =
                serde_json::from_value(params.get("settings").cloned().unwrap_or(params))
                    .context("同步设置无效")?;
            Ok(serde_json::to_value(engine.save_settings(settings)?)?)
        }
        "mail.sync.start" => {
            let account = params.get("accountId").and_then(Value::as_str);
            Ok(json!({ "startedAccountIds": engine.start_sync(account) }))
        }
        "mail.sync.status" => Ok(serde_json::to_value(engine.status()?)?),
        "mail.messages.list" => {
            let account = params.get("accountId").and_then(Value::as_str);
            let query = params.get("query").and_then(Value::as_str).unwrap_or("");
            let cursor = params.get("cursor").and_then(Value::as_i64).unwrap_or(0);
            Ok(serde_json::to_value(
                engine.list_messages(account, query, cursor)?,
            )?)
        }
        "mail.messages.get" => {
            let id = params
                .get("id")
                .and_then(Value::as_i64)
                .context("缺少邮件 ID")?;
            Ok(serde_json::to_value(engine.message(id)?)?)
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

fn write_response(stdout: &Arc<Mutex<std::io::Stdout>>, value: &Value) -> Result<()> {
    let mut writer = stdout.lock().expect("stdout lock poisoned");
    write_json(&mut *writer, value)
}

fn write_json(writer: &mut impl Write, value: &Value) -> Result<()> {
    serde_json::to_writer(&mut *writer, value)?;
    writer.write_all(b"\n")?;
    writer.flush()?;
    Ok(())
}

fn write_error(
    stdout: &Arc<Mutex<std::io::Stdout>>,
    id: Value,
    code: i32,
    message: &str,
) -> Result<()> {
    write_response(
        stdout,
        &json!({
            "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message }
        }),
    )
}
