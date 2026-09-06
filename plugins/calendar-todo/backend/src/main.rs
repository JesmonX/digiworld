use anyhow::{Context, Result, bail};
use chrono::{DateTime, Duration, Utc};
use regex::Regex;
use reqwest::{
    Method,
    blocking::{Client, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{fs, path::PathBuf, time::Duration as StdDuration};
use uuid::Uuid;
const SERVICE: &str = "io.github.jesmonx.digiworld.calendar-todo";
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
    #[serde(default)]
    recurrence_id: Option<String>,
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
    candidate: Option<(Account, String)>,
}

#[derive(Debug)]
struct CalendarReportError {
    status: u16,
    detail: String,
    retryable: bool,
}

fn sync_range() -> (DateTime<Utc>, DateTime<Utc>) {
    let now = Utc::now();
    (now - Duration::days(366), now + Duration::days(731))
}

fn calendar_query_body(start: DateTime<Utc>, end: DateTime<Utc>) -> String {
    format!(
        "<?xml version=\"1.0\"?><c:calendar-query xmlns:d=\"DAV:\" xmlns:c=\"urn:ietf:params:xml:ns:caldav\"><d:prop><d:getetag/><c:calendar-data><c:expand start=\"{0}\" end=\"{1}\"/></c:calendar-data></d:prop><c:filter><c:comp-filter name=\"VCALENDAR\"><c:comp-filter name=\"VEVENT\"><c:time-range start=\"{0}\" end=\"{1}\"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>",
        start.format("%Y%m%dT%H%M%SZ"),
        end.format("%Y%m%dT%H%M%SZ"),
    )
}

fn dav_error_detail(body: &str) -> (String, bool) {
    let lower = body.to_ascii_lowercase();
    if lower.contains("number-of-matches-within-limits")
        || lower.contains("number of matches within limits")
        || lower.contains("max-resource-size")
    {
        return ("服务端限制了单次返回数量，将按时间分段重试".into(), true);
    }
    if lower.contains("need-privileges") || lower.contains("privilege") {
        return ("当前账号没有读取该日历的权限".into(), false);
    }
    let text = Regex::new(r"(?is)<[^>]+>")
        .map(|re| re.replace_all(body, " ").into_owned())
        .unwrap_or_else(|_| body.to_string());
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        // Some iCloud edges return only `403 Forbidden` even when the
        // unbounded query is what tripped the server-side result limit.
        ("服务端未返回具体原因".into(), true)
    } else {
        // A bounded retry is cheap and lets generic 403 responses recover
        // without masking explicit permission failures above.
        (text.chars().take(240).collect(), true)
    }
}
impl App {
    fn account(&self) -> Result<Account> {
        if let Some((account, _)) = &self.candidate {
            return Ok(account.clone());
        }
        read(&self.dir.join("account.json")).context("尚未配置 iCloud 账号")
    }
    fn pass(&self) -> Result<String> {
        if let Some((_, secret)) = &self.candidate {
            return Ok(secret.clone());
        }
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
        validate_url(url)?;
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

    fn report_events(
        &self,
        cal: &Calendar,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
    ) -> std::result::Result<Vec<Event>, CalendarReportError> {
        let body = calendar_query_body(start, end);
        let response = self
            .request(
                Method::from_bytes(b"REPORT").map_err(|error| CalendarReportError {
                    status: 0,
                    detail: error.to_string(),
                    retryable: false,
                })?,
                &cal.href,
                "1",
                Some(body),
            )
            .map_err(|error| CalendarReportError {
                status: 0,
                detail: format!("连接失败：{error}"),
                retryable: false,
            })?;
        let status = response.status().as_u16();
        let text = response.text().map_err(|error| CalendarReportError {
            status,
            detail: format!("读取响应失败：{error}"),
            retryable: false,
        })?;
        if !(200..300).contains(&status) {
            let (detail, retryable) = dav_error_detail(&text);
            return Err(CalendarReportError {
                status,
                detail,
                retryable: status == 403 && retryable,
            });
        }

        let mut events = vec![];
        for block in blocks(&text, "response") {
            let href = tag(&block, "href").unwrap_or_default();
            let etag = tag(&block, "getetag")
                .unwrap_or_default()
                .trim_matches('"')
                .to_string();
            if let Some(ics) = tag(&block, "calendar-data") {
                for component in ics.split("BEGIN:VEVENT").skip(1) {
                    let Some(body) = component.split("END:VEVENT").next() else {
                        continue;
                    };
                    if let Some(mut event) = parse_event(body) {
                        event.calendar_id = cal.id.clone();
                        event.href =
                            resolve_url(&cal.href, &href).map_err(|error| CalendarReportError {
                                status,
                                detail: error.to_string(),
                                retryable: false,
                            })?;
                        event.etag = etag.clone();
                        events.push(event);
                    }
                }
            }
        }
        Ok(events)
    }

    fn report_events_segmented(
        &self,
        cal: &Calendar,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
    ) -> std::result::Result<Vec<Event>, CalendarReportError> {
        let mut cursor = start;
        let mut events = vec![];
        while cursor < end {
            let next = std::cmp::min(cursor + Duration::days(31), end);
            events.extend(self.report_events(cal, cursor, next)?);
            cursor = next;
        }
        let mut unique = std::collections::BTreeMap::new();
        for event in events {
            unique.insert(
                format!(
                    "{}\u{1f}{}\u{1f}{}\u{1f}{}",
                    event.calendar_id,
                    event.href,
                    event.id,
                    event.recurrence_id.as_deref().unwrap_or(&event.start)
                ),
                event,
            );
        }
        Ok(unique.into_values().collect())
    }

    fn sync(&self) -> Result<Value> {
        let a = self.account()?;
        let cached_calendars: Vec<Calendar> =
            read(&self.dir.join("calendars.json")).unwrap_or_default();
        let cached: Vec<Event> = read(&self.dir.join("events.json")).unwrap_or_default();
        let calendars = match self.discover() {
            Ok(value) => value,
            Err(error) if !cached_calendars.is_empty() => {
                return Ok(json!({
                    "calendars": cached_calendars,
                    "events": cached,
                    "warnings": [format!("日历发现失败（{error}）")],
                    "syncedAt": Utc::now().to_rfc3339(),
                }));
            }
            Err(error) => return Err(error),
        };
        let chosen: Vec<Calendar> = calendars
            .iter()
            .cloned()
            .filter(|c| a.selected_calendars.contains(&c.id))
            .collect();
        let (start, end) = sync_range();
        let mut events = vec![];
        let mut warnings = vec![];
        for cal in &chosen {
            let result = self.report_events(cal, start, end);
            let result = match result {
                Ok(value) => Ok(value),
                Err(error) if error.retryable => self.report_events_segmented(cal, start, end),
                Err(error) => Err(error),
            };
            match result {
                Ok(value) => events.extend(value),
                Err(error) => {
                    events.extend(
                        cached
                            .iter()
                            .filter(|event| event.calendar_id == cal.id)
                            .cloned(),
                    );
                    let status = if error.status == 0 {
                        "".into()
                    } else {
                        format!(" {}", error.status)
                    };
                    warnings.push(format!(
                        "{}：读取失败{}（{}）",
                        cal.name, status, error.detail
                    ));
                }
            }
        }
        write(&self.dir.join("calendars.json"), &calendars)?;
        write(&self.dir.join("events.json"), &events)?;
        Ok(
            json!({"calendars":calendars,"events":events,"warnings":warnings,"syncedAt":Utc::now().to_rfc3339()}),
        )
    }
    fn event_save(&self, mut e: Event, overwrite: bool) -> Result<Event> {
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
        validate_event(&e)?;
        let new = e.href.is_empty();
        if new && e.id.is_empty() {
            e.id = Uuid::new_v4().to_string();
        }
        let href = if new {
            format!(
                "{}{}.ics",
                cal.href.trim_end_matches('/').to_string() + "/",
                Uuid::new_v4()
            )
        } else {
            e.href.clone()
        };
        validate_resource(cal, &href)?;
        let body = if new {
            to_ics(&e)
        } else {
            let response = self
                .http
                .get(&href)
                .basic_auth(self.account()?.username, Some(self.pass()?))
                .send()?;
            if !response.status().is_success() {
                bail!("无法读取原始日程，未保存任何修改")
            }
            let current_etag = response
                .headers()
                .get("etag")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .trim_matches('"')
                .to_string();
            if current_etag.is_empty() {
                bail!("服务器缺少版本标识，无法安全编辑")
            }
            if !overwrite && e.etag != current_etag {
                bail!("conflict: 事件已在其他设备修改，请读取服务器版本后重试")
            }
            e.etag = current_etag;
            patch_ics(&response.text()?, &e)?
        };
        let mut r = self
            .http
            .put(&href)
            .basic_auth(self.account()?.username, Some(self.pass()?))
            .header("Content-Type", "text/calendar; charset=utf-8");
        if new {
            r = r.header("If-None-Match", "*")
        } else {
            r = r.header("If-Match", format!("\"{}\"", e.etag))
        }
        let z = r.body(body).send()?;
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
        let calendars: Vec<Calendar> = read(&self.dir.join("calendars.json"))?;
        let calendar = calendars
            .iter()
            .find(|c| c.id == e.calendar_id)
            .context("日历不存在")?;
        if calendar.read_only {
            bail!("此日历只读")
        }
        validate_resource(calendar, &e.href)?;
        if e.etag.is_empty() {
            bail!("缺少事件版本，请先同步")
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
        recurrence_id: field("RECURRENCE-ID"),
        recurring: s
            .lines()
            .any(|l| l.starts_with("RRULE:") || l.starts_with("RECURRENCE-ID")),
    })
}
fn validate_url(raw: &str) -> Result<()> {
    let url = reqwest::Url::parse(raw)?;
    let host = url.host_str().unwrap_or("");
    if url.scheme() != "https"
        || !(host == "icloud.com" || host.ends_with(".icloud.com"))
        || !url.username().is_empty()
        || url.password().is_some()
    {
        bail!("仅支持 iCloud HTTPS 日历地址")
    }
    Ok(())
}
fn validate_resource(calendar: &Calendar, raw: &str) -> Result<()> {
    validate_url(raw)?;
    let base = reqwest::Url::parse(&calendar.href)?;
    let url = reqwest::Url::parse(raw)?;
    if base.origin() != url.origin()
        || !url
            .path()
            .starts_with(&(base.path().trim_end_matches('/').to_string() + "/"))
    {
        bail!("事件不属于所选日历")
    }
    Ok(())
}
fn validate_event(e: &Event) -> Result<()> {
    if e.title.trim().is_empty() {
        bail!("标题不能为空")
    }
    for zone in [&e.start_timezone, &e.end_timezone].into_iter().flatten() {
        if !valid_timezone(zone) {
            bail!("无效时区")
        }
    }
    let format = if e.all_day {
        "%Y%m%d"
    } else if e.start.ends_with('Z') {
        "%Y%m%dT%H%M%SZ"
    } else {
        "%Y%m%dT%H%M%S"
    };
    if e.all_day {
        let start = chrono::NaiveDate::parse_from_str(&e.start, format)?;
        let end = chrono::NaiveDate::parse_from_str(&e.end, format)?;
        if end <= start {
            bail!("结束日期必须晚于开始日期")
        }
    } else {
        let start = chrono::NaiveDateTime::parse_from_str(&e.start, format)?;
        let end = chrono::NaiveDateTime::parse_from_str(&e.end, format)?;
        if e.start_timezone != e.end_timezone {
            bail!("起止时区须一致，请在 Apple 日历中编辑跨时区日程")
        }
        if end <= start {
            bail!("结束时间必须晚于开始时间")
        }
    }
    if e.id.contains(['\r', '\n']) {
        bail!("无效事件标识")
    }
    Ok(())
}
fn patch_ics(original: &str, event: &Event) -> Result<String> {
    let original = unfold(original);
    if original.lines().filter(|l| *l == "BEGIN:VEVENT").count() != 1
        || original.lines().any(|l| {
            l.starts_with("ATTENDEE")
                || l.starts_with("ORGANIZER")
                || l.starts_with("RRULE")
                || l.starts_with("RECURRENCE-ID")
        })
    {
        bail!("重复日程或邀请请在 Apple 日历中编辑")
    }
    if parse_event(&original).is_none_or(|e| e.id != event.id) {
        bail!("事件标识不一致，未保存修改")
    }
    let generated = to_ics(event);
    let fields = [
        "DTSTART",
        "DTEND",
        "DURATION",
        "SUMMARY",
        "LOCATION",
        "DESCRIPTION",
        "DTSTAMP",
    ];
    let replacements: Vec<_> = generated
        .lines()
        .filter(|line| fields.contains(&line.split([';', ':']).next().unwrap_or("")))
        .collect();
    let mut output = Vec::new();
    let mut depth = 0;
    for line in original.lines() {
        if line == "BEGIN:VEVENT" {
            depth = 1;
            output.push(line);
            continue;
        }
        if depth > 0 && line.starts_with("BEGIN:") {
            depth += 1;
        }
        if depth == 1 && line == "END:VEVENT" {
            output.extend(replacements.iter().copied());
            depth = 0;
            output.push(line);
            continue;
        }
        if depth == 1 && fields.contains(&line.split([';', ':']).next().unwrap_or("")) {
            continue;
        }
        output.push(line);
        if depth > 1 && line.starts_with("END:") {
            depth -= 1;
        }
    }
    Ok(output.join("\r\n") + "\r\n")
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
    digiworld_plugin_runtime::atomic_write(p, &serde_json::to_vec_pretty(v)?)?;
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
        candidate: None,
        http: Client::builder()
            .timeout(StdDuration::from_secs(15))
            .user_agent("Digiworld-Calendar/0.1")
            .build()?,
    };
    digiworld_plugin_runtime::serve(
        a,
        handle,
        &[
            "calendar.sync",
            "calendar.account.save",
            "calendar.event.save",
            "calendar.event.delete",
            "calendar.discover",
        ],
    )
}

