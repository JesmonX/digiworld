import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Cloud, Cpu, Database, HardDrive, Plus, RefreshCw, Server, Settings2, Trash2, X } from 'lucide-react'
import { createPluginBridge } from '@digiworld/plugin-sdk'
import { calendarCells, heatLevel, type Metric, type UsageDay } from './heatmap'
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
interface SourceStatus { sourceId: string; status: string; lastScannedAt?: string; error?: string; warnings: string[] }
interface Snapshot {
  startDay?: string
  endDay: string
  totals: Totals
  days: UsageDay[]
  breakdown: Breakdown[]
  statuses: SourceStatus[]
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
        <div className="range-group">{(['30', '90', '365', 'all'] as Range[]).map(value => <button key={value} className={range === value ? 'active' : ''} onClick={() => setRange(value)}>{value === 'all' ? '全部' : `${value} 天`}</button>)}</div>
      </section>

      <section className="summary-grid">
        <Summary icon={<Cpu />} label="总 Token" value={snapshot?.totals.totalTokens} />
        <Summary icon={<HardDrive />} label="输入" value={snapshot?.totals.inputTokens} />
        <Summary icon={<Cloud />} label="输出" value={snapshot?.totals.outputTokens} />
        <Summary icon={<Database />} label="缓存读取" value={snapshot?.totals.cacheReadTokens} />
        <Summary icon={<Database />} label="缓存写入" value={snapshot?.totals.cacheWriteTokens} />
        <Summary icon={<Check />} label="缓存率" text={snapshot?.totals.cacheRate == null ? '—' : `${(snapshot.totals.cacheRate * 100).toFixed(1)}%`} />
      </section>

      <section className="heatmap-card">
        <div className="card-title"><div><h2>每日热力图</h2><p>{snapshot?.startDay ?? snapshot?.days[0]?.day ?? '—'} 至 {snapshot?.endDay ?? '—'}</p></div><select value={metric} onChange={event => setMetric(event.target.value as Metric)}><option value="totalTokens">总 Token</option><option value="inputTokens">输入</option><option value="outputTokens">输出</option><option value="cacheReadTokens">缓存读取</option></select></div>
        {snapshot && cells.length ? <div className="calendar-wrap"><div className="weekday-labels"><span>一</span><span>三</span><span>五</span><span>日</span></div><div className="calendar-grid">{cells.map((cell, index) => <i key={cell.day ?? `blank-${index}`} className={`level-${heatLevel(cell.value, max)} ${cell.day ? '' : 'blank'}`} title={cell.day ? `${cell.day} · ${formatTokens(cell.value)}` : undefined} />)}</div><div className="legend"><span>低</span>{[0, 1, 2, 3, 4, 5].map(level => <i key={level} className={`level-${level}`} />)}<span>高</span></div></div> : <Empty />}
      </section>

      <section className="lower-grid">
        <article className="breakdown-card"><h2>来源明细</h2>{snapshot?.breakdown.length ? <div className="breakdown-table">{[...snapshot.breakdown].sort((a, b) => b.totalTokens - a.totalTokens).map(row => <div key={`${row.sourceId}-${row.agent}`}><span className={`agent-dot ${row.agent}`} /><strong>{agentLabel[row.agent]}</strong><span>{row.sourceLabel}</span><b>{formatTokens(row.totalTokens)}</b><small>{row.cacheRate == null ? `${formatTokens(row.cacheReadTokens)} cache` : `${(row.cacheRate * 100).toFixed(1)}% cache`}</small></div>)}</div> : <Empty />}</article>
        <article className="status-card"><h2>同步状态</h2>{snapshot?.statuses.map(status => <div className="status-row" key={status.sourceId}><span className={`status-dot ${status.status}`} /><div><strong>{sourceOptions.find(source => source.id === status.sourceId)?.label ?? status.sourceId}</strong><small>{status.error ?? status.warnings[0] ?? (status.lastScannedAt ? `更新于 ${new Date(status.lastScannedAt).toLocaleString()}` : '尚未扫描')}</small></div></div>)}</article>
      </section>

      {settingsOpen && settings && <SourceDialog settings={settings} refreshRunning={refresh.running} onClose={() => setSettingsOpen(false)} onSave={async value => {
        const saved = await bridge.request<UsageSettings>('usage.saveSettings', { settings: value })
        setSettings(saved)
        setSources(current => current.filter(id => id === 'local' || saved.sshSources.some(source => source.id === id)).concat(saved.sshSources.filter(source => !current.includes(source.id)).map(source => source.id)))
        setSettingsOpen(false)
        await loadSnapshot(saved)
      }} onScan={testSource} />}
    </div>
  )
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) { return <div className="filter-group"><span>{label}</span>{children}</div> }
function FilterChip({ active, label, onClick }: { active: boolean; label: string; onClick(): void }) { return <button className={`filter-chip ${active ? 'active' : ''}`} aria-pressed={active} onClick={onClick}>{active && <Check />}{label}</button> }
function Summary({ icon, label, value, text }: { icon: React.ReactNode; label: string; value?: number | undefined; text?: string }) { return <article className="summary-card"><span>{icon}</span><div><small>{label}</small><strong>{text ?? formatTokens(value ?? 0)}</strong></div></article> }
function Empty() { return <div className="empty"><Database /><span>暂无数据，点击“手动刷新”开始扫描</span></div> }

