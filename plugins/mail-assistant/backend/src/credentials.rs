use anyhow::{Context, Result};

const SERVICE: &str = "io.github.jesmonx.digiworld.mail-assistant";

pub fn get(account_id: &str) -> Result<String> {
    keyring::Entry::new(SERVICE, account_id)
        .context("无法访问操作系统凭据库")?
        .get_password()
        .context("邮箱授权码不存在或操作系统凭据库不可用")
}

pub fn set(account_id: &str, secret: &str) -> Result<()> {
    keyring::Entry::new(SERVICE, account_id)
        .context("无法访问操作系统凭据库")?
        .set_password(secret)
        .context("无法将邮箱授权码写入操作系统凭据库")
}

pub fn delete(account_id: &str) -> Result<()> {
    let entry = keyring::Entry::new(SERVICE, account_id).context("无法访问操作系统凭据库")?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error).context("无法从操作系统凭据库删除邮箱授权码"),
    }
}

pub fn exists(account_id: &str) -> bool {
    get(account_id).is_ok()
}
