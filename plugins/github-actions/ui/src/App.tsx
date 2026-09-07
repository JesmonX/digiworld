import { useEffect, useMemo, useState } from 'react'
import { PluginPage, PageToolbar, Button, Input, Card, Status, Dialog } from '@digiworld/design-system/react'
import { createPluginBridge } from '@digiworld/plugin-sdk'
import { Github, RefreshCw, Settings, ExternalLink, CheckCircle2, XCircle, LoaderCircle, Clock3, CircleSlash2, Search, X } from 'lucide-react'
import { t, type Locale, DICTIONARY } from './i18n'
import './styles.css'

const bridge = createPluginBridge('io.github.jesmonx.digiworld.github-actions')
type Repo = { fullName: string; private: boolean; updatedAt?: string }
export type Step = { name: string; status: string; conclusion?: string | null; number?: number; started_at?: string | null; completed_at?: string | null }
export type Job = { id: number; name: string; status: string; conclusion?: string | null; html_url?: string; run_url?: string; check_run_url?: string; started_at?: string | null; completed_at?: string | null; steps?: Step[] }
export type Run = { id: number; repository: string; name: string; title: string; branch: string; sha: string; status: string; conclusion?: string | null; url: string; createdAt: string; startedAt?: string; updatedAt?: string; attempt?: number; jobs: Job[]; jobsLoaded?: boolean }

const TERMINAL_CONCLUSIONS = new Set(['success', 'failure', 'cancelled', 'skipped', 'neutral', 'timed_out', 'action_required', 'stale'])
const isFinished = (status?: string, conclusion?: string | null) => status === 'completed' || Boolean(conclusion && TERMINAL_CONCLUSIONS.has(conclusion))

export function runProgress(run: Run, jobs = run.jobs, loaded = run.jobsLoaded ?? jobs.length > 0) {
  if (!loaded) {
    const total = 1
    const done = run.status === 'completed' ? 1 : 0
    return { done, total, current: undefined as string | undefined, percent: done * 100 }
  }
  const steps = jobs.flatMap(job => job.steps ?? [])
  if (steps.length > 0) {
    const done = steps.filter(step => isFinished(step.status, step.conclusion)).length
    const current = steps.find(step => !isFinished(step.status, step.conclusion))?.name
    return { done, total: steps.length, current, percent: done / steps.length * 100 }
  }
  if (jobs.length > 0) {
    const done = jobs.filter(job => isFinished(job.status, job.conclusion)).length
    const current = jobs.find(job => !isFinished(job.status, job.conclusion))?.name
    return { done, total: jobs.length, current, percent: done / jobs.length * 100 }
  }
  const done = run.status === 'completed' ? 1 : 0
  return { done, total: 1, current: undefined as string | undefined, percent: done * 100 }
}

type JobState = { jobs: Job[]; loaded: boolean; loading: boolean; error?: string }

