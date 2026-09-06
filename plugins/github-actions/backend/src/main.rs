use anyhow::{Context, Result, bail};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{fs, path::PathBuf, time::Duration};

const SERVICE: &str = "io.github.jesmonx.digiworld.github-actions";

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    repositories: Vec<String>,
    #[serde(default = "default_poll")]
    poll_seconds: u64,
    #[serde(default)]
    all_actors: bool,
}
fn default_poll() -> u64 {
    30
}

struct App {
    dir: PathBuf,
    client: Client,
    token_override: Option<String>,
}
impl App {
    fn token(&self) -> Result<String> {
        if let Some(token) = &self.token_override {
            return Ok(token.clone());
        }
        keyring::Entry::new(SERVICE, "github-token")?
            .get_password()
            .context("尚未保存 GitHub Token")
    }
    fn settings(&self) -> Result<Settings> {
        let p = self.dir.join("settings.json");
        if !p.exists() {
            return Ok(Settings {
                repositories: vec![],
                poll_seconds: 30,
                all_actors: false,
            });
        }
        Ok(serde_json::from_slice(&fs::read(p)?)?)
    }
    fn save_settings(&self, s: &Settings) -> Result<()> {
        if !(15..=300).contains(&s.poll_seconds) {
            bail!("刷新间隔应为 15–300 秒")
        };
        for r in &s.repositories {
            valid_repo(r)?;
        }
        digiworld_plugin_runtime::atomic_write(
            &self.dir.join("settings.json"),
            &serde_json::to_vec_pretty(s)?,
        )?;
        Ok(())
    }
    fn get(&self, path: &str) -> Result<Value> {
        let response = self
            .client
            .get(format!("https://api.github.com{path}"))
            .bearer_auth(self.token()?)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .send()
            .context("连接 GitHub 失败")?;
        let status = response.status();
        let remaining = response
            .headers()
            .get("x-ratelimit-remaining")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("?")
            .to_string();
        let value: Value = response.json().context("GitHub 返回了无效响应")?;
        if !status.is_success() {
            bail!(
                "GitHub API {status}：{}",
                value
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("请求失败")
            )
        }
        Ok(json!({"value":value,"remaining":remaining}))
    }
    fn identity(&self) -> Result<Value> {
        let data = self.get("/user")?;
        let u = &data["value"];
        Ok(
            json!({"login":u["login"],"avatarUrl":u["avatar_url"],"rateLimitRemaining":data["remaining"]}),
        )
    }
    fn repositories(&self, page: u64) -> Result<Value> {
        let data=self.get(&format!("/user/repos?affiliation=owner,collaborator,organization_member&sort=updated&per_page=100&page={}",page.clamp(1,1000)))?;
        let items=data["value"].as_array().cloned().unwrap_or_default().into_iter().map(|r|json!({"fullName":r["full_name"],"private":r["private"],"updatedAt":r["updated_at"]})).collect::<Vec<_>>();
        Ok(
            json!({"nextPage":if items.len()==100 {Some(page+1)} else {None},"items":items,"rateLimitRemaining":data["remaining"]}),
        )
    }
    fn runs(&self) -> Result<Value> {
        let login = self.identity()?["login"].as_str().unwrap_or("").to_string();
        let settings = self.settings()?;
        let mut runs = Vec::new();
        let mut warnings = Vec::new();
        for repo in settings.repositories {
            valid_repo(&repo)?;
            let actor = if settings.all_actors {
                String::new()
            } else {
                format!("&actor={login}")
            };
            let data = match self.get(&format!("/repos/{repo}/actions/runs?per_page=30{actor}")) {
                Ok(data) => data,
                Err(error) => {
                    warnings.push(json!({"repository":repo,"message":error.to_string()}));
                    continue;
                }
            };
            for run in data["value"]["workflow_runs"]
                .as_array()
                .cloned()
                .unwrap_or_default()
            {
                let actor = run["actor"]["login"].as_str().unwrap_or("");
                let triggering = run["triggering_actor"]["login"].as_str().unwrap_or(actor);
                if !settings.all_actors && actor != login && triggering != login {
                    continue;
                }
                let id = run["id"].as_u64().unwrap_or(0);
                let jobs = if run["status"].as_str() == Some("completed") {
                    json!({"value":{"jobs":[]}})
                } else {
                    self.get(&format!(
                        "/repos/{repo}/actions/runs/{id}/jobs?per_page=100"
                    ))
                    .unwrap_or_else(|error| {
                        warnings.push(json!({"repository":repo,"message":error.to_string()}));
                        json!({"value":{"jobs":[]}})
                    })
                };
                runs.push(json!({"id":id,"repository":repo,"name":run["name"],"title":run["display_title"],"branch":run["head_branch"],"sha":run["head_sha"],"status":run["status"],"conclusion":run["conclusion"],"event":run["event"],"attempt":run["run_attempt"],"createdAt":run["created_at"],"startedAt":run["run_started_at"],"updatedAt":run["updated_at"],"url":run["html_url"],"jobs":jobs["value"]["jobs"]}));
            }
        }
        runs.sort_by(|a, b| b["createdAt"].as_str().cmp(&a["createdAt"].as_str()));
        let cached: Value = std::fs::read(self.dir.join("runs.json"))
            .ok()
            .and_then(|v| serde_json::from_slice(&v).ok())
            .unwrap_or(Value::Null);
        for warning in &warnings {
            if let Some(old) = cached["runs"].as_array() {
                for run in old
                    .iter()
                    .filter(|r| r["repository"] == warning["repository"])
                {
                    if !runs.iter().any(|r| r["id"] == run["id"]) {
                        let mut stale = run.clone();
                        stale["stale"] = json!(true);
                        runs.push(stale);
                    }
                }
            }
        }
        let result =
            json!({"login":login,"updatedAt":chrono_like_now(),"runs":runs,"warnings":warnings});
        digiworld_plugin_runtime::atomic_write(
            &self.dir.join("runs.json"),
            &serde_json::to_vec(&result)?,
        )?;
        Ok(result)
    }
}
fn valid_repo(v: &str) -> Result<()> {
    let mut p = v.split('/');
    let good = |s: &str| {
        !s.is_empty()
            && s.len() <= 100
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
    };
    if !good(p.next().unwrap_or("")) || !good(p.next().unwrap_or("")) || p.next().is_some() {
        bail!("仓库必须使用 owner/repo 格式")
    }
    Ok(())
}
fn chrono_like_now() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string()
}
fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_ansi(false)
        .init();
    let dir = data_dir()?;
    fs::create_dir_all(&dir)?;
    let app = App {
        dir,
        token_override: None,
        client: Client::builder()
            .timeout(Duration::from_secs(12))
            .user_agent("Digiworld-Git-Actions/0.1")
            .build()?,
    };
    digiworld_plugin_runtime::serve(
        app,
        handle,
        &[
            "git.auth.status",
            "git.auth.save",
            "git.repositories.list",
            "git.runs.snapshot",
            "git.jobs.get",
        ],
    )
}

