import { Button, Input, Select, Textarea, Card, Dialog, Status } from '@digiworld/design-system/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Clock3, Database, Gauge, HardDrive, PieChart, Plus, RefreshCw, Server, Settings2, Ticket, Trash2, X } from 'lucide-react'
import { createPluginBridge } from '@digiworld/plugin-sdk'
import { cacheRateScale, calendarCells, formatTokens, heatLevel, weeklyModelCategories, weeklyUsage, type Metric, type UsageDay, type WeeklyUsagePoint } from './heatmap'
import './styles.css'

const PLUGIN_ID = 'io.github.jesmonx.digiworld.agent-token-heatmap'
const bridge = createPluginBridge(PLUGIN_ID)
const AGENTS = ['codex', 'claude', 'pi', 'zcode', 'agy'] as const
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
interface ModelTotal { model: string; totalTokens: number }
interface Snapshot {
  startDay?: string
  endDay: string
  totals: Totals
  days: UsageDay[]
  breakdown: Breakdown[]
  modelBreakdown: ModelBreakdown[]
}
interface QuotaWindow { usedPercent: number; windowDurationMins: number | null; resetsAt: number | null }
interface CodexResetCredit {
  id: string
  title?: string | null
  description?: string | null
  grantedAt: number
  expiresAt?: number | null
  status?: string | null
  resetType?: string | null
}
interface CodexResetCreditsSummary {
  availableCount: number
  credits?: CodexResetCredit[] | null
}
interface CodexQuotaSnapshot {
  status: 'ready' | 'stale' | 'unavailable' | 'unconfigured'
  sourceId: string | null
  sourceLabel: string | null
  fetchedAt: string | null
  planType: string | null
  windows: QuotaWindow[]
  resetCredits?: CodexResetCreditsSummary | null
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

const agentLabel: Record<Agent, string> = {
  codex: 'Codex',
  claude: 'Claude Code',
  pi: 'Pi',
  zcode: 'ZCode',
  agy: 'Antigravity (agy)',
}
const defaultRoot: Record<Agent, string> = {
  codex: '~/.codex/sessions',
  claude: '~/.claude/projects',
  pi: '~/.pi/agent/sessions',
  zcode: '~/.zcode/cli',
  agy: '~/.gemini/antigravity-cli/conversations',
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
  const modelTotals = useMemo(() => {
    const totals = new Map<string, number>()
    for (const row of snapshot?.modelBreakdown ?? []) {
      if (!row.model || row.totalTokens <= 0 || !Number.isFinite(row.totalTokens)) continue
      totals.set(row.model, (totals.get(row.model) ?? 0) + row.totalTokens)
    }
    return [...totals.entries()]
      .map(([model, totalTokens]) => ({ model, totalTokens }))
      .sort((a, b) => b.totalTokens - a.totalTokens || a.model.localeCompare(b.model))
  }, [snapshot])
  const weekly = useMemo(() => snapshot ? weeklyUsage(snapshot.endDay, snapshot.days) : [], [snapshot])
  const sourceOptions = settings ? [{ id: 'local', label: '本机' }, ...settings.sshSources] : []

  return (
    <div className="usage-app">
      <header className="dw-toolbar usage-header">

        <div className="header-buttons"><Button className="secondary" onClick={() => setSettingsOpen(true)}><Settings2 />数据源</Button><Button className="primary" disabled={refresh.running} onClick={() => void startRefresh()}><RefreshCw className={refresh.running ? 'spin' : ''} />{refresh.running ? `${refresh.completed}/${refresh.total} ${refresh.currentSource ?? ''}` : '手动刷新'}</Button></div>
      </header>

      {(error || refresh.errors.length > 0) && <Status tone="error" className="error-banner"><AlertTriangle /><span>{error ?? refresh.errors.join('；')}</span><Button onClick={() => { setError(null); setRefresh(current => ({ ...current, errors: [] })) }}><X /></Button></Status>}

      <section className="filter-bar">
        <FilterGroup label="Agent">{AGENTS.map(agent => <FilterChip key={agent} active={agents.includes(agent)} label={agentLabel[agent]} onClick={() => toggleAgent(agent)} />)}</FilterGroup>
        <FilterGroup label="设备">{sourceOptions.map(source => <FilterChip key={source.id} active={sources.includes(source.id)} label={source.label} onClick={() => toggleSource(source.id)} />)}</FilterGroup>
      </section>

      <section className="insights-grid">
        <WeeklyChart points={weekly} />
        <QuotaCard quota={quota} loading={quotaLoading} configured={Boolean(settings?.codexQuota.sourceId)} onRefresh={() => void loadQuota(true)} onConfigure={() => setSettingsOpen(true)} />
      </section>

      <section className="dw-card heatmap-card">
        <div className="card-title">
          <div><h2>每日热力图</h2><p>{snapshot?.startDay ?? snapshot?.days[0]?.day ?? '—'} 至 {snapshot?.endDay ?? '—'}</p></div>
          <div className="heatmap-controls">
            <div className="dw-segmented range-group" aria-label="统计范围">{(['30', '90', '365', 'all'] as Range[]).map(value => <Button key={value} className={range === value ? 'active' : ''} onClick={() => setRange(value)}>{value === 'all' ? '全部' : `${value} 天`}</Button>)}</div>
            <Select aria-label="热力图指标" value={metric} onChange={event => setMetric(event.target.value as Metric)}><option value="totalTokens">总 Token</option><option value="inputTokens">输入</option><option value="outputTokens">输出</option><option value="cacheReadTokens">缓存读取</option></Select>
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
        <Card className="dw-card breakdown-card"><h2>来源明细</h2>{snapshot?.breakdown.length ? <div className="breakdown-table">{[...snapshot.breakdown].sort((a, b) => b.totalTokens - a.totalTokens).map(row => <div key={`${row.sourceId}-${row.agent}`}><span className={`agent-dot ${row.agent}`} /><strong>{agentLabel[row.agent]}</strong><span>{row.sourceLabel}</span><b>{formatTokens(row.totalTokens)}</b><small>{row.cacheRate == null ? `${formatTokens(row.cacheReadTokens)} cache` : `${(row.cacheRate * 100).toFixed(1)}% cache`}</small></div>)}</div> : <Empty />}</Card>
        <Card className="dw-card daily-ranking-card"><h2>每日用量排行</h2>{dailyRanking.length ? <div className="daily-ranking">{dailyRanking.map((day, index) => <div key={day.day}><b>{index + 1}</b><span>{day.day}</span><i><em style={{ width: `${(day.totalTokens / dailyMax) * 100}%` }} /></i><strong>{formatTokens(day.totalTokens)}</strong></div>)}</div> : <Empty />}</Card>
      </section>

      <Card className="dw-card model-card">
        <div className="model-card-heading"><div><h2>模型来源明细</h2><p>按模型聚合 Token 用量</p></div><PieChart /></div>
        <ModelPieChart rows={modelTotals} />
      </Card>

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
  const width = 820
  const height = 300
  const left = 68
  const right = 68
  const top = 30
  const bottom = 54
  const plotWidth = width - left - right
  const plotHeight = height - top - bottom
  const step = plotWidth / Math.max(points.length, 1)
  const barWidth = Math.min(56, step * .62)
  const maximum = Math.max(1, ...points.map(point => point.totalTokens))
  const modelCategories = weeklyModelCategories(points)
  const { minimum: cacheAxisMinimum, maximum: cacheAxisMaximum } = cacheRateScale(points.map(point => point.cacheRate))
  const cacheAxisRange = Math.max(.05, cacheAxisMaximum - cacheAxisMinimum)
  const ticks = [0, .25, .5, .75, 1]
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
  const yForRate = (rate: number) => top + (cacheAxisMaximum - Math.max(cacheAxisMinimum, Math.min(cacheAxisMaximum, rate))) / cacheAxisRange * plotHeight

  return <Card className="dw-card weekly-card">
    <div className="panel-heading"><div><h2>Last 7 Days</h2></div><div className="chart-legend" aria-label="图例">{modelCategories.length ? modelCategories.map((category, index) => <span className="legend-item" key={category.key} title={`${category.label} · ${formatTokens(category.totalTokens)}`}><i className={`model-key model-key-${index}`} /><b>{category.label}</b><small>{formatTokens(category.totalTokens)}</small></span>) : <span className="legend-item"><i className="bar-key" /><b>Token</b></span>}</div></div>
    {points.length ? <svg className="weekly-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="近七天按模型堆叠的 Token 用量柱形图和缓存率折线图">
      <text x={left} y={top - 13} className="chart-axis-title">Token</text>
      <text x={width - right} y={top - 13} textAnchor="end" className="chart-axis-title">缓存率</text>
      {ticks.map(ratio => {
        const y = top + ratio * plotHeight
        return <g key={ratio}><line x1={left} x2={width - right} y1={y} y2={y} className="chart-grid-line" /><text x={left - 10} y={y + 4} textAnchor="end" className="chart-axis-label">{formatTokens(maximum * (1 - ratio))}</text><text x={width - right + 10} y={y + 4} className="chart-axis-label">{Math.round((cacheAxisMaximum - cacheAxisRange * ratio) * 100)}%</text></g>
      })}
      <line x1={left} x2={width - right} y1={top + plotHeight} y2={top + plotHeight} className="chart-axis-line" />
      {points.map((point, index) => {
        const x = left + (index + .5) * step
        const scale = plotHeight / maximum
        let offset = 0
        const cache = point.cacheRate == null ? '—' : `${(point.cacheRate * 100).toFixed(1)}%`
        const modelSummary = modelCategories
          .map(category => {
            const value = category.values[index] ?? 0
            return value > 0 ? `${category.label} ${formatTokens(value)}` : null
          })
          .filter(Boolean)
          .join('、')
        return <g key={point.day}><title>{`${point.day} · ${formatTokens(point.totalTokens)} Token${modelSummary ? ` · ${modelSummary}` : ''} · 缓存率 ${cache}`}</title><g className="token-bar">{modelCategories.map((category, categoryIndex) => {
          const value = category.values[index] ?? 0
          if (value <= 0) return null
          const segmentHeight = value * scale
          const y = top + plotHeight - offset - segmentHeight
          offset += segmentHeight
          return <rect key={`${point.day}-${category.key}`} x={x - barWidth / 2} y={y} width={barWidth} height={segmentHeight} rx="3" className={`token-segment model-${categoryIndex}`}><title>{`${point.day} · ${category.label} · ${formatTokens(value)} Token (${point.totalTokens > 0 ? (value / point.totalTokens * 100).toFixed(1) : '0.0'}%)`}</title></rect>
        })}</g><text x={x} y={height - 18} textAnchor="middle" className="chart-day-label">{point.day.slice(5).replace('-', '/')}</text></g>
      })}
      {segments.map((segment, index) => segment.length > 1 && <polyline key={index} points={segment.map(point => `${xFor(point)},${yForRate(point.cacheRate!)}`).join(' ')} className="cache-line" />)}
      {points.filter(point => point.cacheRate != null).map((point, index) => {
        const x = xFor(point)
        const y = yForRate(point.cacheRate!)
        const label = `${(point.cacheRate! * 100).toFixed(1)}%`
        const labelBelow = y < top + 27 || (index % 2 === 1 && y < top + 52)
        return <g key={point.day} className="cache-marker"><circle cx={x} cy={y} r="5" className="cache-point"><title>{`${point.day} 缓存率 ${label}`}</title></circle><text x={x} y={labelBelow ? y + 20 : y - 11} textAnchor="middle" className="cache-point-label">{label}</text></g>
      })}
    </svg> : <Empty />}
  </Card>
}

const modelPieColors = ['var(--dw-chart-1)', 'var(--dw-chart-2)', 'var(--dw-chart-3)', 'var(--dw-chart-4)', 'var(--dw-danger)', 'var(--dw-accent-secondary)', 'var(--dw-text-muted)', 'var(--dw-border-strong)']

function ModelPieChart({ rows }: { rows: ModelTotal[] }) {
  if (!rows.length) return <Empty />

  const total = rows.reduce((sum, row) => sum + row.totalTokens, 0)
  const centerX = 108
  const centerY = 108
  const radius = 82
  let angle = -Math.PI / 2
  const sectors = rows.map((row, index) => {
    const startAngle = angle
    angle += (row.totalTokens / total) * Math.PI * 2
    return { ...row, index, startAngle, endAngle: angle }
  })

  return <div className="model-pie-wrap">
    <svg className="model-pie" viewBox="0 0 216 216" role="img" aria-label="按模型聚合的 Token 用量饼状图">
      <title>按模型聚合的 Token 用量</title>
      {sectors.map(sector => <path key={sector.model} className="model-pie-slice" d={pieSectorPath(centerX, centerY, radius, sector.startAngle, sector.endAngle)} fill={modelPieColors[sector.index % modelPieColors.length]}>
        <title>{`${modelDisplayName(sector.model)} · ${formatTokens(sector.totalTokens)} · ${(sector.totalTokens / total * 100).toFixed(1)}%`}</title>
      </path>)}
    </svg>
    <div className="model-pie-legend" aria-label="模型图例">
      {sectors.map(sector => <div key={sector.model}><i style={{ background: modelPieColors[sector.index % modelPieColors.length] }} /><strong title={modelDisplayName(sector.model)}>{modelDisplayName(sector.model)}</strong><span>{formatTokens(sector.totalTokens)} · {(sector.totalTokens / total * 100).toFixed(1)}%</span></div>)}
    </div>
  </div>
}

function pieSectorPath(centerX: number, centerY: number, radius: number, startAngle: number, endAngle: number): string {
  if (endAngle - startAngle >= Math.PI * 2 - 0.001) {
    return `M ${centerX} ${centerY - radius} A ${radius} ${radius} 0 1 1 ${centerX} ${centerY + radius} A ${radius} ${radius} 0 1 1 ${centerX} ${centerY - radius} Z`
  }
  const startX = centerX + Math.cos(startAngle) * radius
  const startY = centerY + Math.sin(startAngle) * radius
  const endX = centerX + Math.cos(endAngle) * radius
  const endY = centerY + Math.sin(endAngle) * radius
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0
  return `M ${centerX} ${centerY} L ${startX} ${startY} A ${radius} ${radius} 0 ${largeArc} 1 ${endX} ${endY} Z`
}

function modelDisplayName(model: string): string {
  return model === 'unknown' ? '未知模型' : model
}

function QuotaCard({ quota, loading, configured, onRefresh, onConfigure }: { quota: CodexQuotaSnapshot | null; loading: boolean; configured: boolean; onRefresh(): void; onConfigure(): void }) {
  const available = quota && (quota.status === 'ready' || quota.status === 'stale') && quota.windows.length > 0
  const resetSummary = quota?.resetCredits
  const availableResets = resetSummary?.availableCount ?? 0
  const credits = (resetSummary?.credits ?? []).filter(credit => credit.status !== 'redeemed')
  return <Card className={`quota-card ${quota?.status ?? ''}`}>
    <div className="panel-heading"><div><h2>Codex 限额</h2><p>{quota?.sourceLabel ?? '指定账号设备'}{quota?.planType ? ` · ${quota.planType}` : ''}</p></div><Button className="panel-action" title="刷新 Codex 限额" disabled={loading || !configured} onClick={onRefresh}><RefreshCw className={loading ? 'spin' : ''} /></Button></div>
    {!configured || quota?.status === 'unconfigured' ? <div className="quota-empty"><Gauge /><span>尚未选择限额查询设备</span><Button onClick={onConfigure}>前往设置</Button></div>
      : loading && !quota ? <div className="quota-empty"><RefreshCw className="spin" /><span>正在获取最新限额…</span></div>
        : available ? <>
          <div className="quota-windows">{quota.windows.map((window, index) => {
            const remaining = 100 - Math.max(0, Math.min(100, window.usedPercent))
            return <div key={`${window.windowDurationMins ?? index}-${window.resetsAt ?? index}`} className="quota-window"><div><strong>{formatDuration(window.windowDurationMins)}</strong><span>已用 {window.usedPercent}% · 剩余 {Math.max(0, 100 - window.usedPercent)}%</span></div><div className="quota-track"><i style={{ width: `${remaining}%` }} /></div><small><Clock3 />{formatReset(window.resetsAt)}</small></div>
          })}</div>
          <div className="quota-resets">
            <div className="quota-resets-header">
              <span className="quota-resets-title"><Ticket />重置卡</span>
              <span className={`quota-resets-badge ${availableResets > 0 ? 'active' : 'zero'}`}>
                {availableResets > 0 ? `${availableResets} 张可用` : '0 张可用'}
              </span>
            </div>
            {credits.length > 0 && (
              <div className="quota-reset-items">
                {credits.map((credit, index) => (
                  <div key={credit.id || index} className="quota-reset-item">
                    <div className="quota-reset-item-name">
                      <span>{credit.title || '额度重置卡'}</span>
                      {credit.description && <span className="quota-reset-item-desc">{credit.description}</span>}
                    </div>
                    <div className="quota-reset-item-dates">
                      <span>获得：{formatCardDate(credit.grantedAt)}</span>
                      <span>到期：{formatCardDate(credit.expiresAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className={`quota-meta ${quota.status === 'stale' ? 'warning' : ''}`}>{quota.status === 'stale' ? `刷新失败，显示上次结果：${quota.error ?? '未知错误'}` : `更新于 ${formatFetchedAt(quota.fetchedAt)}`}</div>
        </> : <div className="quota-empty error"><AlertTriangle /><span>{quota?.error ?? '当前设备无法获取 Codex 限额'}</span><Button onClick={onConfigure}>检查设置</Button></div>}
  </Card>
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
  const ms = seconds > 100_000_000_000 ? seconds : seconds * 1000
  return `${new Date(ms).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} 重置`
}

function formatCardDate(seconds: number | null | undefined): string {
  if (!seconds) return '永久有效'
  const ms = seconds > 100_000_000_000 ? seconds : seconds * 1000
  return new Date(ms).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function formatFetchedAt(value: string | null): string {
  if (!value) return '刚刚'
  return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) { return <div className="filter-group"><span>{label}</span>{children}</div> }
function FilterChip({ active, label, onClick }: { active: boolean; label: string; onClick(): void }) { return <Button className={`filter-chip ${active ? 'active' : ''}`} aria-pressed={active} onClick={onClick}>{active && <Check />}{label}</Button> }
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
  return <Dialog open onClose={() => { if (!busy) onClose() }} className="source-modal" aria-label="数据源"><header><div><h2>数据源</h2><p>用量扫描按需运行，Codex 限额可独立自动刷新</p></div><Button className="close" onClick={onClose}><X /></Button></header>
    {dialogError && <Status tone="error" className="dialog-error">{dialogError}</Status>}
    <section className="source-block"><div className="source-heading"><div><HardDrive /><span><strong>本机</strong><small>默认 Agent 数据目录</small></span></div><div className="agent-checks">{AGENTS.map(agent => <label key={agent}><Input type="checkbox" checked={draft.localAgents.includes(agent)} onChange={() => setDraft(current => ({ ...current, localAgents: toggleRequired(current.localAgents, agent) }))} />{agentLabel[agent]}</label>)}</div></div><div className="root-grid">{AGENTS.map(agent => <label key={agent}>{agentLabel[agent]}<Input value={draft.localRoots[agent] ?? ''} onChange={event => setDraft(current => ({ ...current, localRoots: { ...current.localRoots, [agent]: event.target.value } }))} placeholder={defaultRoot[agent]} /></label>)}</div></section>
    {draft.sshSources.map((source, index) => <section className="source-block" key={source.id}><div className="source-heading"><div><Server /><span><strong>{source.label || 'SSH 设备'}</strong><small>{source.host || '尚未填写 Host'}</small></span></div><Button className="icon danger" title="移除设备" onClick={() => setDraft(current => ({ ...current, sshSources: current.sshSources.filter((_, item) => item !== index), codexQuota: current.codexQuota.sourceId === source.id ? { ...current.codexQuota, sourceId: null } : current.codexQuota }))}><Trash2 /></Button></div><div className="ssh-fields"><label>名称<Input value={source.label} onChange={event => updateSource(index, { ...source, label: event.target.value })} /></label><label>SSH Config Host<Input value={source.host} onChange={event => updateSource(index, { ...source, host: event.target.value })} placeholder="gpu-server" /></label></div><div className="agent-checks">{AGENTS.map(agent => <label key={agent}><Input type="checkbox" checked={source.enabledAgents.includes(agent)} onChange={() => updateSource(index, { ...source, enabledAgents: toggleRequired(source.enabledAgents, agent) })} />{agentLabel[agent]}</label>)}</div><div className="root-grid">{AGENTS.map(agent => <label key={agent}>{agentLabel[agent]}<Input value={source.roots[agent] ?? ''} onChange={event => updateSource(index, { ...source, roots: { ...source.roots, [agent]: event.target.value } })} placeholder={defaultRoot[agent]} /></label>)}</div><Button className="secondary scan-source" disabled={refreshRunning || !source.host} onClick={async () => { setScanning(source.id); setScanMessage(null); setDialogError(null); try { await onScan(source); setScanMessage(`${source.label || source.host} 扫描成功`) } catch (reason) { setDialogError(String(reason)) } finally { setScanning(null) } }}><RefreshCw className={scanning === source.id ? 'spin' : ''} />{scanning === source.id ? '扫描中…' : '测试并扫描'}</Button></section>)}
    {scanMessage && <Status tone="success" className="dialog-success">{scanMessage}</Status>}
    {adding ? <div className="add-confirm"><span>将添加一个使用 SSH config 和密钥认证的 Unix 设备。</span><Button className="primary" onClick={addSource}>继续</Button><Button className="secondary" onClick={() => setAdding(false)}>取消</Button></div> : <Button className="add-source" onClick={() => setAdding(true)}><Plus />添加 SSH 设备</Button>}
    <section className="source-block quota-settings"><div className="source-heading"><div><Gauge /><span><strong>Codex 限额查询</strong><small>仅显示所选设备登录的一个 Codex 账号</small></span></div></div>
      <div className="quota-setting-grid">
        <label>查询设备<Select value={draft.codexQuota.sourceId ?? ''} onChange={event => setDraft(current => ({ ...current, codexQuota: { ...current.codexQuota, sourceId: event.target.value || null } }))}><option value="">不查询</option>{sourceOptions.map(source => <option key={source.id} value={source.id}>{source.label}</option>)}</Select></label>
        <label>Shell<Select value={draft.codexQuota.shellPreset} onChange={event => setDraft(current => ({ ...current, codexQuota: { ...current.codexQuota, shellPreset: event.target.value as ShellPreset } }))}><option value="auto">自动</option><option value="powershell">PowerShell</option><option value="zsh">zsh</option><option value="bash">bash</option></Select></label>
        <label>自动刷新<Select value={intervalMode} onChange={event => { const value = event.target.value; setDraft(current => ({ ...current, codexQuota: { ...current.codexQuota, refreshIntervalSeconds: value === 'off' ? null : value === 'custom' ? 120 : Number(value) } })) }}><option value="off">关闭</option><option value="30">30 秒</option><option value="60">60 秒</option><option value="300">5 分钟</option><option value="900">15 分钟</option><option value="custom">自定义</option></Select></label>
        {intervalMode === 'custom' && <label>自定义秒数<Input type="number" min="30" max="3600" value={interval ?? 120} onChange={event => setDraft(current => ({ ...current, codexQuota: { ...current.codexQuota, refreshIntervalSeconds: Number(event.target.value) } }))} /></label>}
      </div>
      <label className="pre-command">前置命令<Textarea rows={3} value={draft.codexQuota.preCommand} onChange={event => setDraft(current => ({ ...current, codexQuota: { ...current.codexQuota, preCommand: event.target.value } }))} placeholder="例如：source ~/awsproxy" /><small>命令以明文保存在本机。建议引用脚本或环境变量，不要直接填写令牌和密码。</small></label>
      <Button className="secondary scan-source" disabled={quotaTesting || !draft.codexQuota.sourceId} onClick={async () => { setQuotaTesting(true); setScanMessage(null); setDialogError(null); try { const result = await onQuotaTest(draft); if (result.status !== 'ready') throw new Error(result.error ?? '无法获取 Codex 限额'); setScanMessage(`${result.sourceLabel ?? '所选设备'} 限额查询成功`) } catch (reason) { setDialogError(String(reason)) } finally { setQuotaTesting(false) } }}><RefreshCw className={quotaTesting ? 'spin' : ''} />{quotaTesting ? '查询中…' : '测试限额查询'}</Button>
    </section>
    <footer><Button className="secondary" onClick={onClose}>取消</Button><Button className="primary" disabled={busy} onClick={async () => { setBusy(true); setDialogError(null); try { await onSave(draft) } catch (reason) { setDialogError(String(reason)); setBusy(false) } }}>{busy ? '保存中…' : '保存设置'}</Button></footer>
  </Dialog>
}

function toggleRequired<T>(values: T[], value: T): T[] { return values.includes(value) ? (values.length === 1 ? values : values.filter(item => item !== value)) : [...values, value] }
