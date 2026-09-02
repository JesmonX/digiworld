import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Boxes, Check, ChevronRight, CircleAlert, Download, Gauge, Library,
  LoaderCircle, Network, Pause, RefreshCw, Settings, ShieldCheck,
} from 'lucide-react'
import { suppressContextMenu, type CatalogIndex, type CatalogPlugin, type PluginSummary } from '@digiworld/plugin-sdk'
import { PluginFrame } from './components/PluginFrame'
import { WindowChrome } from './components/WindowChrome'
import { api, type AppState, type ProxyMode, type ProxySettings } from './lib/api'
import './styles.css'

type Page = 'home' | 'catalog' | 'settings' | { pluginId: string }

function permissionLabel(id: string): string {
  const labels: Record<string, string> = {
    'background': '后台运行',
    'global-input': '读取全局键位事件',
    'plugin-storage': '本地插件存储',
    'filesystem:agent-session-data': '读取 Coding Agent 会话数据',
    'process:ssh': '使用系统 SSH',
  }
  return labels[id] ?? id
}

function stateLabel(plugin: PluginSummary): string {
  if (!plugin.enabled || plugin.state === 'disabled') return '已停用'
  const labels: Partial<Record<PluginSummary['state'], string>> = {
    installed: '已安装',
    starting: '启动中',
    running: '运行中',
    paused: '已暂停',
    failed: '异常',
  }
  return labels[plugin.state] ?? plugin.state
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

  useEffect(() => suppressContextMenu(), [])

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
  const selectedPlugin = typeof page === 'string' ? undefined : installed.get(page.pluginId)

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
    if (!window.confirm(`移除“${plugin.name}”？统计数据会保留。`)) return
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

  const pageTitle = typeof page === 'string'
    ? { home: '概览', catalog: '功能库', settings: '设置' }[page]
    : selectedPlugin?.name ?? '插件'
  const pluginOpen = typeof page !== 'string'

  return (
    <div className={`app-window ${pluginOpen ? 'plugin-open' : ''}`}>
      <WindowChrome />
      <div className="app-shell">
        <aside className="sidebar">
          <nav>
            <NavButton active={page === 'home'} icon={<Gauge />} label="概览" onClick={() => setPage('home')} />
            <NavButton active={page === 'catalog'} icon={<Library />} label="功能库" onClick={() => setPage('catalog')} />
            {state?.plugins.map(plugin => (
              <NavButton key={plugin.id} active={pluginOpen && page.pluginId === plugin.id}
                icon={<Boxes />} label={plugin.name} status={plugin.state} onClick={() => setPage({ pluginId: plugin.id })} />
            ))}
          </nav>
          <div className="sidebar-bottom">
            <NavButton active={page === 'settings'} icon={<Settings />} label="设置" onClick={() => setPage('settings')} />
          </div>
        </aside>

        <main className="main">
          <header className="topbar">
            <h1>{pageTitle}</h1>
            {selectedPlugin && (
              <div className="plugin-management">
                <span className={`compact-status ${selectedPlugin.state}`}>{stateLabel(selectedPlugin)}</span>
                <button className="secondary compact" disabled={busy === selectedPlugin.id} onClick={() => void manageEnabled(selectedPlugin, !selectedPlugin.enabled)}>
                  {selectedPlugin.enabled ? '停用' : '启用'}
                </button>
                <button className="danger-button" disabled={busy === selectedPlugin.id} onClick={() => void uninstall(selectedPlugin)}>移除</button>
              </div>
            )}
          </header>

          {error && <div className="error-banner"><CircleAlert /><span>{error}</span><button onClick={() => setError(null)}>关闭</button></div>}

          <section className="content">
            {page === 'home' && <Home plugins={state?.plugins ?? []} onCatalog={() => setPage('catalog')} onOpen={id => setPage({ pluginId: id })} />}
            {page === 'catalog' && <Catalog catalog={catalog} installed={installed} busy={busy} onInstall={setConfirmInstall} onRefresh={() => refreshCatalog(true)} onOpen={id => setPage({ pluginId: id })} />}
            {page === 'settings' && state && <SettingsPage state={state} onChange={async enabled => { await api.setLaunchAtStartup(enabled); await refreshState() }} />}
            {pluginOpen && (
              !selectedPlugin ? <Loading label="载入插件" />
                : selectedPlugin.enabled
                  ? (pluginHtml ? <PluginFrame pluginId={page.pluginId} html={pluginHtml} /> : <Loading label="载入界面" />)
                  : <div className="plugin-disabled"><Pause /><h2>已停用</h2></div>
            )}
          </section>
        </main>
      </div>

      {confirmInstall && <InstallDialog plugin={confirmInstall} busy={busy === confirmInstall.id} onCancel={() => setConfirmInstall(null)} onConfirm={() => void install(confirmInstall)} />}
    </div>
  )
}

