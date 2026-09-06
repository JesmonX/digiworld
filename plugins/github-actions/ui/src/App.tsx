import { useEffect, useMemo, useState, useRef } from 'react'
import { Button, Input, Card, Status, Dialog } from '@digiworld/design-system/react'
import { createPluginBridge } from '@digiworld/plugin-sdk'
import { Github, RefreshCw, Settings, ExternalLink, CheckCircle2, XCircle, LoaderCircle, Clock3, CircleSlash2, Search, X } from 'lucide-react'
import './styles.css'

const bridge = createPluginBridge('io.github.jesmonx.digiworld.github-actions')
type Repo = { fullName: string; private: boolean; updatedAt?: string }
type Job = { id: number; name: string; status: string; conclusion?: string; html_url?: string }
type Run = { id: number; repository: string; name: string; title: string; branch: string; sha: string; status: string; conclusion?: string; url: string; createdAt: string; startedAt?: string; updatedAt?: string; attempt?: number; stale?: boolean; jobs: Job[] }

const dateText = (value?: string) => {
  if (!value) return '—'
  const date = /^\d+$/.test(value) ? new Date(Number(value) * 1000) : new Date(value)
  return Number.isNaN(+date) ? '—' : new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}
const statusText = (status: string, conclusion?: string) => {
  if (status !== 'completed') return status === 'queued' || status === 'waiting' ? '排队中' : '运行中'
  return ({ success: '成功', failure: '失败', cancelled: '已取消', skipped: '已跳过', neutral: '中立', timed_out: '超时', action_required: '需要操作' } as Record<string, string>)[conclusion ?? ''] ?? '状态未知'
}
function RunIcon({ run }: { run: Run }) {
  if (run.status !== 'completed') return run.status === 'queued' || run.status === 'waiting' ? <Clock3 className="queued" /> : <LoaderCircle className="spin" />
  if (run.conclusion === 'success') return <CheckCircle2 className="ok" />
  if (run.conclusion === 'cancelled' || run.conclusion === 'skipped') return <CircleSlash2 className="muted" />
  return <XCircle className="bad" />
}

