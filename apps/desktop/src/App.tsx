import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Boxes, Check, ChevronRight, CircleAlert, Download, Gauge, Library,
  LoaderCircle, PackageCheck, Pause, RefreshCw, Settings, ShieldCheck, Sparkles,
} from 'lucide-react'
import type { CatalogIndex, CatalogPlugin, PluginSummary } from '@digiworld/plugin-sdk'
import { PluginFrame } from './components/PluginFrame'
import { api, type AppState } from './lib/api'
import './styles.css'

type Page = 'home' | 'catalog' | 'settings' | { pluginId: string }

function permissionLabel(id: string): string {
  const labels: Record<string, string> = {
    'background': '后台运行', 'global-input': '读取全局键位事件', 'plugin-storage': '本地插件存储',
  }
  return labels[id] ?? id
}

function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [catalog, setCatalog] = useState<CatalogIndex | null>(null)
  const [page, setPage] = useState<Page>('home')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pluginHtml, setPluginHtml] = useState<string | null>(null)
  const [confirmInstall, setConfirmInstall] = useState<CatalogPlugin | null>(null)

  const refreshState = useCallback(async () => setState(await api.appState()), [])
  const refreshCatalog = useCallback(async (force = false) => setCatalog(await api.catalog(force)), [])

  useEffect(() => {
    Promise.all([refreshState(), refreshCatalog()]).catch(reason => setError(String(reason)))
  }, [refreshCatalog, refreshState])

  useEffect(() => {
    if (typeof page === 'string') {
      setPluginHtml(null)
      return
    }
    api.pluginUi(page.pluginId).then(setPluginHtml).catch(reason => setError(String(reason)))
  }, [page])

  const installed = useMemo(() => new Map(state?.plugins.map(plugin => [plugin.id, plugin]) ?? []), [state])

  const install = async (plugin: CatalogPlugin) => {
    setBusy(plugin.id)
    setError(null)
    try {
      await api.install(plugin.id)
      await refreshState()
      setConfirmInstall(null)
      setPage({ pluginId: plugin.id })
    } catch (reason) {
      setError(String(reason))
    } finally {
      setBusy(null)
    }
  }

  const manageEnabled = async (plugin: PluginSummary, enabled: boolean) => {
    setBusy(plugin.id)
    setError(null)
    try {
      await api.setEnabled(plugin.id, enabled)
      await refreshState()
    } catch (reason) {
      setError(String(reason))
    } finally {
      setBusy(null)
    }
  }

  const uninstall = async (plugin: PluginSummary) => {
    if (!window.confirm(`移除“${plugin.name}”？点击“确定”将保留统计数据，方便以后重新安装。`)) return
    setBusy(plugin.id)
    setError(null)
    try {
      await api.uninstall(plugin.id, false)
      await refreshState()
      setPage('home')
    } catch (reason) {
      setError(String(reason))
    } finally {
      setBusy(null)
    }
  }

  const enabledPlugins = state?.plugins.filter(plugin => plugin.enabled) ?? []
  const pageTitle = typeof page === 'string'
    ? { home: '概览', catalog: '功能库', settings: '设置' }[page]
    : state?.plugins.find(plugin => plugin.id === page.pluginId)?.name ?? '插件'

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setPage('home')}>
          <span className="brand-mark"><Sparkles size={19} /></span>
          <span><strong>Digiworld</strong><small>你的数字工具空间</small></span>
        </button>
        <nav>
          <NavButton active={page === 'home'} icon={<Gauge />} label="概览" onClick={() => setPage('home')} />
          <NavButton active={page === 'catalog'} icon={<Library />} label="功能库" onClick={() => setPage('catalog')} />
          {state?.plugins.map(plugin => (
            <NavButton key={plugin.id} active={typeof page !== 'string' && page.pluginId === plugin.id}
              icon={<Boxes />} label={plugin.name} status={plugin.state} onClick={() => setPage({ pluginId: plugin.id })} />
          ))}
        </nav>
        <div className="sidebar-bottom">
          <NavButton active={page === 'settings'} icon={<Settings />} label="设置" onClick={() => setPage('settings')} />
          <div className="privacy-chip"><ShieldCheck size={15} /><span>本地优先 · 无遥测</span></div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div><p className="eyebrow">DIGIWORLD / {typeof page === 'string' ? page.toUpperCase() : 'PLUGIN'}</p><h1>{pageTitle}</h1></div>
          <div className="status-pill"><span className="pulse" />{enabledPlugins.length} 个功能运行中</div>
        </header>

        {error && <div className="error-banner"><CircleAlert size={18} /><span>{error}</span><button onClick={() => setError(null)}>关闭</button></div>}

        <section className="content">
          {page === 'home' && <Home plugins={state?.plugins ?? []} catalog={catalog} onCatalog={() => setPage('catalog')} onOpen={id => setPage({ pluginId: id })} />}
          {page === 'catalog' && <Catalog catalog={catalog} installed={installed} busy={busy} onInstall={setConfirmInstall} onRefresh={() => refreshCatalog(true)} onOpen={id => setPage({ pluginId: id })} />}
          {page === 'settings' && state && <SettingsPage state={state} onChange={async enabled => { await api.setLaunchAtStartup(enabled); await refreshState() }} />}
          {typeof page !== 'string' && (() => {
            const plugin = installed.get(page.pluginId)
            if (!plugin) return <Loading label="正在载入插件状态" />
            return <div className="plugin-page">
              <div className="plugin-toolbar"><span>{plugin.enabled ? '后台统计已启用' : '此功能已停用'}</span><div><button className="secondary" disabled={busy === plugin.id} onClick={() => void manageEnabled(plugin, !plugin.enabled)}>{plugin.enabled ? '停用' : '启用'}</button><button className="danger-button" disabled={busy === plugin.id} onClick={() => void uninstall(plugin)}>移除</button></div></div>
              {plugin.enabled ? (pluginHtml ? <PluginFrame pluginId={page.pluginId} html={pluginHtml} /> : <Loading label="正在载入插件界面" />) : <div className="plugin-disabled"><Pause size={30} /><h2>功能已停用</h2><p>数据仍保留在本机，重新启用即可继续使用。</p></div>}
            </div>
          })()}
        </section>
      </main>

      {confirmInstall && <InstallDialog plugin={confirmInstall} busy={busy === confirmInstall.id} onCancel={() => setConfirmInstall(null)} onConfirm={() => install(confirmInstall)} />}
    </div>
  )
}