fn handle(a: &App, m: &str, p: Value) -> Result<Value> {
    match m {
        "health" => Ok(json!({"status":"ok","protocolVersion":1})),
        "shutdown" => Ok(json!({"stopped":true})),
        "git.auth.status" => {
            if a.token().is_err() {
                return Ok(json!({"connected":false,"state":"unconfigured"}));
            }
            Ok(match a.identity() {
                Ok(v) => json!({"connected":true,"state":"ready","account":v}),
                Err(error) => {
                    json!({"connected":true,"state":"unavailable","error":error.to_string(),"account":std::fs::read(a.dir.join("account.json")).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok())})
                }
            })
        }
        "git.auth.save" => {
            let t = p["token"].as_str().context("缺少 Token")?.trim();
            if t.len() < 20 {
                bail!("Token 无效")
            }
            let candidate = App {
                dir: a.dir.clone(),
                client: a.client.clone(),
                token_override: Some(t.into()),
            };
            let identity = candidate.identity()?;
            let entry = keyring::Entry::new(SERVICE, "github-token")?;
            let old = entry.get_password().ok();
            entry.set_password(t)?;
            if let Err(error) = digiworld_plugin_runtime::atomic_write(
                &a.dir.join("account.json"),
                &serde_json::to_vec(&identity)?,
            ) {
                if let Some(old) = old {
                    entry.set_password(&old)?;
                } else {
                    let _ = entry.delete_credential();
                }
                return Err(error);
            }
            Ok(identity)
        }
        "git.auth.remove" => {
            let _ = keyring::Entry::new(SERVICE, "github-token")?.delete_credential();
            Ok(json!({"removed":true}))
        }
        "git.repositories.list" => a.repositories(p["page"].as_u64().unwrap_or(1)),
        "git.runs.cached" => Ok(std::fs::read(a.dir.join("runs.json"))
            .ok()
            .and_then(|v| serde_json::from_slice::<Value>(&v).ok())
            .unwrap_or(json!({"runs":[]}))),
        "git.jobs.get" => {
            let repo = p["repository"].as_str().context("缺少仓库")?;
            valid_repo(repo)?;
            let id = p["id"].as_u64().context("缺少运行 ID")?;
            Ok(a.get(&format!(
                "/repos/{repo}/actions/runs/{id}/jobs?per_page=100"
            ))?["value"]
                .clone())
        }
        "git.settings.get" => Ok(serde_json::to_value(a.settings()?)?),
        "git.settings.save" => {
            let s: Settings = serde_json::from_value(p.get("settings").cloned().unwrap_or(p))?;
            a.save_settings(&s)?;
            Ok(serde_json::to_value(s)?)
        }
        "git.runs.snapshot" => a.runs(),
        _ => bail!("unknown method: {m}"),
    }
}
fn data_dir() -> Result<PathBuf> {
    let mut a = std::env::args_os().skip(1);
    while let Some(x) = a.next() {
        if x == "--data-dir" {
            return a
                .next()
                .map(PathBuf::from)
                .context("--data-dir requires a path");
        }
    }
    bail!("--data-dir is required")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn repository_names_are_restricted() {
        assert!(valid_repo("openai/codex").is_ok());
        assert!(valid_repo("-o/ProxyCommand=x").is_err());
        assert!(valid_repo("owner/too/many").is_err());
    }
}
