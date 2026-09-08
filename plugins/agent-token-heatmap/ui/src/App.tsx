import { rovingDataKeyDown, PluginPage, PageToolbar, MetricGrid, Metric as MetricValue, EmptyState, Button, Input, Select, Textarea, Card, Dialog, Status } from '@digiworld/design-system/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Clock3, CreditCard, Database, Gauge, HardDrive, PieChart, Plus, RefreshCw, Server, Settings2, Ticket, Trash2, X } from 'lucide-react'
import { createPluginBridge } from '@digiworld/plugin-sdk'
import { cacheRateScale, calendarCells, formatTokens, heatLevel, weeklyModelCategories, weeklyUsage, type Metric, type UsageDay, type WeeklyUsagePoint } from './heatmap'
import { t, type Locale } from './i18n'
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
  agyQuota: AgyQuotaSettings
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
interface AgyQuotaSettings {
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
interface CodexQuotaCredits {
  balance?: string | null
  hasCredits: boolean
  unlimited: boolean
}
interface CodexQuotaSnapshot {
  status: 'ready' | 'stale' | 'unavailable' | 'unconfigured'
  sourceId: string | null
  sourceLabel: string | null
  fetchedAt: string | null
  planType: string | null
  windows: QuotaWindow[]
  credits?: CodexQuotaCredits | null
  resetCredits?: CodexResetCreditsSummary | null
  error: string | null
}
interface AgyQuotaBucket {
  id: string
  name: string
  description?: string | null
  window: string
  windowDurationMins: number | null
  usedPercent: number
  remainingPercent: number
  remainingFraction: number
  resetTime?: string | null
  resetsAt?: number | null
}
interface AgyQuotaGroup {
  name: string
  description?: string | null
  buckets: AgyQuotaBucket[]
}
interface AgyQuotaSnapshot {
  status: 'ready' | 'stale' | 'unavailable' | 'unconfigured'
  sourceId: string | null
  sourceLabel: string | null
  fetchedAt: string | null
  planType: string | null
  description?: string | null
  groups: AgyQuotaGroup[]
  windows: AgyQuotaBucket[]
  error: string | null
}

export function formatCreditBalance(balance: string | null | undefined, locale: Locale = 'en'): string {
  if (!balance) return t('unavailable', locale)
  const trimmed = balance.trim()
  if (trimmed === t('unlimited', locale) || trimmed === t('unavailable', locale) || trimmed === '不可用' || trimmed === 'Unavailable' || trimmed === '不限' || trimmed === 'Unlimited') {
    return trimmed
  }
  const match = trimmed.match(/^([^0-9.-]*)(-?\d+(?:\.\d+)?)(.*)$/)
  if (!match || !match[2]) return trimmed
  const prefix = match[1] ?? ''
  const numStr = match[2]
  const suffix = match[3] ?? ''
  const num = parseFloat(numStr)
  if (Number.isNaN(num)) return trimmed
  return `${prefix}${num.toFixed(1)}${suffix}`
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
  const [locale, setLocale] = useState<Locale>(() => {
    if (typeof document !== 'undefined') {
      if (document.documentElement.lang === 'en') return 'en'
      if (document.documentElement.lang.startsWith('zh')) return 'zh'
    }
    return 'en'
  })
  const [settings, setSettings] = useState<UsageSettings | null>(null)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [agents, setAgents] = useState<Agent[]>([...AGENTS])
  const [sources, setSources] = useState<string[]>(['local'])
  const [range, setRange] = useState<Range>('365')
  const [metric, setMetric] = useState<Metric>('totalTokens')
  const [refresh, setRefresh] = useState<RefreshStatus>({ running: false, completed: 0, total: 0, errors: [] })
  const [quota, setQuota] = useState<CodexQuotaSnapshot | null>(null)
  const [quotaLoading, setQuotaLoading] = useState(false)
  const [agyQuota, setAgyQuota] = useState<AgyQuotaSnapshot | null>(null)
  const [agyQuotaLoading, setAgyQuotaLoading] = useState(false)
  const [activeQuotaAgent, setActiveQuotaAgent] = useState<'codex' | 'agy'>('codex')
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    return bridge.on('locale', (payload: unknown) => {
      const loc = typeof payload === 'string' ? payload : (payload as { locale?: Locale })?.locale
      if (loc === 'en' || loc === 'zh') setLocale(loc)
    })
  }, [])

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
    const sourceId = settings?.codexQuota?.sourceId ?? null
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
  }, [settings?.codexQuota?.sourceId])

  const loadAgyQuota = useCallback(async (force = false) => {
    const sourceId = settings?.agyQuota?.sourceId ?? null
    setAgyQuotaLoading(true)
    setAgyQuota(current => current?.sourceId === sourceId ? current : null)
    try {
      const next = await bridge.request<AgyQuotaSnapshot>('usage.getAgyQuota', { force })
      setAgyQuota(current => next.status === 'unavailable' && current?.sourceId === next.sourceId && (current.status === 'ready' || current.status === 'stale')
        ? { ...current, status: 'stale', error: next.error }
        : next)
    } catch (reason) {
      setAgyQuota(current => current?.sourceId === sourceId && (current.status === 'ready' || current.status === 'stale')
        ? { ...current, status: 'stale', error: String(reason) }
        : { status: 'unavailable', sourceId, sourceLabel: null, fetchedAt: null, planType: null, description: null, groups: [], windows: [], error: String(reason) })
    } finally {
      setAgyQuotaLoading(false)
    }
  }, [settings?.agyQuota?.sourceId])

  useEffect(() => {
    if (!settings) return
    void loadQuota()
    void loadAgyQuota()
  }, [loadAgyQuota, loadQuota, settings])

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
      await Promise.allSettled([loadQuota(true), loadAgyQuota(true)])
      lastRefreshedAtRef.current = Date.now()
    } finally {
      autoRefreshRunningRef.current = false
    }
  }, [loadAgyQuota, loadQuota, startRefresh])

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

  useEffect(() => {
    const seconds = settings?.codexQuota?.refreshIntervalSeconds
    if (!seconds) return
    const timer = window.setInterval(() => void loadQuota(), seconds * 1000)
    return () => window.clearInterval(timer)
  }, [loadQuota, settings?.codexQuota?.refreshIntervalSeconds])

  useEffect(() => {
    const seconds = settings?.agyQuota?.refreshIntervalSeconds
    if (!seconds) return
    const timer = window.setInterval(() => void loadAgyQuota(), seconds * 1000)
    return () => window.clearInterval(timer)
  }, [loadAgyQuota, settings?.agyQuota?.refreshIntervalSeconds])

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
  const sourceOptions = settings ? [{ id: 'local', label: t('localDevice', locale) }, ...settings.sshSources] : []

  return (
    <PluginPage className="usage-app">
      <PageToolbar className=" usage-header">
        <div className="header-buttons">
          <Button className="secondary" onClick={() => setSettingsOpen(true)}><Settings2 />{t('settings', locale)}</Button>
          <Button className="primary" disabled={refresh.running} onClick={() => void startRefresh()}><RefreshCw className={refresh.running ? 'spin' : ''} />{refresh.running ? `${refresh.completed}/${refresh.total} ${refresh.currentSource ?? ''}` : t('manualRefresh', locale)}</Button>
        </div>
      </PageToolbar>

      {(error || refresh.errors.length > 0) && <Status tone="error" className="error-banner"><AlertTriangle /><span>{error ?? refresh.errors.join('；')}</span><Button aria-label={locale === 'zh' ? '关闭错误提示' : 'Dismiss error'} onClick={() => { setError(null); setRefresh(current => ({ ...current, errors: [] })) }}><X /></Button></Status>}

      <section className="filter-bar">
        <FilterGroup label={t('agents', locale)}>{AGENTS.map(agent => <FilterChip key={agent} active={agents.includes(agent)} label={agentLabel[agent]} icon={<AgentIcon agent={agent} />} onClick={() => toggleAgent(agent)} />)}</FilterGroup>
        <FilterGroup label={t('devices', locale)}>{sourceOptions.map(source => <FilterChip key={source.id} active={sources.includes(source.id)} label={source.label} onClick={() => toggleSource(source.id)} />)}</FilterGroup>
      </section>

      <section className="insights-grid">
        <WeeklyChart points={weekly} locale={locale} />
        <QuotaCard
          activeAgent={activeQuotaAgent}
          onSwitchAgent={setActiveQuotaAgent}
          codexQuota={quota}
          codexLoading={quotaLoading}
          codexConfigured={Boolean(settings?.codexQuota?.sourceId)}
          agyQuota={agyQuota}
          agyLoading={agyQuotaLoading}
          agyConfigured={Boolean(settings?.agyQuota?.sourceId)}
          locale={locale}
          onRefreshCodex={() => void loadQuota(true)}
          onRefreshAgy={() => void loadAgyQuota(true)}
          onConfigure={() => setSettingsOpen(true)}
        />
      </section>

      <section className="dw-card heatmap-card">
        <div className="card-title">
          <div><h2>{t('dailyHeatmap', locale)}</h2></div>
          <div className="heatmap-controls">
            <div className="dw-segmented range-group" aria-label={t('rangeAria', locale)}>{(['30', '90', '365', 'all'] as Range[]).map(value => <Button key={value} className={range === value ? 'active' : ''} onClick={() => setRange(value)}>{value === 'all' ? t('all', locale) : locale === 'zh' ? `${value} 天` : `${value}d`}</Button>)}</div>
            <Select aria-label={t('metricAria', locale)} value={metric} onChange={event => setMetric(event.target.value as Metric)}><option value="totalTokens">{t('totalTokens', locale)}</option><option value="inputTokens">{t('inputTokens', locale)}</option><option value="outputTokens">{t('outputTokens', locale)}</option><option value="cacheReadTokens">{t('cacheReadTokens', locale)}</option></Select>
          </div>
        </div>
        <MetricGrid aria-label={t('summaryGridAria', locale)}>
          <Summary label={t('totalTokens', locale)} value={snapshot?.totals.totalTokens} />
          <Summary label={t('inputTokens', locale)} value={snapshot?.totals.inputTokens} />
          <Summary label={t('outputTokens', locale)} value={snapshot?.totals.outputTokens} />
          <Summary label={t('cacheReadTokens', locale)} value={snapshot?.totals.cacheReadTokens} />
          <Summary label={t('cacheRate', locale)} text={snapshot?.totals.cacheRate == null ? '—' : `${(snapshot.totals.cacheRate * 100).toFixed(1)}%`} />
        </MetricGrid>
        {snapshot && cells.length ? <div className="calendar-wrap"><div className="weekday-labels">{locale === 'zh' ? <><span>一</span><span>三</span><span>五</span><span>日</span></> : <><span>M</span><span>W</span><span>F</span><span>S</span></>}</div><div className="calendar-grid" onKeyDown={event => rovingDataKeyDown(event)}>{cells.map((cell, index) => <i key={cell.day ?? `blank-${index}`} tabIndex={cell.day ? (index === cells.findIndex(item => item.day) ? 0 : -1) : undefined} aria-label={cell.day ? `${cell.day}，${formatTokens(cell.value)}` : undefined} className={`level-${heatLevel(cell.value, max)} ${cell.day ? '' : 'blank'}`} data-tooltip={cell.day ? `${cell.day} · ${formatTokens(cell.value)} Tokens` : undefined} />)}</div><div className="legend"><span>{t('low', locale)}</span>{[0, 1, 2, 3, 4, 5].map(level => <i key={level} className={`level-${level}`} />)}<span>{t('high', locale)}</span></div></div> : <Empty locale={locale} />}
      </section>

      <section className="lower-grid">
        <Card className="dw-card breakdown-card"><h2>{t('sourceBreakdown', locale)}</h2>{snapshot?.breakdown.length ? <div className="breakdown-table">{[...snapshot.breakdown].sort((a, b) => b.totalTokens - a.totalTokens).map(row => <div key={`${row.sourceId}-${row.agent}`}><AgentIcon agent={row.agent} className={`agent-breakdown-icon ${row.agent}`} /><strong>{agentLabel[row.agent]}</strong><span>{row.sourceLabel}</span><b>{formatTokens(row.totalTokens)}</b><small>{row.cacheRate == null ? `${formatTokens(row.cacheReadTokens)} cache` : `${(row.cacheRate * 100).toFixed(1)}% cache`}</small></div>)}</div> : <Empty locale={locale} />} </Card>
        <Card className="dw-card daily-ranking-card"><h2>{t('dailyRanking', locale)}</h2>{dailyRanking.length ? <div className="daily-ranking">{dailyRanking.map((day, index) => <div key={day.day}><b>{index + 1}</b><span>{day.day}</span><i><em style={{ width: `${(day.totalTokens / dailyMax) * 100}%` }} /></i><strong>{formatTokens(day.totalTokens)}</strong></div>)}</div> : <Empty locale={locale} />}</Card>
      </section>

      <Card className="dw-card model-card">
        <div className="model-card-heading"><div><h2>{t('modelBreakdown', locale)}</h2><p>{t('modelAggregated', locale)}</p></div><PieChart /></div>
        <ModelPieChart rows={modelTotals} locale={locale} />
      </Card>

      {settingsOpen && settings && <SourceDialog settings={settings} locale={locale} refreshRunning={refresh.running} onClose={() => setSettingsOpen(false)} onSave={async value => {
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
      }} onScan={testSource} onQuotaTest={async value => bridge.request<CodexQuotaSnapshot>('usage.testCodexQuota', { settings: value })}
      onAgyQuotaTest={async value => bridge.request<AgyQuotaSnapshot>('usage.testAgyQuota', { settings: value })} />}
    </PluginPage>
  )
}