fn handle(a: &App, m: &str, p: Value) -> Result<Value> {
    match m {
        "health" => Ok(json!({"status":"ok","protocolVersion":1})),
        "shutdown" => Ok(json!({"stopped":true})),
        "calendar.account.get" => {
            if a.dir.join("account.json").exists() {
                Ok(serde_json::to_value(a.account()?)?)
            } else {
                Ok(Value::Null)
            }
        }
        "calendar.account.save" => {
            let mut x: Account = serde_json::from_value(p["account"].clone())?;
            if x.server_url.is_empty() {
                x.server_url = base()
            }
            let secret = p["secret"].as_str().context("缺少 App 专用密码")?;
            validate_url(&x.server_url)?;
            let candidate = App {
                dir: a.dir.clone(),
                http: a.http.clone(),
                candidate: Some((x.clone(), secret.to_string())),
            };
            let calendars = candidate.discover()?;
            let entry = keyring::Entry::new(SERVICE, "icloud-app-password")?;
            let old = entry.get_password().ok();
            entry.set_password(secret)?;
            if let Err(error) = write(&a.dir.join("account.json"), &x) {
                if let Some(old) = old {
                    entry.set_password(&old)?;
                } else {
                    let _ = entry.delete_credential();
                }
                return Err(error);
            }
            Ok(serde_json::to_value(calendars)?)
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

    #[test]
    fn calendar_queries_are_time_bounded() {
        let start = Utc::now();
        let body = calendar_query_body(start, start + Duration::days(1));
        assert!(body.contains("<c:time-range start=\""));
        assert!(body.contains("end=\""));
        assert!(body.contains("name=\"VEVENT\""));
    }

    #[test]
    fn classifies_caldav_match_limit_errors_for_segmented_retry() {
        let (detail, retryable) =
            dav_error_detail("<d:number-of-matches-within-limits xmlns:d=\"DAV:\"/>");
        assert!(retryable);
        assert!(detail.contains("分段"));
    }

    #[test]
    fn classifies_caldav_privilege_errors_without_retrying() {
        let (detail, retryable) = dav_error_detail("<d:need-privileges xmlns:d=\"DAV:\"/>");
        assert!(!retryable);
        assert!(detail.contains("权限"));
    }

    #[test]
    fn treats_generic_forbidden_responses_as_bounded_retry_candidates() {
        let (detail, retryable) = dav_error_detail("403 Forbidden");
        assert!(retryable);
        assert!(detail.contains("403 Forbidden"));
    }
}