export default function App() {
  const [token, setToken] = useState('')
  const [connected, setConnected] = useState(false)
  const [login, setLogin] = useState('')
  const [repos, setRepos] = useState<Repo[]>([])
  const [savedSelection, setSavedSelection] = useState<string[]>([])
  const [nextPage, setNextPage] = useState<number | null>(null)
  const [allActors, setAllActors] = useState(false)
  const [repoFilter, setRepoFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [branchFilter, setBranchFilter] = useState('')
  const [initialized, setInitialized] = useState(false)
  const refreshing = useRef(false)
  const [selected, setSelected] = useState<string[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [settings, setSettings] = useState(false)
  const [repoQuery, setRepoQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState('')

  const loadRuns = async () => {
    if (refreshing.current) return
    refreshing.current = true
    try {
      const data = await bridge.job<{runs:Run[];updatedAt?:string;warnings?:{repository:string;message:string}[]}>('git.runs.snapshot')
      setRuns(data.runs); setUpdatedAt(data.updatedAt ?? ''); setError(data.warnings?.map(w=>`${w.repository}: ${w.message}`).join('；') ?? '')
    } finally { refreshing.current = false }
  }
  const loadRepos = async (page = 1) => {
    const data = await bridge.job<{items:Repo[];nextPage?:number | null}>('git.repositories.list', {page})
    setRepos(current=>page===1?data.items:[...new Map([...current,...data.items].map(repo=>[repo.fullName,repo])).values()]); setNextPage(data.nextPage ?? null)
  }
  const load = async () => {
    setBusy(true); setError('')
    try {
      const auth = await bridge.job<{ connected: boolean; account?: { login: string }; error?: string }>('git.auth.status')
      setConnected(auth.connected); setLogin(auth.account?.login || ''); if (auth.error) setError(auth.error)
      const cfg = await bridge.request<{ repositories: string[]; allActors?: boolean }>('git.settings.get')
      setSelected(cfg.repositories); setSavedSelection(cfg.repositories); setAllActors(cfg.allActors ?? false)
      if (auth.connected) {const cached = await bridge.request<{runs:Run[]}>('git.runs.cached');setRuns(cached.runs);if(!auth.error){await loadRepos();await loadRuns()}}
    } catch (reason) { setError(String(reason)) } finally { setBusy(false); setInitialized(true) }
  }
  useEffect(() => { void load(); bridge.ready() }, [])
  useEffect(() => {
    if (!connected) return
    const timer = setInterval(() => { if (bridge.isActive()) void loadRuns().catch(reason => setError(String(reason))) }, 30_000)
    return () => clearInterval(timer)
  }, [connected])
  const connect = async () => {
    setBusy(true); setError('')
    try { const account = await bridge.job<{ login: string }>('git.auth.save', { token }); setLogin(account.login); setConnected(true); setToken(''); await load() }
    catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  const save = async () => {
    setSaving(true); setError('')
    try { await bridge.request('git.settings.save', { settings: { repositories: selected, pollSeconds: 30, allActors } }); setSavedSelection(selected); setSettings(false); await loadRuns() }
    catch (reason) { setError(String(reason)) } finally { setSaving(false) }
  }
  const filteredRepos = useMemo(() => repos.filter(repo => repo.fullName.toLowerCase().includes(repoQuery.trim().toLowerCase())), [repos, repoQuery])

  useEffect(() => bridge.on<{active:boolean}>('host.visibility', ({active}) => {if(active) void loadRuns().catch(reason=>setError(String(reason)))}), [])

  if (!initialized) return <main><Status>正在读取账号状态…</Status></main>
  if (!connected) return <main className="center"><Card><Github size={28} /><h1>连接 GitHub</h1><p>Token 只保存在系统凭据库，需要仓库 Actions 只读权限。</p><Input aria-label="GitHub Token" type="password" value={token} onChange={event => setToken(event.target.value)} placeholder="github_pat_…" /><Button variant="primary" onClick={() => void connect()} disabled={busy || !token}>{busy && <LoaderCircle className="spin" />}连接账号</Button>{error && <Status tone="error">{error}</Status>}</Card></main>
  return <main>
    <header className="dw-toolbar"><div><Github size={18} /><strong>{login} 的 Actions</strong><small>{updatedAt ? `更新于 ${dateText(updatedAt)}` : ''}</small></div><Button onClick={() => {setSelected(savedSelection); setSettings(true)}}><Settings size={15} />仓库</Button><Button onClick={() => { setBusy(true); void loadRuns().catch(reason => setError(String(reason))).finally(() => setBusy(false)) }} disabled={busy}>{busy ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}刷新</Button></header>
    {error && <Status tone="error" className="error"><span>{error}</span><Button aria-label="关闭错误" onClick={() => setError('')}><X size={14} /></Button></Status>}
    <div className="dw-toolbar"><Input aria-label="筛选仓库" placeholder="筛选仓库" value={repoFilter} onChange={e=>setRepoFilter(e.target.value)} /><Input aria-label="筛选分支" placeholder="筛选分支" value={branchFilter} onChange={e=>setBranchFilter(e.target.value)} /><select className="dw-select" aria-label="筛选运行状态" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="">全部状态</option><option value="in_progress">运行中</option><option value="success">成功</option><option value="failure">失败</option></select></div>
    <section className="runs">{runs.length === 0 ? <Status>{selected.length ? '没有找到由你触发的运行' : '请先选择仓库'}</Status> : runs.filter(run => (!repoFilter || run.repository.toLowerCase().includes(repoFilter.toLowerCase())) && (!branchFilter || run.branch.includes(branchFilter)) && (!statusFilter || run.status===statusFilter || run.conclusion===statusFilter)).map(run => <Card key={run.id} className="run">
      <div className="run-head"><RunIcon run={run} /><div><strong>{run.title || run.name}</strong><small>{run.repository} · {run.branch} · {run.sha?.slice(0, 7)}</small></div><span className={`run-status ${run.conclusion ?? run.status}`}>{statusText(run.status, run.conclusion)}</span><Button onClick={() => void bridge.request('host.openExternal', { url: run.url }).catch(reason => setError(String(reason)))}>GitHub <ExternalLink size={13} /></Button></div>
      <div className="run-meta">{run.stale && <Status>缓存数据 · 更新失败</Status>}<span>开始于 {dateText(run.startedAt || run.createdAt)}</span>{(run.attempt ?? 1) > 1 && <span>第 {run.attempt} 次尝试</span>}</div>
      {run.status === 'completed' && !run.jobs.length && <Button onClick={async () => { try { const data = await bridge.job<{jobs:Job[]}>('git.jobs.get', {repository:run.repository,id:run.id}); setRuns(current=>current.map(item=>item.id===run.id?{...item,jobs:data.jobs}:item)) } catch(reason) {setError(String(reason))} }}>查看 Job 详情</Button>}
      {run.jobs.length > 0 && <div className="jobs">{run.jobs.map(job => <div key={job.id}><span>{job.name}</span><small>{statusText(job.status, job.conclusion)}</small></div>)}</div>}
    </Card>)}</section>
    <Dialog open={settings} onClose={() => !saving && setSettings(false)} className="settings" aria-label="监控仓库">
      <header><div><h2>监控仓库</h2><p>选择需要显示运行状态的仓库。</p></div><Button aria-label="关闭" onClick={() => setSettings(false)} disabled={saving}><X size={16} /></Button></header>
      <label className="repo-search"><Search size={15} /><Input aria-label="搜索仓库" value={repoQuery} onChange={event => setRepoQuery(event.target.value)} placeholder="搜索 owner/repo" /></label>
      <div className="repo-list">{filteredRepos.map(repo => <label key={repo.fullName}><input type="checkbox" checked={selected.includes(repo.fullName)} onChange={event => setSelected(event.target.checked ? [...selected, repo.fullName] : selected.filter(item => item !== repo.fullName))} /><span>{repo.fullName}<small>{repo.private ? '私有' : '公开'}</small></span></label>)}</div>
      {nextPage && <Button disabled={saving} onClick={async()=>{setSaving(true);try{await loadRepos(nextPage)}catch(reason){setError(String(reason))}finally{setSaving(false)}}}>加载更多仓库</Button>}
      <label><input type="checkbox" checked={allActors} onChange={e=>setAllActors(e.target.checked)} />显示所选仓库全部运行</label>
      <Input type="password" aria-label="新 GitHub Token" placeholder="更换 Token（留空不修改）" value={token} onChange={e=>setToken(e.target.value)} />
      <Button disabled={!token || busy} onClick={()=>void connect()}>验证并更换 Token</Button>
      <Button variant="danger" disabled={busy} onClick={async()=>{try{await bridge.request('git.auth.remove');setConnected(false);setRuns([]);setSettings(false)}catch(reason){setError(String(reason))}}}>断开账号</Button>
      <footer><Button onClick={() => {setSelected(savedSelection); setSettings(false)}} disabled={saving}>取消</Button><Button variant="primary" onClick={() => void save()} disabled={saving}>{saving && <LoaderCircle className="spin" size={14} />}保存</Button></footer>
    </Dialog>
  </main>
}
