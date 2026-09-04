use anyhow::{Context, Result, bail};
use native_tls::TlsConnector;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;
use url::Url;

pub trait IoStream: Read + Write + Send {}
impl<T: Read + Write + Send> IoStream for T {}
pub type BoxedIo = Box<dyn IoStream>;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const IO_TIMEOUT: Duration = Duration::from_secs(60);

pub fn connect_tls(host: &str, port: u16) -> Result<BoxedIo> {
    let stream = connect_route(host, port)?;
    let connector = TlsConnector::builder().build().context("无法初始化 TLS")?;
    connector
        .connect(host, stream)
        .map(|stream| Box::new(stream) as BoxedIo)
        .map_err(|error| match error {
            native_tls::HandshakeError::Failure(error) => anyhow::anyhow!("TLS 握手失败: {error}"),
            native_tls::HandshakeError::WouldBlock(_) => anyhow::anyhow!("TLS 握手超时"),
        })
}

fn connect_route(host: &str, port: u16) -> Result<BoxedIo> {
    let mode = std::env::var("DIGIWORLD_PROXY_MODE").unwrap_or_else(|_| "system".into());
    if mode == "direct" {
        return direct(host, port);
    }
    let proxy = proxy_url()?;
    if mode == "custom" && proxy.is_none() {
        bail!("自定义代理没有可用地址，请在 Digiworld 设置中重新保存代理")
    }
    let Some(proxy) = proxy else {
        return direct(host, port);
    };
    let parsed = Url::parse(&proxy).context("代理地址无效")?;
    let proxy_host = parsed.host_str().context("代理地址缺少主机")?;
    let proxy_port = parsed.port().context("代理地址缺少端口")?;
    match parsed.scheme() {
        "socks5" | "socks5h" => {
            let target = if parsed.scheme() == "socks5" {
                let address = (host, port)
                    .to_socket_addrs()
                    .context("无法解析 IMAP 主机")?
                    .next()
                    .context("IMAP 主机没有可用地址")?;
                socks::TargetAddr::Ip(address)
            } else {
                socks::TargetAddr::Domain(host.to_string(), port)
            };
            let stream = socks::Socks5Stream::connect((proxy_host, proxy_port), target)
                .context("SOCKS5 代理连接失败")?
                .into_inner();
            configure(&stream)?;
            Ok(Box::new(stream))
        }
        "http" | "https" => {
            let tcp = tcp(proxy_host, proxy_port).context("HTTP 代理连接失败")?;
            let mut stream: BoxedIo = if parsed.scheme() == "https" {
                let connector = TlsConnector::builder()
                    .build()
                    .context("无法初始化代理 TLS")?;
                Box::new(
                    connector
                        .connect(proxy_host, Box::new(tcp) as BoxedIo)
                        .map_err(|error| match error {
                            native_tls::HandshakeError::Failure(error) => {
                                anyhow::anyhow!("HTTPS 代理握手失败: {error}")
                            }
                            native_tls::HandshakeError::WouldBlock(_) => {
                                anyhow::anyhow!("HTTPS 代理握手超时")
                            }
                        })?,
                )
            } else {
                Box::new(tcp)
            };
            http_connect(&mut stream, host, port)?;
            Ok(stream)
        }
        scheme => bail!("邮件连接不支持代理协议 {scheme}"),
    }
}

fn proxy_url() -> Result<Option<String>> {
    let environment = ["ALL_PROXY", "all_proxy", "HTTPS_PROXY", "https_proxy"]
        .into_iter()
        .find_map(|name| {
            std::env::var(name)
                .ok()
                .filter(|value| !value.trim().is_empty())
        });
    if environment.is_some() {
        return Ok(environment);
    }
    system_proxy_url()
}

#[cfg(not(windows))]
fn system_proxy_url() -> Result<Option<String>> {
    Ok(None)
}

#[cfg(windows)]
fn system_proxy_url() -> Result<Option<String>> {
    use winreg::RegKey;
    use winreg::enums::HKEY_CURRENT_USER;

    if std::env::var("DIGIWORLD_PROXY_MODE").ok().as_deref() != Some("system") {
        return Ok(None);
    }
    let settings = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings")
        .context("无法读取 Windows 系统代理设置")?;
    let enabled: u32 = settings.get_value("ProxyEnable").unwrap_or(0);
    if enabled != 1 {
        let pac: String = settings.get_value("AutoConfigURL").unwrap_or_default();
        if !pac.trim().is_empty() {
            bail!("邮件连接暂不支持 PAC 系统代理，请在 Digiworld 中选择自定义代理")
        }
        return Ok(None);
    }
    let raw: String = settings
        .get_value("ProxyServer")
        .context("Windows 系统代理没有服务器地址")?;
    let selected = if raw.contains('=') {
        raw.split(';')
            .find_map(|entry| {
                entry
                    .strip_prefix("https=")
                    .or_else(|| entry.strip_prefix("http="))
            })
            .context("Windows 系统代理没有 HTTP 或 HTTPS 代理")?
            .to_string()
    } else {
        raw
    };
    if selected.contains("://") {
        Ok(Some(selected))
    } else {
        Ok(Some(format!("http://{selected}")))
    }
}

fn direct(host: &str, port: u16) -> Result<BoxedIo> {
    Ok(Box::new(tcp(host, port).context("无法连接 IMAP 服务器")?))
}

fn tcp(host: &str, port: u16) -> Result<TcpStream> {
    let addresses = (host, port).to_socket_addrs()?;
    let mut last = None;
    for address in addresses {
        match TcpStream::connect_timeout(&address, CONNECT_TIMEOUT) {
            Ok(stream) => {
                configure(&stream)?;
                return Ok(stream);
            }
            Err(error) => last = Some(error),
        }
    }
    Err(last
        .map(anyhow::Error::from)
        .unwrap_or_else(|| anyhow::anyhow!("主机没有可用地址")))
}

fn configure(stream: &TcpStream) -> Result<()> {
    stream.set_read_timeout(Some(IO_TIMEOUT))?;
    stream.set_write_timeout(Some(IO_TIMEOUT))?;
    stream.set_nodelay(true)?;
    Ok(())
}

fn http_connect(stream: &mut BoxedIo, host: &str, port: u16) -> Result<()> {
    let authority = format!("{host}:{port}");
    write!(
        stream,
        "CONNECT {authority} HTTP/1.1\r\nHost: {authority}\r\nProxy-Connection: Keep-Alive\r\n\r\n"
    )?;
    stream.flush()?;
    let mut response = Vec::with_capacity(512);
    let mut byte = [0_u8; 1];
    while response.len() < 16 * 1024 {
        stream.read_exact(&mut byte)?;
        response.push(byte[0]);
        if response.ends_with(b"\r\n\r\n") {
            break;
        }
    }
    let text = String::from_utf8_lossy(&response);
    let status = text.lines().next().unwrap_or_default();
    if !status
        .split_whitespace()
        .nth(1)
        .is_some_and(|code| code.starts_with('2'))
    {
        bail!("HTTP 代理拒绝 CONNECT: {status}")
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proxy_precedence_prefers_all_proxy() {
        unsafe {
            std::env::set_var("ALL_PROXY", "socks5h://127.0.0.1:7890");
            std::env::set_var("HTTPS_PROXY", "http://127.0.0.1:8080");
        }
        assert_eq!(
            proxy_url().unwrap().as_deref(),
            Some("socks5h://127.0.0.1:7890")
        );
        unsafe {
            std::env::remove_var("ALL_PROXY");
            std::env::remove_var("HTTPS_PROXY");
        }
    }
}
