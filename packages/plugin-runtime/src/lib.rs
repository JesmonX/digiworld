//! Bounded background work for synchronous plugin backends. Business models stay in plugins.
use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    io::{BufRead, Write},
    path::Path,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    // All mutation handlers for a plugin run on one worker at a time.
    let tmp = path.with_extension("json.tmp");
    let mut file = std::fs::File::create(&tmp)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
#[derive(Clone)]
struct Job {
    key: Value,
    value: Value,
}
/// Short RPCs remain compatible. Long operations are started explicitly and never replayed.
pub fn serve<A: Send + Sync + 'static>(
    app: A,
    handle: fn(&A, &str, Value) -> Result<Value>,
    allowed: &'static [&'static str],
) -> Result<()> {
    let app = Arc::new(app);
    let jobs = Arc::new(Mutex::new(BTreeMap::<String, Job>::new()));
    let mutation = Arc::new(Mutex::new(()));
    let mut sequence = 0u64;
    for line in std::io::stdin().lock().lines() {
        let value: Value = match serde_json::from_str(&line?) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("invalid RPC: {e}");
                continue;
            }
        };
        let method = value["method"].as_str().unwrap_or("");
        let params = value.get("params").cloned().unwrap_or(Value::Null);
        let result: Result<Value> = (|| match method {
            "job.status" => {
                let id = params["id"].as_str().context("缺少任务 ID")?;
                Ok(jobs
                    .lock()
                    .unwrap()
                    .get(id)
                    .context("任务不存在，请重新读取状态")?
                    .value
                    .clone())
            }
            "job.start" => {
                let task = params["method"]
                    .as_str()
                    .context("缺少任务方法")?
                    .to_string();
                if !allowed.contains(&task.as_str()) {
                    bail!("不支持的后台操作")
                }
                let mut all = jobs.lock().unwrap();
                if let Some(job) = all.values().find(|job| job.value["state"] == "running") {
                    if job.key == params {
                        return Ok(job.value.clone());
                    }
                    bail!("已有操作进行中，请稍后重试")
                }
                sequence += 1;
                let id = sequence.to_string();
                let state = json!({"id":id,"state":"running","stage":task,"completed":0,"total":1,"startedAt":now(),"finishedAt":null});
                if all.len() >= 32 {
                    let oldest = all
                        .keys()
                        .min_by_key(|id| id.parse::<u64>().unwrap_or(0))
                        .cloned();
                    if let Some(id) = oldest {
                        all.remove(&id);
                    }
                }
                all.insert(
                    id.clone(),
                    Job {
                        key: params.clone(),
                        value: state.clone(),
                    },
                );
                drop(all);
                let jobs = jobs.clone();
                let app = app.clone();
                let mutation = mutation.clone();
                std::thread::spawn(move || {
                    let _guard = mutation.lock().unwrap();
                    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        handle(
                            &app,
                            &task,
                            params.get("payload").cloned().unwrap_or(Value::Null),
                        )
                    }));
                    let mut all = jobs.lock().unwrap();
                    if let Some(job) = all.get_mut(&id) {
                        job.value["finishedAt"] = json!(now());
                        job.value["completed"] = json!(1);
                        match result {
                            Ok(Ok(value)) => {
                                job.value["state"] = json!("completed");
                                job.value["result"] = value;
                            }
                            Ok(Err(error)) => {
                                job.value["state"] = json!("failed");
                                job.value["error"] = json!(error.to_string());
                            }
                            Err(_) => {
                                job.value["state"] = json!("failed");
                                job.value["error"] = json!("后台任务异常结束");
                            }
                        }
                    }
                });
                Ok(state)
            }
            "health" => Ok(json!({"status":"ok","protocolVersion":1})),
            "shutdown" => Ok(json!({"stopped":true})),
            _ => {
                let _guard = mutation
                    .try_lock()
                    .map_err(|_| anyhow::anyhow!("已有操作进行中，请稍后重试"))?;
                handle(&app, method, params)
            }
        })();
        let out = match result {
            Ok(result) => json!({"jsonrpc":"2.0","id":value["id"],"result":result}),
            Err(error) => {
                json!({"jsonrpc":"2.0","id":value["id"],"error":{"code":-32000,"message":error.to_string(),"data":{"code":"operation_failed","retryable":false}}})
            }
        };
        let mut stdout = std::io::stdout().lock();
        serde_json::to_writer(&mut stdout, &out)?;
        stdout.write_all(b"\n")?;
        stdout.flush()?;
        if method == "shutdown" {
            break;
        }
    }
    Ok(())
}

/// Drain bounded output concurrently and enforce a wall-clock deadline (SSH connect timeout alone is insufficient).
pub fn command_output(
    command: &mut std::process::Command,
    seconds: u64,
) -> Result<std::process::Output> {
    use std::io::Read;
    use std::process::Stdio;
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let out = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout
            .take(4 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    let err = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stderr
            .take(1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    let started = std::time::Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if started.elapsed().as_secs() >= seconds {
            let _ = child.kill();
            let _ = child.wait();
            bail!("远端操作超时，请检查实际状态后重试");
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    };
    let stdout = out
        .join()
        .map_err(|_| anyhow::anyhow!("读取远端输出失败"))??;
    let stderr = err
        .join()
        .map_err(|_| anyhow::anyhow!("读取远端错误失败"))??;
    if stdout.len() > 4 * 1024 * 1024 || stderr.len() > 1024 * 1024 {
        bail!("远端输出超过大小限制");
    }
    Ok(std::process::Output {
        status,
        stdout,
        stderr,
    })
}
