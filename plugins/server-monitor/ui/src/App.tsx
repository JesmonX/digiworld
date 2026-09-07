import { useCallback, useEffect, useRef, useState } from 'react'
import { Dialog, PluginPage, PageToolbar, Button, Input, Card, Progress, Status, Select } from '@digiworld/design-system/react'
import { createPluginBridge } from '@digiworld/plugin-sdk'
import { Server, Plus, RefreshCw, HardDrive, MemoryStick, Cpu, Gauge, Network, Settings, X, LoaderCircle, AlertCircle } from 'lucide-react'
import { t, type Locale } from './i18n'

const bridge = createPluginBridge('io.github.jesmonx.digiworld.server-monitor')

type Config = {
  id: string
  label: string
  host: string
  disks: string[]
  interfaces: string[]
  showCpu: boolean
  showGpu: boolean
  showGpuUtilization?: boolean
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

const normalizeConfig = (config: Config): Config => ({
  ...config,
  showGpuUtilization: config.showGpuUtilization ?? true,
})

const previous = new Map<string, { at: number; rx: number; tx: number }>()
const size = (v: number) => `${(v / 1024 ** 3).toFixed(1)} GB`
const rate = (v: number) => v < 1024 ? `${v.toFixed(0)} B/s` : v < 1024 ** 2 ? `${(v / 1024).toFixed(1)} KB/s` : `${(v / 1024 ** 2).toFixed(1)} MB/s`
const pct = (a: number, b: number) => b ? Math.round((a / b) * 100) : 0

export default function App() {
  const [locale, setLocale] = useState<Locale>(() => {
    return (document.documentElement.lang?.startsWith('zh') ? 'zh' : 'en') as Locale
  })
  const [configs, setConfigs] = useState<Config[]>([])
  const [devices, setDevices] = useState<Device[]>([])
  const [draft, setDraft] = useState<Config | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionBusy, setActionBusy] = useState<'detect' | 'install' | 'save' | null>(null)
  const [setup, setSetup] = useState('')
  const [layout, setLayout] = useState<LayoutMode>(() => {
    try {
      const saved = localStorage.getItem('digiworld.server-monitor.layout')
      return (saved === 'compact' || saved === 'double' || saved === 'single' || saved === 'auto') ? saved : 'auto'
    } catch {
      return 'auto'
    }
  })

  const changeLayout = (mode: LayoutMode) => {
    setLayout(mode)
    try {
      localStorage.setItem('digiworld.server-monitor.layout', mode)
    } catch {}
  }

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
        const selection = normalizeConfig(d.selection)
        if (!d.network || !d.timestamp) return { ...d, selection }
        return {
          ...d,
          selection,
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
      const normalized = s.devices.map(normalizeConfig)
      setConfigs(normalized)
      await refreshSamples(normalized)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }, [refreshSamples])

  useEffect(() => {
    void loadSettings()
    bridge.ready()

    const unlistenVisibility = bridge.on<{ active: boolean }>('host.visibility', ({ active }) => {
      isActiveRef.current = active
      if (active) {
        void refreshSamples()
      }
    })

    const unlistenLocale = bridge.on('locale', (payload: unknown) => {
      const nextLocale = typeof payload === 'string' ? payload : (payload as { locale?: Locale })?.locale
      if (nextLocale === 'en' || nextLocale === 'zh') {
        setLocale(nextLocale)
      }
    })

    const intervalId = setInterval(() => {
      if (isActiveRef.current && !draftRef.current) {
        void refreshSamples()
      }
    }, 5000)

    return () => {
      if (typeof unlistenVisibility === 'function') unlistenVisibility()
      if (typeof unlistenLocale === 'function') unlistenLocale()
      clearInterval(intervalId)
    }
  }, [loadSettings, refreshSamples])

  const edit = (c?: Config) => {
    setSetup('')
    setError('')
    setDraft(c ? {
      showDiskDevice: c.showDiskDevice ?? true,
      showGpuLabels: c.showGpuLabels ?? false,
      showGpuUtilization: c.showGpuUtilization ?? true,
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
      showGpuUtilization: true,
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
        r.status === 'ready' ? t('vnstatStatusReady', locale) : r.status === 'installed' ? t('vnstatStatusInstalled', locale) : t('vnstatStatusOther', locale).replace('{status}', r.status),
        r.manager ? t('packageManager', locale).replace('{manager}', r.manager) : '',
        r.verification,
        r.error,
        r.command ? t('execCommand', locale).replace('{command}', r.command) : '',
      ].filter(Boolean)
      setSetup(parts.join('\n'))
    } catch (e) {
      setError(String(e))
    } finally {
      setActionBusy(null)
    }
  }

  return (
    <PluginPage>
      <PageToolbar className="">
        <div className="toolbar-title">
          <Server size={18} />
          <strong>{t('title', locale)}</strong>
        </div>
        <div className="toolbar-actions">
          <div className="layout-select">
            <Select aria-label={t('layoutAria', locale)} value={layout} onChange={e => changeLayout(e.target.value as LayoutMode)}>
              <option value="auto">{t('layoutAuto', locale)}</option>
              <option value="compact">{t('layoutCompact', locale)}</option>
              <option value="double">{t('layoutDouble', locale)}</option>
              <option value="single">{t('layoutSingle', locale)}</option>
            </Select>
          </div>
          <Button onClick={() => edit()}><Plus size={15} />{t('addServer', locale)}</Button>
          <Button onClick={() => void loadSettings()} disabled={busy}>
            <RefreshCw className={busy ? 'spin' : ''} size={15} />{t('refresh', locale)}
          </Button>
        </div>
      </PageToolbar>

      {error && <Status tone="error">{error}</Status>}

      <section className={`devices layout-${layout}`}>
        {configs.length === 0 ? (
          <Status>{t('noServers', locale)}</Status>
        ) : (
          devices.map(d => {
            const visibleDisks = (d.disks || []).filter(x => !d.selection.disks.length || d.selection.disks.includes(x.mount))
            const visibleInterfaces = (d.network || []).filter(x => !d.selection.interfaces.length || d.selection.interfaces.includes(x.name))
            const visibleVnstat = d.vnstat?.interfaces?.filter(v => !d.selection.interfaces.length || d.selection.interfaces.includes(v.name)) ?? []
            return (
              <Card key={d.id}>
                <header>
                  <div>
                    <span className="device-avatar">
                      <Server size={16} />
                    </span>
                    <span>
                      <strong>{d.label}</strong>
                      <small>
                        {d.hostname
                          ? `${d.hostname} · ${t('uptimeDays', locale).replace('{days}', String(Math.floor((d.uptimeSeconds ?? 0) / 86400)))} · ${new Date((d.timestamp ?? 0) * 1000).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
                          : d.error
                            ? t('connectionFailed', locale)
                            : t('loading', locale)}
                      </small>
                    </span>
                  </div>
                  <Button aria-label={t('serverSettings', locale)} onClick={() => edit(configs.find(x => x.id === d.id))}>
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
                          title={t('memory', locale)}
                          value={`${size(d.memory.used)} / ${size(d.memory.total)}`}
                          percent={pct(d.memory.used, d.memory.total)}
                        />
                        {d.selection.showCpu && d.cpu && (
                          <Metric
                            icon={<Cpu size={15} />}
                            title={t('cpuLoad', locale)}
                            value={`${d.cpu.load1.toFixed(2)} / ${d.cpu.logicalCores} ${t('cores', locale)}`}
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
                              d.selection.showGpuUtilization !== false ? (d.selection.showGpuLabels ? `${t('gpuUtil', locale)}: ${g.utilization}%` : `${g.utilization}%`) : null,
                              d.selection.showGpuLabels ? `${t('gpuVram', locale)}: ${memoryDisplay}` : memoryDisplay,
                              d.selection.showGpuTemperature !== false && g.temperatureC != null ? (d.selection.showGpuLabels ? `${t('gpuTemp', locale)}: ${g.temperatureC}°C` : `${g.temperatureC}°C`) : null,
                              (d.selection.showGpuPower && g.powerDrawW != null) ? (d.selection.showGpuLabels ? `${t('gpuPower', locale)}: ${Math.round(g.powerDrawW)}W` : `${Math.round(g.powerDrawW)}W`) : null,
                            ].filter(Boolean).join(' · ')
                            return (
                              <Metric
                                key={g.index}
                                icon={<Gauge size={15} />}
                                title={`GPU ${g.index} · ${cleanName}`}
                                value={details}
                                percent={memoryPercent}
                                showPercent={false}
                              />
                            )
                          })
                        ) : (
                          <small className={`gpu-unavailable ${d.gpuStatus === 'error' ? 'error' : ''}`} title={d.gpuError ?? undefined}>
                            {d.gpuStatus === 'error' ? t('gpuError', locale) : d.gpuStatus === 'unavailable' ? t('noNvidiaSmi', locale) : t('noGpu', locale)}
                          </small>
                        )}
                      </div>
                    )}

                    {d.selection.showTraffic && (
                      <div className="traffic">
                        <div className="traffic-head">
                          <Network size={15} />
                          <small title={d.vnstatError ?? undefined}>
                            {d.vnstat ? t('vnstatReady', locale) : d.vnstatStatus === 'error' ? t('vnstatFailed', locale) : t('vnstatMissing', locale)}
                          </small>
                        </div>
                        {visibleInterfaces.length > 0 && (
                          <div className="traffic-rates">
                            {visibleInterfaces.map(n => (
                              <span key={n.name}>
                                <strong>{n.name}</strong> ↓ {n.receivedPerSecond === undefined ? t('sampling', locale) : rate(n.receivedPerSecond)} ↑ {n.sentPerSecond === undefined ? t('sampling', locale) : rate(n.sentPerSecond)} · {t('cumulative', locale)} ↓ {size(n.receivedBytes)} ↑ {size(n.sentBytes)}
                              </span>
                            ))}
                          </div>
                        )}
                        {visibleVnstat.length > 0 && (
                          <details className="daily-details">
                            <summary><small>{t('dailyTraffic', locale)}</small></summary>
                            {visibleVnstat.map(v => (
                              <div className="daily" key={v.name}>
                                <strong>{v.name} · {t('dailyTrafficTitle', locale)}</strong>
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
        <Dialog open onClose={() => { if (!actionBusy) setDraft(null) }} className="editor" aria-label={t('serverSettings', locale)}>
          <header>
            <h2>{t('serverSettings', locale)}</h2>
            <Button aria-label={t('close', locale)} onClick={() => setDraft(null)}><X size={16} /></Button>
          </header>
          <label>
            {t('name', locale)}
            <Input value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} />
          </label>
          <label>
            {t('hostAlias', locale)}
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
                checked={draft.showGpuUtilization !== false}
                onChange={e => setDraft({ ...draft, showGpuUtilization: e.target.checked })}
              />
              {t('showGpuUtilization', locale)}
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.showDiskDevice !== false}
                onChange={e => setDraft({ ...draft, showDiskDevice: e.target.checked })}
              />
              {t('showDiskDevice', locale)}
            </label>
            <label>
              <input
                type="checkbox"
                checked={!!draft.showGpuLabels}
                onChange={e => setDraft({ ...draft, showGpuLabels: e.target.checked })}
              />
              {t('showGpuLabels', locale)}
            </label>
            <label>
              <input
                type="checkbox"
                checked={!!draft.showGpuPower}
                onChange={e => setDraft({ ...draft, showGpuPower: e.target.checked })}
              />
              {t('showGpuPower', locale)}
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.showGpuTemperature !== false}
                onChange={e => setDraft({ ...draft, showGpuTemperature: e.target.checked })}
              />
              {t('showGpuTemp', locale)}
            </label>
            <label>
              {t('gpuMemoryMode', locale)}
              <Select
                value={draft.gpuMemoryDisplay ?? 'both'}
                onChange={e => setDraft({ ...draft, gpuMemoryDisplay: e.target.value as NonNullable<Config['gpuMemoryDisplay']> })}
              >
                <option value="percent">{t('memPercent', locale)}</option>
                <option value="value">{t('memValue', locale)}</option>
                <option value="both">{t('memBoth', locale)}</option>
              </Select>
            </label>
          </div>
          <p>{t('selectPrompt', locale)}</p>
          {devices.find(x => x.id === draft.id && x.disks && x.network) && (
            <div className="selectors">
              <fieldset>
                <legend>{t('monitoredDisks', locale)}</legend>
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
                <legend>{t('monitoredInterfaces', locale)}</legend>
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
              {actionBusy === 'detect' ? <><LoaderCircle className="spin" size={14} /> {t('detecting', locale)}</> : t('detectVnstat', locale)}
            </Button>
            <Button onClick={() => void vnstat(true)} variant="primary" disabled={actionBusy !== null}>
              {actionBusy === 'install' ? <><LoaderCircle className="spin" size={14} /> {t('installing', locale)}</> : t('installVnstat', locale)}
            </Button>
          </div>
          {setup && <pre>{setup}</pre>}
          <footer>
            <Button onClick={() => setDraft(null)} disabled={actionBusy !== null}>{t('cancel', locale)}</Button>
            <Button
              variant="primary"
              onClick={() => void save()}
              disabled={actionBusy !== null || !draft.label || !draft.host}
            >
              {actionBusy === 'save' ? <><LoaderCircle className="spin" size={14} /> {t('saving', locale)}</> : t('save', locale)}
            </Button>
          </footer>
        </Dialog>
      )}
    </PluginPage>
  )
}

function Metric({ icon, title, value, percent, showPercent = true }: { icon: React.ReactNode; title: string; value: string; percent: number; showPercent?: boolean }) {
  return (
    <div className="metric">
      <div className="metric-header">
        <span className="metric-icon-wrap">{icon}</span>
        <div className="metric-info">
          <small tabIndex={0} data-tooltip={title}>{title}</small>
          <strong className="metric-value">{value.split(" · ").map((part, index) => <span key={index}>{part}</span>)}</strong>
        </div>
        {showPercent && <span className="metric-badge">{Math.round(percent)}%</span>}
      </div>
      <Progress value={percent} max={100} label={title} showValue={false} emphasized />
    </div>
  )
}