const dateText = (value?: string, locale: Locale = 'en') => {
  if (!value) return '—'
  const date = /^\d+$/.test(value) ? new Date(Number(value) * 1000) : new Date(value)
  return Number.isNaN(+date) ? '—' : new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

const statusText = (status: string, conclusion: string | null | undefined, locale: Locale) => {
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

function JobDetails({ state, locale }: { state: JobState; locale: Locale }) {
  if (state.loading && !state.loaded) return <Status className="job-detail-status">{t('loadingJobs', locale)}</Status>
  if (state.error && !state.loaded) return <Status tone="error" className="job-detail-status">{t('jobsLoadFailed', locale).replace('{error}', state.error)}</Status>
  if (!state.jobs.length) return <Status className="job-detail-status">{t('noJobs', locale)}</Status>
  return (
    <div className="jobs-detail">
      {state.jobs.map(job => (
        <details key={job.id} className="job-detail">
          <summary>
            <span className="job-summary-main"><strong>{job.name}</strong><small>{statusText(job.status, job.conclusion, locale)}</small></span>
            <span className={`job-status ${job.conclusion ?? job.status}`}>{statusText(job.status, job.conclusion, locale)}</span>
          </summary>
          <div className="job-meta">
            <span>{job.started_at ? dateText(job.started_at, locale) : '—'}{job.completed_at ? ` → ${dateText(job.completed_at, locale)}` : ''}</span>
            {job.html_url && <a href={job.html_url} target="_blank" rel="noreferrer">{t('jobLink', locale)} <ExternalLink size={12} /></a>}
          </div>
          {job.steps && job.steps.length > 0 ? (
            <ol className="steps">
              {job.steps.map(step => (
                <li key={`${job.id}-${step.number ?? step.name}`} className={step.conclusion ?? step.status}>
                  <span><strong>{step.name}</strong><small>{statusText(step.status, step.conclusion, locale)}</small></span>
                  <time>{step.completed_at ? dateText(step.completed_at, locale) : step.started_at ? dateText(step.started_at, locale) : '—'}</time>
                </li>
              ))}
            </ol>
          ) : <small className="no-steps">{t('noSteps', locale)}</small>}
        </details>
      ))}
    </div>
  )
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
  const [expandedRuns, setExpandedRuns] = useState<Set<number>>(() => new Set())
  const [jobStates, setJobStates] = useState<Record<number, JobState>>({})

  const loadRuns = async () => {
    const data = await bridge.request<{ runs: Run[]; updatedAt?: string }>('git.runs.snapshot')
    setRuns(data.runs)
    setUpdatedAt(data.updatedAt ?? '')
    setJobStates(current => {
      const next = { ...current }
      for (const run of data.runs) {
        const previous = next[run.id]
        if (run.jobsLoaded || run.jobs.length > 0) {
          next[run.id] = { jobs: run.jobs, loaded: true, loading: previous?.loading ?? false, ...(previous?.error ? { error: previous.error } : {}) }
        } else if (!previous) {
          next[run.id] = { jobs: [], loaded: false, loading: false }
        }
      }
      return next
    })
  }

  const loadJobs = async (run: Run) => {
    const current = jobStates[run.id]
    if (current?.loaded || current?.loading) return
    setJobStates(value => ({ ...value, [run.id]: { jobs: value[run.id]?.jobs ?? [], loaded: false, loading: true } }))
    try {
      const data = await bridge.request<{ jobs: Job[] }>('git.run.jobs', { repository: run.repository, runId: run.id })
      setJobStates(value => ({ ...value, [run.id]: { jobs: data.jobs, loaded: true, loading: false } }))
    } catch (reason) {
      setJobStates(value => ({ ...value, [run.id]: { ...(value[run.id] ?? { jobs: [] }), loaded: false, loading: false, error: String(reason) } }))
    }
  }

  const toggleRun = (run: Run) => {
    const opening = !expandedRuns.has(run.id)
    setExpandedRuns(current => {
      const next = new Set(current)
      if (next.has(run.id)) next.delete(run.id)
      else next.add(run.id)
      return next
    })
    if (opening && !jobStates[run.id]?.loaded && run.jobs.length === 0) void loadJobs(run)
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

    const unlistenLocale = bridge.on('locale', (payload: unknown) => {
      const nextLocale = typeof payload === 'string' ? payload : (payload as { locale?: Locale })?.locale
      if (nextLocale === 'en' || nextLocale === 'zh') {
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
          runs.map(run => {
            const state = jobStates[run.id] ?? { jobs: run.jobs, loaded: run.jobsLoaded ?? run.jobs.length > 0, loading: false }
            const progress = runProgress(run, state.loaded ? state.jobs : run.jobs, state.loaded)
            const expanded = expandedRuns.has(run.id)
            return (
              <Card key={run.id} className="run">
                <div className="run-head">
                  <RunIcon run={run} />
                  <div>
                    <strong tabIndex={0} data-tooltip={run.title || run.name}>{run.title || run.name}</strong>
                    <small tabIndex={0} data-tooltip={`${run.repository} · ${run.branch} · ${run.sha ?? ''}`}>{run.repository} · {run.branch} · {run.sha?.slice(0, 7)}</small>
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
                <div className="run-progress">
                  <div className="run-progress-head"><span>{t('progress', locale)}</span><strong>{progress.done}/{progress.total}</strong></div>
                  <div className="run-progress-track" role="progressbar" aria-label={t('progress', locale)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.percent)}><span style={{ width: `${Math.max(0, Math.min(100, progress.percent))}%` }} /></div>
                  <small>{progress.current ? t('currentStep', locale).replace('{step}', progress.current) : progress.percent >= 100 ? t('allStepsComplete', locale) : t('waitingForStep', locale)}</small>
                </div>
                <Button className="run-details-toggle" aria-expanded={expanded} aria-controls={`run-details-${run.id}`} onClick={() => toggleRun(run)}>
                  {expanded ? t('hideJobs', locale) : t('showJobs', locale)}
                </Button>
                {expanded && <div id={`run-details-${run.id}`}><JobDetails state={state} locale={locale} /></div>}
              </Card>
            )
          })
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
