import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Input, Card, Status, Select, Dialog } from '@digiworld/design-system/react'
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
  showDiskDevice?: boolean
  showGpuLabels?: boolean
  showGpuPower?: boolean
  showGpuTemperature?: boolean
  gpuMemoryDisplay?: 'percent' | 'value' | 'both'
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
  gpuStatus?: 'ready' | 'unavailable' | 'error'
  gpuError?: string | null
  vnstatStatus?: 'ready' | 'unavailable' | 'error'
  vnstatError?: string | null
  uptimeSeconds?: number
  memory?: { total: number; used: number }
  cpu?: { logicalCores: number; load1: number; load5: number }
  disks?: Disk[]
  gpus?: {
    index: number
    name: string
    utilization: number
    memoryUsedMiB: number
    memoryTotalMiB: number
    temperatureC?: number | null
    powerDrawW?: number | null
  }[]
  network?: Net[]
  vnstat?: { interfaces?: { name: string; traffic?: { day?: { date: { year: number; month: number; day: number }; rx: number; tx: number }[] } }[] }
  selection: Config
}

type LayoutMode = 'auto' | 'compact' | 'double' | 'single'

const previous = new Map<string, { at: number; rx: number; tx: number }>()
// Keep the familiar GB label while using the binary conversion used by the
// backend counters; this matches the values users see in system monitors.
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
  const [deleteId,setDeleteId]=useState<string | null>(null)
  const [history,setHistory]=useState<Record<string,{at:number;memory:number}[]>>({})
  const [setup, setSetup] = useState('')
  const [layout, setLayout] = useState<LayoutMode>('auto')
  const configsRef = useRef<Config[]>([])
  configsRef.current = configs
  const changeLayout = async (mode: LayoutMode) => {
    const old = layout
    setLayout(mode)
    try { await bridge.request('servers.layout.save', { layout: mode }) }
    catch (reason) { setLayout(old); setError(String(reason)) }
  }

  const isActiveRef = useRef(true)
  const isRefreshingRef = useRef(false)
  const sampleGenerationRef = useRef(0)
  const draftRef = useRef<Config | null>(null)
  draftRef.current = draft

  const refreshSamples = useCallback(async (currentConfigs?: Config[], deviceId?: string) => {
    if (isRefreshingRef.current) return
    isRefreshingRef.current = true
    const currentGen = sampleGenerationRef.current
    try {
      const activeConfigs = currentConfigs ?? configsRef.current
      if (!activeConfigs.length) {
        setDevices([])
        return
      }
      const sampleRes = await bridge.job<{ devices: Device[] }>('servers.sample', deviceId ? {id:deviceId} : {})
      if (sampleGenerationRef.current !== currentGen) return

      setHistory(current=>{
        const next={...current}
        for(const device of sampleRes.devices) if(!device.error && device.timestamp && device.memory?.total) {
          const points=current[device.id] ?? []
          if(points.at(-1)?.at !== device.timestamp) next[device.id]=[...points,{at:device.timestamp,memory:pct(device.memory.used,device.memory.total)}].filter(p=>p.at>=device.timestamp!-1800).slice(-360)
        }
        return next
      })
      const updated = sampleRes.devices.map(d => {
        if (!d.network || !d.timestamp) return d
        return {
          ...d,
          network: d.network.map(n => {
            const key = `${d.id}:${n.name}`
            const p = previous.get(key)
            const seconds = p ? d.timestamp! - p.at : 0
            previous.set(key, { at: d.timestamp!, rx: n.receivedBytes, tx: n.sentBytes })
            return {
              ...n,
              receivedPerSecond: p && seconds > 0 && n.receivedBytes >= p.rx ? (n.receivedBytes - p.rx) / seconds : undefined,
              sentPerSecond: p && seconds > 0 && n.sentBytes >= p.tx ? (n.sentBytes - p.tx) / seconds : undefined,
            }
          }),
        }
      })
      setDevices(current => deviceId ? current.map(d=>updated.find(next=>next.id===d.id)??d) : updated)
      setError('')
    } catch (e) {
      if (sampleGenerationRef.current === currentGen) {
        setError(String(e))
      }
    } finally {
      isRefreshingRef.current = false
    }
  }, [])

  const loadSettings = useCallback(async () => {
    setBusy(true)
    try {
      const s = await bridge.request<{ devices: Config[]; layout?: LayoutMode }>('servers.settings.get')
      setLayout(s.layout ?? 'auto')
      configsRef.current = s.devices
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
      if (active && !isRefreshingRef.current) {
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
    setDraft(c ? {
      showDiskDevice: c.showDiskDevice ?? true,
      showGpuLabels: c.showGpuLabels ?? false,
      showGpuPower: c.showGpuPower ?? false,
      showGpuTemperature: c.showGpuTemperature ?? true,
      gpuMemoryDisplay: c.gpuMemoryDisplay ?? 'both',
      ...c,
    } : {
      id: crypto.randomUUID().replaceAll('-', '').slice(0, 12),
      label: '',
      host: '',
      disks: [],
      interfaces: [],
      showCpu: true,
      showGpu: true,
      showTraffic: true,
      showDiskDevice: true,
      showGpuLabels: false,
      showGpuPower: false,
      showGpuTemperature: true,
      gpuMemoryDisplay: 'both',
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
      await bridge.request('servers.settings.save', { settings: { devices: next, layout } })
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
      const r = await bridge.job<{
        status: string
        command: string
        error?: string
        verification?: string
        manager?: string
      }>('servers.vnstat.setup', { host: draft.host, install })
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
        <div className="layout-select">
          <Select aria-label="排布方式" value={layout} onChange={e => void changeLayout(e.target.value as LayoutMode)}>
            <option value="auto">自适应排布</option>
            <option value="compact">紧凑多列</option>
            <option value="double">标准双列</option>
            <option value="single">单列全宽</option>
          </Select>
        </div>
        <Button onClick={() => edit()}><Plus size={15} />添加设备</Button>
        <Button onClick={() => void loadSettings()} disabled={busy}>
          <RefreshCw className={busy ? 'spin' : ''} size={15} />刷新
        </Button>
      </header>

      {error && <Status tone="error">{error}</Status>}

      <section className={`devices layout-${layout}`}>
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
                        {d.hostname ? `${d.hostname} · 运行 ${Math.floor((d.uptimeSeconds ?? 0) / 86400)} 天 · ${new Date((d.timestamp ?? 0) * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : d.error ? '连接异常' : '载入中…'}
                      </small>
                    </span>
                  </div>
                  <Button aria-label="设备设置" onClick={() => edit(configs.find(x => x.id === d.id))}>
                    <Settings size={15} />
                  </Button>
                  <Button disabled={isRefreshingRef.current} onClick={()=>void refreshSamples(undefined,d.id)}>重试采样</Button><Button variant="danger" onClick={()=>setDeleteId(d.id)}>移除</Button>
                </header>
                {(history[d.id]?.length ?? 0)>1 && <details><summary>最近 30 分钟内存趋势</summary><svg role="img" aria-label={`${d.label} 内存趋势`} viewBox="0 0 360 110"><polyline fill="none" stroke="var(--dw-accent)" strokeWidth="2" points={(history[d.id]??[]).map((p,i,all)=>`${i*360/Math.max(1,all.length-1)},${100-p.memory}`).join(' ')} /></svg><table><thead><tr><th>采样时间</th><th>内存占用</th></tr></thead><tbody>{history[d.id]?.slice(-12).map(p=><tr key={p.at}><td>{new Date(p.at*1000).toLocaleTimeString()}</td><td>{p.memory}%</td></tr>)}</tbody></table></details>}

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
                            title="CPU 负载"
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
                            title={d.selection.showDiskDevice !== false ? `${x.mount} · ${x.device}` : x.mount}
                            value={`${size(x.used)} / ${size(x.total)}`}
                            percent={x.percent}
                          />
                        ))}
                      </div>
                    )}

                    {d.selection.showGpu && (
                      <div className="gpu-grid">
                        {d.gpus && d.gpus.length > 0 ? (
                          d.gpus.map(g => {
                            const cleanName = g.name.replace(/^NVIDIA\s+/i, '').trim()
                            const memoryPercent = pct(g.memoryUsedMiB, g.memoryTotalMiB)
                            const memoryValue = `${size(g.memoryUsedMiB * 1024 * 1024)} / ${size(g.memoryTotalMiB * 1024 * 1024)}`
                            const memoryDisplay = d.selection.gpuMemoryDisplay === 'percent'
                              ? `${memoryPercent}%`
                              : d.selection.gpuMemoryDisplay === 'value'
                                ? memoryValue
                                : `${memoryValue} (${memoryPercent}%)`
                            const details = [
                              d.selection.showGpuLabels ? `利用率: ${g.utilization}%` : `${g.utilization}%`,
                              d.selection.showGpuLabels ? `显存: ${memoryDisplay}` : memoryDisplay,
                              d.selection.showGpuTemperature !== false && g.temperatureC != null ? (d.selection.showGpuLabels ? `温度: ${g.temperatureC}°C` : `${g.temperatureC}°C`) : null,
                              (d.selection.showGpuPower && g.powerDrawW != null) ? (d.selection.showGpuLabels ? `功率: ${Math.round(g.powerDrawW)}W` : `${Math.round(g.powerDrawW)}W`) : null,
                            ].filter(Boolean).join(' · ')
                            return (
                              <Metric
                                key={g.index}
                                icon={<Gauge size={15} />}
                                title={`GPU ${g.index} · ${cleanName}`}
                                value={details}
                                percent={g.utilization}
                              />
                            )
                          })
                        ) : (
                          <small className={`gpu-unavailable ${d.gpuStatus === 'error' ? 'error' : ''}`} title={d.gpuError ?? undefined}>{d.gpuStatus === 'error' ? 'GPU 信息采集失败' : d.gpuStatus === 'unavailable' ? '未安装 nvidia-smi' : '未检测到 GPU'}</small>
                        )}
                      </div>
                    )}

                    {d.selection.showTraffic && (
                      <div className="traffic">
                        <div className="traffic-head">
                          <Network size={15} />
                          <small title={d.vnstatError ?? undefined}>{d.vnstat ? 'vnStat 每日记录已连接' : d.vnstatStatus === 'error' ? 'vnStat 采集失败，仅显示网卡累计' : '未检测到 vnStat，仅显示网卡累计'}</small>
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
                {['CPU', 'GPU', 'Traffic'][i]}
              </label>
            ))}
          </div>
          <div className="toggles sub-toggles">
            <label>
              <input
                type="checkbox"
                checked={draft.showDiskDevice !== false}
                onChange={e => setDraft({ ...draft, showDiskDevice: e.target.checked })}
              />
              显示硬盘设备号
            </label>
            <label>
              <input
                type="checkbox"
                checked={!!draft.showGpuLabels}
                onChange={e => setDraft({ ...draft, showGpuLabels: e.target.checked })}
              />
              GPU 显示详细文字标签
            </label>
            <label>
              <input
                type="checkbox"
                checked={!!draft.showGpuPower}
                onChange={e => setDraft({ ...draft, showGpuPower: e.target.checked })}
              />
              GPU 显示功率
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.showGpuTemperature !== false}
                onChange={e => setDraft({ ...draft, showGpuTemperature: e.target.checked })}
              />
              GPU 显示温度
            </label>
            <label>
              GPU 显存显示
              <Select
                value={draft.gpuMemoryDisplay ?? 'both'}
                onChange={e => setDraft({ ...draft, gpuMemoryDisplay: e.target.value as NonNullable<Config['gpuMemoryDisplay']> })}
              >
                <option value="percent">占用百分比</option>
                <option value="value">具体数值</option>
                <option value="both">百分比 + 具体数值</option>
              </Select>
            </label>
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
      <Dialog open={deleteId!==null} onClose={()=>setDeleteId(null)} aria-label="移除设备"><h2>移除监控设备</h2><p>移除本地配置，远端服务保持运行。</p><Button onClick={()=>setDeleteId(null)}>取消</Button><Button variant="danger" disabled={!!actionBusy} onClick={async()=>{setActionBusy('save');try{const next=configs.filter(c=>c.id!==deleteId);await bridge.request('servers.settings.save',{settings:{devices:next,layout}});sampleGenerationRef.current+=1;setConfigs(next);setDevices(current=>current.filter(d=>d.id!==deleteId));setDeleteId(null)}catch(reason){setError(String(reason))}finally{setActionBusy(null)}}}>确认移除</Button></Dialog>
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