function NavButton({ active, icon, label, status, onClick }: { active: boolean; icon: React.ReactNode; label: string; status?: string; onClick(): void }) {
  return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}><span>{icon}</span><b>{label}</b>{status && <i className={`state-dot ${status}`} />}</button>
}

function Home({ plugins, catalog, onCatalog, onOpen }: { plugins: PluginSummary[]; catalog: CatalogIndex | null; onCatalog(): void; onOpen(id: string): void }) {
  if (plugins.length === 0) return (
    <div className="empty-state">
      <div className="orb"><div className="orb-core"><Boxes size={42} /></div></div>
      <p className="eyebrow">A CLEAN START</p>
      <h2>这是你的空白数字空间</h2>
      <p>只安装你真正需要的功能。每个模块独立运行、清晰授权，随时可以停用或移除。</p>
      <button className="primary" onClick={onCatalog}>浏览功能库 <ChevronRight size={17} /></button>
      <div className="feature-row"><span><ShieldCheck /> 官方签名</span><span><PackageCheck /> 按需安装</span><span><Gauge /> 轻量后台</span></div>
    </div>
  )

  return <div className="dashboard-grid">
    <article className="hero-card"><p className="eyebrow">YOUR DIGITAL WORLD</p><h2>欢迎回来</h2><p>所有数据留在本机。你已安装 {plugins.length} 个功能，其中 {plugins.filter(p => p.enabled).length} 个正在运行。</p><button className="secondary" onClick={onCatalog}>添加功能</button></article>
    <article className="metric-card"><small>已安装功能</small><strong>{plugins.length}</strong><span>功能库共 {catalog?.plugins.length ?? '—'} 项</span></article>
    {plugins.map(plugin => <button key={plugin.id} className="plugin-tile" onClick={() => onOpen(plugin.id)}><div className="tile-icon"><Boxes /></div><div><strong>{plugin.name}</strong><p>{plugin.description}</p></div><span className={`badge ${plugin.state}`}>{plugin.state}</span></button>)}
  </div>
}

