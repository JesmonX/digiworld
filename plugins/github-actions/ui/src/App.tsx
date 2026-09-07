import { useEffect, useMemo, useState } from 'react'
import { PluginPage, PageToolbar, Button, Input, Card, Status, Dialog } from '@digiworld/design-system/react'
import { createPluginBridge } from '@digiworld/plugin-sdk'
import { Github, RefreshCw, Settings, ExternalLink, CheckCircle2, XCircle, LoaderCircle, Clock3, CircleSlash2, Search, X } from 'lucide-react'
import { t, type Locale, DICTIONARY } from './i18n'
import './styles.css'

const bridge = createPluginBridge('io.github.jesmonx.digiworld.github-actions')
type Repo = { fullName: string; private: boolean; updatedAt?: string }
type Job = { id: number; name: string; status: string; conclusion?: string; html_url?: string }
type Run = { id: number; repository: string; name: string; title: string; branch: string; sha: string; status: string; conclusion?: string; url: string; createdAt: string; startedAt?: string; updatedAt?: string; attempt?: number; jobs: Job[] }

const dateText = (value?: string, locale: Locale = 'en') => {
  if (!value) return '—'
  const date = /^\d+$/.test(value) ? new Date(Number(value) * 1000) : new Date(value)
  return Number.isNaN(+date) ? '—' : new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

const statusText = (status: string, conclusion: string | undefined, locale: Locale) => {
  if (status !== 'completed') return status === 'queued' || status === 'waiting' ? t('queued', locale) : t('running', locale)
  const map: Record<string, keyof typeof DICTIONARY> = {
    success: 'success',
    failure: 'failure',
    cancelled: 'cancelled',
    skipped: 'skipped',
    neutral: 'neutral',
    timed_out: 'timed_out',
    action_required: 'action_required',
  }
  const key = conclusion ? map[conclusion] : undefined
  return key ? t(key, locale) : t('unknown', locale)
}

function RunIcon({ run }: { run: Run }) {
  if (run.status !== 'completed') return run.status === 'queued' || run.status === 'waiting' ? <Clock3 className="queued" /> : <LoaderCircle className="spin" />
  if (run.conclusion === 'success') return <CheckCircle2 className="ok" />
  if (run.conclusion === 'cancelled' || run.conclusion === 'skipped') return <CircleSlash2 className="muted" />
  return <XCircle className="bad" />
}

export default function App() {
  const [locale, setLocale] = useState<Locale>(() => {
    return (document.documentElement.lang?.startsWith('zh') ? 'zh' : 'en') as Locale
  })
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
    setRuns(data.runs)
    setUpdatedAt(data.updatedAt ?? '')
  }

  const load = async () => {
    setBusy(true)
    setError('')
    try {
      const auth = await bridge.request<{ connected: boolean; account?: { login: string } }>('git.auth.status')
      setConnected(auth.connected)
      setLogin(auth.account?.login || '')
      const cfg = await bridge.request<{ repositories: string[] }>('git.settings.get')
      setSelected(cfg.repositories)
      if (auth.connected) {
        setRepos((await bridge.request<{ items: Repo[] }>('git.repositories.list')).items)
        await loadRuns()
      }
    } catch (reason) {
      setError(String(reason))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void load()
    bridge.ready()

    const unlistenLocale = bridge.on<{ locale: Locale }>('locale', ({ locale: nextLocale }) => {
      if (nextLocale) {
        setLocale(nextLocale)
      }
    })

    return () => {
      if (typeof unlistenLocale === 'function') unlistenLocale()
    }
  }, [])

  useEffect(() => {
    if (!connected) return
    const timer = setInterval(() => {
      void loadRuns().catch(reason => setError(String(reason)))
    }, 30_000)
    return () => clearInterval(timer)
  }, [connected])

  const connect = async () => {
    setBusy(true)
    setError('')
    try {
      const account = await bridge.request<{ login: string }>('git.auth.save', { token })
      setLogin(account.login)
      setConnected(true)
      setToken('')
      await load()
    } catch (reason) {
      setError(String(reason))
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      await bridge.request('git.settings.save', { settings: { repositories: selected, pollSeconds: 30 } })
      setSettings(false)
      await loadRuns()
    } catch (reason) {
      setError(String(reason))
    } finally {
      setSaving(false)
    }
  }

  const filteredRepos = useMemo(
    () => repos.filter(repo => repo.fullName.toLowerCase().includes(repoQuery.trim().toLowerCase())),
    [repos, repoQuery]
  )

  if (!connected) {
    return (
      <main className="center">
        <Card>
          <Github size={28} />
          <h1>{t('connectTitle', locale)}</h1>
          <p>{t('connectSubtitle', locale)}</p>
          <Input
            aria-label={t('tokenAria', locale)}
            type="password"
            value={token}
            onChange={event => setToken(event.target.value)}
            placeholder="github_pat_…"
          />
          <Button variant="primary" onClick={() => void connect()} disabled={busy || !token}>
            {busy && <LoaderCircle className="spin" />}
            {busy ? t('connecting', locale) : t('connectButton', locale)}
          </Button>
          {error && <Status tone="error">{error}</Status>}
        </Card>
      </main>
    )
  }

  return (
    <PluginPage>
      <PageToolbar className="">
        <div>
          <Github size={18} />
          <strong>{t('toolbarTitle', locale).replace('{login}', login)}</strong>
          <small>{updatedAt ? t('updatedAt', locale).replace('{time}', dateText(updatedAt, locale)) : ''}</small>
        </div>
        <Button onClick={() => setSettings(true)}>
          <Settings size={15} />{t('repos', locale)}
        </Button>
        <Button
          onClick={() => {
            setBusy(true)
            void loadRuns().catch(reason => setError(String(reason))).finally(() => setBusy(false))
          }}
          disabled={busy}
        >
          {busy ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}
          {t('refresh', locale)}
        </Button>
      </PageToolbar>

      {error && (
        <Status tone="error" className="error">
          <span>{error}</span>
          <Button aria-label={t('closeError', locale)} onClick={() => setError('')}>
            <X size={14} />
          </Button>
        </Status>
      )}

      <section className="runs">
        {runs.length === 0 ? (
          <Status>{selected.length ? t('noRuns', locale) : t('noReposSelected', locale)}</Status>
        ) : (
          runs.map(run => (
            <Card key={run.id} className="run">
              <div className="run-head">
                <RunIcon run={run} />
                <div>
                  <strong>{run.title || run.name}</strong>
                  <small>{run.repository} · {run.branch} · {run.sha?.slice(0, 7)}</small>
                </div>
                <span className={`run-status ${run.conclusion ?? run.status}`}>
                  {statusText(run.status, run.conclusion, locale)}
                </span>
                <a href={run.url} target="_blank" rel="noreferrer">
                  GitHub <ExternalLink size={13} />
                </a>
              </div>
              <div className="run-meta">
                <span>{t('startedAt', locale).replace('{time}', dateText(run.startedAt || run.createdAt, locale))}</span>
                {(run.attempt ?? 1) > 1 && <span>{t('attempt', locale).replace('{attempt}', String(run.attempt))}</span>}
              </div>
              {run.jobs.length > 0 && (
                <div className="jobs">
                  {run.jobs.map(job => (
                    <div key={job.id}>
                      <span>{job.name}</span>
                      <small>{statusText(job.status, job.conclusion, locale)}</small>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))
        )}
      </section>

      <Dialog open={settings} onClose={() => !saving && setSettings(false)} className="settings" aria-label={t('settingsTitle', locale)}>
        <header>
          <div>
            <h2>{t('settingsTitle', locale)}</h2>
            <p>{t('settingsSubtitle', locale)}</p>
          </div>
          <Button aria-label={t('close', locale)} onClick={() => setSettings(false)} disabled={saving}>
            <X size={16} />
          </Button>
        </header>
        <label className="repo-search">
          <Search size={15} />
          <Input
            aria-label={t('searchRepos', locale)}
            value={repoQuery}
            onChange={event => setRepoQuery(event.target.value)}
            placeholder={t('searchPlaceholder', locale)}
          />
        </label>
        <div className="repo-list">
          {filteredRepos.map(repo => (
            <label key={repo.fullName}>
              <input
                type="checkbox"
                checked={selected.includes(repo.fullName)}
                onChange={event =>
                  setSelected(
                    event.target.checked
                      ? [...selected, repo.fullName]
                      : selected.filter(item => item !== repo.fullName)
                  )
                }
              />
              <span>
                {repo.fullName}
                <small>{repo.private ? t('private', locale) : t('public', locale)}</small>
              </span>
            </label>
          ))}
        </div>
        <footer>
          <Button onClick={() => setSettings(false)} disabled={saving}>
            {t('cancel', locale)}
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving}>
            {saving && <LoaderCircle className="spin" size={14} />}
            {saving ? t('saving', locale) : t('save', locale)}
          </Button>
        </footer>
      </Dialog>
    </PluginPage>
  )
}
