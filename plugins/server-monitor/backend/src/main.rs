use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    fs,
    io::{BufRead, Write},
    path::PathBuf,
    process::{Command, Stdio},
};
#[derive(Deserialize)]
struct Req {
    id: Value,
    method: String,
    #[serde(default)]
    params: Value,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Device {
    id: String,
    label: String,
    host: String,
    #[serde(default)]
    disks: Vec<String>,
    #[serde(default = "yes")]
    show_cpu: bool,
    #[serde(default = "yes")]
    show_gpu: bool,
    #[serde(default = "yes")]
    show_traffic: bool,
    #[serde(default)]
    interfaces: Vec<String>,
    #[serde(default = "yes")]
    show_disk_device: bool,
    #[serde(default)]
    show_gpu_labels: bool,
    #[serde(default)]
    show_gpu_power: bool,
}
#[derive(Default, Serialize, Deserialize)]
struct Settings {
    devices: Vec<Device>,
}
fn yes() -> bool {
    true
}
struct App {
    dir: PathBuf,
}
const HELPER: &str = r#"import json,os,subprocess,time
def read(p):
 try:return open(p).read().strip()
 except:return ''
def cmd(a):
 try:return subprocess.run(a,text=True,capture_output=True,timeout=5).stdout.strip()
 except:return ''
def num(v):
 try:return float(v)
 except:return None
mem={}
for x in read('/proc/meminfo').splitlines():
 k,_,v=x.partition(':'); mem[k]=int((v.strip().split() or ['0'])[0])*1024
load=read('/proc/loadavg').split()
disks=[]
raw=cmd(['df','-B1','-P','-x','tmpfs','-x','devtmpfs','-x','squashfs'])
for line in raw.splitlines()[1:]:
 p=line.split()
 if len(p)>=6: disks.append({'device':p[0],'total':int(p[1]),'used':int(p[2]),'available':int(p[3]),'percent':float(p[4][:-1]),'mount':' '.join(p[5:])})
gpu=[]
raw=cmd(['nvidia-smi','--query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw','--format=csv,noheader,nounits'])
for line in raw.splitlines():
 p=[x.strip() for x in line.split(',')]
 if len(p)>=6:
  try:
   gpu.append({
    'index':int(p[0]),
    'name':p[1],
    'utilization':float(p[2]),
    'memoryUsedMiB':float(p[3]),
    'memoryTotalMiB':float(p[4]),
    'temperatureC':num(p[5]),
    'powerDrawW':num(p[6]) if len(p)>=7 else None
   })
  except:pass
net=[]
for line in read('/proc/net/dev').splitlines()[2:]:
 if ':' not in line:continue
 name,data=line.split(':',1); p=data.split()
 if len(p)>=16 and name.strip()!='lo':net.append({'name':name.strip(),'receivedBytes':int(p[0]),'sentBytes':int(p[8])})
vn=None
try:
 r=subprocess.run(['vnstat','--json','d'],text=True,capture_output=True,timeout=8)
 if r.returncode==0:vn=json.loads(r.stdout)
except:pass
print(json.dumps({'hostname':read('/etc/hostname') or os.uname().nodename,'timestamp':int(time.time()),'uptimeSeconds':float(read('/proc/uptime').split()[0]),'memory':{'total':mem.get('MemTotal',0),'available':mem.get('MemAvailable',0),'used':mem.get('MemTotal',0)-mem.get('MemAvailable',0)},'cpu':{'logicalCores':os.cpu_count() or 0,'load1':float(load[0]) if load else 0,'load5':float(load[1]) if len(load)>1 else 0,'load15':float(load[2]) if len(load)>2 else 0},'disks':disks,'gpus':gpu,'network':net,'vnstat':vn}))"#;
impl App {
    fn settings(&self) -> Result<Settings> {
        let p = self.dir.join("settings.json");
        if !p.exists() {
            return Ok(Settings::default());
        }
        Ok(serde_json::from_slice(&fs::read(p)?)?)
    }
    fn save(&self, s: &Settings) -> Result<()> {
        for d in &s.devices {
            valid(d)?
        }
        fs::write(
            self.dir.join("settings.json"),
            serde_json::to_vec_pretty(s)?,
        )?;
        Ok(())
    }
    fn sample(&self, id: Option<&str>) -> Result<Value> {
        let s = self.settings()?;
        let mut out = vec![];
        for d in s.devices.iter().filter(|d| id.is_none_or(|x| x == d.id)) {
            let selection = json!({
                "disks": d.disks,
                "interfaces": d.interfaces,
                "showCpu": d.show_cpu,
                "showGpu": d.show_gpu,
                "showTraffic": d.show_traffic,
                "showDiskDevice": d.show_disk_device,
                "showGpuLabels": d.show_gpu_labels,
                "showGpuPower": d.show_gpu_power,
            });
            match ssh(&d.host, HELPER) {
                Ok(mut v) => {
                    v["id"] = json!(d.id);
                    v["label"] = json!(d.label);
                    v["selection"] = selection;
                    out.push(v);
                }
                Err(e) => {
                    out.push(json!({
                        "id": d.id,
                        "label": d.label,
                        "error": e.to_string(),
                        "selection": selection,
                    }));
                }
            }
        }
        Ok(json!({"devices":out}))
    }
}
fn valid(d: &Device) -> Result<()> {
    if d.id.is_empty()
        || d.id.len() > 80
        || !d
            .id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
    {
        bail!("设备 ID 无效")
    }
    if d.label.trim().is_empty() || d.label.len() > 80 {
        bail!("设备名称无效")
    }
    host(&d.host)?;
    Ok(())
}
fn host(h: &str) -> Result<()> {
    if h.is_empty()
        || h.starts_with('-')
        || h.len() > 253
        || !h
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
    {
        bail!("SSH Host 必须是安全的 OpenSSH 配置别名")
    }
    Ok(())
}
fn ssh(h: &str, script: &str) -> Result<Value> {
    host(h)?;
    let hex = script
        .as_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    let remote = format!("python3 -c 'exec(bytes.fromhex(\"{hex}\").decode())'");
    let out = Command::new(if cfg!(windows) { "ssh.exe" } else { "ssh" })
        .args([
            "-T",
            "-o",
            "BatchMode=yes",
            "-o",
            "StrictHostKeyChecking=yes",
            "-o",
            "ConnectTimeout=10",
            h,
            &remote,
        ])
        .stdin(Stdio::null())
        .output()
        .context("无法启动系统 OpenSSH")?;
    if !out.status.success() {
        bail!(
            "SSH 采集失败：{}",
            String::from_utf8_lossy(&out.stderr)
                .chars()
                .take(500)
                .collect::<String>()
        )
    }
    if out.stdout.len() > 4 * 1024 * 1024 {
        bail!("远端数据超过 4 MiB")
    }
    serde_json::from_slice(&out.stdout).context("远端未返回有效 JSON")
}
fn setup(h: &str, install: bool) -> Result<Value> {
    host(h)?;
    let detect = "if command -v vnstat >/dev/null; then echo ready; elif command -v apt-get >/dev/null; then echo apt; elif command -v dnf >/dev/null; then echo dnf; else echo unsupported; fi";
    let kind = run(h, detect)?.trim().to_string();
    let command = match kind.as_str() {
        "ready" => {
            "vnstat --version && (systemctl is-active vnstat || systemctl is-active vnstatd || true)"
        }
        "apt" => {
            "sudo -n apt-get update && sudo -n apt-get install -y vnstat && sudo -n systemctl enable --now vnstat"
        }
        "dnf" => "sudo -n dnf install -y vnstat && sudo -n systemctl enable --now vnstat",
        "unsupported" => "# 请使用系统包管理器安装 vnstat 并启用 vnstat 服务",
        _ => "vnstat --version",
    };
    if install && kind != "unsupported" && kind != "ready" {
        if let Err(error) = run(h, command) {
            return Ok(json!({
                "status": "install_failed",
                "manager": kind,
                "command": command,
                "error": error.to_string()
            }));
        }
        let verification =
            "vnstat --version && (systemctl is-active vnstat || systemctl is-active vnstatd)";
        return match run(h, verification) {
            Ok(output) => Ok(json!({
                "status": "ready",
                "manager": kind,
                "command": command,
                "verification": output
            })),
            Err(error) => Ok(json!({
                "status": "install_failed",
                "manager": kind,
                "command": command,
                "error": format!("安装完成，但服务验证失败：{error}")
            })),
        };
    }
    Ok(
        json!({"status":if kind=="ready"{"ready"}else if install{"installed"}else{"missing"},"manager":kind,"command":command}),
    )
}
fn run(h: &str, c: &str) -> Result<String> {
    let o = Command::new(if cfg!(windows) { "ssh.exe" } else { "ssh" })
        .args([
            "-T",
            "-o",
            "BatchMode=yes",
            "-o",
            "StrictHostKeyChecking=yes",
            "-o",
            "ConnectTimeout=10",
            h,
            c,
        ])
        .output()?;
    if !o.status.success() {
        bail!(
            "远端命令失败：{}",
            String::from_utf8_lossy(&o.stderr)
                .chars()
                .take(500)
                .collect::<String>()
        )
    }
    Ok(String::from_utf8_lossy(&o.stdout).into())
}
fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_ansi(false)
        .init();
    let dir = data_dir()?;
    fs::create_dir_all(&dir)?;
    let a = App { dir };
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
        "servers.settings.get" => Ok(serde_json::to_value(a.settings()?)?),
        "servers.settings.save" => {
            let s: Settings = serde_json::from_value(p.get("settings").cloned().unwrap_or(p))?;
            a.save(&s)?;
            Ok(serde_json::to_value(s)?)
        }
        "servers.sample" => a.sample(p.get("id").and_then(Value::as_str)),
        "servers.vnstat.setup" => setup(
            p["host"].as_str().context("缺少 SSH Host")?,
            p["install"].as_bool().unwrap_or(false),
        ),
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
    fn ssh_alias_validation_blocks_options() {
        assert!(host("prod-gpu-1").is_ok());
        assert!(host("-oProxyCommand=bad").is_err());
        assert!(host("name with spaces").is_err())
    }
}
