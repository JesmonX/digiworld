use crate::model::{AttachmentInfo, ParsedMessage};
use mailparse::MailHeaderMap;

const MAX_BODY_CHARS: usize = 1024 * 1024;

pub fn parse(raw: &[u8]) -> ParsedMessage {
    let Ok(mail) = mailparse::parse_mail(raw) else {
        return ParsedMessage {
            subject: "（无法解析的邮件）".into(),
            sender: String::new(),
            recipients: String::new(),
            received_at: None,
            body: String::new(),
            body_truncated: false,
            attachments: vec![],
        };
    };
    let subject = mail.headers.get_first_value("Subject").unwrap_or_default();
    let sender = mail.headers.get_first_value("From").unwrap_or_default();
    let recipients = mail.headers.get_first_value("To").unwrap_or_default();
    let received_at = mail
        .headers
        .get_first_value("Date")
        .and_then(|value| mailparse::dateparse(&value).ok())
        .and_then(|timestamp| chrono::DateTime::from_timestamp(timestamp, 0))
        .map(|value| value.to_rfc3339());
    let mut plain = Vec::new();
    let mut html = Vec::new();
    let mut attachments = Vec::new();
    collect_parts(&mail, &mut plain, &mut html, &mut attachments);
    let body = if plain.is_empty() {
        strip_html(&html.join("\n\n"))
    } else {
        plain.join("\n\n")
    };
    let body_truncated = body.chars().count() > MAX_BODY_CHARS;
    let body = body.chars().take(MAX_BODY_CHARS).collect();
    ParsedMessage {
        subject,
        sender,
        recipients,
        received_at,
        body,
        body_truncated,
        attachments,
    }
}

pub fn decode_text_part(
    raw: &[u8],
    mime_type: &str,
    charset: Option<&str>,
    encoding: &str,
) -> String {
    let charset = charset.unwrap_or("utf-8");
    let mut message = format!(
        "Content-Type: {mime_type}; charset=\"{charset}\"\r\nContent-Transfer-Encoding: {encoding}\r\n\r\n"
    )
    .into_bytes();
    message.extend_from_slice(raw);
    parse(&message).body
}

fn collect_parts(
    part: &mailparse::ParsedMail<'_>,
    plain: &mut Vec<String>,
    html: &mut Vec<String>,
    attachments: &mut Vec<AttachmentInfo>,
) {
    if !part.subparts.is_empty() {
        for child in &part.subparts {
            collect_parts(child, plain, html, attachments);
        }
        return;
    }
    let disposition = part.get_content_disposition();
    let filename = disposition
        .params
        .get("filename")
        .cloned()
        .or_else(|| part.ctype.params.get("name").cloned());
    let is_attachment =
        disposition.disposition == mailparse::DispositionType::Attachment || filename.is_some();
    if is_attachment {
        attachments.push(AttachmentInfo {
            filename: filename.unwrap_or_else(|| "未命名附件".into()),
            mime_type: part.ctype.mimetype.clone(),
            size: part
                .get_body_raw()
                .map(|body| body.len() as u64)
                .unwrap_or(0),
        });
        return;
    }
    if part.ctype.mimetype.eq_ignore_ascii_case("text/plain") {
        if let Ok(body) = part.get_body() {
            plain.push(body);
        }
    } else if part.ctype.mimetype.eq_ignore_ascii_case("text/html")
        && let Ok(body) = part.get_body()
    {
        html.push(body);
    }
}

fn strip_html(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    let mut inside = false;
    for ch in value.chars() {
        match ch {
            '<' => inside = true,
            '>' => {
                inside = false;
                result.push(' ');
            }
            _ if !inside => result.push(ch),
            _ => {}
        }
    }
    result
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_text_and_attachment_without_rendering_html() {
        let raw = b"From: Team <team@example.com>\r\nTo: Me <me@example.com>\r\nSubject: =?UTF-8?B?6YKu5Lu25Yqp5omL?=\r\nContent-Type: multipart/mixed; boundary=x\r\n\r\n--x\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nhello\r\n--x\r\nContent-Type: application/pdf; name=a.pdf\r\nContent-Disposition: attachment; filename=a.pdf\r\n\r\nabc\r\n--x--\r\n";
        let parsed = parse(raw);
        assert_eq!(parsed.subject, "邮件助手");
        assert!(parsed.body.contains("hello"));
        assert_eq!(parsed.attachments[0].filename, "a.pdf");
    }
}
