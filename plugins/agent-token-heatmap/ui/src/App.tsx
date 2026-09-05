import { Button, Input, Select, Textarea, Card, Dialog, Status } from '@digiworld/design-system/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  autoRefreshIntervalSeconds?: number | null
  codexQuota: CodexQuotaSettings
  selectedAgents?: Agent[]
  selectedSources?: string[]
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

function AgentIcon({ agent, className = '' }: { agent: Agent; className?: string }) {
  const cls = `agent-icon agent-icon-${agent} ${className}`.trim()
  if (agent === 'codex') {
    return (
      <svg className={cls} viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
        <path d="M22.28 9.82a5.98 5.98 0 0 0-.51-4.91 6.05 6.05 0 0 0-6.51-2.9A6.07 6.07 0 0 0 4.98 4.18a5.98 5.98 0 0 0-4 2.9 6.05 6.05 0 0 0 .74 7.1 5.98 5.98 0 0 0 .51 4.91 6.05 6.05 0 0 0 6.52 2.9A5.98 5.98 0 0 0 13.26 24a6.06 6.06 0 0 0 5.77-4.2 5.99 5.99 0 0 0 4-2.9 6.06 6.06 0 0 0-.75-7.08zm-9.02 12.61a4.48 4.48 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.8.8 0 0 0 .4-.68v-6.74l2.02 1.17a.07.07 0 0 1 .04.05v5.59a4.5 4.5 0 0 1-4.5 4.49zm-9.66-4.13a4.47 4.47 0 0 1-.54-3.01l.15.08 4.78 2.76a.77.77 0 0 0 .78 0l5.84-3.37v2.33a.08.08 0 0 1-.03.06L9.74 19.95a4.5 4.5 0 0 1-6.14-1.65zM2.34 7.9a4.48 4.48 0 0 1 2.37-1.98V11.6a.77.77 0 0 0 .38.68l5.82 3.35-2.02 1.17a.08.08 0 0 1-.07 0L4 14.01A4.5 4.5 0 0 1 2.34 7.9zm16.6 3.85L13.1 8.36 15.12 7.2a.08.08 0 0 1 .07 0l4.83 2.8a4.49 4.49 0 0 1-.67 8.1v-5.68a.8.8 0 0 0-.41-.67zm2.01-3.02l-.14-.09-4.78-2.78a.78.78 0 0 0-.78 0L9.41 9.23V6.9a.07.07 0 0 1 .03-.06l4.83-2.79a4.5 4.5 0 0 1 6.68 4.66zM8.31 12.86l-2.02-1.16a.08.08 0 0 1-.04-.06V6.07a4.5 4.5 0 0 1 7.38-3.45l-.14.08L8.7 5.46a.8.8 0 0 0-.4.68zm1.1-2.36l2.6-1.5 2.6 1.5v3l-2.6 1.5-2.6-1.5z" />
      </svg>
    )
  }
  if (agent === 'claude') {
    return (
      <svg className={cls} viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
        <path d="M12 2a1.25 1.25 0 0 1 1.25 1.25v2.88a1.25 1.25 0 1 1-2.5 0V3.25A1.25 1.25 0 0 1 12 2zm0 14.62a1.25 1.25 0 0 1 1.25 1.25v2.88a1.25 1.25 0 1 1-2.5 0v-2.88A1.25 1.25 0 0 1 12 16.62zm10-5.87a1.25 1.25 0 0 1-1.25 1.25h-2.88a1.25 1.25 0 1 1 0-2.5h2.88A1.25 1.25 0 0 1 22 10.75zm-14.62 0a1.25 1.25 0 0 1-1.25 1.25H3.25a1.25 1.25 0 1 1 0-2.5h2.88A1.25 1.25 0 0 1 7.38 10.75zm11.69-6.32a1.25 1.25 0 0 1 0 1.77l-2.04 2.04a1.25 1.25 0 0 1-1.77-1.77l2.04-2.04a1.25 1.25 0 0 1 1.77 0zm-10.36 10.36a1.25 1.25 0 0 1 0 1.77l-2.04 2.04a1.25 1.25 0 0 1-1.77-1.77l2.04-2.04a1.25 1.25 0 0 1 1.77 0zm10.36 1.77a1.25 1.25 0 0 1-1.77 1.77l-2.04-2.04a1.25 1.25 0 0 1 1.77-1.77l2.04 2.04zM6.94 4.43a1.25 1.25 0 0 1 1.77 1.77L6.67 8.24A1.25 1.25 0 0 1 4.9 6.47l2.04-2.04z" />
      </svg>
    )
  }
  if (agent === 'pi') {
    return (
      <svg className={cls} viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
        <path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h13a1.5 1.5 0 0 1 0 3H7.8l.7 9.2a2 2 0 0 0 2 1.8h.5a1.5 1.5 0 0 1 0 3h-.5a5 5 0 0 1-4.98-4.63L5 8h-.5A1.5 1.5 0 0 1 4 6.5zm11 1.5h3v8.5a2.5 2.5 0 0 0 2.5 2.5 1.5 1.5 0 0 1 0 3 5.5 5.5 0 0 1-5.5-5.5V8z" />
      </svg>
    )
  }
  if (agent === 'zcode') {
    return (
      <svg className={cls} viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
        <path d="M5 6.5A1.5 1.5 0 0 1 6.5 5h11a1.5 1.5 0 0 1 1.2 2.4L11.5 16H17.5a1.5 1.5 0 0 1 0 3h-11a1.5 1.5 0 0 1-1.2-2.4L12.5 8H6.5A1.5 1.5 0 0 1 5 6.5z" />
      </svg>
    )
  }
  return (
    <svg className={cls} viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M12 2C12 7.52 7.52 12 2 12C7.52 12 12 16.48 12 22C12 16.48 16.48 12 22 12C16.48 12 12 7.52 12 2Z" />
    </svg>
  )
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

  const loadSnapshot = useCallback(async (nextSettings?: UsageSettings, currentAgents?: Agent[], currentSources?: string[]) => {
    const configured = nextSettings ?? settings
    if (!configured) return
    const activeAgents = currentAgents ?? agents
    const activeSources = currentSources ?? sources
    const allowedSources = ['local', ...configured.sshSources.map(source => source.id)]
    const selectedSources = activeSources.filter(source => allowedSources.includes(source))
    setSnapshot(await bridge.request<Snapshot>('usage.snapshot', {
      range,
      agents: activeAgents,
      sources: selectedSources.length ? selectedSources : allowedSources,
    }))
  }, [agents, range, settings, sources])

  useEffect(() => {
    bridge.ready()
    bridge.request<UsageSettings>('usage.getSettings').then(value => {
      setSettings(value)
      const allowedSources = ['local', ...value.sshSources.map(source => source.id)]
      const initialAgents = (value.selectedAgents && value.selectedAgents.length > 0)
        ? value.selectedAgents.filter(a => AGENTS.includes(a))
        : [...AGENTS]
      const initialSources = (value.selectedSources && value.selectedSources.length > 0)
        ? value.selectedSources.filter(s => allowedSources.includes(s))
        : allowedSources
      const effectiveSources = initialSources.length > 0 ? initialSources : allowedSources
      setAgents(initialAgents)
      setSources(effectiveSources)
      return bridge.request<Snapshot>('usage.snapshot', {
        range: '365',
        agents: initialAgents,
        sources: effectiveSources,
      })
    }).then(setSnapshot).catch(reason => setError(String(reason)))
  }, [])

  useEffect(() => {
    if (settings) void loadSnapshot().catch(reason => setError(String(reason)))
  }, [agents, range, sources]) // eslint-disable-line react-hooks/exhaustive-deps

  const watchRefresh = useCallback(async (status: RefreshStatus): Promise<RefreshStatus> => {
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
  }, [loadSnapshot])

  const startRefresh = useCallback(async (sourceId?: string) => {
    setError(null)
    try {
      await watchRefresh(await bridge.request<RefreshStatus>('usage.startRefresh', sourceId ? { sourceId } : {}))
    } catch (reason) {
      setError(String(reason))
    }
  }, [watchRefresh])

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

  const autoRefreshRunningRef = useRef(false)
  const lastRefreshedAtRef = useRef<number>(Date.now())
  const autoRefreshInterval = settings?.autoRefreshIntervalSeconds ?? 0

  const refreshAll = useCallback(async () => {
    if (autoRefreshRunningRef.current) return
    if (document.visibilityState === 'hidden') return
    autoRefreshRunningRef.current = true
    try {
      const status = await bridge.request<RefreshStatus>('usage.refreshStatus')
      if (!status.running) {
        await startRefresh()
      }
      await loadQuota(true)
      lastRefreshedAtRef.current = Date.now()
    } finally {
      autoRefreshRunningRef.current = false
    }
  }, [loadQuota, startRefresh])

  useEffect(() => {
    if (!autoRefreshInterval || autoRefreshInterval <= 0) return
    const timer = window.setInterval(() => {
      void refreshAll()
    }, autoRefreshInterval * 1000)

    const onVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') {
        const elapsed = Date.now() - lastRefreshedAtRef.current
        if (elapsed >= autoRefreshInterval * 1000) {
          void refreshAll()
        }
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [autoRefreshInterval, refreshAll])

  const changeAutoRefreshInterval = async (seconds: number) => {
    if (!settings) return
    const next: UsageSettings = {
      ...settings,
      autoRefreshIntervalSeconds: seconds <= 0 ? null : seconds,
    }
    setSettings(next)
    try {
      await bridge.request('usage.saveSettings', { settings: next })
    } catch (e) {
      setError(String(e))
    }
  }

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

  const toggleAgent = (agent: Agent) => {
    const next = agents.includes(agent)
      ? (agents.length === 1 ? agents : agents.filter(value => value !== agent))
      : [...agents, agent]
    setAgents(next)
    void bridge.request('usage.saveFilters', { agents: next, sources }).catch(() => {})
  }
  const toggleSource = (source: string) => {
    const next = sources.includes(source)
      ? (sources.length === 1 ? sources : sources.filter(value => value !== source))
      : [...sources, source]
    setSources(next)
    void bridge.request('usage.saveFilters', { agents, sources: next }).catch(() => {})
  }

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
        <div className="header-buttons">
          <div className="auto-refresh-control">
            <Clock3 size={14} />
            <Select
              aria-label="自动刷新间隔"
              value={String(autoRefreshInterval)}
              onChange={e => void changeAutoRefreshInterval(Number(e.target.value))}
            >
              <option value="0">自动刷新：关闭</option>
              <option value="60">自动刷新：1 分钟</option>
              <option value="300">自动刷新：5 分钟</option>
              <option value="900">自动刷新：15 分钟</option>
              <option value="1800">自动刷新：30 分钟</option>
              <option value="3600">自动刷新：1 小时</option>
            </Select>
          </div>
          <Button className="secondary" onClick={() => setSettingsOpen(true)}><Settings2 />数据源</Button>
          <Button className="primary" disabled={refresh.running} onClick={() => void startRefresh()}><RefreshCw className={refresh.running ? 'spin' : ''} />{refresh.running ? `${refresh.completed}/${refresh.total} ${refresh.currentSource ?? ''}` : '手动刷新'}</Button>
        </div>
      </header>

      {(error || refresh.errors.length > 0) && <Status tone="error" className="error-banner"><AlertTriangle /><span>{error ?? refresh.errors.join('；')}</span><Button onClick={() => { setError(null); setRefresh(current => ({ ...current, errors: [] })) }}><X /></Button></Status>}

      <section className="filter-bar">
        <FilterGroup label="Agent">{AGENTS.map(agent => <FilterChip key={agent} active={agents.includes(agent)} label={agentLabel[agent]} icon={<AgentIcon agent={agent} />} onClick={() => toggleAgent(agent)} />)}</FilterGroup>
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
        {snapshot && cells.length ? <div className="calendar-wrap"><div className="weekday-labels"><span>一</span><span>三</span><span>五</span><span>日</span></div><div className="calendar-grid">{cells.map((cell, index) => <i key={cell.day ?? `blank-${index}`} tabIndex={cell.day ? 0 : undefined} aria-label={cell.day ? `${cell.day}，${formatTokens(cell.value)}` : undefined} className={`level-${heatLevel(cell.value, max)} ${cell.day ? '' : 'blank'}`} title={cell.day ? `${cell.day} · ${formatTokens(cell.value)}` : undefined} />)}</div><div className="legend"><span>低</span>{[0, 1, 2, 3, 4, 5].map(level => <i key={level} className={`level-${level}`} />)}<span>高</span></div></div> : <Empty />}
      </section>

      <section className="lower-grid">
        <Card className="dw-card breakdown-card"><h2>来源明细</h2>{snapshot?.breakdown.length ? <div className="breakdown-table">{[...snapshot.breakdown].sort((a, b) => b.totalTokens - a.totalTokens).map(row => <div key={`${row.sourceId}-${row.agent}`}><AgentIcon agent={row.agent} className={`agent-breakdown-icon ${row.agent}`} /><strong>{agentLabel[row.agent]}</strong><span>{row.sourceLabel}</span><b>{formatTokens(row.totalTokens)}</b><small>{row.cacheRate == null ? `${formatTokens(row.cacheReadTokens)} cache` : `${(row.cacheRate * 100).toFixed(1)}% cache`}</small></div>)}</div> : <Empty />}</Card>
        <Card className="dw-card daily-ranking-card"><h2>每日用量排行</h2>{dailyRanking.length ? <div className="daily-ranking">{dailyRanking.map((day, index) => <div key={day.day}><b>{index + 1}</b><span>{day.day}</span><i><em style={{ width: `${(day.totalTokens / dailyMax) * 100}%` }} /></i><strong>{formatTokens(day.totalTokens)}</strong></div>)}</div> : <Empty />}</Card>
      </section>

      <Card className="dw-card model-card">
        <div className="model-card-heading"><div><h2>模型来源明细</h2><p>按模型聚合 Token 用量</p></div><PieChart /></div>
        <ModelPieChart rows={modelTotals} />
      </Card>

      {settingsOpen && settings && <SourceDialog settings={settings} refreshRunning={refresh.running} onClose={() => setSettingsOpen(false)} onSave={async value => {
        const nextSources = sources.filter(id => id === 'local' || value.sshSources.some(source => source.id === id))
        const saved = await bridge.request<UsageSettings>('usage.saveSettings', {
          settings: {
            ...value,
            selectedAgents: agents,
            selectedSources: nextSources,
          },
        })
        setSettings(saved)
        const allowedSources = ['local', ...saved.sshSources.map(source => source.id)]
        const effectiveSources = nextSources.length ? nextSources : allowedSources
        setSources(effectiveSources)
        setSettingsOpen(false)
        await loadSnapshot(saved, agents, effectiveSources)
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
    <div className="panel-heading"><div><h2>Last 7 Days</h2></div><div className="chart-legend" aria-label="图例">{modelCategories.length ? modelCategories.map((category, index) => <span className="legend-item" key={category.key} title={`${category.label} · ${formatTokens(category.totalTokens)}`}><i className={`model-key model-key-${index % 8}`} /><b>{category.label}</b><small>{formatTokens(category.totalTokens)}</small></span>) : <span className="legend-item"><i className="bar-key" /><b>Token</b></span>}<span className="legend-item" title="缓存率折线"><i className="cache-key" /><b>缓存率</b></span></div></div>
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
          return <rect key={`${point.day}-${category.key}`} x={x - barWidth / 2} y={y} width={barWidth} height={segmentHeight} className={`token-segment model-${categoryIndex % 8}`}><title>{`${point.day} · ${category.label} · ${formatTokens(value)} Token (${point.totalTokens > 0 ? (value / point.totalTokens * 100).toFixed(1) : '0.0'}%)`}</title></rect>
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

const modelPieColors = [
  'var(--dw-chart-1)',
  'var(--dw-chart-2)',
  'var(--dw-chart-3)',
  'var(--dw-chart-4)',
  'var(--dw-chart-5)',
  'var(--dw-chart-6)',
  'var(--dw-chart-7)',
  'var(--dw-chart-8)',
]

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
            return <div key={`${window.windowDurationMins ?? index}-${window.resetsAt ?? index}`} className="quota-window"><div><strong>{formatDuration(window.windowDurationMins)}</strong><span>剩余 {remaining}%</span></div><div className="quota-track"><i style={{ width: `${remaining}%` }} /></div><small><Clock3 />{formatReset(window.resetsAt)}</small></div>
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
function FilterChip({ active, label, icon, onClick }: { active: boolean; label: string; icon?: React.ReactNode; onClick(): void }) { return <Button className={`filter-chip ${active ? 'active' : ''}`} aria-pressed={active} onClick={onClick}>{active && <Check className="chip-check" />}{icon}<span>{label}</span></Button> }
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
    <section className="source-block"><div className="source-heading"><div><HardDrive /><span><strong>本机</strong><small>默认 Agent 数据目录</small></span></div><div className="agent-checks">{AGENTS.map(agent => <label key={agent}><Input type="checkbox" checked={draft.localAgents.includes(agent)} onChange={() => setDraft(current => ({ ...current, localAgents: toggleRequired(current.localAgents, agent) }))} /><AgentIcon agent={agent} /><span>{agentLabel[agent]}</span></label>)}</div></div><div className="root-grid">{AGENTS.map(agent => <label key={agent}>{agentLabel[agent]}<Input value={draft.localRoots[agent] ?? ''} onChange={event => setDraft(current => ({ ...current, localRoots: { ...current.localRoots, [agent]: event.target.value } }))} placeholder={defaultRoot[agent]} /></label>)}</div></section>
    {draft.sshSources.map((source, index) => <section className="source-block" key={source.id}><div className="source-heading"><div><Server /><span><strong>{source.label || 'SSH 设备'}</strong><small>{source.host || '尚未填写 Host'}</small></span></div><Button className="icon danger" title="移除设备" onClick={() => setDraft(current => ({ ...current, sshSources: current.sshSources.filter((_, item) => item !== index), codexQuota: current.codexQuota.sourceId === source.id ? { ...current.codexQuota, sourceId: null } : current.codexQuota }))}><Trash2 /></Button></div><div className="ssh-fields"><label>名称<Input value={source.label} onChange={event => updateSource(index, { ...source, label: event.target.value })} /></label><label>SSH Config Host<Input value={source.host} onChange={event => updateSource(index, { ...source, host: event.target.value })} placeholder="gpu-server" /></label></div><div className="agent-checks">{AGENTS.map(agent => <label key={agent}><Input type="checkbox" checked={source.enabledAgents.includes(agent)} onChange={() => updateSource(index, { ...source, enabledAgents: toggleRequired(source.enabledAgents, agent) })} /><AgentIcon agent={agent} /><span>{agentLabel[agent]}</span></label>)}</div><div className="root-grid">{AGENTS.map(agent => <label key={agent}>{agentLabel[agent]}<Input value={source.roots[agent] ?? ''} onChange={event => updateSource(index, { ...source, roots: { ...source.roots, [agent]: event.target.value } })} placeholder={defaultRoot[agent]} /></label>)}</div><Button className="secondary scan-source" disabled={refreshRunning || !source.host} onClick={async () => { setScanning(source.id); setScanMessage(null); setDialogError(null); try { await onScan(source); setScanMessage(`${source.label || source.host} 扫描成功`) } catch (reason) { setDialogError(String(reason)) } finally { setScanning(null) } }}><RefreshCw className={scanning === source.id ? 'spin' : ''} />{scanning === source.id ? '扫描中…' : '测试并扫描'}</Button></section>)}
    {scanMessage && <Status tone="success" className="dialog-success">{scanMessage}</Status>}
    {adding ? <div className="add-confirm"><span>将添加一个使用 SSH config 和密钥认证的 Unix 设备。</span><Button className="primary" onClick={addSource}>继续</Button><Button className="secondary" onClick={() => setAdding(false)}>取消</Button></div> : <Button className="add-source" onClick={() => setAdding(true)}><Plus />添加 SSH 设备</Button>}
    <section className="source-block">
      <div className="source-heading">
        <div><Clock3 /><span><strong>整体用量自动刷新</strong><small>处于插件页时按设定周期自动同步 Token 用量与限额</small></span></div>
      </div>
      <div className="quota-setting-grid">
        <label>刷新间隔
          <Select
            value={String(draft.autoRefreshIntervalSeconds ?? 0)}
            onChange={event => {
              const val = Number(event.target.value)
              setDraft(current => ({ ...current, autoRefreshIntervalSeconds: val <= 0 ? null : val }))
            }}
          >
            <option value="0">关闭</option>
            <option value="60">1 分钟</option>
            <option value="300">5 分钟</option>
            <option value="900">15 分钟</option>
            <option value="1800">30 分钟</option>
            <option value="3600">1 小时</option>
          </Select>
        </label>
      </div>
    </section>
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
