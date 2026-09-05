use anyhow::{Context, Result, bail};
use chrono::Utc;
use regex::Regex;
use reqwest::{
    Method,
    blocking::{Client, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    fs,
    io::{BufRead, Write},
    path::PathBuf,
    time::Duration,
};
use uuid::Uuid;
const SERVICE: &str = "io.github.jesmonx.digiworld.calendar-todo";
#[derive(Deserialize)]
struct Req {
    id: Value,
    method: String,
    #[serde(default)]
    params: Value,
}
#[derive(Default, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Account {
    username: String,
    #[serde(default = "base")]
    server_url: String,
    #[serde(default)]
    selected_calendars: Vec<String>,
}
fn base() -> String {
    "https://caldav.icloud.com".into()
}
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Calendar {
    id: String,
    name: String,
    href: String,
    #[serde(default)]
    read_only: bool,
}
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Event {
    id: String,
    calendar_id: String,
    href: String,
    etag: String,
    title: String,
    start: String,
    end: String,
    #[serde(default)]
    start_timezone: Option<String>,
    #[serde(default)]
    end_timezone: Option<String>,
    all_day: bool,
    location: String,
    notes: String,
    #[serde(default)]
    recurring: bool,
}
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Todo {
    id: String,
    title: String,
    done: bool,
    due: Option<String>,
    created_at: String,
    updated_at: String,
}
struct App {
    dir: PathBuf,
    http: Client,
}
impl App {
    fn account(&self) -> Result<Account> {
        read(&self.dir.join("account.json")).context("尚未配置 iCloud 账号")
    }
    fn pass(&self) -> Result<String> {
        keyring::Entry::new(SERVICE, "icloud-app-password")?
            .get_password()
            .context("App 专用密码不存在")
    }
    fn request(
        &self,
        method: Method,
        url: &str,
        depth: &str,
        body: Option<String>,
    ) -> Result<Response> {
        let a = self.account()?;
        let mut r = self
            .http
            .request(method, url)
            .basic_auth(a.username, Some(self.pass()?))
            .header("Depth", depth);
        if let Some(b) = body {
            r = r
                .header("Content-Type", "application/xml; charset=utf-8")
                .body(b)
        }
        let z = r.send().context("连接 iCloud CalDAV 失败")?;
        Ok(z)
    }
    fn propfind(&self, url: &str, depth: &str, props: &str) -> Result<String> {
        let body = format!(
            "<?xml version=\"1.0\"?><d:propfind xmlns:d=\"DAV:\" xmlns:c=\"urn:ietf:params:xml:ns:caldav\"><d:prop>{props}</d:prop></d:propfind>"
        );
        let z = self.request(Method::from_bytes(b"PROPFIND")?, url, depth, Some(body))?;
        let status = z.status();
        let text = z.text()?;
        if !status.is_success() && status.as_u16() != 207 {
            bail!("CalDAV 发现失败 {status}")
        }
        Ok(text)
    }
    fn discover(&self) -> Result<Vec<Calendar>> {
        let a = self.account()?;
        let root = format!("{}/", a.server_url.trim_end_matches('/'));
        let principal_doc = self.propfind(&root, "0", "<d:current-user-principal/>")?;
        let principal_block = blocks(&principal_doc, "current-user-principal")
            .into_iter()
            .next()
            .context("CalDAV 未返回当前用户 principal")?;
        let principal_href = tag(&principal_block, "href").context("CalDAV principal 缺少地址")?;
        let principal = resolve_url(&root, &principal_href)?;
        let home_doc = self.propfind(&principal, "0", "<c:calendar-home-set/>")?;
        let home_block = blocks(&home_doc, "calendar-home-set")
            .into_iter()
            .next()
            .context("CalDAV 未返回日历目录")?;
        let home_href = tag(&home_block, "href").context("CalDAV 日历目录缺少地址")?;
        let home = resolve_url(&principal, &home_href)?;

        let text = self.propfind(
            &home,
            "1",
            "<d:displayname/><d:resourcetype/><c:supported-calendar-component-set/><d:current-user-privilege-set/>",
        )?;
        let clean_home_url = home.trim_end_matches('/');
        let mut out = vec![];
        for block in blocks(&text, "response") {
            let rt = blocks(&block, "resourcetype")
                .into_iter()
                .next()
                .unwrap_or_default();
            if !rt.contains("calendar") {
                continue;
            }
            if let Some(comps) = blocks(&block, "supported-calendar-component-set")
                .into_iter()
                .next()
                && !comps.contains("VEVENT")
            {
                continue;
            }
            let href = tag(&block, "href").unwrap_or_default();
            if href.is_empty() {
                continue;
            }
            let cal_url = resolve_url(&home, &href)?;
            let clean_cal_url = cal_url.trim_end_matches('/');
            if clean_cal_url == clean_home_url || clean_cal_url.ends_with("/calendars") {
                continue;
            }
            let name = tag(&block, "displayname").unwrap_or_else(|| href.clone());
            let read_only = !block.contains("<d:write") && !block.contains(":write");
            out.push(Calendar {
                id: href.clone(),
                name,
                href: cal_url,
                read_only,
            })
        }
        if out.is_empty() {
            bail!("没有发现可用日历；请确认已开启 iCloud 日历")
        }
        Ok(out)
    }
    fn sync(&self) -> Result<Value> {
        let a = self.account()?;
        let calendars = self.discover()?;
        let chosen: Vec<Calendar> = calendars
            .into_iter()
            .filter(|c| a.selected_calendars.contains(&c.id))
            .collect();
        let body = "<?xml version=\"1.0\"?><c:calendar-query xmlns:d=\"DAV:\" xmlns:c=\"urn:ietf:params:xml:ns:caldav\"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name=\"VCALENDAR\"><c:comp-filter name=\"VEVENT\"/></c:comp-filter></c:filter></c:calendar-query>";
        let mut events = vec![];
        for cal in &chosen {
            let z = self.request(
                Method::from_bytes(b"REPORT")?,
                &cal.href,
                "1",
                Some(body.into()),
            )?;
            let status = z.status();
            let text = z.text()?;
            if !status.is_success() && !status.as_u16().eq(&207) {
                bail!("读取日历失败 {status}")
            }
            for b in blocks(&text, "response") {
                let href = tag(&b, "href").unwrap_or_default();
                let etag = tag(&b, "getetag")
                    .unwrap_or_default()
                    .trim_matches('"')
                    .to_string();
                if let Some(ics) = tag(&b, "calendar-data")
                    && let Some(mut e) = parse_event(&ics)
                {
                    e.calendar_id = cal.id.clone();
                    e.href = resolve_url(&cal.href, &href)?;
                    e.etag = etag;
                    events.push(e)
                }
            }
        }
        write(&self.dir.join("calendars.json"), &chosen)?;
        write(&self.dir.join("events.json"), &events)?;
        Ok(json!({"calendars":chosen,"events":events,"syncedAt":Utc::now().to_rfc3339()}))
    }
    fn event_save(&self, e: Event, overwrite: bool) -> Result<Event> {
        if e.recurring {
            bail!("重复事件请在 Apple 日历中编辑")
        }
        let calendars: Vec<Calendar> = read(&self.dir.join("calendars.json"))?;
        let cal = calendars
            .iter()
            .find(|c| c.id == e.calendar_id)
            .context("日历不存在")?;
        if cal.read_only {
            bail!("此日历只读")
        }
        let new = e.href.is_empty();
        let href = if new {
            format!(
                "{}{}.ics",
                cal.href.trim_end_matches('/').to_string() + "/",
                Uuid::new_v4()
            )
        } else {
            e.href.clone()
        };
        let mut r = self
            .http
            .put(&href)
            .basic_auth(self.account()?.username, Some(self.pass()?))
            .header("Content-Type", "text/calendar; charset=utf-8");
        if new {
            r = r.header("If-None-Match", "*")
        } else if !overwrite {
            r = r.header("If-Match", format!("\"{}\"", e.etag))
        }
        let z = r.body(to_ics(&e)).send()?;
        if z.status().as_u16() == 412 {
            bail!("事件已在其他设备修改，请刷新后重试或选择覆盖")
        }
        if !z.status().is_success() {
            bail!("保存事件失败 {}", z.status())
        }
        let mut saved = e;
        saved.href = href;
        saved.etag = z
            .headers()
            .get("etag")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .trim_matches('"')
            .to_string();
        Ok(saved)
    }
    fn event_delete(&self, e: &Event, overwrite: bool) -> Result<()> {
        if e.recurring {
            bail!("重复事件请在 Apple 日历中删除")
        }
        let mut r = self
            .http
            .delete(&e.href)
            .basic_auth(self.account()?.username, Some(self.pass()?));
        if !overwrite {
            r = r.header("If-Match", format!("\"{}\"", e.etag))
        }
        let z = r.send()?;
        if z.status().as_u16() == 412 {
            bail!("事件已在其他设备修改，请刷新后重试或选择覆盖")
        }
        if !z.status().is_success() && z.status().as_u16() != 404 {
            bail!("删除事件失败 {}", z.status())
        }
        Ok(())
    }
    fn todos(&self) -> Result<Vec<Todo>> {
        let p = self.dir.join("todos.json");
        if p.exists() { read(&p) } else { Ok(vec![]) }
    }
    fn save_todo(&self, mut t: Todo) -> Result<Todo> {
        let mut all = self.todos()?;
        let now = Utc::now().to_rfc3339();
        if t.id.is_empty() {
            t.id = Uuid::new_v4().to_string();
            t.created_at = now.clone()
        }
        t.updated_at = now;
        if t.title.trim().is_empty() {
            bail!("Todo 标题不能为空")
        }
        if let Some(x) = all.iter_mut().find(|x| x.id == t.id) {
            *x = t.clone()
        } else {
            all.push(t.clone())
        }
        write(&self.dir.join("todos.json"), &all)?;
        Ok(t)
    }
    fn delete_todo(&self, id: &str) -> Result<()> {
        let mut x = self.todos()?;
        x.retain(|t| t.id != id);
        write(&self.dir.join("todos.json"), &x)
    }
}
fn parse_event(s: &str) -> Option<Event> {
    let s = unfold(s);
    let line = |n: &str| {
        s.lines()
            .find(|l| l.starts_with(&format!("{n}:")) || l.starts_with(&format!("{n};")))
    };
    let field = |n: &str| line(n).and_then(|l| l.split_once(':').map(|x| unescape_ics(x.1)));
    let timezone = |n: &str| {
        line(n)
            .and_then(|l| l.split_once(':'))
            .and_then(|(head, _)| {
                head.split(';')
                    .skip(1)
                    .find_map(|part| part.strip_prefix("TZID=").map(str::to_string))
            })
    };
    let start = field("DTSTART")?;
    let end = field("DTEND").unwrap_or_else(|| start.clone());
    Some(Event {
        id: field("UID").unwrap_or_default(),
        calendar_id: String::new(),
        href: String::new(),
        etag: String::new(),
        title: field("SUMMARY").unwrap_or_default(),
        all_day: start.len() == 8,
        start,
        end,
        start_timezone: timezone("DTSTART"),
        end_timezone: timezone("DTEND"),
        location: field("LOCATION").unwrap_or_default(),
        notes: field("DESCRIPTION").unwrap_or_default(),
        recurring: s
            .lines()
            .any(|l| l.starts_with("RRULE:") || l.starts_with("RECURRENCE-ID")),
    })
}
fn to_ics(e: &Event) -> String {
    let dt = Utc::now().format("%Y%m%dT%H%M%SZ");
    let safe_start_timezone = e
        .start_timezone
        .as_deref()
        .filter(|value| valid_timezone(value));
    let (start_key, end_key) = if e.all_day {
        (
            "DTSTART;VALUE=DATE".to_string(),
            "DTEND;VALUE=DATE".to_string(),
        )
    } else if let Some(timezone) = safe_start_timezone {
        (
            format!("DTSTART;TZID={timezone}"),
            format!(
                "DTEND;TZID={}",
                e.end_timezone.as_deref().unwrap_or(timezone)
            ),
        )
    } else {
        ("DTSTART".to_string(), "DTEND".to_string())
    };
    format!(
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Digiworld//Calendar Todo//CN\r\nBEGIN:VEVENT\r\nUID:{}\r\nDTSTAMP:{}\r\n{}:{}\r\n{}:{}\r\nSUMMARY:{}\r\nLOCATION:{}\r\nDESCRIPTION:{}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
        if e.id.is_empty() {
            Uuid::new_v4().to_string()
        } else {
            e.id.clone()
        },
        dt,
        start_key,
        e.start,
        end_key,
        e.end,
        escape_ics(&e.title),
        escape_ics(&e.location),
        escape_ics(&e.notes)
    )
}
fn valid_timezone(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"/_+-".contains(&byte))
}
fn blocks(s: &str, name: &str) -> Vec<String> {
    Regex::new(&format!(
        r"(?is)<(?:\w+:)?{name}\b[^>]*>(.*?)</(?:\w+:)?{name}>"
    ))
    .unwrap()
    .captures_iter(s)
    .map(|c| c[1].to_string())
    .collect()
}
fn tag(s: &str, n: &str) -> Option<String> {
    Regex::new(&format!(r"(?is)<(?:\w+:)?{n}\b[^>]*>(.*?)</(?:\w+:)?{n}>"))
        .ok()?
        .captures(s)
        .map(|c| xml(&c[1]))
}
fn xml(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .trim()
        .to_string()
}
fn resolve_url(base: &str, href: &str) -> Result<String> {
    if href.starts_with("http://") || href.starts_with("https://") {
        return Ok(href.to_string());
    }
    let base_with_slash = if base.ends_with('/') {
        base.to_string()
    } else {
        format!("{base}/")
    };
    let base_url =
        reqwest::Url::parse(&base_with_slash).with_context(|| format!("无效的基础 URL: {base}"))?;
    let resolved = base_url
        .join(href)
        .with_context(|| format!("无法解析相对路径: {href}"))?;
    Ok(resolved.to_string())
}
fn unfold(s: &str) -> String {
    s.replace("\r\n ", "").replace("\r\n\t", "")
}
fn unescape_ics(s: &str) -> String {
    s.replace("\\n", "\n")
        .replace("\\,", ",")
        .replace("\\;", ";")
        .replace("\\\\", "\\")
}
fn escape_ics(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('\n', "\\n")
        .replace(',', "\\,")
        .replace(';', "\\;")
}
fn read<T: for<'a> Deserialize<'a>>(p: &std::path::Path) -> Result<T> {
    Ok(serde_json::from_slice(&fs::read(p)?)?)
}
fn write<T: Serialize>(p: &std::path::Path, v: &T) -> Result<()> {
    fs::write(p, serde_json::to_vec_pretty(v)?)?;
    Ok(())
}
fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_ansi(false)
        .init();
    let dir = data_dir()?;
    fs::create_dir_all(&dir)?;
    let a = App {
        dir,
        http: Client::builder()
            .timeout(Duration::from_secs(15))
            .user_agent("Digiworld-Calendar/0.1")
            .build()?,
    };
    for l in std::io::stdin().lock().lines() {
        let r: Req = serde_json::from_str(&l?)?;
        let stop = r.method == "shutdown";
        let z = handle(&a, &r.method, r.params);
        let o = match z {
            Ok(v) => json!({"jsonrpc":"2.0","id":r.id,"result":v}),
            Err(e) => {
                json!({"jsonrpc":"2.0","id":r.id,"error":{"code":-32000,"message":e.to_string()}})
            }
        };
        serde_json::to_writer(std::io::stdout(), &o)?;
        std::io::stdout().write_all(b"\n")?;
        std::io::stdout().flush()?;
        if stop {
            break;
        }
    }
    Ok(())
}
fn handle(a: &App, m: &str, p: Value) -> Result<Value> {
    match m {
        "health" => Ok(json!({"status":"ok","protocolVersion":1})),
        "shutdown" => Ok(json!({"stopped":true})),
        "calendar.account.get" => Ok(serde_json::to_value(a.account().ok())?),
        "calendar.account.save" => {
            let mut x: Account = serde_json::from_value(p["account"].clone())?;
            if x.server_url.is_empty() {
                x.server_url = base()
            }
            let secret = p["secret"].as_str().context("缺少 App 专用密码")?;
            write(&a.dir.join("account.json"), &x)?;
            keyring::Entry::new(SERVICE, "icloud-app-password")?.set_password(secret)?;
            Ok(serde_json::to_value(a.discover()?)?)
        }
        "calendar.discover" => Ok(serde_json::to_value(a.discover()?)?),
        "calendar.selection.save" => {
            let mut x = a.account()?;
            x.selected_calendars = serde_json::from_value(p["calendarIds"].clone())?;
            write(&a.dir.join("account.json"), &x)?;
            Ok(serde_json::to_value(x)?)
        }
        "calendar.sync" => a.sync(),
        "calendar.cached" => Ok(
            json!({"calendars":read::<Vec<Calendar>>(&a.dir.join("calendars.json")).unwrap_or_default(),"events":read::<Vec<Event>>(&a.dir.join("events.json")).unwrap_or_default()}),
        ),
        "calendar.event.save" => Ok(serde_json::to_value(a.event_save(
            serde_json::from_value(p["event"].clone())?,
            p["overwrite"].as_bool().unwrap_or(false),
        )?)?),
        "calendar.event.delete" => {
            a.event_delete(
                &serde_json::from_value(p["event"].clone())?,
                p["overwrite"].as_bool().unwrap_or(false),
            )?;
            Ok(json!({"deleted":true}))
        }
        "todo.list" => Ok(serde_json::to_value(a.todos()?)?),
        "todo.save" => Ok(serde_json::to_value(
            a.save_todo(serde_json::from_value(p["todo"].clone())?)?,
        )?),
        "todo.delete" => {
            a.delete_todo(p["id"].as_str().context("缺少 Todo ID")?)?;
            Ok(json!({"deleted":true}))
        }
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
    fn parses_normal_and_recurring_events() {
        let normal=parse_event("BEGIN:VEVENT\r\nUID:1\r\nDTSTART:20260905T090000Z\r\nDTEND:20260905T100000Z\r\nSUMMARY:Review\\, weekly\r\nEND:VEVENT").unwrap();
        assert_eq!(normal.title, "Review, weekly");
        assert!(!normal.recurring);
        assert_eq!(normal.start_timezone, None);
        let zoned=parse_event("BEGIN:VEVENT\r\nUID:3\r\nDTSTART;TZID=Asia/Shanghai:20260905T090000\r\nDTEND;TZID=Asia/Shanghai:20260905T100000\r\nEND:VEVENT").unwrap();
        assert_eq!(zoned.start_timezone.as_deref(), Some("Asia/Shanghai"));
        assert!(to_ics(&zoned).contains("DTSTART;TZID=Asia/Shanghai:20260905T090000"));
        assert!(valid_timezone("America/Los_Angeles"));
        assert!(!valid_timezone("Asia/Shanghai\r\nSUMMARY:Injected"));
        let recurring=parse_event("BEGIN:VEVENT\r\nUID:2\r\nDTSTART;VALUE=DATE:20260905\r\nRRULE:FREQ=DAILY\r\nEND:VEVENT").unwrap();
        assert!(recurring.all_day && recurring.recurring)
    }
    #[test]
    fn resolves_dav_paths() {
        assert_eq!(
            resolve_url("https://caldav.icloud.com/", "/123/calendars/").unwrap(),
            "https://caldav.icloud.com/123/calendars/"
        )
    }
    #[test]
    fn resolves_partitioned_dav_paths() {
        assert_eq!(
            resolve_url(
                "https://p120-caldav.icloud.com:443/123/calendars/",
                "/123/calendars/home/"
            )
            .unwrap(),
            "https://p120-caldav.icloud.com/123/calendars/home/"
        );
    }
    #[test]
    fn resolves_relative_subpaths() {
        assert_eq!(
            resolve_url("https://p120-caldav.icloud.com:443/123/calendars/", "home/").unwrap(),
            "https://p120-caldav.icloud.com/123/calendars/home/"
        );
    }
}
