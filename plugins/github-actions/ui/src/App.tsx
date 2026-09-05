import { useEffect, useMemo, useState } from 'react'
import { Button, Input, Card, Status, Dialog } from '@digiworld/design-system/react'
import { createPluginBridge } from '@digiworld/plugin-sdk'
import { Github, RefreshCw, Settings, ExternalLink, CheckCircle2, XCircle, LoaderCircle, Clock3, CircleSlash2, Search, X } from 'lucide-react'
import './styles.css'

const bridge = createPluginBridge('io.github.jesmonx.digiworld.github-actions')
type Repo = { fullName: string; private: boolean; updatedAt?: string }
type Job = { id: number; name: string; status: string; conclusion?: string; html_url?: string }
type Run = { id: number; repository: string; name: string; title: string; branch: string; sha: string; status: string; conclusion?: string; url: string; createdAt: string; startedAt?: string; updatedAt?: string; attempt?: number; jobs: Job[] }

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
  const [selected, setSelected] = useState<string[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [settings, setSettings] = useState(false)
  const [repoQuery, setRepoQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState('')

  const loadRuns = async () => {
    const data = await bridge.request<{ runs: Run[]; updatedAt?: string }>('git.runs.snapshot')
    setRuns(data.runs); setUpdatedAt(data.updatedAt ?? '')
  }
  const load = async () => {
    setBusy(true); setError('')
    try {
      const auth = await bridge.request<{ connected: boolean; account?: { login: string } }>('git.auth.status')
      setConnected(auth.connected); setLogin(auth.account?.login || '')
      const cfg = await bridge.request<{ repositories: string[] }>('git.settings.get')
      setSelected(cfg.repositories)
      if (auth.connected) { setRepos((await bridge.request<{ items: Repo[] }>('git.repositories.list')).items); await loadRuns() }
    } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  useEffect(() => { void load(); bridge.ready() }, [])
  useEffect(() => {
    if (!connected) return
    const timer = setInterval(() => { void loadRuns().catch(reason => setError(String(reason))) }, 30_000)
    return () => clearInterval(timer)
  }, [connected])
  const connect = async () => {
    setBusy(true); setError('')
    try { const account = await bridge.request<{ login: string }>('git.auth.save', { token }); setLogin(account.login); setConnected(true); setToken(''); await load() }
    catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  const save = async () => {
    setSaving(true); setError('')
    try { await bridge.request('git.settings.save', { settings: { repositories: selected, pollSeconds: 30 } }); setSettings(false); await loadRuns() }
    catch (reason) { setError(String(reason)) } finally { setSaving(false) }
  }
  const filteredRepos = useMemo(() => repos.filter(repo => repo.fullName.toLowerCase().includes(repoQuery.trim().toLowerCase())), [repos, repoQuery])

  if (!connected) return <main className="center"><Card><Github size={28} /><h1>连接 GitHub</h1><p>Token 只保存在系统凭据库，需要仓库 Actions 只读权限。</p><Input aria-label="GitHub Token" type="password" value={token} onChange={event => setToken(event.target.value)} placeholder="github_pat_…" /><Button variant="primary" onClick={() => void connect()} disabled={busy || !token}>{busy && <LoaderCircle className="spin" />}连接账号</Button>{error && <Status tone="error">{error}</Status>}</Card></main>
  return <main>
    <header className="dw-toolbar"><div><Github size={18} /><strong>{login} 的 Actions</strong><small>{updatedAt ? `更新于 ${dateText(updatedAt)}` : ''}</small></div><Button onClick={() => setSettings(true)}><Settings size={15} />仓库</Button><Button onClick={() => { setBusy(true); void loadRuns().catch(reason => setError(String(reason))).finally(() => setBusy(false)) }} disabled={busy}>{busy ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}刷新</Button></header>
    {error && <Status tone="error" className="error"><span>{error}</span><Button aria-label="关闭错误" onClick={() => setError('')}><X size={14} /></Button></Status>}
    <section className="runs">{runs.length === 0 ? <Status>{selected.length ? '没有找到由你触发的运行' : '请先选择仓库'}</Status> : runs.map(run => <Card key={run.id} className="run">
      <div className="run-head"><RunIcon run={run} /><div><strong>{run.title || run.name}</strong><small>{run.repository} · {run.branch} · {run.sha?.slice(0, 7)}</small></div><span className={`run-status ${run.conclusion ?? run.status}`}>{statusText(run.status, run.conclusion)}</span><a href={run.url} target="_blank" rel="noreferrer">GitHub <ExternalLink size={13} /></a></div>
      <div className="run-meta"><span>开始于 {dateText(run.startedAt || run.createdAt)}</span>{(run.attempt ?? 1) > 1 && <span>第 {run.attempt} 次尝试</span>}</div>
      {run.jobs.length > 0 && <div className="jobs">{run.jobs.map(job => <div key={job.id}><span>{job.name}</span><small>{statusText(job.status, job.conclusion)}</small></div>)}</div>}
    </Card>)}</section>
    <Dialog open={settings} onClose={() => !saving && setSettings(false)} className="settings" aria-label="监控仓库">
      <header><div><h2>监控仓库</h2><p>选择需要显示运行状态的仓库。</p></div><Button aria-label="关闭" onClick={() => setSettings(false)} disabled={saving}><X size={16} /></Button></header>
      <label className="repo-search"><Search size={15} /><Input aria-label="搜索仓库" value={repoQuery} onChange={event => setRepoQuery(event.target.value)} placeholder="搜索 owner/repo" /></label>
      <div className="repo-list">{filteredRepos.map(repo => <label key={repo.fullName}><input type="checkbox" checked={selected.includes(repo.fullName)} onChange={event => setSelected(event.target.checked ? [...selected, repo.fullName] : selected.filter(item => item !== repo.fullName))} /><span>{repo.fullName}<small>{repo.private ? '私有' : '公开'}</small></span></label>)}</div>
      <footer><Button onClick={() => setSettings(false)} disabled={saving}>取消</Button><Button variant="primary" onClick={() => void save()} disabled={saving}>{saving && <LoaderCircle className="spin" size={14} />}保存</Button></footer>
    </Dialog>
  </main>
}
