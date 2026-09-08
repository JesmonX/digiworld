use anyhow::{Context, Result, bail};
use chrono::{DateTime, Duration, Utc};
use quick_xml::{NsReader, XmlVersion, events::Event as XmlEvent, name::ResolveResult};
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
    time::Duration as StdDuration,
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
    #[serde(default)]
    capabilities: CalendarCapabilities,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
enum Capability {
    Allowed,
    Denied,
    #[default]
    Unknown,
}

#[derive(Clone, Copy)]
enum CalendarOperation {
    Create,
    Update,
    Delete,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
struct CalendarCapabilities {
    create: Capability,
    update: Capability,
    delete: Capability,
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

#[derive(Debug)]
struct CalendarReportError {
    status: u16,
    detail: String,
    retryable: bool,
}

const DAV_NS: &[u8] = b"DAV:";
const CALDAV_NS: &[u8] = b"urn:ietf:params:xml:ns:caldav";

#[derive(Debug, Clone)]
struct XmlNode {
    namespace: Vec<u8>,
    local: String,
    text: String,
    attributes: Vec<(String, String)>,
    children: Vec<XmlNode>,
}

fn parse_xml_tree(xml: &str) -> Result<Vec<XmlNode>> {
    let mut reader = NsReader::from_str(xml);
    // Entity references split text events; trimming each chunk would erase
    // spaces around an ampersand or numeric character reference.
    reader.config_mut().trim_text(false);
    let mut roots = Vec::new();
    let mut stack: Vec<XmlNode> = Vec::new();
    let mut buffer = Vec::new();
    loop {
        let decoder = reader.decoder();
        let (resolved, event) = reader.read_resolved_event_into(&mut buffer)?;
        match event {
            XmlEvent::Start(element) => {
                let mut attributes = Vec::new();
                for attribute in element.attributes().with_checks(false) {
                    let attribute = attribute?;
                    attributes.push((
                        String::from_utf8_lossy(attribute.key.local_name().as_ref()).into_owned(),
                        attribute
                            .decoded_and_normalized_value(XmlVersion::Implicit1_0, decoder)?
                            .into_owned(),
                    ));
                }
                stack.push(XmlNode {
                    namespace: match resolved {
                        ResolveResult::Bound(namespace) => namespace.as_ref().to_vec(),
                        _ => Vec::new(),
                    },
                    local: String::from_utf8_lossy(element.local_name().as_ref()).into_owned(),
                    text: String::new(),
                    attributes,
                    children: Vec::new(),
                });
            }
            XmlEvent::Empty(element) => {
                let mut attributes = Vec::new();
                for attribute in element.attributes().with_checks(false) {
                    let attribute = attribute?;
                    attributes.push((
                        String::from_utf8_lossy(attribute.key.local_name().as_ref()).into_owned(),
                        attribute
                            .decoded_and_normalized_value(XmlVersion::Implicit1_0, decoder)?
                            .into_owned(),
                    ));
                }
                attach_xml_node(
                    &mut roots,
                    &mut stack,
                    XmlNode {
                        namespace: match resolved {
                            ResolveResult::Bound(namespace) => namespace.as_ref().to_vec(),
                            _ => Vec::new(),
                        },
                        local: String::from_utf8_lossy(element.local_name().as_ref()).into_owned(),
                        text: String::new(),
                        attributes,
                        children: Vec::new(),
                    },
                );
            }
            XmlEvent::Text(text) => {
                if let Some(node) = stack.last_mut() {
                    node.text.push_str(&text.decode()?);
                }
            }
            XmlEvent::CData(text) => {
                if let Some(node) = stack.last_mut() {
                    node.text.push_str(&text.decode()?);
                }
            }
            XmlEvent::GeneralRef(reference) => {
                if let Some(node) = stack.last_mut() {
                    if let Some(character) = reference.resolve_char_ref()? {
                        node.text.push(character);
                    } else {
                        let name = reference.decode()?;
                        let value = quick_xml::escape::resolve_predefined_entity(&name)
                            .context("不支持的 XML 实体引用")?;
                        node.text.push_str(value);
                    }
                }
            }
            XmlEvent::End(_) => {
                if let Some(node) = stack.pop() {
                    attach_xml_node(&mut roots, &mut stack, node);
                }
            }
            XmlEvent::Eof => break,
            _ => {}
        }
        buffer.clear();
    }
    Ok(roots)
}

fn attach_xml_node(roots: &mut Vec<XmlNode>, stack: &mut [XmlNode], node: XmlNode) {
    if let Some(parent) = stack.last_mut() {
        parent.children.push(node);
    } else {
        roots.push(node);
    }
}

fn collect_xml_descendants<'a>(
    nodes: &'a [XmlNode],
    namespace: &[u8],
    local: &str,
    result: &mut Vec<&'a XmlNode>,
) {
    for node in nodes {
        if node.namespace == namespace && node.local == local {
            result.push(node);
        }
        collect_xml_descendants(&node.children, namespace, local, result);
    }
}

fn xml_descendants<'a>(nodes: &'a [XmlNode], namespace: &[u8], local: &str) -> Vec<&'a XmlNode> {
    let mut result = Vec::new();
    collect_xml_descendants(nodes, namespace, local, &mut result);
    result
}

