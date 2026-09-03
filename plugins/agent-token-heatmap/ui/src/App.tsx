import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, BarChart3, Check, Clock3, Database, Gauge, HardDrive, Plus, RefreshCw, Server, Settings2, Trash2, X } from 'lucide-react'
import { createPluginBridge } from '@digiworld/plugin-sdk'
import { calendarCells, formatTokens, heatLevel, weeklyUsage, type Metric, type UsageDay, type WeeklyUsagePoint } from './heatmap'
import './styles.css'

const PLUGIN_ID = 'io.github.jesmonx.digiworld.agent-token-heatmap'
const bridge = createPluginBridge(PLUGIN_ID)
const AGENTS = ['codex', 'claude', 'pi'] as const
type Agent = typeof AGENTS[number]
type Range = '30' | '90' | '365' | 'all'

interface SshSource {
  id: string
  label: string
  host: string
  enabledAgents: Agent[]
  roots: Partial<Record<Agent, string>>
}
interface UsageSettings {
  localAgents: Agent[]
  localRoots: Partial<Record<Agent, string>>
  sshSources: SshSource[]
  codexQuota: CodexQuotaSettings
}
type ShellPreset = 'auto' | 'powershell' | 'zsh' | 'bash'
interface CodexQuotaSettings {
  sourceId: string | null
  shellPreset: ShellPreset
  preCommand: string
  refreshIntervalSeconds: number | null
}
interface Totals {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  cacheRate?: number
}
interface Breakdown extends Totals { sourceId: string; sourceLabel: string; agent: Agent }
interface ModelBreakdown extends Totals { sourceId: string; sourceLabel: string; agent: Agent; model: string }
interface Snapshot {
  startDay?: string
  endDay: string
  totals: Totals
  days: UsageDay[]
  breakdown: Breakdown[]
  modelBreakdown: ModelBreakdown[]
}
interface QuotaWindow { usedPercent: number; windowDurationMins: number | null; resetsAt: number | null }
interface CodexQuotaSnapshot {
  status: 'ready' | 'stale' | 'unavailable' | 'unconfigured'
  sourceId: string | null
  sourceLabel: string | null
  fetchedAt: string | null
  planType: string | null
  windows: QuotaWindow[]
  error: string | null
}
interface RefreshStatus {
  running: boolean
  jobId?: string
  completed: number
  total: number
  currentSource?: string
  errors: string[]
}

const agentLabel: Record<Agent, string> = { codex: 'Codex', claude: 'Claude Code', pi: 'Pi' }
const defaultRoot: Record<Agent, string> = {
  codex: '~/.codex/sessions', claude: '~/.claude/projects', pi: '~/.pi/agent/sessions',
}