function WeeklyChart({ points, locale = 'en' }: { points: WeeklyUsagePoint[]; locale?: Locale }) {
  const chartRef = useRef<SVGSVGElement>(null)
  const [width, setWidth] = useState(600)
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry!.contentRect.width)))
    observer.observe(chart)
    return () => observer.disconnect()
  }, [points.length > 0])
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
  const modelCategories = weeklyModelCategories(points, 6, locale)
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
    <div className="panel-heading"><div><h2>{t('last7Days', locale)}</h2></div><div className="chart-legend" aria-label={t('chartLegendAria', locale)}>{modelCategories.length ? modelCategories.map((category, index) => <span className="legend-item" key={category.key} tabIndex={0} data-tooltip={`${category.label} · ${formatTokens(category.totalTokens)}`}><i className={`model-key model-key-${index % 8}`} /><b>{category.label}</b><small>{formatTokens(category.totalTokens)}</small></span>) : <span className="legend-item"><i className="bar-key" /><b>Token</b></span>}<span className="legend-item" tabIndex={0} data-tooltip={t('cacheRateLine', locale)}><i className="cache-key" /><b>{t('cacheRate', locale)}</b></span></div></div>
    {points.length ? <svg ref={chartRef} onKeyDown={event => rovingDataKeyDown(event)} className="weekly-chart" viewBox={`0 0 ${width} ${height}`} role="group" aria-label={t('chartAria', locale)}>
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
        return <g key={point.day} tabIndex={index === 0 ? 0 : -1} data-tooltip={`${point.day} · ${formatTokens(point.totalTokens)} Token${modelSummary ? ` · ${modelSummary}` : ''} · ${t('cacheRate', locale)} ${cache}`} aria-label={`${point.day} · ${formatTokens(point.totalTokens)} Token`}><rect x={x - barWidth / 2} y={top} width={barWidth} height={plotHeight} rx="5" className="chart-bar-track" /><g className="token-bar">{modelCategories.map((category, categoryIndex) => {
          const value = category.values[index] ?? 0
          if (value <= 0) return null
          const segmentHeight = value * scale
          const y = top + plotHeight - offset - segmentHeight
          offset += segmentHeight
          return <rect key={`${point.day}-${category.key}`} x={x - barWidth / 2} y={y} width={barWidth} height={segmentHeight} rx="5" className={`token-segment model-${categoryIndex % 8}`} data-tooltip={`${point.day} · ${category.label} · ${formatTokens(value)} Token (${point.totalTokens > 0 ? (value / point.totalTokens * 100).toFixed(1) : '0.0'}%)`} />
        })}</g><text x={x} y={height - 18} textAnchor="middle" className="chart-day-label">{point.day.slice(5).replace('-', '/')}</text></g>
      })}
      {segments.map((segment, index) => segment.length > 1 && <polyline key={index} points={segment.map(point => `${xFor(point)},${yForRate(point.cacheRate!)}`).join(' ')} className="cache-line" />)}
      {points.filter(point => point.cacheRate != null).map((point, index) => {
        const x = xFor(point)
        const y = yForRate(point.cacheRate!)
        const label = `${(point.cacheRate! * 100).toFixed(1)}%`
        const labelBelow = y < top + 27 || (index % 2 === 1 && y < top + 52)
        return <g key={point.day} className="cache-marker"><circle cx={x} cy={y} r="5" className="cache-point" data-tooltip={`${point.day} ${t('cacheRate', locale)} ${label}`} /><text visibility={width < 480 ? 'hidden' : undefined} x={x} y={labelBelow ? y + 20 : y - 11} textAnchor="middle" className="cache-point-label">{label}</text></g>
      })}
    </svg> : <Empty locale={locale} />}
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