fn xml_text(node: &XmlNode) -> String {
    let mut value = node.text.clone();
    for child in &node.children {
        value.push_str(&xml_text(child));
    }
    value.trim().to_string()
}

fn successful_properties(response: &XmlNode) -> Vec<&XmlNode> {
    response
        .children
        .iter()
        .filter(|propstat| propstat.namespace == DAV_NS && propstat.local == "propstat")
        .filter(|propstat| {
            propstat
                .children
                .iter()
                .find(|node| node.namespace == DAV_NS && node.local == "status")
                .map(xml_text)
                .is_some_and(|status| {
                    status
                        .split_whitespace()
                        .nth(1)
                        .is_some_and(|code| code.starts_with('2'))
                })
        })
        .filter_map(|propstat| {
            propstat
                .children
                .iter()
                .find(|node| node.namespace == DAV_NS && node.local == "prop")
        })
        .collect()
}

fn response_nodes(xml: &str) -> Result<Vec<XmlNode>> {
    let roots = parse_xml_tree(xml)?;
    Ok(xml_descendants(&roots, DAV_NS, "response")
        .into_iter()
        .cloned()
        .collect())
}

fn property_child_text(
    xml: &str,
    property_namespace: &[u8],
    property: &str,
    child_namespace: &[u8],
    child: &str,
) -> Result<Option<String>> {
    let roots = parse_xml_tree(xml)?;
    for response in xml_descendants(&roots, DAV_NS, "response") {
        for prop in successful_properties(response) {
            for property_node in xml_descendants(&prop.children, property_namespace, property) {
                if let Some(value) =
                    xml_descendants(&property_node.children, child_namespace, child).first()
                {
                    return Ok(Some(xml_text(value)));
                }
            }
        }
    }
    Ok(None)
}

fn capability_for_response(response: &XmlNode) -> CalendarCapabilities {
    let privilege_set = successful_properties(response)
        .into_iter()
        .flat_map(|prop| xml_descendants(&prop.children, DAV_NS, "current-user-privilege-set"))
        .next();
    let Some(privilege_set) = privilege_set else {
        return CalendarCapabilities::default();
    };
    let privileges = xml_descendants(&privilege_set.children, DAV_NS, "privilege");
    if privileges.is_empty() {
        return CalendarCapabilities::default();
    }
    let names = privileges
        .iter()
        .flat_map(|privilege| {
            let mut nodes = vec![*privilege];
            collect_xml_descendants(&privilege.children, DAV_NS, "all", &mut nodes);
            collect_xml_descendants(&privilege.children, DAV_NS, "write", &mut nodes);
            collect_xml_descendants(&privilege.children, DAV_NS, "write-content", &mut nodes);
            collect_xml_descendants(&privilege.children, DAV_NS, "write-properties", &mut nodes);
            collect_xml_descendants(&privilege.children, DAV_NS, "bind", &mut nodes);
            collect_xml_descendants(&privilege.children, DAV_NS, "unbind", &mut nodes);
            nodes
        })
        .map(|node| node.local.as_str())
        .collect::<std::collections::HashSet<_>>();
    let all = names.contains("all") || names.contains("write");
    CalendarCapabilities {
        create: if all || names.contains("bind") {
            Capability::Allowed
        } else {
            Capability::Denied
        },
        update: if all || names.contains("write-content") || names.contains("write-properties") {
            Capability::Allowed
        } else {
            Capability::Denied
        },
        delete: if all || names.contains("unbind") {
            Capability::Allowed
        } else {
            Capability::Denied
        },
    }
}

fn capabilities_from_xml(xml: &str) -> Result<CalendarCapabilities> {
    let responses = response_nodes(xml)?;
    Ok(responses
        .first()
        .map(capability_for_response)
        .unwrap_or_default())
}

