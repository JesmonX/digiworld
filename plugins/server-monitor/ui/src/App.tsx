import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Input, Card, Status } from '@digiworld/design-system/react'
import { createPluginBridge } from '@digiworld/plugin-sdk'
import { Server, Plus, RefreshCw, HardDrive, MemoryStick, Cpu, Gauge, Network, Settings, X, LoaderCircle, AlertCircle } from 'lucide-react'

const bridge = createPluginBridge('io.github.jesmonx.digiworld.server-monitor')

type Config = {
  id: string
  label: string
  host: string
  disks: string[]
  interfaces: string[]
  showCpu: boolean
  showGpu: boolean
  showTraffic: boolean
}

type Disk = {
  device: string
  mount: string
  total: number
  used: number
  percent: number
}

type Net = {
  name: string
  receivedBytes: number
  sentBytes: number
  receivedPerSecond: number | undefined
  sentPerSecond: number | undefined
}

type Device = {
  id: string
  label: string
  error?: string
  hostname?: string
  timestamp?: number
  uptimeSeconds?: number
  memory?: { total: number; used: number }
  cpu?: { logicalCores: number; load1: number; load5: number }
  disks?: Disk[]
  gpus?: { index: number; name: string; utilization: number; memoryUsedMiB: number; memoryTotalMiB: number; temperatureC: number }[]
  network?: Net[]
  vnstat?: { interfaces?: { name: string; traffic?: { day?: { date: { year: number; month: number; day: number }; rx: number; tx: number }[] } }[] }
  selection: Config
}

const previous = new Map<string, { at: number; rx: number; tx: number }>()
const size = (v: number) => `${(v / 1024 ** 3).toFixed(1)} GB`
const rate = (v: number) => v < 1024 ? `${v.toFixed(0)} B/s` : v < 1024 ** 2 ? `${(v / 1024).toFixed(1)} KB/s` : `${(v / 1024 ** 2).toFixed(1)} MB/s`
const pct = (a: number, b: number) => b ? Math.round((a / b) * 100) : 0