function NavButton({ active, icon, label, status, onClick }: { active: boolean; icon: React.ReactNode; label: string; status?: string; onClick(): void }) {
  return <button title={label} className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}><span>{icon}</span><b>{label}</b>{status && <i className={`state-dot ${status}`} />}</button>
}

function Home({ plugins, onCatalog, onOpen }: { plugins: PluginSummary[]; onCatalog(): void; onOpen(id: string): void }) {
  if (plugins.length === 0) return (
    <div className="empty-state">
      <div className="empty-icon"><Boxes /></div>
      <h2>还没有安装功能</h2>
      <p>从功能库选择需要的工具。</p>
      <button className="primary" onClick={onCatalog}>浏览功能库 <ChevronRight /></button>
    </div>
  )

  return (
    <div className="installed-section">
      <div className="section-heading">
        <h2>已安装</h2>
        <button className="secondary" onClick={onCatalog}>添加功能</button>
      </div>
      <div className="installed-list">
        {plugins.map(plugin => (
          <button key={plugin.id} className="plugin-row" onClick={() => onOpen(plugin.id)}>
            <span className="row-icon"><Boxes /></span>
            <strong>{plugin.name}</strong>
            <span className={`compact-status ${plugin.state}`}>{stateLabel(plugin)}</span>
            <ChevronRight className="row-chevron" />
          </button>
        ))}
      </div>
    </div>
  )
}

function Catalog({ catalog, installed, busy, onInstall, onRefresh, onOpen }: { catalog: CatalogIndex | null; installed: Map<string, PluginSummary>; busy: string | null; onInstall(plugin: CatalogPlugin): void; onRefresh(): void; onOpen(id: string): void }) {
  if (!catalog) return <Loading label="载入功能库" />
  return (
    <div>
      <div className="section-heading">
        <h2>可用功能</h2>
        <button className="icon-button" aria-label="刷新功能库" title="刷新" onClick={onRefresh}><RefreshCw /></button>
      </div>
      <div className="catalog-grid">
        {catalog.plugins.map(plugin => {
          const current = installed.get(plugin.id)
          return (
            <article className="catalog-card" key={plugin.id}>
              <div className="catalog-title"><span className="catalog-icon"><Boxes /></span><small>v{plugin.version}</small></div>
              <h3>{plugin.name}</h3>
              <p>{plugin.description}</p>
              {current
                ? <button className="secondary full" onClick={() => onOpen(plugin.id)}>打开 <ChevronRight /></button>
                : <button className="primary full" disabled={busy === plugin.id} onClick={() => onInstall(plugin)}>{busy === plugin.id ? <LoaderCircle className="spin" /> : <Download />}安装</button>}
            </article>
          )
        })}
      </div>
    </div>
  )
}