fn read_only_for(capabilities: CalendarCapabilities) -> bool {
    capabilities.create == Capability::Denied
        && capabilities.update == Capability::Denied
        && capabilities.delete == Capability::Denied
}

fn operation_capability(
    capabilities: CalendarCapabilities,
    operation: CalendarOperation,
) -> Capability {
    match operation {
        CalendarOperation::Create => capabilities.create,
        CalendarOperation::Update => capabilities.update,
        CalendarOperation::Delete => capabilities.delete,
    }
}

fn is_authentication_error(error: &anyhow::Error) -> bool {
    error.to_string().contains("认证失败（401）")
}

fn sync_range() -> (DateTime<Utc>, DateTime<Utc>) {
    let now = Utc::now();
    (now - Duration::days(366), now + Duration::days(731))
}

fn calendar_query_body(start: DateTime<Utc>, end: DateTime<Utc>) -> String {
    format!(
        "<?xml version=\"1.0\"?><c:calendar-query xmlns:d=\"DAV:\" xmlns:c=\"urn:ietf:params:xml:ns:caldav\"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name=\"VCALENDAR\"><c:comp-filter name=\"VEVENT\"><c:time-range start=\"{}\" end=\"{}\"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>",
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
            match status.as_u16() {
                401 => bail!("认证失败（401）"),
                403 => bail!("权限拒绝（403）"),
                _ => bail!("CalDAV 发现失败 {status}"),
            }
        }
        Ok(text)
    }
    fn discover(&self) -> Result<Vec<Calendar>> {
        let a = self.account()?;
        let root = format!("{}/", a.server_url.trim_end_matches('/'));
        let principal_doc = self.propfind(&root, "0", "<d:current-user-principal/>")?;
        let principal_href = property_child_text(
            &principal_doc,
            DAV_NS,
            "current-user-principal",
            DAV_NS,
            "href",
        )?
        .context("CalDAV principal 缺少地址")?;
        let principal = resolve_url(&root, &principal_href)?;
        let home_doc = self.propfind(&principal, "0", "<c:calendar-home-set/>")?;
        let home_href =
            property_child_text(&home_doc, CALDAV_NS, "calendar-home-set", DAV_NS, "href")?
                .context("CalDAV 日历目录缺少地址")?;
        let home = resolve_url(&principal, &home_href)?;

        let text = self.propfind(
            &home,
            "1",
            "<d:displayname/><d:resourcetype/><c:supported-calendar-component-set/><d:current-user-privilege-set/>",
        )?;
        let clean_home_url = home.trim_end_matches('/');
        let mut out = vec![];
        for response in response_nodes(&text)? {
            let properties = successful_properties(&response);
            let resource_type = properties
                .iter()
                .flat_map(|prop| xml_descendants(&prop.children, DAV_NS, "resourcetype"))
                .next();
            if !resource_type.is_some_and(|node| {
                !xml_descendants(&node.children, CALDAV_NS, "calendar").is_empty()
            }) {
                continue;
            }
            let component_set = properties
                .iter()
                .flat_map(|prop| {
                    xml_descendants(
                        &prop.children,
                        CALDAV_NS,
                        "supported-calendar-component-set",
                    )
                })
                .next();
            if let Some(component_set) = component_set {
                let has_vevent = xml_descendants(&component_set.children, CALDAV_NS, "comp")
                    .iter()
                    .any(|component| {
                        component.attributes.iter().any(|(name, value)| {
                            name == "name" && value.eq_ignore_ascii_case("VEVENT")
                        })
                    });
                if !has_vevent {
                    continue;
                }
            }
            let href = response
                .children
                .iter()
                .find(|node| node.namespace == DAV_NS && node.local == "href")
                .map(xml_text)
                .unwrap_or_default();
            if href.is_empty() {
                continue;
            }
            let cal_url = resolve_url(&home, &href)?;
            let clean_cal_url = cal_url.trim_end_matches('/');
            if clean_cal_url == clean_home_url || clean_cal_url.ends_with("/calendars") {
                continue;
            }
            let name = properties
                .iter()
                .flat_map(|prop| xml_descendants(&prop.children, DAV_NS, "displayname"))
                .next()
                .map(xml_text)
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| href.clone());
            let capabilities = capability_for_response(&response);
            out.push(Calendar {
                id: href.clone(),
                name,
                href: cal_url,
                read_only: read_only_for(capabilities),
                capabilities,
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
            if let Some(ics) = tag(&block, "calendar-data")
                && let Some(mut event) = parse_event(&ics)
            {
                event.calendar_id = cal.id.clone();
                event.href =
                    resolve_url(&cal.href, &href).map_err(|error| CalendarReportError {
                        status,
                        detail: error.to_string(),
                        retryable: false,
                    })?;
                event.etag = etag;
                events.push(event);
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
            unique.insert(format!("{}\u{1f}{}", event.calendar_id, event.href), event);
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
            .into_iter()
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
        write(&self.dir.join("calendars.json"), &chosen)?;
        write(&self.dir.join("events.json"), &events)?;
        Ok(
            json!({"calendars":chosen,"events":events,"warnings":warnings,"syncedAt":Utc::now().to_rfc3339()}),
        )
    }
    fn refresh_calendar_capabilities(&self, calendar: &Calendar) -> Result<CalendarCapabilities> {
        let xml = self.propfind(&calendar.href, "0", "<d:current-user-privilege-set/>")?;
        capabilities_from_xml(&xml)
    }

    fn refresh_resource_capability(
        &self,
        href: &str,
        operation: CalendarOperation,
    ) -> Result<Capability> {
        let xml = match self.propfind(href, "0", "<d:current-user-privilege-set/>") {
            Ok(xml) => xml,
            Err(error) if is_authentication_error(&error) => return Err(error),
            Err(_) => return Ok(Capability::Unknown),
        };
        Ok(operation_capability(
            capabilities_from_xml(&xml)?,
            operation,
        ))
    }

    fn calendar_for_operation(
        &self,
        calendar_id: &str,
        operation: CalendarOperation,
    ) -> Result<Calendar> {
        let mut calendars: Vec<Calendar> = read(&self.dir.join("calendars.json"))?;
        let index = calendars
            .iter()
            .position(|calendar| calendar.id == calendar_id)
            .context("日历不存在")?;
        let mut calendar = calendars[index].clone();
        let current = operation_capability(calendar.capabilities, operation);
        let operation_capability = match current {
            Capability::Allowed | Capability::Denied => current,
            Capability::Unknown => match self.refresh_calendar_capabilities(&calendar) {
                Ok(refreshed) => {
                    calendar.capabilities = refreshed;
                    calendar.read_only = read_only_for(refreshed);
                    calendars[index] = calendar.clone();
                    let _ = write(&self.dir.join("calendars.json"), &calendars);
                    operation_capability(refreshed, operation)
                }
                Err(error) if is_authentication_error(&error) => return Err(error),
                Err(_) => Capability::Unknown,
            },
        };
        if operation_capability == Capability::Denied {
            bail!("此日历只读")
        }
        Ok(calendar)
    }

    fn event_save(&self, e: Event, overwrite: bool) -> Result<Event> {
        if e.recurring {
            bail!("重复事件请在 Apple 日历中编辑")
        }
        let new = e.href.is_empty();
        let cal = self.calendar_for_operation(
            &e.calendar_id,
            if new {
                CalendarOperation::Create
            } else {
                CalendarOperation::Update
            },
        )?;
        if !new
            && self.refresh_resource_capability(&e.href, CalendarOperation::Update)?
                == Capability::Denied
        {
            bail!("此事件无修改权限")
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
        if z.status().as_u16() == 401 {
            bail!("认证失败（401）")
        }
        if z.status().as_u16() == 403 {
            bail!("权限拒绝（403）")
        }
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
        self.event_delete_authenticated(e, overwrite, &self.account()?.username, &self.pass()?)
    }

    fn event_delete_authenticated(
        &self,
        e: &Event,
        overwrite: bool,
        username: &str,
        password: &str,
    ) -> Result<()> {
        if e.recurring {
            bail!("重复事件请在 Apple 日历中删除")
        }
        let _calendar = self.calendar_for_operation(&e.calendar_id, CalendarOperation::Delete)?;
        // DAV:unbind is checked on the parent collection, not the event.
        // The server still enforces resource-specific constraints on DELETE.
        let mut r = self
            .http
            .delete(&e.href)
            .basic_auth(username, Some(password));
        if !overwrite {
            r = r.header("If-Match", format!("\"{}\"", e.etag))
        }
        let z = r.send()?;
        if z.status().as_u16() == 401 {
            bail!("认证失败（401）")
        }
        if z.status().as_u16() == 403 {
            bail!("权限拒绝（403）")
        }
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
            .timeout(StdDuration::from_secs(15))
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

    #[test]
    fn parses_namespaced_all_privilege_only_from_successful_propstat() {
        let xml = r#"<x:multistatus xmlns:x="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
          <x:response><x:href>/calendar/</x:href>
            <x:propstat><x:prop><x:current-user-privilege-set><x:privilege><x:write/></x:privilege></x:current-user-privilege-set></x:prop><x:status>HTTP/1.1 404 Not Found</x:status></x:propstat>
            <x:propstat><x:prop><x:current-user-privilege-set><x:privilege><x:all/></x:privilege></x:current-user-privilege-set></x:prop><x:status>HTTP/1.1 200 OK</x:status></x:propstat>
          </x:response>
        </x:multistatus>"#;
        assert_eq!(
            capabilities_from_xml(xml).unwrap(),
            CalendarCapabilities {
                create: Capability::Allowed,
                update: Capability::Allowed,
                delete: Capability::Allowed
            }
        );
    }

    #[test]
    fn parses_default_namespace_read_as_explicitly_denied() {
        let xml = r#"<multistatus xmlns="DAV:">
          <response><href>/calendar/</href><propstat><prop><current-user-privilege-set><privilege><read/></privilege></current-user-privilege-set></prop><status>HTTP/1.1 200 OK</status></propstat></response>
        </multistatus>"#;
        assert_eq!(
            capabilities_from_xml(xml).unwrap(),
            CalendarCapabilities {
                create: Capability::Denied,
                update: Capability::Denied,
                delete: Capability::Denied
            }
        );
        assert!(read_only_for(capabilities_from_xml(xml).unwrap()));
    }

    #[test]
    fn missing_or_failed_privilege_property_is_unknown() {
        let xml = r#"<d:multistatus xmlns:d="DAV:">
          <d:response><d:propstat><d:prop><d:current-user-privilege-set><d:privilege><d:write/></d:privilege></d:current-user-privilege-set></d:prop><d:status>HTTP/1.1 403 Forbidden</d:status></d:propstat></d:response>
        </d:multistatus>"#;
        assert_eq!(
            capabilities_from_xml(xml).unwrap(),
            CalendarCapabilities::default()
        );
    }

    #[test]
    fn xml_entities_preserve_names_and_discovery_urls() {
        let xml = r#"<d:multistatus xmlns:d="DAV:"><d:response><d:propstat><d:prop>
          <d:displayname>Work &amp; Home&#32;&#x4E2D;&lt;&gt;&quot;&apos;</d:displayname>
          <d:current-user-principal><d:href>/p?a=1&amp;b=&#50;</d:href></d:current-user-principal>
          </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>"#;
        let roots = parse_xml_tree(xml).unwrap();
        assert_eq!(
            xml_text(xml_descendants(&roots, DAV_NS, "displayname")[0]),
            "Work & Home 中<>\"'"
        );
        assert_eq!(
            property_child_text(xml, DAV_NS, "current-user-principal", DAV_NS, "href")
                .unwrap()
                .as_deref(),
            Some("/p?a=1&b=2")
        );
        assert!(parse_xml_tree("<name>&undefined;</name>").is_err());
    }

    #[test]
    fn delete_uses_parent_unbind_without_probing_event_privileges() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                .unwrap();
            let mut request = Vec::new();
            let mut byte = [0];
            while !request.ends_with(b"\r\n\r\n") {
                assert_eq!(stream.read(&mut byte).unwrap(), 1);
                request.push(byte[0]);
            }
            stream
                .write_all(b"HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n")
                .unwrap();
            String::from_utf8(request).unwrap()
        });
        let dir =
            std::env::temp_dir().join(format!("digiworld-delete-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        let app = App {
            dir: dir.clone(),
            http: Client::builder()
                .no_proxy()
                .timeout(std::time::Duration::from_secs(5))
                .build()
                .unwrap(),
        };
        let capabilities = CalendarCapabilities {
            create: Capability::Denied,
            update: Capability::Denied,
            delete: Capability::Allowed,
        };
        write(
            &dir.join("calendars.json"),
            &vec![Calendar {
                id: "cal".into(),
                name: "Test".into(),
                href: format!("{base}/cal/"),
                read_only: false,
                capabilities,
            }],
        )
        .unwrap();
        let event: Event = serde_json::from_value(json!({"id":"event", "calendarId":"cal", "href":format!("{base}/cal/event.ics"), "etag":"revision-1", "title":"Test", "start":"", "end":"", "allDay":false, "location":"", "notes":""})).unwrap();
        let result = app.event_delete_authenticated(&event, false, "test", "test");
        let request = server.join().unwrap();
        fs::remove_dir_all(&dir).unwrap();
        result.unwrap();
        assert!(request.starts_with("DELETE /cal/event.ics HTTP/1.1"));
        assert!(
            request
                .to_ascii_lowercase()
                .contains("if-match: \"revision-1\"")
        );
    }
}
