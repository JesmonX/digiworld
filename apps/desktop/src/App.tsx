import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Boxes, Check, ChevronRight, CircleAlert, Download, Gauge, Library,
  LoaderCircle, Network, Palette, Pause, RefreshCw, Settings, ShieldCheck,
} from 'lucide-react'
import { suppressContextMenu, type CatalogIndex, type CatalogPlugin, type PluginSummary } from '@digiworld/plugin-sdk'
import { PluginFrame } from './components/PluginFrame'
import { WindowChrome } from './components/WindowChrome'
import {
  api, type AppState, type CoreUpdateInfo, type PluginUpdateInfo, type ProxyMode,
  type ProxySettings, type UpdateProgress,
} from './lib/api'
import {
  ACCENT_THEMES, accentThemeStyle, getAccentTheme, loadAccentThemeId, pluginTheme,
  saveAccentThemeId, type AccentThemeId,
} from './theme'
import './styles.css'

type Page = 'home' | 'catalog' | 'settings' | { pluginId: string }

function permissionLabel(id: string): string {
  const labels: Record<string, string> = {
    'background': '后台运行',
    'global-input': '读取全局键位事件',
    'plugin-storage': '本地插件存储',
    'filesystem:agent-session-data': '读取 Coding Agent 会话数据',
    'process:ssh': '使用系统 SSH',
    'process:shell': '运行已配置的系统 Shell',
    'network:openai': '访问 OpenAI Codex 服务',
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
  const [updateProgress, setUpdateProgress] = useState<UpdateProgress | null>(null)
  const [accentThemeId, setAccentThemeId] = useState<AccentThemeId>(loadAccentThemeId)
  const accentTheme = getAccentTheme(accentThemeId)
  const activePluginTheme = useMemo(() => pluginTheme(accentTheme), [accentTheme])

  useEffect(() => saveAccentThemeId(accentThemeId), [accentThemeId])

  const refreshState = useCallback(async () => setState(await api.appState()), [])
  const refreshCatalog = useCallback(async (force = false) => setCatalog(await api.catalog(force)), [])

  useEffect(() => suppressContextMenu(), [])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    void api.onUpdateProgress(progress => setUpdateProgress(progress)).then(stop => {
      if (disposed) stop()
      else unlisten = stop
    }).catch(reason => setError(String(reason)))
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

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
    <div className={`app-window ${pluginOpen ? 'plugin-open' : ''}`} style={accentThemeStyle(accentTheme)}>
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
            {page === 'settings' && state && <SettingsPage state={state} progress={updateProgress} onProgressReset={() => setUpdateProgress(null)} onPluginsUpdated={refreshState} accentThemeId={accentThemeId} onAccentThemeChange={setAccentThemeId} onChange={async enabled => { await api.setLaunchAtStartup(enabled); await refreshState() }} />}
            {pluginOpen && (
              !selectedPlugin ? <Loading label="载入插件" />
                : selectedPlugin.enabled
                  ? (pluginHtml ? <PluginFrame pluginId={page.pluginId} html={pluginHtml} theme={activePluginTheme} /> : <Loading label="载入界面" />)
                  : <div className="plugin-disabled"><Pause /><h2>已停用</h2></div>
            )}
          </section>
        </main>
      </div>

      {confirmInstall && <InstallDialog plugin={confirmInstall} busy={busy === confirmInstall.id} progress={updateProgress?.operation === 'plugin-install' && updateProgress.itemId === confirmInstall.id ? updateProgress : null} onCancel={() => setConfirmInstall(null)} onConfirm={() => { setUpdateProgress(null); void install(confirmInstall) }} />}
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

type UpdateDialog =
  | { kind: 'plugins'; updates: PluginUpdateInfo[] }
  | { kind: 'core'; update: CoreUpdateInfo }

function SettingsPage({ state, progress, onProgressReset, onPluginsUpdated, accentThemeId, onAccentThemeChange, onChange }: {
  state: AppState
  progress: UpdateProgress | null
  onProgressReset(): void
  onPluginsUpdated(): Promise<void>
  accentThemeId: AccentThemeId
  onAccentThemeChange(id: AccentThemeId): void
  onChange(enabled: boolean): Promise<void>
}) {
  const [proxy, setProxy] = useState<ProxySettings>({ mode: 'system' })
  const [proxyBusy, setProxyBusy] = useState<'save' | 'test' | null>(null)
  const [proxyMessage, setProxyMessage] = useState<string | null>(null)
  const [updateBusy, setUpdateBusy] = useState<'plugin-check' | 'plugin-install' | 'core-check' | 'core-install' | null>(null)
  const [pluginMessage, setPluginMessage] = useState<string | null>(null)
  const [coreMessage, setCoreMessage] = useState<string | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [updateDialog, setUpdateDialog] = useState<UpdateDialog | null>(null)

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

  const checkPluginUpdates = async () => {
    setUpdateBusy('plugin-check')
    setPluginMessage(null)
    setUpdateError(null)
    try {
      const updates = await api.checkPluginUpdates()
      if (updates.length === 0) setPluginMessage('所有插件均为最新版本')
      else setUpdateDialog({ kind: 'plugins', updates })
    } catch (reason) {
      setPluginMessage(String(reason))
    } finally {
      setUpdateBusy(null)
    }
  }

  const checkCoreUpdate = async () => {
    setUpdateBusy('core-check')
    setCoreMessage(null)
    setUpdateError(null)
    try {
      const update = await api.checkCoreUpdate()
      if (update) setUpdateDialog({ kind: 'core', update })
      else setCoreMessage('当前已是最新版本')
    } catch (reason) {
      setCoreMessage(String(reason))
    } finally {
      setUpdateBusy(null)
    }
  }

  const confirmUpdate = async () => {
    if (!updateDialog) return
    setUpdateError(null)
    onProgressReset()
    if (updateDialog.kind === 'plugins') {
      const compatible = updateDialog.updates.filter(update => update.compatible)
      if (compatible.length === 0) {
        setUpdateError('这些插件需要更新 Digiworld 主程序后才能安装')
        return
      }
      setUpdateBusy('plugin-install')
      try {
        await api.installPluginUpdates(compatible.map(({ id, version }) => ({ id, version })))
        await onPluginsUpdated()
        setPluginMessage(`已更新 ${compatible.length} 个插件`)
        setUpdateDialog(null)
      } catch (reason) {
        setUpdateError(String(reason))
      } finally {
        setUpdateBusy(null)
      }
      return
    }

    setUpdateBusy('core-install')
    try {
      await api.installCoreUpdate(updateDialog.update.version)
    } catch (reason) {
      setUpdateError(String(reason))
      setUpdateBusy(null)
    }
  }

  return (
    <div className="settings-stack">
      <article className="settings-card theme-card">
        <div className="theme-copy">
          <h3><Palette />主题颜色</h3>
          <p>选择按钮、选中状态和图表的强调色，界面仍保持浅色</p>
        </div>
        <div className="theme-options" role="radiogroup" aria-label="主题颜色">
          {ACCENT_THEMES.map(theme => (
            <button
              key={theme.id}
              type="button"
              className={accentThemeId === theme.id ? 'active' : ''}
              role="radio"
              aria-checked={accentThemeId === theme.id}
              aria-label={theme.label}
              title={theme.label}
              style={{ '--theme-swatch': theme.accent } as React.CSSProperties}
              onClick={() => onAccentThemeChange(theme.id)}
            >
              <span />
              <small>{theme.label}</small>
              {accentThemeId === theme.id && <Check />}
            </button>
          ))}
        </div>
      </article>
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
      <article className="settings-card update-card">
        <div><h3>插件更新</h3><p>一次检查并更新所有已安装插件，通过上方已保存的代理连接</p>{pluginMessage && <small className="update-message">{pluginMessage}</small>}</div>
        <button className="secondary" disabled={updateBusy !== null} onClick={() => void checkPluginUpdates()}>{updateBusy === 'plugin-check' ? <><LoaderCircle className="spin" />检查中…</> : '检查全部插件'}</button>
      </article>
      <article className="settings-card update-card">
        <div><h3>主程序更新</h3><p>当前版本 {state.version}，检查后由你确认是否下载和安装</p>{coreMessage && <small className="update-message">{coreMessage}</small>}</div>
        <button className="secondary" disabled={updateBusy !== null} onClick={() => void checkCoreUpdate()}>{updateBusy === 'core-check' ? <><LoaderCircle className="spin" />检查中…</> : '检查主程序'}</button>
      </article>
      <article className="settings-card"><div><h3>诊断信息</h3><p>导出版本、插件状态和日志</p></div><button className="secondary" onClick={() => void api.exportDiagnostics()}>导出</button></article>
      <div className="version-line"><ShieldCheck /> Digiworld {state.version}</div>
      {updateDialog && (
        <UpdateDialogView
          dialog={updateDialog}
          busy={updateBusy === 'plugin-install' || updateBusy === 'core-install'}
          progress={progress}
          error={updateError}
          onCancel={() => { if (!updateBusy) setUpdateDialog(null) }}
          onConfirm={() => void confirmUpdate()}
        />
      )}
    </div>
  )
}

function InstallDialog({ plugin, busy, progress, onCancel, onConfirm }: { plugin: CatalogPlugin; busy: boolean; progress: UpdateProgress | null; onCancel(): void; onConfirm(): void }) {
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="install-title">
        <div className="modal-icon"><ShieldCheck /></div>
        <h2 id="install-title">安装 {plugin.name}</h2>
        <div className="permission-dialog">
          {plugin.permissions.map(permission => <div key={permission.id}><Check /><span><strong>{permissionLabel(permission.id)}</strong><small>{permission.reason}</small></span></div>)}
        </div>
        {busy && <ProgressView progress={progress} fallbackName={plugin.name} />}
        <div className="modal-actions"><button className="secondary" disabled={busy} onClick={onCancel}>取消</button><button className="primary" disabled={busy} onClick={onConfirm}>{busy ? <LoaderCircle className="spin" /> : <Download />}安装</button></div>
      </div>
    </div>
  )
}

function UpdateDialogView({ dialog, busy, progress, error, onCancel, onConfirm }: { dialog: UpdateDialog; busy: boolean; progress: UpdateProgress | null; error: string | null; onCancel(): void; onConfirm(): void }) {
  const isPlugins = dialog.kind === 'plugins'
  const compatibleCount = isPlugins ? dialog.updates.filter(update => update.compatible).length : 1
  const matchingProgress = progress && (
    (isPlugins && progress.operation === 'plugin-update') ||
    (!isPlugins && progress.operation === 'core-update')
  ) ? progress : null
  return (
    <div className="modal-backdrop">
      <div className="modal update-modal" role="dialog" aria-modal="true" aria-labelledby="update-title">
        <div className="modal-icon"><Download /></div>
        <h2 id="update-title">{isPlugins ? `发现 ${dialog.updates.length} 个插件更新` : `发现 Digiworld ${dialog.update.version}`}</h2>
        {isPlugins ? (
          <div className="update-list">
            {dialog.updates.map(update => (
              <div key={update.id} className={!update.compatible ? 'incompatible' : ''}>
                <span><strong>{update.name}</strong><small>{update.currentVersion} → {update.version}</small></span>
                <span className="update-flags">
                  {update.permissionsChanged && <small>权限有变化</small>}
                  {!update.compatible && <small>需 Digiworld {update.minCoreVersion}</small>}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="core-release-notes">
            <p>{stateVersionLabel(dialog.update.version)}</p>
            {dialog.update.notes && <pre>{dialog.update.notes}</pre>}
          </div>
        )}
        {!busy && <p className="consent-copy">检查更新不会自动安装。点击下方按钮后才会通过当前代理下载并安装。</p>}
        {busy && <ProgressView progress={matchingProgress} fallbackName={isPlugins ? '插件更新' : `Digiworld ${dialog.update.version}`} />}
        {error && <div className="update-error"><CircleAlert />{error}</div>}
        <div className="modal-actions">
          <button className="secondary" disabled={busy} onClick={onCancel}>取消</button>
          <button className="primary" disabled={busy || compatibleCount === 0} onClick={onConfirm}>
            {busy ? <LoaderCircle className="spin" /> : <Download />}
            {busy ? '正在更新…' : isPlugins ? `同意并更新 ${compatibleCount} 项` : '同意并更新'}
          </button>
        </div>
      </div>
    </div>
  )
}

function stateVersionLabel(version: string) {
  return `将下载并安装版本 ${version}，安装完成后 Digiworld 会重启。`
}

function ProgressView({ progress, fallbackName }: { progress: UpdateProgress | null; fallbackName: string }) {
  const downloading = progress?.stage === 'downloading'
  const percent = downloading && progress.total
    ? Math.min(100, Math.round(progress.downloaded / progress.total * 100))
    : null
  const stageLabel = !progress ? '准备下载' : downloading ? '正在下载' : progress.stage === 'completed' ? '安装完成' : '正在安装'
  const currentItem = progress?.stage === 'completed' ? progress.completedItems : (progress?.completedItems ?? 0) + 1
  const itemCount = progress && progress.totalItems > 1 ? ` · ${Math.min(currentItem, progress.totalItems)}/${progress.totalItems}` : ''
  return (
    <div className="update-progress" aria-live="polite">
      <div><strong>{stageLabel}{itemCount}</strong><span>{progress?.itemName ?? fallbackName}</span></div>
      <div className={`progress-track ${percent === null ? 'indeterminate' : ''}`} role="progressbar" aria-label={`${stageLabel}进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
        <span style={percent === null ? undefined : { width: `${percent}%` }} />
      </div>
      {downloading && <small>{formatBytes(progress.downloaded)}{progress.total ? ` / ${formatBytes(progress.total)} · ${percent}%` : ''}</small>}
    </div>
  )
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function Loading({ label }: { label: string }) {
  return <div className="loading"><LoaderCircle className="spin" /><span>{label}</span></div>
}

export default App