function SettingsPage({ state, onChange }: { state: AppState; onChange(enabled: boolean): Promise<void> }) {
  const [checking, setChecking] = useState(false)
  const [proxy, setProxy] = useState<ProxySettings>({ mode: 'system' })
  const [proxyBusy, setProxyBusy] = useState<'save' | 'test' | null>(null)
  const [proxyMessage, setProxyMessage] = useState<string | null>(null)

  useEffect(() => {
    api.proxySettings().then(setProxy).catch(reason => setProxyMessage(String(reason)))
  }, [])

  const updateMode = (mode: ProxyMode) => setProxy(current => mode === 'custom'
    ? (current.url ? { mode, url: current.url } : { mode })
    : { mode })

  const runProxyAction = async (action: 'save' | 'test') => {
    setProxyBusy(action)
    setProxyMessage(null)
    try {
      if (action === 'save') {
        setProxy(await api.setProxySettings(proxy))
        setProxyMessage('代理设置已保存')
      } else {
        const result = await api.testProxySettings(proxy)
        setProxyMessage(`连接成功 · ${result.latencyMs} ms`)
      }
    } catch (reason) {
      setProxyMessage(String(reason))
    } finally {
      setProxyBusy(null)
    }
  }

  return (
    <div className="settings-stack">
      <article className="settings-card"><div><h3>开机启动</h3><p>在后台启动已启用的插件</p></div><button aria-label="切换开机启动" className={`switch ${state.launchAtStartup ? 'on' : ''}`} onClick={() => void onChange(!state.launchAtStartup)}><span /></button></article>
      <article className="settings-card proxy-card">
        <div className="proxy-copy">
          <h3><Network />网络代理</h3>
          <p>用于功能库、程序更新和声明网络权限的插件</p>
          <div className="proxy-modes" role="group" aria-label="代理模式">
            {([['system', '系统代理'], ['custom', '自定义'], ['direct', '直连']] as const).map(([mode, label]) => (
              <button key={mode} className={proxy.mode === mode ? 'active' : ''} aria-pressed={proxy.mode === mode} onClick={() => updateMode(mode)}>{label}</button>
            ))}
          </div>
          {proxy.mode === 'custom' && <input aria-label="自定义代理地址" value={proxy.url ?? ''} onChange={event => setProxy({ mode: 'custom', url: event.target.value })} placeholder="http://127.0.0.1:7890" />}
          {proxyMessage && <small className="proxy-message">{proxyMessage}</small>}
        </div>
        <div className="proxy-actions"><button className="secondary" disabled={proxyBusy !== null} onClick={() => void runProxyAction('test')}>{proxyBusy === 'test' ? '测试中…' : '测试连接'}</button><button className="primary" disabled={proxyBusy !== null} onClick={() => void runProxyAction('save')}>{proxyBusy === 'save' ? '保存中…' : '保存'}</button></div>
      </article>
      <article className="settings-card"><div><h3>核心更新</h3><p>当前版本 {state.version}</p></div><button className="secondary" disabled={checking} onClick={async () => { setChecking(true); await api.checkCoreUpdate(); setChecking(false) }}>{checking ? '检查中…' : '检查更新'}</button></article>
      <article className="settings-card"><div><h3>诊断信息</h3><p>导出版本、插件状态和日志</p></div><button className="secondary" onClick={() => void api.exportDiagnostics()}>导出</button></article>
      <div className="version-line"><ShieldCheck /> Digiworld {state.version}</div>
    </div>
  )
}

function InstallDialog({ plugin, busy, onCancel, onConfirm }: { plugin: CatalogPlugin; busy: boolean; onCancel(): void; onConfirm(): void }) {
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="install-title">
        <div className="modal-icon"><ShieldCheck /></div>
        <h2 id="install-title">安装 {plugin.name}</h2>
        <div className="permission-dialog">
          {plugin.permissions.map(permission => <div key={permission.id}><Check /><span><strong>{permissionLabel(permission.id)}</strong><small>{permission.reason}</small></span></div>)}
        </div>
        <div className="modal-actions"><button className="secondary" disabled={busy} onClick={onCancel}>取消</button><button className="primary" disabled={busy} onClick={onConfirm}>{busy ? <LoaderCircle className="spin" /> : <Download />}安装</button></div>
      </div>
    </div>
  )
}

function Loading({ label }: { label: string }) {
  return <div className="loading"><LoaderCircle className="spin" /><span>{label}</span></div>
}

export default App