function ModelPieChart({ rows, locale = 'en' }: { rows: ModelTotal[]; locale?: Locale }) {
  if (!rows.length) return <Empty locale={locale} />

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
    <svg onKeyDown={event => rovingDataKeyDown(event)} className="model-pie" viewBox="0 0 216 216" role="group" aria-label={t('modelPieAria', locale)}>
      <title>{t('modelPieTitle', locale)}</title>
      {sectors.map(sector => <path key={sector.model} tabIndex={sector.index === 0 ? 0 : -1} data-tooltip={`${modelDisplayName(sector.model, locale)} · ${formatTokens(sector.totalTokens)} · ${(sector.totalTokens / total * 100).toFixed(1)}%`} className="model-pie-slice" d={pieSectorPath(centerX, centerY, radius, sector.startAngle, sector.endAngle)} fill={modelPieColors[sector.index % modelPieColors.length]} />)}
    </svg>
    <div className="model-pie-legend" aria-label={t('modelLegendAria', locale)}>
      {sectors.map(sector => <div key={sector.model}><i style={{ background: modelPieColors[sector.index % modelPieColors.length] }} /><strong tabIndex={0} data-tooltip={modelDisplayName(sector.model, locale)}>{modelDisplayName(sector.model, locale)}</strong><span>{formatTokens(sector.totalTokens)} · {(sector.totalTokens / total * 100).toFixed(1)}%</span></div>)}
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

function modelDisplayName(model: string, locale: Locale = 'en'): string {
  return model === 'unknown' ? t('unknownModel', locale) : model
}

interface QuotaCardProps {
  quota?: CodexQuotaSnapshot | null
  loading?: boolean
  configured?: boolean
  onRefresh?(): void

  activeAgent?: 'codex' | 'agy'
  onSwitchAgent?: (agent: 'codex' | 'agy') => void
  codexQuota?: CodexQuotaSnapshot | null
  codexLoading?: boolean
  codexConfigured?: boolean
  agyQuota?: AgyQuotaSnapshot | null
  agyLoading?: boolean
  agyConfigured?: boolean
  locale?: Locale
  onRefreshCodex?: () => void
  onRefreshAgy?: () => void
  onConfigure(): void
}

function QuotaCard(props: QuotaCardProps) {
  const {
    quota,
    loading = false,
    configured = true,
    onRefresh,
    activeAgent = 'codex',
    onSwitchAgent,
    codexQuota,
    codexLoading,
    codexConfigured,
    agyQuota,
    agyLoading = false,
    agyConfigured = true,
    locale = 'en',
    onRefreshCodex,
    onRefreshAgy,
    onConfigure,
  } = props

  const [internalAgent, setInternalAgent] = useState<'codex' | 'agy'>('codex')
  const effectiveAgent = onSwitchAgent ? activeAgent : internalAgent
  const handleSwitch = (agent: 'codex' | 'agy') => {
    if (onSwitchAgent) {
      onSwitchAgent(agent)
    } else {
      setInternalAgent(agent)
    }
  }

  const effectiveCodexQuota = codexQuota ?? quota ?? null
  const effectiveCodexLoading = codexLoading ?? loading
  const effectiveCodexConfigured = codexConfigured ?? configured
  const effectiveCodexRefresh = onRefreshCodex ?? onRefresh ?? (() => {})

  const isCodex = effectiveAgent === 'codex'
  const currentStatus = isCodex ? effectiveCodexQuota?.status : agyQuota?.status
  const currentLoading = isCodex ? effectiveCodexLoading : agyLoading
  const currentConfigured = isCodex ? effectiveCodexConfigured : agyConfigured
  const currentSourceLabel = isCodex
    ? (effectiveCodexQuota?.sourceLabel ?? (locale === 'zh' ? '指定账号设备' : 'Designated Device'))
    : (agyQuota?.sourceLabel ?? (locale === 'zh' ? '指定账号设备' : 'Designated Device'))
  const currentPlanType = isCodex
    ? formatCodexPlan(effectiveCodexQuota?.planType)
    : formatAgyPlan(agyQuota?.planType)
  const currentFetchedAt = isCodex ? effectiveCodexQuota?.fetchedAt : agyQuota?.fetchedAt
  const currentError = isCodex ? effectiveCodexQuota?.error : agyQuota?.error

  const [activeCreditIndex, setActiveCreditIndex] = useState(0)
  const codexAvailable = effectiveCodexQuota && (effectiveCodexQuota.status === 'ready' || effectiveCodexQuota.status === 'stale') && effectiveCodexQuota.windows.length > 0
  const resetSummary = effectiveCodexQuota?.resetCredits
  const availableResets = resetSummary?.availableCount ?? 0
  const credits = (resetSummary?.credits ?? []).filter(credit => credit.status !== 'redeemed')
  const safeCreditIndex = credits.length > 0 ? Math.min(activeCreditIndex, credits.length - 1) : 0
  const currentCredit = credits[safeCreditIndex]
  const handlePrevCredit = () => {
    setActiveCreditIndex(current => (credits.length > 0 ? (current - 1 + credits.length) % credits.length : 0))
  }
  const handleNextCredit = () => {
    setActiveCreditIndex(current => (credits.length > 0 ? (current + 1) % credits.length : 0))
  }
  const codexBalance = effectiveCodexQuota?.credits?.unlimited
    ? t('unlimited', locale)
    : formatCreditBalance(effectiveCodexQuota?.credits?.balance, locale)

  const agyAvailable = agyQuota && (agyQuota.status === 'ready' || agyQuota.status === 'stale') && (agyQuota.windows.length > 0 || (agyQuota.groups && agyQuota.groups.length > 0))
  const agyGroups = agyQuota?.groups && agyQuota.groups.length > 0
    ? agyQuota.groups
    : (agyQuota?.windows && agyQuota.windows.length > 0
        ? [{ name: 'Gemini Models', description: null, buckets: agyQuota.windows }]
        : [])

  const handlePrev = () => handleSwitch(isCodex ? 'agy' : 'codex')
  const handleNext = () => handleSwitch(isCodex ? 'agy' : 'codex')
  const handleRefresh = () => {
    if (isCodex) {
      effectiveCodexRefresh()
    } else {
      onRefreshAgy?.()
    }
  }

  return (
    <Card className={`quota-card ${currentStatus ?? ''}`}>
      <div className="panel-heading">
        <div>
          <h2>{isCodex ? t('codexQuota', locale) : t('agyQuota', locale)}</h2>
          <p>{currentSourceLabel}{currentPlanType ? ` · ${currentPlanType}` : ''}</p>
        </div>
        <div className="quota-header-actions">
          <div className="quota-carousel-nav" role="navigation" aria-label={t('quotaCardPagination', locale)}>
            <button
              type="button"
              className="quota-nav-btn"
              title={t('prevCard', locale)}
              aria-label={t('prevCard', locale)}
              onClick={handlePrev}
            >
              <ChevronLeft />
            </button>
            <span className="quota-page-badge">{isCodex ? '1/2' : '2/2'}</span>
            <button
              type="button"
              className="quota-nav-btn"
              title={t('nextCard', locale)}
              aria-label={t('nextCard', locale)}
              onClick={handleNext}
            >
              <ChevronRight />
            </button>
          </div>
          <Button
            className="panel-action"
            title={isCodex ? (locale === 'zh' ? '刷新 Codex 限额' : 'Refresh Codex Quota') : (locale === 'zh' ? '刷新 AGY 限额' : 'Refresh AGY Quota')}
            disabled={currentLoading || !currentConfigured}
            onClick={handleRefresh}
          >
            <RefreshCw className={currentLoading ? 'spin' : ''} />
          </Button>
        </div>
      </div>

      {isCodex ? (
        !effectiveCodexConfigured || effectiveCodexQuota?.status === 'unconfigured' ? (
          <div className="quota-empty">
            <Gauge />
            <span>{locale === 'zh' ? '尚未选择限额查询设备' : 'No device configured for quota queries'}</span>
            <Button onClick={onConfigure}>{t('settings', locale)}</Button>
          </div>
        ) : effectiveCodexLoading && !effectiveCodexQuota ? (
          <div className="quota-empty">
            <RefreshCw className="spin" />
            <span>{locale === 'zh' ? '正在获取最新限额…' : 'Fetching latest quota...'}</span>
          </div>
        ) : codexAvailable ? (
          <>
            <div className="quota-windows">
              {effectiveCodexQuota.windows.map((window, index) => {
                const remaining = 100 - Math.max(0, Math.min(100, window.usedPercent))
                return (
                  <div key={`${window.windowDurationMins ?? index}-${window.resetsAt ?? index}`} className="quota-window">
                    <div>
                      <strong>{formatDuration(window.windowDurationMins, locale)}</strong>
                      <span>{locale === 'zh' ? `剩余 ${remaining}%` : `Remaining ${remaining}%`}</span>
                    </div>
                    <div className="quota-track">
                      <i style={{ width: `${remaining}%` }} />
                    </div>
                    <small>
                      <Clock3 />
                      {formatReset(window.resetsAt, locale)}
                    </small>
                  </div>
                )
              })}
            </div>
            <div className="quota-credits" data-has-credits={effectiveCodexQuota.credits?.hasCredits === true}>
              <div className="quota-credits-icon"><CreditCard /></div>
              <div>
                <span>{t('creditsBalance', locale)}</span>
                <strong>{codexBalance}</strong>
              </div>
            </div>
            <div className="quota-resets">
              <div className="quota-resets-header">
                <span className="quota-resets-title"><Ticket />{t('resetCards', locale)}</span>
                <div className="quota-resets-actions">
                  {credits.length > 1 && (
                    <div className="quota-carousel-nav" role="navigation" aria-label={t('resetCardPagination', locale)}>
                      <button
                        type="button"
                        className="quota-nav-btn"
                        title={t('prevResetCard', locale)}
                        aria-label={t('prevResetCard', locale)}
                        onClick={handlePrevCredit}
                      >
                        <ChevronLeft />
                      </button>
                      <span className="quota-page-badge">{safeCreditIndex + 1}/{credits.length}</span>
                      <button
                        type="button"
                        className="quota-nav-btn"
                        title={t('nextResetCard', locale)}
                        aria-label={t('nextResetCard', locale)}
                        onClick={handleNextCredit}
                      >
                        <ChevronRight />
                      </button>
                    </div>
                  )}
                  <span className={`quota-resets-badge ${availableResets > 0 ? 'active' : 'zero'}`}>
                    {t('availableResets', locale).replace('{count}', String(availableResets))}
                  </span>
                </div>
              </div>
              {credits.length > 0 && currentCredit && (
                <div className="quota-reset-items">
                  <div key={currentCredit.id || safeCreditIndex} className="quota-reset-item">
                    <div className="quota-reset-item-name">
                      <span>{currentCredit.title || t('defaultResetCard', locale)}</span>
                    </div>
                    <div className="quota-reset-item-dates">
                      <span>{formatCardPeriod(currentCredit.grantedAt, currentCredit.expiresAt, locale)}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="quota-empty error">
            <AlertTriangle />
            <span>{effectiveCodexQuota?.error ?? (locale === 'zh' ? '当前设备无法获取 Codex 限额' : 'Unable to query Codex quota from device')}</span>
            <Button onClick={onConfigure}>{t('settings', locale)}</Button>
          </div>
        )
      ) : (
        !currentConfigured || agyQuota?.status === 'unconfigured' ? (
          <div className="quota-empty">
            <Gauge />
            <span>{locale === 'zh' ? '尚未选择限额查询设备' : 'No device configured for quota queries'}</span>
            <Button onClick={onConfigure}>{t('settings', locale)}</Button>
          </div>
        ) : agyLoading && !agyQuota ? (
          <div className="quota-empty">
            <RefreshCw className="spin" />
            <span>{locale === 'zh' ? '正在获取最新限额…' : 'Fetching latest quota...'}</span>
          </div>
        ) : agyAvailable ? (
          <div className="quota-agy-groups">
            {agyGroups.map((group, gIdx) => {
              const buckets = [...(group.buckets ?? [])].sort(
                (a, b) => (a.windowDurationMins ?? (a.window === '5h' ? 300 : 10080)) - (b.windowDurationMins ?? (b.window === '5h' ? 300 : 10080))
              )
              return (
                <div key={group.name || gIdx} className="quota-agy-group">
                  <div className="quota-agy-group-header">
                    <span>{formatAgyGroupName(group.name, locale)}</span>
                  </div>
                  <div className="quota-windows">
                    {buckets.map((bucket, index) => {
                      const remaining = Math.max(0, Math.min(100, Math.round(bucket.remainingPercent)))
                      const durationLabel = formatDuration(bucket.windowDurationMins ?? (bucket.window === '5h' ? 300 : 10080), locale)
                      return (
                        <div key={bucket.id || `${bucket.window}-${index}`} className="quota-window">
                          <div>
                            <strong>{durationLabel}</strong>
                            <span>{locale === 'zh' ? `剩余 ${remaining}%` : `Remaining ${remaining}%`}</span>
                          </div>
                          <div className="quota-track">
                            <i style={{ width: `${remaining}%` }} />
                          </div>
                          <small>
                            <Clock3 />
                            {formatAgyReset(bucket.resetsAt, bucket.resetTime, locale)}
                          </small>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="quota-empty error">
            <AlertTriangle />
            <span>{agyQuota?.error ?? (locale === 'zh' ? '当前设备无法获取 Antigravity 限额' : 'Unable to query Antigravity quota from device')}</span>
            <Button onClick={onConfigure}>{t('settings', locale)}</Button>
          </div>
        )
      )}

      <div className="quota-footer">
        <div className={`quota-meta ${currentStatus === 'stale' ? 'warning' : ''}`}>
          {currentStatus === 'stale'
            ? (locale === 'zh' ? `刷新失败，显示上次结果：${currentError ?? '未知错误'}` : `Failed to refresh, showing last result: ${currentError ?? 'Unknown'}`)
            : currentFetchedAt
              ? (locale === 'zh' ? `更新于 ${formatFetchedAt(currentFetchedAt, locale)}` : `Updated at ${formatFetchedAt(currentFetchedAt, locale)}`)
              : (locale === 'zh' ? '未同步' : 'Not synced')}
        </div>
        <div className="quota-dots" role="tablist" aria-label={t('quotaCardPagination', locale)}>
          <button
            type="button"
            className={`quota-dot ${isCodex ? 'active' : ''}`}
            aria-label="Codex Quota"
            title="Codex"
            aria-selected={isCodex}
            onClick={() => handleSwitch('codex')}
          />
          <button
            type="button"
            className={`quota-dot ${!isCodex ? 'active' : ''}`}
            aria-label="Antigravity Quota"
            title="Antigravity (agy)"
            aria-selected={!isCodex}
            onClick={() => handleSwitch('agy')}
          />
        </div>
      </div>
    </Card>
  )
}

function formatCodexPlan(plan: string | null | undefined): string | null {
  if (!plan) return null
  if (plan.toLowerCase() === 'plus') return 'Plus'
  if (plan.toLowerCase() === 'pro') return 'Pro'
  if (plan.toLowerCase() === 'team') return 'Team'
  if (plan.toLowerCase() === 'enterprise') return 'Enterprise'
  return plan
}

function formatAgyPlan(plan: string | null | undefined): string {
  if (!plan || plan === 'Gemini Models' || plan === 'Claude and GPT models' || plan.toLowerCase().includes('pro')) {
    return 'AI Pro'
  }
  return plan
}

function formatAgyGroupName(name: string, locale: Locale = 'en'): string {
  if (name === 'Gemini Models' || name.toLowerCase().includes('gemini')) {
    return t('geminiModels', locale)
  }
  if (name === 'Claude and GPT models' || name.toLowerCase().includes('claude') || name.toLowerCase().includes('gpt')) {
    return t('claudeGptModels', locale)
  }
  return name
}

function formatDuration(minutes: number | null, locale: Locale = 'en'): string {
  if (minutes == null) return t('quotaWindow', locale)
  if (minutes % 10_080 === 0) return `${minutes / 10_080 * 7}d`
  if (minutes % 1_440 === 0) return `${minutes / 1_440}d`
  if (minutes % 60 === 0) return `${minutes / 60}h`
  return `${minutes}m`
}

function formatReset(seconds: number | null, locale: Locale = 'en'): string {
  if (!seconds) return locale === 'zh' ? '未提供重置时间' : 'No reset time'
  const ms = seconds > 100_000_000_000 ? seconds : seconds * 1000
  const dateStr = new Date(ms).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  return locale === 'zh' ? `${dateStr} 重置` : `Resets ${dateStr}`
}

function formatAgyReset(seconds: number | null | undefined, resetTimeStr: string | null | undefined, locale: Locale = 'en'): string {
  if (seconds) {
    return formatReset(seconds, locale)
  }
  if (resetTimeStr) {
    const d = new Date(resetTimeStr)
    if (!Number.isNaN(d.getTime())) {
      const dateStr = d.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      return locale === 'zh' ? `${dateStr} 重置` : `Resets ${dateStr}`
    }
    return resetTimeStr
  }
  return locale === 'zh' ? '未提供重置时间' : 'No reset time'
}

export function formatCardPeriod(
  grantedAt: number | null | undefined,
  expiresAt: number | null | undefined,
  locale: Locale = 'en',
): string {
  if (!grantedAt && !expiresAt) {
    return locale === 'zh' ? '永久有效' : 'Permanent'
  }
  const toDate = (sec: number) => new Date(sec > 100_000_000_000 ? sec : sec * 1000)
  const formatMmDd = (d: Date) => {
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${mm}/${dd}`
  }
  const formatTime = (d: Date) => {
    let hours = d.getHours()
    const minutes = String(d.getMinutes()).padStart(2, '0')
    const ampm = hours >= 12 ? 'PM' : 'AM'
    hours = hours % 12
    if (hours === 0) hours = 12
    const hourStr = String(hours).padStart(2, '0')
    return `${hourStr}:${minutes} ${ampm}`
  }

  if (grantedAt && expiresAt) {
    const startDate = toDate(grantedAt)
    const endDate = toDate(expiresAt)
    return `${formatMmDd(startDate)}-${formatMmDd(endDate)}, ${formatTime(endDate)}`
  }
  if (grantedAt && !expiresAt) {
    const startDate = toDate(grantedAt)
    const perm = locale === 'zh' ? '永久有效' : 'Permanent'
    return `${formatMmDd(startDate)}-${perm}, ${formatTime(startDate)}`
  }
  if (!grantedAt && expiresAt) {
    const endDate = toDate(expiresAt)
    return `${formatMmDd(endDate)}, ${formatTime(endDate)}`
  }
  return locale === 'zh' ? '永久有效' : 'Permanent'
}

export function formatCardDate(seconds: number | null | undefined, locale: Locale = 'en'): string {
  if (!seconds) return locale === 'zh' ? '永久有效' : 'Permanent'
  const ms = seconds > 100_000_000_000 ? seconds : seconds * 1000
  return new Date(ms).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function formatFetchedAt(value: string | null, locale: Locale = 'en'): string {
  if (!value) return t('justNow', locale)
  return new Date(value).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) { return <div className="filter-group"><span>{label}</span>{children}</div> }
function FilterChip({ active, label, icon, onClick }: { active: boolean; label: string; icon?: React.ReactNode; onClick(): void }) { return <Button className={`filter-chip ${active ? 'active' : ''}`} aria-pressed={active} onClick={onClick}>{active && <Check className="chip-check" />}{icon}<span>{label}</span></Button> }
function Summary({ label, value, text }: { label: string; value?: number | undefined; text?: string }) { return <MetricValue label={label} value={text ?? (value == null ? '—' : formatTokens(value))} /> }
function Empty({ locale = 'en' }: { locale?: Locale }) { return <EmptyState icon={<Database />} title={t('noData', locale)} description={t('noDataDesc', locale)} /> }

const defaultAgyQuota: AgyQuotaSettings = {
  sourceId: 'local',
  shellPreset: 'auto',
  preCommand: '',
  refreshIntervalSeconds: 60,
}

function SourceDialog({ settings, refreshRunning, locale = 'en', onClose, onSave, onScan, onQuotaTest, onAgyQuotaTest }: { settings: UsageSettings; refreshRunning: boolean; locale?: Locale; onClose(): void; onSave(value: UsageSettings): Promise<void>; onScan(source: SshSource): Promise<void>; onQuotaTest(value: UsageSettings): Promise<CodexQuotaSnapshot>; onAgyQuotaTest(value: UsageSettings): Promise<AgyQuotaSnapshot> }) {
  const [draft, setDraft] = useState<UsageSettings>(() => {
    const cloned = structuredClone(settings)
    if (!cloned.agyQuota) {
      cloned.agyQuota = { ...defaultAgyQuota }
    }
    return cloned
  })
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState<string | null>(null)
  const [quotaTesting, setQuotaTesting] = useState(false)
  const [agyQuotaTesting, setAgyQuotaTesting] = useState(false)
  const [scanMessage, setScanMessage] = useState<string | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const updateSource = (index: number, source: SshSource) => setDraft(current => ({ ...current, sshSources: current.sshSources.map((value, item) => item === index ? source : value) }))
  const addSource = () => {
    setDraft(current => ({ ...current, sshSources: [...current.sshSources, { id: `ssh-${Date.now()}`, label: t('remoteDevice', locale), host: '', enabledAgents: [...AGENTS], roots: {} }] }))
    setAdding(false)
  }
  const interval = draft.codexQuota.refreshIntervalSeconds
  const intervalMode = interval == null ? 'off' : [30, 60, 300, 900].includes(interval) ? String(interval) : 'custom'
  const agyInterval = draft.agyQuota.refreshIntervalSeconds
  const agyIntervalMode = agyInterval == null ? 'off' : [30, 60, 300, 900].includes(agyInterval) ? String(agyInterval) : 'custom'
  const sourceOptions = [{ id: 'local', label: t('localDevice', locale) }, ...draft.sshSources]
  return <Dialog open onClose={() => { if (!busy) onClose() }} className="source-modal" aria-label={t('settings', locale)}><header><div><h2>{t('settings', locale)}</h2><p>{t('settingsDialogSubtitle', locale)}</p></div><Button className="close" onClick={onClose}><X /></Button></header>
    {dialogError && <Status tone="error" className="dialog-error">{dialogError}</Status>}
    <section className="source-block"><div className="source-heading"><div><HardDrive /><span><strong>{t('localDevice', locale)}</strong><small>{t('localDeviceDefault', locale)}</small></span></div><div className="agent-checks">{AGENTS.map(agent => <label key={agent}><Input type="checkbox" checked={draft.localAgents.includes(agent)} onChange={() => setDraft(current => ({ ...current, localAgents: toggleRequired(current.localAgents, agent) }))} /><AgentIcon agent={agent} /><span>{agentLabel[agent]}</span></label>)}</div></div><div className="root-grid">{AGENTS.map(agent => <label key={agent}>{agentLabel[agent]}<Input value={draft.localRoots[agent] ?? ''} onChange={event => setDraft(current => ({ ...current, localRoots: { ...current.localRoots, [agent]: event.target.value } }))} placeholder={defaultRoot[agent]} /></label>)}</div></section>
    {draft.sshSources.map((source, index) => <section className="source-block" key={source.id}><div className="source-heading"><div><Server /><span><strong>{source.label || t('remoteDevice', locale)}</strong><small>{source.host || t('unspecifiedHost', locale)}</small></span></div><Button className="icon danger" title={t('removeDevice', locale)} onClick={() => setDraft(current => ({ ...current, sshSources: current.sshSources.filter((_, item) => item !== index), codexQuota: current.codexQuota.sourceId === source.id ? { ...current.codexQuota, sourceId: null } : current.codexQuota, agyQuota: current.agyQuota.sourceId === source.id ? { ...current.agyQuota, sourceId: null } : current.agyQuota }))}><Trash2 /></Button></div><div className="ssh-fields"><label>{t('deviceName', locale)}<Input value={source.label} onChange={event => updateSource(index, { ...source, label: event.target.value })} /></label><label>{t('sshHost', locale)}<Input value={source.host} onChange={event => updateSource(index, { ...source, host: event.target.value })} placeholder="gpu-server" /></label></div><div className="agent-checks">{AGENTS.map(agent => <label key={agent}><Input type="checkbox" checked={source.enabledAgents.includes(agent)} onChange={() => updateSource(index, { ...source, enabledAgents: toggleRequired(source.enabledAgents, agent) })} /><AgentIcon agent={agent} /><span>{agentLabel[agent]}</span></label>)}</div><div className="root-grid">{AGENTS.map(agent => <label key={agent}>{agentLabel[agent]}<Input value={source.roots[agent] ?? ''} onChange={event => updateSource(index, { ...source, roots: { ...source.roots, [agent]: event.target.value } })} placeholder={defaultRoot[agent]} /></label>)}</div><Button className="secondary scan-source" disabled={refreshRunning || !source.host} onClick={async () => { setScanning(source.id); setScanMessage(null); setDialogError(null); try { await onScan(source); setScanMessage(t('scanSuccess', locale).replace('{label}', source.label || source.host)) } catch (reason) { setDialogError(String(reason)) } finally { setScanning(null) } }}><RefreshCw className={scanning === source.id ? 'spin' : ''} />{scanning === source.id ? t('scanning', locale) : t('testAndScan', locale)}</Button></section>)}
    {scanMessage && <Status tone="success" className="dialog-success">{scanMessage}</Status>}
    {adding ? <div className="add-confirm"><span>{t('addSshConfirm', locale)}</span><Button className="primary" onClick={addSource}>{t('continueBtn', locale)}</Button><Button className="secondary" onClick={() => setAdding(false)}>{t('cancelBtn', locale)}</Button></div> : <Button className="add-source" onClick={() => setAdding(true)}><Plus />{t('addSshDevice', locale)}</Button>}
    <section className="source-block session-refresh-settings">
      <div className="source-heading">
        <div><Clock3 /><span><strong>{t('autoRefreshTitle', locale)}</strong><small>{t('autoRefreshSubtitle', locale)}</small></span></div>
      </div>
      <div className="quota-setting-grid">
        <label>{t('refreshInterval', locale)}
          <Select
            value={String(draft.autoRefreshIntervalSeconds ?? 0)}
            onChange={event => {
              const val = Number(event.target.value)
              setDraft(current => ({ ...current, autoRefreshIntervalSeconds: val <= 0 ? null : val }))
            }}
          >
            <option value="0">{t('off', locale)}</option>
            <option value="60">{t('oneMin', locale)}</option>
            <option value="300">{t('fiveMin', locale)}</option>
            <option value="900">{t('fifteenMin', locale)}</option>
            <option value="1800">{t('thirtyMin', locale)}</option>
            <option value="3600">{t('oneHour', locale)}</option>
          </Select>
        </label>
      </div>
    </section>
    <section className="source-block quota-settings"><div className="source-heading"><div><Gauge /><span><strong>{t('codexQuotaSettings', locale)}</strong><small>{t('codexQuotaSubtitle', locale)}</small></span></div></div>
      <div className="quota-setting-grid">
        <label>{t('queryDevice', locale)}<Select value={draft.codexQuota.sourceId ?? ''} onChange={event => setDraft(current => ({ ...current, codexQuota: { ...current.codexQuota, sourceId: event.target.value || null } }))}><option value="">{t('noQuery', locale)}</option>{sourceOptions.map(source => <option key={source.id} value={source.id}>{source.label}</option>)}</Select></label>
        <label>Shell<Select value={draft.codexQuota.shellPreset} onChange={event => setDraft(current => ({ ...current, codexQuota: { ...current.codexQuota, shellPreset: event.target.value as ShellPreset } }))}><option value="auto">{t('autoShell', locale)}</option><option value="powershell">PowerShell</option><option value="zsh">zsh</option><option value="bash">bash</option></Select></label>
        <label>{t('autoRefreshMode', locale)}<Select value={intervalMode} onChange={event => { const value = event.target.value; setDraft(current => ({ ...current, codexQuota: { ...current.codexQuota, refreshIntervalSeconds: value === 'off' ? null : value === 'custom' ? 120 : Number(value) } })) }}><option value="off">{t('off', locale)}</option><option value="30">{t('thirtySec', locale)}</option><option value="60">{t('sixtySec', locale)}</option><option value="300">{t('fiveMin', locale)}</option><option value="900">{t('fifteenMin', locale)}</option><option value="custom">{t('customMode', locale)}</option></Select></label>
        {intervalMode === 'custom' && <label>{t('customSeconds', locale)}<Input type="number" min="30" max="3600" value={interval ?? 120} onChange={event => setDraft(current => ({ ...current, codexQuota: { ...current.codexQuota, refreshIntervalSeconds: Number(event.target.value) } }))} /></label>}
      </div>
      <label className="pre-command">{t('preCommand', locale)}<Textarea rows={3} value={draft.codexQuota.preCommand} onChange={event => setDraft(current => ({ ...current, codexQuota: { ...current.codexQuota, preCommand: event.target.value } }))} placeholder="例如：source ~/awsproxy" /><small>{t('preCommandDesc', locale)}</small></label>
      <Button className="secondary scan-source" disabled={quotaTesting || !draft.codexQuota.sourceId} onClick={async () => { setQuotaTesting(true); setScanMessage(null); setDialogError(null); try { const result = await onQuotaTest(draft); if (result.status !== 'ready') throw new Error(result.error ?? t('quotaQueryFailed', locale)); setScanMessage(t('quotaQuerySuccess', locale).replace('{label}', result.sourceLabel ?? t('devices', locale))) } catch (reason) { setDialogError(String(reason)) } finally { setQuotaTesting(false) } }}><RefreshCw className={quotaTesting ? 'spin' : ''} />{quotaTesting ? t('querying', locale) : t('testQuota', locale)}</Button>
    </section>
    <section className="source-block quota-settings agy-quota-settings"><div className="source-heading"><div><AgentIcon agent="agy" /><span><strong>{t('agyQuotaSettings', locale)}</strong><small>{t('agyQuotaSubtitle', locale)}</small></span></div></div>
      <div className="quota-setting-grid">
        <label>{t('queryDevice', locale)}<Select value={draft.agyQuota.sourceId ?? ''} onChange={event => setDraft(current => ({ ...current, agyQuota: { ...current.agyQuota, sourceId: event.target.value || null } }))}><option value="">{t('noQuery', locale)}</option>{sourceOptions.map(source => <option key={source.id} value={source.id}>{source.label}</option>)}</Select></label>
        <label>Shell<Select value={draft.agyQuota.shellPreset} onChange={event => setDraft(current => ({ ...current, agyQuota: { ...current.agyQuota, shellPreset: event.target.value as ShellPreset } }))}><option value="auto">{t('autoShell', locale)}</option><option value="powershell">PowerShell</option><option value="zsh">zsh</option><option value="bash">bash</option></Select></label>
        <label>{t('autoRefreshMode', locale)}<Select value={agyIntervalMode} onChange={event => { const value = event.target.value; setDraft(current => ({ ...current, agyQuota: { ...current.agyQuota, refreshIntervalSeconds: value === 'off' ? null : value === 'custom' ? 120 : Number(value) } })) }}><option value="off">{t('off', locale)}</option><option value="30">{t('thirtySec', locale)}</option><option value="60">{t('sixtySec', locale)}</option><option value="300">{t('fiveMin', locale)}</option><option value="900">{t('fifteenMin', locale)}</option><option value="custom">{t('customMode', locale)}</option></Select></label>
        {agyIntervalMode === 'custom' && <label>{t('customSeconds', locale)}<Input type="number" min="30" max="3600" value={agyInterval ?? 120} onChange={event => setDraft(current => ({ ...current, agyQuota: { ...current.agyQuota, refreshIntervalSeconds: Number(event.target.value) } }))} /></label>}
      </div>
      <label className="pre-command">{t('preCommand', locale)}<Textarea rows={3} value={draft.agyQuota.preCommand} onChange={event => setDraft(current => ({ ...current, agyQuota: { ...current.agyQuota, preCommand: event.target.value } }))} placeholder="例如：source ~/.bashrc" /><small>{t('preCommandDesc', locale)}</small></label>
      <Button className="secondary scan-source" disabled={agyQuotaTesting || !draft.agyQuota.sourceId} onClick={async () => { setAgyQuotaTesting(true); setScanMessage(null); setDialogError(null); try { const result = await onAgyQuotaTest(draft); if (result.status !== 'ready') throw new Error(result.error ?? t('agyQuotaFailed', locale)); setScanMessage(t('quotaQuerySuccess', locale).replace('{label}', result.sourceLabel ?? t('devices', locale))) } catch (reason) { setDialogError(String(reason)) } finally { setAgyQuotaTesting(false) } }}><RefreshCw className={agyQuotaTesting ? 'spin' : ''} />{agyQuotaTesting ? t('querying', locale) : t('testAgyQuota', locale)}</Button>
    </section>
    <footer><Button className="secondary" onClick={onClose}>{t('cancelBtn', locale)}</Button><Button className="primary" disabled={busy} onClick={async () => { setBusy(true); setDialogError(null); try { await onSave(draft) } catch (reason) { setDialogError(String(reason)); setBusy(false) } }}>{busy ? t('savingSettings', locale) : t('saveSettings', locale)}</Button></footer>
  </Dialog>
}

function toggleRequired<T>(values: T[], value: T): T[] { return values.includes(value) ? (values.length === 1 ? values : values.filter(item => item !== value)) : [...values, value] }