function Catalog({ catalog, installed, busy, onInstall, onRefresh, onOpen }: { catalog: CatalogIndex | null; installed: Map<string, PluginSummary>; busy: string | null; onInstall(plugin: CatalogPlugin): void; onRefresh(): void; onOpen(id: string): void }) {
  if (!catalog) return <Loading label="正在连接官方功能库" />
  return <div><div className="section-heading"><div><p>只提供 Digiworld 官方签名功能</p><h2>选择你需要的能力</h2></div><button className="icon-button" onClick={onRefresh}><RefreshCw size={18} /></button></div>
    <div className="catalog-grid">{catalog.plugins.map(plugin => {
      const current = installed.get(plugin.id)
      return <article className="catalog-card" key={plugin.id}>
        <div className="catalog-icon"><span /><Boxes size={30} /></div>
        <div className="catalog-meta"><span>OFFICIAL</span><span>v{plugin.version}</span></div>
        <h3>{plugin.name}</h3><p>{plugin.description}</p>
        <div className="permission-list">{plugin.permissions.map(permission => <span key={permission.id}><Check size={13} />{permissionLabel(permission.id)}</span>)}</div>
        {current
          ? <button className="secondary full" onClick={() => onOpen(plugin.id)}>打开功能 <ChevronRight size={16} /></button>
          : <button className="primary full" disabled={busy === plugin.id} onClick={() => onInstall(plugin)}>{busy === plugin.id ? <LoaderCircle className="spin" /> : <Download size={16} />}安装</button>}
      </article>
    })}</div>
  </div>
}

function SettingsPage({ state, onChange }: { state: AppState; onChange(enabled: boolean): Promise<void> }) {
  const [checking, setChecking] = useState(false)
  return <div className="settings-stack">
    <article className="settings-card"><div><h3>开机后在后台启动</h3><p>仅启动已启用的后台插件，不创建主窗口。</p></div><button className={`switch ${state.launchAtStartup ? 'on' : ''}`} onClick={() => onChange(!state.launchAtStartup)}><span /></button></article>
    <article className="settings-card"><div><h3>核心更新</h3><p>当前版本 {state.version}，更新前始终由你确认。</p></div><button className="secondary" disabled={checking} onClick={async () => { setChecking(true); await api.checkCoreUpdate(); setChecking(false) }}>{checking ? '检查中…' : '检查更新'}</button></article>
    <article className="settings-card"><div><h3>本地诊断</h3><p>导出版本、插件状态和脱敏日志，不包含键盘统计或凭据。</p></div><button className="secondary" onClick={() => api.exportDiagnostics()}>导出诊断</button></article>
    <article className="about-card"><span className="brand-mark"><Sparkles size={19} /></span><div><h3>Digiworld</h3><p>本地优先的模块化桌面工具平台 · MIT License</p></div></article>
  </div>
}

function InstallDialog({ plugin, busy, onCancel, onConfirm }: { plugin: CatalogPlugin; busy: boolean; onCancel(): void; onConfirm(): void }) {
  return <div className="modal-backdrop"><div className="modal"><div className="modal-icon"><ShieldCheck /></div><p className="eyebrow">PERMISSION REVIEW</p><h2>安装 {plugin.name}</h2><p>{plugin.description}</p><h4>这个功能需要：</h4><div className="permission-dialog">{plugin.permissions.map(permission => <div key={permission.id}><Check /><span><strong>{permissionLabel(permission.id)}</strong><small>{permission.reason}</small></span></div>)}</div><p className="trust-note">这是 Digiworld 官方签名的原生功能。启用后，其后台进程将以当前用户权限运行。</p><div className="modal-actions"><button className="secondary" disabled={busy} onClick={onCancel}>取消</button><button className="primary" disabled={busy} onClick={onConfirm}>{busy ? <LoaderCircle className="spin" /> : <Download />}同意并安装</button></div></div></div>
}

function Loading({ label }: { label: string }) { return <div className="loading"><LoaderCircle className="spin" /><span>{label}</span></div> }

export default App