export default function App() {
  const [configs, setConfigs] = useState<Config[]>([])
  const [devices, setDevices] = useState<Device[]>([])
  const [draft, setDraft] = useState<Config | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionBusy, setActionBusy] = useState<'detect' | 'install' | 'save' | null>(null)
  const [setup, setSetup] = useState('')

  const isActiveRef = useRef(true)
  const isRefreshingRef = useRef(false)
  const sampleGenerationRef = useRef(0)
  const draftRef = useRef<Config | null>(null)
  draftRef.current = draft

  const refreshSamples = useCallback(async (currentConfigs?: Config[]) => {
    if (isRefreshingRef.current) return
    isRefreshingRef.current = true
    const currentGen = sampleGenerationRef.current
    try {
      const activeConfigs = currentConfigs ?? configs
      if (!activeConfigs.length) {
        setDevices([])
        return
      }
      const sampleRes = await bridge.request<{ devices: Device[] }>('servers.sample')
      if (sampleGenerationRef.current !== currentGen) return

      setDevices(sampleRes.devices.map(d => {
        if (!d.network || !d.timestamp) return d
        return {
          ...d,
          network: d.network.map(n => {
            const key = `${d.id}:${n.name}`
            const p = previous.get(key)
            const seconds = p ? Math.max(1, d.timestamp! - p.at) : 1
            previous.set(key, { at: d.timestamp!, rx: n.receivedBytes, tx: n.sentBytes })
            return {
              ...n,
              receivedPerSecond: p && n.receivedBytes >= p.rx ? (n.receivedBytes - p.rx) / seconds : undefined,
              sentPerSecond: p && n.sentBytes >= p.tx ? (n.sentBytes - p.tx) / seconds : undefined,
            }
          }),
        }
      }))
    } catch (e) {
      if (sampleGenerationRef.current === currentGen) {
        setError(String(e))
      }
    } finally {
      isRefreshingRef.current = false
    }
  }, [configs])

  const loadSettings = useCallback(async () => {
    setBusy(true)
    try {
      const s = await bridge.request<{ devices: Config[] }>('servers.settings.get')
      setConfigs(s.devices)
      await refreshSamples(s.devices)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }, [refreshSamples])

  useEffect(() => {
    void loadSettings()
    bridge.ready()

    const unlisten = bridge.on<{ active: boolean }>('host.visibility', ({ active }) => {
      isActiveRef.current = active
      if (active) {
        void refreshSamples()
      }
    })

    const intervalId = setInterval(() => {
      if (isActiveRef.current && !draftRef.current) {
        void refreshSamples()
      }
    }, 5000)

    return () => {
      unlisten()
      clearInterval(intervalId)
    }
  }, [loadSettings, refreshSamples])

  const edit = (c?: Config) => {
    setSetup('')
    setError('')
    setDraft(c ? { ...c } : {
      id: crypto.randomUUID().replaceAll('-', '').slice(0, 12),
      label: '',
      host: '',
      disks: [],
      interfaces: [],
      showCpu: true,
      showGpu: true,
      showTraffic: true,
    })
  }

  const save = async () => {
    if (!draft) return
    setActionBusy('save')
    setError('')
    const previousConfigs = configs
    const previousDevices = devices
    try {
      sampleGenerationRef.current += 1
      const next = [...configs.filter(x => x.id !== draft.id), draft]
      setConfigs(next)
      setDevices(prev => {
        const found = prev.some(x => x.id === draft.id)
        if (found) {
          return prev.map(x => x.id === draft.id ? { ...x, label: draft.label, selection: draft } : x)
        } else {
          return [...prev, { id: draft.id, label: draft.label, selection: draft, disks: [], gpus: [], network: [] }]
        }
      })
      await bridge.request('servers.settings.save', { settings: { devices: next } })
      setDraft(null)
      void refreshSamples(next)
    } catch (e) {
      setConfigs(previousConfigs)
      setDevices(previousDevices)
      setError(String(e))
    } finally {
      setActionBusy(null)
    }
  }

  const vnstat = async (install: boolean) => {
    if (!draft) return
    setActionBusy(install ? 'install' : 'detect')
    setSetup('')
    try {
      const r = await bridge.request<{
        status: string
        command: string
        error?: string
        verification?: string
        manager?: string
      }>('servers.vnstat.setup', { host: draft.host, install }, { timeoutMs: 120_000 })
      const parts = [
        r.status === 'ready' ? 'vnStat 状态：正常就绪' : r.status === 'installed' ? 'vnStat 状态：已安装' : `vnStat 状态：${r.status}`,
        r.manager ? `包管理器：${r.manager}` : '',
        r.verification,
        r.error,
        r.command ? `执行命令：${r.command}` : '',
      ].filter(Boolean)
      setSetup(parts.join('\n'))
    } catch (e) {
      setError(String(e))
    } finally {
      setActionBusy(null)
    }
  }

  return (
    <main>
      <header className="dw-toolbar">
        <div>
          <Server size={18} />
          <strong>远程 Linux 设备</strong>
        </div>
        <Button onClick={() => edit()}><Plus size={15} />添加设备</Button>
        <Button onClick={() => void loadSettings()} disabled={busy}>
          <RefreshCw className={busy ? 'spin' : ''} size={15} />刷新
        </Button>
      </header>

      {error && <Status tone="error">{error}</Status>}

      <section className="devices">
        {configs.length === 0 ? (
          <Status>使用 OpenSSH 配置别名添加第一台 Linux 设备。</Status>
        ) : (
          devices.map(d => {
            const visibleDisks = (d.disks || []).filter(x => !d.selection.disks.length || d.selection.disks.includes(x.mount))
            const visibleInterfaces = (d.network || []).filter(x => !d.selection.interfaces.length || d.selection.interfaces.includes(x.name))
            const visibleVnstat = d.vnstat?.interfaces?.filter(v => !d.selection.interfaces.length || d.selection.interfaces.includes(v.name)) ?? []
            return (
              <Card key={d.id}>
                <header>
                  <div>
                    <Server size={16} />
                    <span>
                      <strong>{d.label}</strong>
                      <small>
                        {d.hostname ? `${d.hostname} · 运行 ${Math.floor((d.uptimeSeconds ?? 0) / 86400)} 天` : d.error ? '连接异常' : '载入中…'}
                      </small>
                    </span>
                  </div>
                  <Button aria-label="设备设置" onClick={() => edit(configs.find(x => x.id === d.id))}>
                    <Settings size={15} />
                  </Button>
                </header>

                {d.error ? (
                  <Status tone="error" className="device-error">
                    <AlertCircle size={14} />
                    <span>{d.error}</span>
                  </Status>
                ) : (
                  <>
                    {d.memory && (
                      <div className="metrics">
                        <Metric
                          icon={<MemoryStick size={15} />}
                          title="内存"
                          value={`${size(d.memory.used)} / ${size(d.memory.total)}`}
                          percent={pct(d.memory.used, d.memory.total)}
                        />
                        {d.selection.showCpu && d.cpu && (
                          <Metric
                            icon={<Cpu size={15} />}
                            title="CPU Load"
                            value={`${d.cpu.load1.toFixed(2)} / ${d.cpu.logicalCores} 核`}
                            percent={Math.min(100, (d.cpu.load1 / d.cpu.logicalCores) * 100)}
                          />
                        )}
                      </div>
                    )}

                    {visibleDisks.length > 0 && (
                      <div className="disk-grid">
                        {visibleDisks.map(x => (
                          <Metric
                            key={x.mount}
                            icon={<HardDrive size={15} />}
                            title={`${x.mount} · ${x.device}`}
                            value={`${size(x.used)} / ${size(x.total)}`}
                            percent={x.percent}
                          />
                        ))}
                      </div>
                    )}

                    {d.selection.showGpu && (
                      <div className="gpu-grid">
                        {d.gpus && d.gpus.length > 0 ? (
                          d.gpus.map(g => (
                            <Metric
                              key={g.index}
                              icon={<Gauge size={15} />}
                              title={`GPU ${g.index} · ${g.name}`}
                              value={`${g.utilization}% · ${g.memoryUsedMiB}/${g.memoryTotalMiB} MiB · ${g.temperatureC}°C`}
                              percent={g.utilization}
                            />
                          ))
                        ) : (
                          <small className="gpu-unavailable">NVIDIA GPU 不可用</small>
                        )}
                      </div>
                    )}

                    {d.selection.showTraffic && (
                      <div className="traffic">
                        <div className="traffic-head">
                          <Network size={15} />
                          <small>{d.vnstat ? 'vnStat 每日记录已连接' : '未检测到 vnStat，仅显示网卡累计'}</small>
                        </div>
                        {visibleInterfaces.length > 0 && (
                          <div className="traffic-rates">
                            {visibleInterfaces.map(n => (
                              <span key={n.name}>
                                <strong>{n.name}</strong> ↓ {n.receivedPerSecond === undefined ? '采样中' : rate(n.receivedPerSecond)} ↑ {n.sentPerSecond === undefined ? '采样中' : rate(n.sentPerSecond)} · 累计 ↓ {size(n.receivedBytes)} ↑ {size(n.sentBytes)}
                              </span>
                            ))}
                          </div>
                        )}
                        {visibleVnstat.length > 0 && (
                          <details className="daily-details">
                            <summary><small>每日流量历史 (最多 30 天)</small></summary>
                            {visibleVnstat.map(v => (
                              <div className="daily" key={v.name}>
                                <strong>{v.name} · 每日流量</strong>
                                {(v.traffic?.day || []).slice(-30).reverse().map(x => (
                                  <span key={`${x.date.year}-${x.date.month}-${x.date.day}`}>
                                    <time>{x.date.month}/{x.date.day}</time>
                                    <em>↓ {size(x.rx)} · ↑ {size(x.tx)}</em>
                                  </span>
                                ))}
                              </div>
                            ))}
                          </details>
                        )}
                      </div>
                    )}
                  </>
                )}
              </Card>
            )
          })
        )}
      </section>

      {draft && (
        <Card className="editor">
          <header>
            <h2>设备设置</h2>
            <Button aria-label="关闭" onClick={() => setDraft(null)}><X size={16} /></Button>
          </header>
          <label>
            名称
            <Input value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} />
          </label>
          <label>
            OpenSSH Host 别名
            <Input value={draft.host} onChange={e => setDraft({ ...draft, host: e.target.value })} />
          </label>
          <div className="toggles">
            {(['showCpu', 'showGpu', 'showTraffic'] as const).map((k, i) => (
              <label key={k}>
                <input
                  type="checkbox"
                  checked={draft[k]}
                  onChange={e => setDraft({ ...draft, [k]: e.target.checked })}
                />
                {['CPU', 'NVIDIA GPU', 'Traffic'][i]}
              </label>
            ))}
          </div>
          <p>选择要并列显示的挂载点和网卡；空选择表示全部显示。</p>
          {devices.find(x => x.id === draft.id && x.disks && x.network) && (
            <div className="selectors">
              <fieldset>
                <legend>硬盘 / 挂载点</legend>
                {(devices.find(x => x.id === draft.id)?.disks || []).map(x => (
                  <label key={x.mount}>
                    <input
                      type="checkbox"
                      checked={draft.disks.includes(x.mount)}
                      onChange={e => setDraft({
                        ...draft,
                        disks: e.target.checked ? [...draft.disks, x.mount] : draft.disks.filter(v => v !== x.mount),
                      })}
                    />
                    {x.mount} · {x.device}
                  </label>
                ))}
              </fieldset>
              <fieldset>
                <legend>网卡</legend>
                {(devices.find(x => x.id === draft.id)?.network || []).map(x => (
                  <label key={x.name}>
                    <input
                      type="checkbox"
                      checked={draft.interfaces.includes(x.name)}
                      onChange={e => setDraft({
                        ...draft,
                        interfaces: e.target.checked ? [...draft.interfaces, x.name] : draft.interfaces.filter(v => v !== x.name),
                      })}
                    />
                    {x.name}
                  </label>
                ))}
              </fieldset>
            </div>
          )}
          <div className="vnstat">
            <Button onClick={() => void vnstat(false)} disabled={actionBusy !== null}>
              {actionBusy === 'detect' ? <><LoaderCircle className="spin" size={14} /> 检测中…</> : '检测 vnStat'}
            </Button>
            <Button onClick={() => void vnstat(true)} variant="primary" disabled={actionBusy !== null}>
              {actionBusy === 'install' ? <><LoaderCircle className="spin" size={14} /> 安装中…</> : '安装并启用'}
            </Button>
          </div>
          {setup && <pre>{setup}</pre>}
          <footer>
            <Button onClick={() => setDraft(null)} disabled={actionBusy !== null}>取消</Button>
            <Button
              variant="primary"
              onClick={() => void save()}
              disabled={actionBusy !== null || !draft.label || !draft.host}
            >
              {actionBusy === 'save' ? <><LoaderCircle className="spin" size={14} /> 保存中…</> : '保存'}
            </Button>
          </footer>
        </Card>
      )}
    </main>
  )
}

function Metric({ icon, title, value, percent }: { icon: React.ReactNode; title: string; value: string; percent: number }) {
  return (
    <div className="metric">
      <div>
        {icon}
        <span>
          <small>{title}</small>
          <strong>{value}</strong>
        </span>
      </div>
      <progress value={percent} max="100" />
    </div>
  )
}