export default function App() {
  const [settings, setSettings] = useState<UsageSettings | null>(null)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [agents, setAgents] = useState<Agent[]>([...AGENTS])
  const [sources, setSources] = useState<string[]>(['local'])
  const [range, setRange] = useState<Range>('365')
  const [metric, setMetric] = useState<Metric>('totalTokens')
  const [refresh, setRefresh] = useState<RefreshStatus>({ running: false, completed: 0, total: 0, errors: [] })
  const [quota, setQuota] = useState<CodexQuotaSnapshot | null>(null)
  const [quotaLoading, setQuotaLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const loadSnapshot = useCallback(async (nextSettings?: UsageSettings) => {
    const configured = nextSettings ?? settings
    if (!configured) return
    const allowedSources = ['local', ...configured.sshSources.map(source => source.id)]
    const selectedSources = sources.filter(source => allowedSources.includes(source))
    setSnapshot(await bridge.request<Snapshot>('usage.snapshot', {
      range, agents, sources: selectedSources.length ? selectedSources : allowedSources,
    }))
  }, [agents, range, settings, sources])

  useEffect(() => {
    bridge.ready()
    bridge.request<UsageSettings>('usage.getSettings').then(value => {
      setSettings(value)
      setSources(['local', ...value.sshSources.map(source => source.id)])
      return bridge.request<Snapshot>('usage.snapshot', { range: '365', agents: AGENTS, sources: ['local', ...value.sshSources.map(source => source.id)] })
    }).then(setSnapshot).catch(reason => setError(String(reason)))
  }, [])

  useEffect(() => {
    if (settings) void loadSnapshot().catch(reason => setError(String(reason)))
  }, [agents, range, sources]) // eslint-disable-line react-hooks/exhaustive-deps

  const watchRefresh = async (status: RefreshStatus): Promise<RefreshStatus> => {
      setRefresh(status)
      while (true) {
        await new Promise(resolve => window.setTimeout(resolve, 700))
        const next = await bridge.request<RefreshStatus>('usage.refreshStatus')
        setRefresh(next)
        if (!next.running) {
          await loadSnapshot()
          return next
        }
      }
  }

  const startRefresh = async (sourceId?: string) => {
    setError(null)
    try {
      await watchRefresh(await bridge.request<RefreshStatus>('usage.startRefresh', sourceId ? { sourceId } : {}))
    } catch (reason) {
      setError(String(reason))
    }
  }

  const loadQuota = useCallback(async (force = false) => {
    const sourceId = settings?.codexQuota.sourceId ?? null
    setQuotaLoading(true)
    setQuota(current => current?.sourceId === sourceId ? current : null)
    try {
      const next = await bridge.request<CodexQuotaSnapshot>('usage.getCodexQuota', { force })
      setQuota(current => next.status === 'unavailable' && current?.sourceId === next.sourceId && (current.status === 'ready' || current.status === 'stale')
        ? { ...current, status: 'stale', error: next.error }
        : next)
    } catch (reason) {
      setQuota(current => current?.sourceId === sourceId && (current.status === 'ready' || current.status === 'stale')
        ? { ...current, status: 'stale', error: String(reason) }
        : { status: 'unavailable', sourceId, sourceLabel: null, fetchedAt: null, planType: null, windows: [], error: String(reason) })
    } finally {
      setQuotaLoading(false)
    }
  }, [settings?.codexQuota.sourceId])

  useEffect(() => {
    if (!settings) return
    void loadQuota()
  }, [loadQuota, settings])

  useEffect(() => {
    const seconds = settings?.codexQuota.refreshIntervalSeconds
    if (!seconds) return
    const timer = window.setInterval(() => void loadQuota(), seconds * 1000)
    return () => window.clearInterval(timer)
  }, [loadQuota, settings?.codexQuota.refreshIntervalSeconds])

  const testSource = async (source: SshSource) => {
    setError(null)
    try {
      const result = await watchRefresh(await bridge.request<RefreshStatus>('usage.testSsh', { source }))
      if (result.errors.length) throw new Error(result.errors.join('；'))
    } catch (reason) {
      setError(String(reason))
      throw reason
    }
  }

  const toggleAgent = (agent: Agent) => setAgents(current => current.includes(agent)
    ? (current.length === 1 ? current : current.filter(value => value !== agent))
    : [...current, agent])
  const toggleSource = (source: string) => setSources(current => current.includes(source)
    ? (current.length === 1 ? current : current.filter(value => value !== source))
    : [...current, source])

  const cells = useMemo(() => {
    if (!snapshot) return []
    const start = snapshot.startDay ?? snapshot.days[0]?.day ?? snapshot.endDay
    return calendarCells(start, snapshot.endDay, snapshot.days, metric)
  }, [metric, snapshot])
  const max = Math.max(0, ...cells.map(cell => cell.value))
  const dailyRanking = useMemo(() => [...(snapshot?.days ?? [])].filter(day => day.totalTokens > 0).sort((a, b) => b.totalTokens - a.totalTokens || b.day.localeCompare(a.day)).slice(0, 10), [snapshot])
  const dailyMax = dailyRanking[0]?.totalTokens ?? 1
  const modelBreakdown = useMemo(() => [...(snapshot?.modelBreakdown ?? [])].filter(row => row.totalTokens > 0).sort((a, b) => b.totalTokens - a.totalTokens), [snapshot])
  const weekly = useMemo(() => snapshot ? weeklyUsage(snapshot.endDay, snapshot.days) : [], [snapshot])
  const sourceOptions = settings ? [{ id: 'local', label: '本机' }, ...settings.sshSources] : []

  return (
    <div className="usage-app">
      <header className="usage-header">
        <div><h1>Token 使用量</h1><p>本地聚合 Codex、Claude Code 与 Pi 的 usage 记录</p></div>
        <div className="header-buttons"><button className="secondary" onClick={() => setSettingsOpen(true)}><Settings2 />数据源</button><button className="primary" disabled={refresh.running} onClick={() => void startRefresh()}><RefreshCw className={refresh.running ? 'spin' : ''} />{refresh.running ? `${refresh.completed}/${refresh.total} ${refresh.currentSource ?? ''}` : '手动刷新'}</button></div>
      </header>

      {(error || refresh.errors.length > 0) && <div className="error-banner"><AlertTriangle /><span>{error ?? refresh.errors.join('；')}</span><button onClick={() => { setError(null); setRefresh(current => ({ ...current, errors: [] })) }}><X /></button></div>}

      <section className="filter-bar">
        <FilterGroup label="Agent">{AGENTS.map(agent => <FilterChip key={agent} active={agents.includes(agent)} label={agentLabel[agent]} onClick={() => toggleAgent(agent)} />)}</FilterGroup>
        <FilterGroup label="设备">{sourceOptions.map(source => <FilterChip key={source.id} active={sources.includes(source.id)} label={source.label} onClick={() => toggleSource(source.id)} />)}</FilterGroup>
      </section>

      <section className="insights-grid">
        <WeeklyChart points={weekly} />
        <QuotaCard quota={quota} loading={quotaLoading} configured={Boolean(settings?.codexQuota.sourceId)} onRefresh={() => void loadQuota(true)} onConfigure={() => setSettingsOpen(true)} />
      </section>

      <section className="heatmap-card">
        <div className="card-title">
          <div><h2>每日热力图</h2><p>{snapshot?.startDay ?? snapshot?.days[0]?.day ?? '—'} 至 {snapshot?.endDay ?? '—'}</p></div>
          <div className="heatmap-controls">
            <div className="range-group" aria-label="统计范围">{(['30', '90', '365', 'all'] as Range[]).map(value => <button key={value} className={range === value ? 'active' : ''} onClick={() => setRange(value)}>{value === 'all' ? '全部' : `${value} 天`}</button>)}</div>
            <select aria-label="热力图指标" value={metric} onChange={event => setMetric(event.target.value as Metric)}><option value="totalTokens">总 Token</option><option value="inputTokens">输入</option><option value="outputTokens">输出</option><option value="cacheReadTokens">缓存读取</option></select>
          </div>
        </div>
        <div className="summary-grid" aria-label="所选范围用量汇总">
          <Summary label="总 Token" value={snapshot?.totals.totalTokens} />
          <Summary label="输入" value={snapshot?.totals.inputTokens} />
          <Summary label="输出" value={snapshot?.totals.outputTokens} />
          <Summary label="缓存读取" value={snapshot?.totals.cacheReadTokens} />
          <Summary label="缓存写入" value={snapshot?.totals.cacheWriteTokens} />
          <Summary label="缓存率" text={snapshot?.totals.cacheRate == null ? '—' : `${(snapshot.totals.cacheRate * 100).toFixed(1)}%`} />
        </div>
        {snapshot && cells.length ? <div className="calendar-wrap"><div className="weekday-labels"><span>一</span><span>三</span><span>五</span><span>日</span></div><div className="calendar-grid">{cells.map((cell, index) => <i key={cell.day ?? `blank-${index}`} className={`level-${heatLevel(cell.value, max)} ${cell.day ? '' : 'blank'}`} title={cell.day ? `${cell.day} · ${formatTokens(cell.value)}` : undefined} />)}</div><div className="legend"><span>低</span>{[0, 1, 2, 3, 4, 5].map(level => <i key={level} className={`level-${level}`} />)}<span>高</span></div></div> : <Empty />}
      </section>

      <section className="lower-grid">
        <article className="breakdown-card"><h2>来源明细</h2>{snapshot?.breakdown.length ? <div className="breakdown-table">{[...snapshot.breakdown].sort((a, b) => b.totalTokens - a.totalTokens).map(row => <div key={`${row.sourceId}-${row.agent}`}><span className={`agent-dot ${row.agent}`} /><strong>{agentLabel[row.agent]}</strong><span>{row.sourceLabel}</span><b>{formatTokens(row.totalTokens)}</b><small>{row.cacheRate == null ? `${formatTokens(row.cacheReadTokens)} cache` : `${(row.cacheRate * 100).toFixed(1)}% cache`}</small></div>)}</div> : <Empty />}</article>
        <article className="daily-ranking-card"><h2>每日用量排行</h2>{dailyRanking.length ? <div className="daily-ranking">{dailyRanking.map((day, index) => <div key={day.day}><b>{index + 1}</b><span>{day.day}</span><i><em style={{ width: `${(day.totalTokens / dailyMax) * 100}%` }} /></i><strong>{formatTokens(day.totalTokens)}</strong></div>)}</div> : <Empty />}</article>
      </section>

      <article className="model-card">
        <div className="model-card-heading"><div><h2>模型来源明细</h2><p>按设备、Agent 与会话记录中的模型聚合</p></div><BarChart3 /></div>
        {modelBreakdown.length ? <div className="model-table">{modelBreakdown.map(row => <div key={`${row.sourceId}-${row.agent}-${row.model}`}><span className={`agent-dot ${row.agent}`} /><strong title={row.model}>{row.model === 'unknown' ? '未知模型' : row.model}</strong><span>{agentLabel[row.agent]}</span><span>{row.sourceLabel}</span><b>{formatTokens(row.totalTokens)}</b></div>)}</div> : <Empty />}
      </article>

      {settingsOpen && settings && <SourceDialog settings={settings} refreshRunning={refresh.running} onClose={() => setSettingsOpen(false)} onSave={async value => {
        const saved = await bridge.request<UsageSettings>('usage.saveSettings', { settings: value })
        setSettings(saved)
        setSources(current => current.filter(id => id === 'local' || saved.sshSources.some(source => source.id === id)).concat(saved.sshSources.filter(source => !current.includes(source.id)).map(source => source.id)))
        setSettingsOpen(false)
        await loadSnapshot(saved)
      }} onScan={testSource} onQuotaTest={async value => bridge.request<CodexQuotaSnapshot>('usage.testCodexQuota', { settings: value })} />}
    </div>
  )
}

function WeeklyChart({ points }: { points: WeeklyUsagePoint[] }) {
  const width = 700
  const height = 230
  const left = 52
  const right = 48
  const top = 24
  const bottom = 42
  const plotWidth = width - left - right
  const plotHeight = height - top - bottom
  const step = plotWidth / Math.max(points.length, 1)
  const barWidth = Math.min(46, step * .54)
  const maximum = Math.max(1, ...points.map(point => point.totalTokens))
  const segments: WeeklyUsagePoint[][] = []
  for (const point of points) {
    if (point.cacheRate == null) continue
    const previous = segments.at(-1)
    const previousIndex = previous?.length ? points.indexOf(previous.at(-1)!) : -2
    const index = points.indexOf(point)
    if (!previous || previousIndex !== index - 1) segments.push([point])
    else previous.push(point)
  }
  const xFor = (point: WeeklyUsagePoint) => left + (points.indexOf(point) + .5) * step
  const yForRate = (rate: number) => top + (1 - Math.max(0, Math.min(1, rate))) * plotHeight

  return <article className="weekly-card">
    <div className="panel-heading"><div><h2>近 7 天趋势</h2><p>总 Token 与缓存读取率</p></div><div className="chart-legend"><span><i className="bar-key" />Token</span><span><i className="line-key" />缓存率</span></div></div>
    {points.length ? <svg className="weekly-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="近七天 Token 用量柱形图和缓存率折线图">
      {[0, .5, 1].map(ratio => {
        const y = top + ratio * plotHeight
        return <g key={ratio}><line x1={left} x2={width - right} y1={y} y2={y} className="chart-grid-line" /><text x={left - 8} y={y + 4} textAnchor="end" className="chart-axis-label">{formatTokens(maximum * (1 - ratio))}</text><text x={width - right + 8} y={y + 4} className="chart-axis-label">{Math.round((1 - ratio) * 100)}%</text></g>
      })}
      {points.map((point, index) => {
        const x = left + (index + .5) * step
        const barHeight = point.totalTokens > 0 ? Math.max(2, point.totalTokens / maximum * plotHeight) : 0
        const cache = point.cacheRate == null ? '—' : `${(point.cacheRate * 100).toFixed(1)}%`
        return <g key={point.day}><title>{`${point.day} · ${formatTokens(point.totalTokens)} Token · 缓存率 ${cache}`}</title><rect x={x - barWidth / 2} y={top + plotHeight - barHeight} width={barWidth} height={barHeight} rx="4" className="token-bar" /><text x={x} y={height - 17} textAnchor="middle" className="chart-day-label">{point.day.slice(5).replace('-', '/')}</text></g>
      })}
      {segments.map((segment, index) => segment.length > 1 && <polyline key={index} points={segment.map(point => `${xFor(point)},${yForRate(point.cacheRate!)}`).join(' ')} className="cache-line" />)}
      {points.filter(point => point.cacheRate != null).map(point => <circle key={point.day} cx={xFor(point)} cy={yForRate(point.cacheRate!)} r="4" className="cache-point"><title>{`${point.day} 缓存率 ${(point.cacheRate! * 100).toFixed(1)}%`}</title></circle>)}
    </svg> : <Empty />}
  </article>
}

function QuotaCard({ quota, loading, configured, onRefresh, onConfigure }: { quota: CodexQuotaSnapshot | null; loading: boolean; configured: boolean; onRefresh(): void; onConfigure(): void }) {
  const available = quota && (quota.status === 'ready' || quota.status === 'stale') && quota.windows.length > 0
  return <article className={`quota-card ${quota?.status ?? ''}`}>
    <div className="panel-heading"><div><h2>Codex 限额</h2><p>{quota?.sourceLabel ?? '指定账号设备'}{quota?.planType ? ` · ${quota.planType}` : ''}</p></div><button className="panel-action" title="刷新 Codex 限额" disabled={loading || !configured} onClick={onRefresh}><RefreshCw className={loading ? 'spin' : ''} /></button></div>
    {!configured || quota?.status === 'unconfigured' ? <div className="quota-empty"><Gauge /><span>尚未选择限额查询设备</span><button onClick={onConfigure}>前往设置</button></div>
      : loading && !quota ? <div className="quota-empty"><RefreshCw className="spin" /><span>正在获取最新限额…</span></div>
        : available ? <>
          <div className="quota-windows">{quota.windows.map((window, index) => {
            const remaining = 100 - Math.max(0, Math.min(100, window.usedPercent))
            return <div key={`${window.windowDurationMins ?? index}-${window.resetsAt ?? index}`} className="quota-window"><div><strong>{formatDuration(window.windowDurationMins)}</strong><span>已用 {window.usedPercent}% · 剩余 {Math.max(0, 100 - window.usedPercent)}%</span></div><div className="quota-track"><i style={{ width: `${remaining}%` }} /></div><small><Clock3 />{formatReset(window.resetsAt)}</small></div>
          })}</div>
          <div className={`quota-meta ${quota.status === 'stale' ? 'warning' : ''}`}>{quota.status === 'stale' ? `刷新失败，显示上次结果：${quota.error ?? '未知错误'}` : `更新于 ${formatFetchedAt(quota.fetchedAt)}`}</div>
        </> : <div className="quota-empty error"><AlertTriangle /><span>{quota?.error ?? '当前设备无法获取 Codex 限额'}</span><button onClick={onConfigure}>检查设置</button></div>}
  </article>
}

function formatDuration(minutes: number | null): string {
  if (minutes == null) return '限额窗口'
  if (minutes % 10_080 === 0) return `${minutes / 10_080 * 7}d`
  if (minutes % 1_440 === 0) return `${minutes / 1_440}d`
  if (minutes % 60 === 0) return `${minutes / 60}h`
  return `${minutes}m`
}

function formatReset(seconds: number | null): string {
  if (!seconds) return '未提供重置时间'
  return `${new Date(seconds * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} 重置`
}

function formatFetchedAt(value: string | null): string {
  if (!value) return '刚刚'
  return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) { return <div className="filter-group"><span>{label}</span>{children}</div> }
function FilterChip({ active, label, onClick }: { active: boolean; label: string; onClick(): void }) { return <button className={`filter-chip ${active ? 'active' : ''}`} aria-pressed={active} onClick={onClick}>{active && <Check />}{label}</button> }
function Summary({ label, value, text }: { label: string; value?: number | undefined; text?: string }) { return <div className="summary-item"><small>{label}</small><strong>{text ?? formatTokens(value ?? 0)}</strong></div> }
function Empty() { return <div className="empty"><Database /><span>暂无数据，点击“手动刷新”开始扫描</span></div> }

function SourceDialog({ settings, refreshRunning, onClose, onSave, onScan, onQuotaTest }: { settings: UsageSettings; refreshRunning: boolean; onClose(): void; onSave(value: UsageSettings): Promise<void>; onScan(source: SshSource): Promise<void>; onQuotaTest(value: UsageSettings): Promise<CodexQuotaSnapshot> }) {
  const [draft, setDraft] = useState<UsageSettings>(structuredClone(settings))
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState<string | null>(null)
  const [quotaTesting, setQuotaTesting] = useState(false)
  const [scanMessage, setScanMessage] = useState<string | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const updateSource = (index: number, source: SshSource) => setDraft(current => ({ ...current, sshSources: current.sshSources.map((value, item) => item === index ? source : value) }))
  const addSource = () => {
    setDraft(current => ({ ...current, sshSources: [...current.sshSources, { id: `ssh-${Date.now()}`, label: '远端设备', host: '', enabledAgents: [...AGENTS], roots: {} }] }))
    setAdding(false)
  }
  const interval = draft.codexQuota.refreshIntervalSeconds
  const intervalMode = interval == null ? 'off' : [30, 60, 300, 900].includes(interval) ? String(interval) : 'custom'
  const sourceOptions = [{ id: 'local', label: '本机' }, ...draft.sshSources]
  return <div className="modal-backdrop"><div className="source-modal" role="dialog" aria-modal="true"><header><div><h2>数据源</h2><p>用量扫描按需运行，Codex 限额可独立自动刷新</p></div><button className="close" onClick={onClose}><X /></button></header>
    {dialogError && <div className="dialog-error">{dialogError}</div>}
    <section className="source-block"><div className="source-heading"><div><HardDrive /><span><strong>本机</strong><small>默认 Agent 数据目录</small></span></div><div className="agent-checks">{AGENTS.map(agent => <label key={agent}><input type="checkbox" checked={draft.localAgents.includes(agent)} onChange={() => setDraft(current => ({ ...current, localAgents: toggleRequired(current.localAgents, agent) }))} />{agentLabel[agent]}</label>)}</div></div><div className="root-grid">{AGENTS.map(agent => <label key={agent}>{agentLabel[agent]}<input value={draft.localRoots[agent] ?? ''} onChange={event => setDraft(current => ({ ...current, localRoots: { ...current.localRoots, [agent]: event.target.value } }))} placeholder={defaultRoot[agent]} /></label>)}</div></section>
    {draft.sshSources.map((source, index) => <section className="source-block" key={source.id}><div className="source-heading"><div><Server /><span><strong>{source.label || 'SSH 设备'}</strong><small>{source.host || '尚未填写 Host'}</small></span></div><button className="icon danger" title="移除设备" onClick={() => setDraft(current => ({ ...current, sshSources: current.sshSources.filter((_, item) => item !== index), codexQuota: current.codexQuota.sourceId === source.id ? { ...current.codexQuota, sourceId: null } : current.codexQuota }))}><Trash2 /></button></div><div className="ssh-fields"><label>名称<input value={source.label} onChange={event => updateSource(index, { ...source, label: event.target.value })} /></label><label>SSH Config Host<input value={source.host} onChange={event => updateSource(index, { ...source, host: event.target.value })} placeholder="gpu-server" /></label></div><div className="agent-checks">{AGENTS.map(agent => <label key={agent}><input type="checkbox" checked={source.enabledAgents.includes(agent)} onChange={() => updateSource(index, { ...source, enabledAgents: toggleRequired(source.enabledAgents, agent) })} />{agentLabel[agent]}</label>)}</div><div className="root-grid">{AGENTS.map(agent => <label key={agent}>{agentLabel[agent]}<input value={source.roots[agent] ?? ''} onChange={event => updateSource(index, { ...source, roots: { ...source.roots, [agent]: event.target.value } })} placeholder={defaultRoot[agent]} /></label>)}</div><button className="secondary scan-source" disabled={refreshRunning || !source.host} onClick={async () => { setScanning(source.id); setScanMessage(null); setDialogError(null); try { await onScan(source); setScanMessage(`${source.label || source.host} 扫描成功`) } catch (reason) { setDialogError(String(reason)) } finally { setScanning(null) } }}><RefreshCw className={scanning === source.id ? 'spin' : ''} />{scanning === source.id ? '扫描中…' : '测试并扫描'}</button></section>)}
    {scanMessage && <div className="dialog-success">{scanMessage}</div>}
    {adding ? <div className="add-confirm"><span>将添加一个使用 SSH config 和密钥认证的 Unix 设备。</span><button className="primary" onClick={addSource}>继续</button><button className="secondary" onClick={() => setAdding(false)}>取消</button></div> : <button className="add-source" onClick={() => setAdding(true)}><Plus />添加 SSH 设备</button>}
    <section className="source-block quota-settings"><div className="source-heading"><div><Gauge /><span><strong>Codex 限额查询</strong><small>仅显示所选设备登录的一个 Codex 账号</small></span></div></div>
      <div className="quota-setting-grid">
        <label>查询设备<select value={draft.codexQuota.sourceId ?? ''} onChange={event => setDraft(current => ({ ...current, codexQuota: { ...current.codexQuota, sourceId: event.target.value || null } }))}><option value="">不查询</option>{sourceOptions.map(source => <option key={source.id} value={source.id}>{source.label}</option>)}</select></label>
        <label>Shell<select value={draft.codexQuota.shellPreset} onChange={event => setDraft(current => ({ ...current, codexQuota: { ...current.codexQuota, shellPreset: event.target.value as ShellPreset } }))}><option value="auto">自动</option><option value="powershell">PowerShell</option><option value="zsh">zsh</option><option value="bash">bash</option></select></label>
        <label>自动刷新<select value={intervalMode} onChange={event => { const value = event.target.value; setDraft(current => ({ ...current, codexQuota: { ...current.codexQuota, refreshIntervalSeconds: value === 'off' ? null : value === 'custom' ? 120 : Number(value) } })) }}><option value="off">关闭</option><option value="30">30 秒</option><option value="60">60 秒</option><option value="300">5 分钟</option><option value="900">15 分钟</option><option value="custom">自定义</option></select></label>
        {intervalMode === 'custom' && <label>自定义秒数<input type="number" min="30" max="3600" value={interval ?? 120} onChange={event => setDraft(current => ({ ...current, codexQuota: { ...current.codexQuota, refreshIntervalSeconds: Number(event.target.value) } }))} /></label>}
      </div>
      <label className="pre-command">前置命令<textarea rows={3} value={draft.codexQuota.preCommand} onChange={event => setDraft(current => ({ ...current, codexQuota: { ...current.codexQuota, preCommand: event.target.value } }))} placeholder="例如：source ~/awsproxy" /><small>命令以明文保存在本机。建议引用脚本或环境变量，不要直接填写令牌和密码。</small></label>
      <button className="secondary scan-source" disabled={quotaTesting || !draft.codexQuota.sourceId} onClick={async () => { setQuotaTesting(true); setScanMessage(null); setDialogError(null); try { const result = await onQuotaTest(draft); if (result.status !== 'ready') throw new Error(result.error ?? '无法获取 Codex 限额'); setScanMessage(`${result.sourceLabel ?? '所选设备'} 限额查询成功`) } catch (reason) { setDialogError(String(reason)) } finally { setQuotaTesting(false) } }}><RefreshCw className={quotaTesting ? 'spin' : ''} />{quotaTesting ? '查询中…' : '测试限额查询'}</button>
    </section>
    <footer><button className="secondary" onClick={onClose}>取消</button><button className="primary" disabled={busy} onClick={async () => { setBusy(true); setDialogError(null); try { await onSave(draft) } catch (reason) { setDialogError(String(reason)); setBusy(false) } }}>{busy ? '保存中…' : '保存设置'}</button></footer>
  </div></div>
}

function toggleRequired<T>(values: T[], value: T): T[] { return values.includes(value) ? (values.length === 1 ? values : values.filter(item => item !== value)) : [...values, value] }
