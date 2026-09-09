use anyhow::{Context, Result, bail};
use chrono::{NaiveDate, Utc};
use rusqlite::{Connection, params};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    io::{BufRead, Write},
    path::PathBuf,
};

#[derive(Deserialize)]
struct Request {
    id: Value,
    method: String,
    #[serde(default)]
    params: Value,
}

fn handle(db: &Connection, method: &str, p: Value) -> Result<Value> {
    match method {
        "health" => Ok(json!({"status":"ok","protocolVersion":1})),
        "shutdown" => Ok(json!({"stopped":true})),
        "markpad.list" => {
            let mut stmt = db.prepare("SELECT id, day, content, created_at, updated_at FROM notes ORDER BY day DESC, created_at DESC, id DESC")?;
            let notes = stmt.query_map([], |r| Ok(json!({"id":r.get::<_,String>(0)?, "day":r.get::<_,String>(1)?, "content":r.get::<_,String>(2)?, "createdAt":r.get::<_,String>(3)?, "updatedAt":r.get::<_,String>(4)?})))?.collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(json!(notes))
        }
        "markpad.save" => {
            let id = p["id"].as_str().context("Missing note ID")?;
            let day = p["day"].as_str().context("Missing date")?;
            let content = p["content"].as_str().context("Missing content")?;
            if id.is_empty() || id.len() > 100 {
                bail!("Invalid note ID")
            }
            if NaiveDate::parse_from_str(day, "%Y-%m-%d")?
                .format("%Y-%m-%d")
                .to_string()
                != day
            {
                bail!("Invalid date")
            }
            if content.len() > 200_000 {
                bail!("Content exceeds 200000 bytes")
            }
            let now = Utc::now().to_rfc3339();
            db.execute("INSERT INTO notes(id,day,content,created_at,updated_at) VALUES (?1,?2,?3,?4,?4) ON CONFLICT(id) DO UPDATE SET content=excluded.content, updated_at=excluded.updated_at", params![id,day,content,now])?;
            Ok(json!({"updatedAt":now}))
        }
        "markpad.delete" => {
            db.execute(
                "DELETE FROM notes WHERE id=?1",
                [p["id"].as_str().context("Missing note ID")?],
            )?;
            Ok(json!({"deleted":true}))
        }
        _ => bail!("Unknown method: {method}"),
    }
}
fn main() -> Result<()> {
    let mut args = std::env::args_os().skip(1);
    let mut dir = None;
    while let Some(arg) = args.next() {
        if arg == "--data-dir" {
            dir = args.next().map(PathBuf::from);
        }
    }
    let dir = dir.context("--data-dir is required")?;
    std::fs::create_dir_all(&dir)?;
    let db = Connection::open(dir.join("markpad.sqlite3"))?;
    db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY, day TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS notes_day ON notes(day);")?;
    for line in std::io::stdin().lock().lines() {
        let request: Request = match serde_json::from_str(&line?) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("Invalid request: {e}");
                continue;
            }
        };
        let result = match handle(&db, &request.method, request.params) {
            Ok(value) => json!({"jsonrpc":"2.0","id":request.id,"result":value}),
            Err(e) => {
                json!({"jsonrpc":"2.0","id":request.id,"error":{"code":-32000,"message":e.to_string()}})
            }
        };
        let mut out = std::io::stdout().lock();
        serde_json::to_writer(&mut out, &result)?;
        out.write_all(b"\n")?;
        out.flush()?;
        if request.method == "shutdown" {
            break;
        }
    }
    Ok(())
}