function SourceDialog({ settings, refreshRunning, onClose, onSave, onScan }: { settings: UsageSettings; refreshRunning: boolean; onClose(): void; onSave(value: UsageSettings): Promise<void>; onScan(source: SshSource): Promise<void> }) {
  const [draft, setDraft] = useState<UsageSettings>(structuredClone(settings))
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState<string | null>(null)
  const [scanMessage, setScanMessage] = useState<string | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const updateSource = (index: number, source: SshSource) => setDraft(current => ({ ...current, sshSources: current.sshSources.map((value, item) => item === index ? source : value) }))
  const addSource = () => {
    setDraft(current => ({ ...current, sshSources: [...current.sshSources, { id: `ssh-${Date.now()}`, label: '远端设备', host: '', enabledAgents: [...AGENTS], roots: {} }] }))
    setAdding(false)
  }
  return <div className="modal-backdrop"><div className="source-modal" role="dialog" aria-modal="true"><header><div><h2>数据源</h2><p>扫描仅在你点击刷新时进行</p></div><button className="close" onClick={onClose}><X /></button></header>
    {dialogError && <div className="dialog-error">{dialogError}</div>}
    <section className="source-block"><div className="source-heading"><div><HardDrive /><span><strong>本机</strong><small>默认 Agent 数据目录</small></span></div><div className="agent-checks">{AGENTS.map(agent => <label key={agent}><input type="checkbox" checked={draft.localAgents.includes(agent)} onChange={() => setDraft(current => ({ ...current, localAgents: toggleRequired(current.localAgents, agent) }))} />{agentLabel[agent]}</label>)}</div></div><div className="root-grid">{AGENTS.map(agent => <label key={agent}>{agentLabel[agent]}<input value={draft.localRoots[agent] ?? ''} onChange={event => setDraft(current => ({ ...current, localRoots: { ...current.localRoots, [agent]: event.target.value } }))} placeholder={defaultRoot[agent]} /></label>)}</div></section>
    {draft.sshSources.map((source, index) => <section className="source-block" key={source.id}><div className="source-heading"><div><Server /><span><strong>{source.label || 'SSH 设备'}</strong><small>{source.host || '尚未填写 Host'}</small></span></div><button className="icon danger" title="移除设备" onClick={() => setDraft(current => ({ ...current, sshSources: current.sshSources.filter((_, item) => item !== index) }))}><Trash2 /></button></div><div className="ssh-fields"><label>名称<input value={source.label} onChange={event => updateSource(index, { ...source, label: event.target.value })} /></label><label>SSH Config Host<input value={source.host} onChange={event => updateSource(index, { ...source, host: event.target.value })} placeholder="gpu-server" /></label></div><div className="agent-checks">{AGENTS.map(agent => <label key={agent}><input type="checkbox" checked={source.enabledAgents.includes(agent)} onChange={() => updateSource(index, { ...source, enabledAgents: toggleRequired(source.enabledAgents, agent) })} />{agentLabel[agent]}</label>)}</div><div className="root-grid">{AGENTS.map(agent => <label key={agent}>{agentLabel[agent]}<input value={source.roots[agent] ?? ''} onChange={event => updateSource(index, { ...source, roots: { ...source.roots, [agent]: event.target.value } })} placeholder={defaultRoot[agent]} /></label>)}</div><button className="secondary scan-source" disabled={refreshRunning || !source.host} onClick={async () => { setScanning(source.id); setScanMessage(null); setDialogError(null); try { await onScan(source); setScanMessage(`${source.label || source.host} 扫描成功`) } catch (reason) { setDialogError(String(reason)) } finally { setScanning(null) } }}><RefreshCw className={scanning === source.id ? 'spin' : ''} />{scanning === source.id ? '扫描中…' : '测试并扫描'}</button></section>)}
    {scanMessage && <div className="dialog-success">{scanMessage}</div>}
    {adding ? <div className="add-confirm"><span>将添加一个使用 SSH config 和密钥认证的 Unix 设备。</span><button className="primary" onClick={addSource}>继续</button><button className="secondary" onClick={() => setAdding(false)}>取消</button></div> : <button className="add-source" onClick={() => setAdding(true)}><Plus />添加 SSH 设备</button>}
    <footer><button className="secondary" onClick={onClose}>取消</button><button className="primary" disabled={busy} onClick={async () => { setBusy(true); setDialogError(null); try { await onSave(draft) } catch (reason) { setDialogError(String(reason)); setBusy(false) } }}>{busy ? '保存中…' : '保存设置'}</button></footer>
  </div></div>
}

function toggleRequired<T>(values: T[], value: T): T[] { return values.includes(value) ? (values.length === 1 ? values : values.filter(item => item !== value)) : [...values, value] }
function formatTokens(value: number): string { return new Intl.NumberFormat('zh-CN', { notation: value >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value) }
