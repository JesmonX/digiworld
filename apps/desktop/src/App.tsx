import { Button, Input, Card, Dialog, Switch, Status, RadioGroup } from '@digiworld/design-system/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  Activity, AlertTriangle, BarChart3, Boxes, Check, ChevronRight, CircleAlert, Download, Gauge, MoreHorizontal,
  CalendarDays, GitBranch, Keyboard, Library, LoaderCircle, Mail, Network, Palette, Pause, RefreshCw, Server, Settings,
  ShieldCheck, Type, type LucideIcon,
} from 'lucide-react'
import { suppressContextMenu, type CatalogIndex, type CatalogPlugin, type PluginSummary } from '@digiworld/plugin-sdk'
import { PluginFrame } from './components/PluginFrame'
import { WindowChrome } from './components/WindowChrome'
import {
  api, type AppState, type CoreUpdateInfo, type PluginUpdateInfo, type ProxyMode,
  type ProxySettings, type UpdateProgress,
} from './lib/api'
import {
  ACCENT_THEMES, FONT_THEMES, COLOR_SCHEMES, getColorSchemePreview, themeStyle, loadTextScale, saveTextScale,
  type TextScale, type ColorSchemeId, getAccentTheme, getFontTheme, loadAccentThemeId, loadColorSchemeId,
  loadFontThemeId, loadFontWeight, pluginTheme, saveAccentThemeId, saveColorSchemeId, saveFontThemeId,
  saveFontWeight, loadGlassMode, saveGlassMode, type AccentThemeId, type FontThemeId, type FontWeight, type GlassMode,
} from './theme'
import './styles.css'

type Page = 'home' | 'catalog' | 'settings' | { pluginId: string }

const PROXY_TEST_DEADLINE_MS = 20_000
const UPDATE_CHECK_DEADLINE_MS = 35_000

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function withDeadline<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(message)), timeoutMs)
    operation.then(
      value => { window.clearTimeout(timeout); resolve(value) },
      reason => { window.clearTimeout(timeout); reject(reason) },
    )
  })
}

function permissionLabel(id: string): string {
  const labels: Record<string, string> = {
    'background': '后台运行',
    'global-input': '读取全局键位事件',
    'plugin-storage': '本地插件存储',
    'filesystem:agent-session-data': '读取 Coding Agent 会话数据',
    'process:ssh': '使用系统 SSH',
    'process:shell': '运行已配置的系统 Shell',
    'network:openai': '访问 OpenAI Codex 服务',
    'network:imap': '访问 IMAP 邮箱服务',
    'network:github': '访问 GitHub 服务',
    'network:icloud': '访问 iCloud 日历服务',
    'notifications': '显示系统通知',
    'secret:mail-credentials': '保存邮箱授权码',
    'secret:github-token': '保存 GitHub Token',
    'secret:icloud-app-password': '保存 iCloud App 专用密码',
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

function ChatGptIcon({ className, 'aria-hidden': ariaHidden, 'data-plugin-icon': dataPluginIcon }: { className?: string; 'aria-hidden'?: boolean | 'true' | 'false'; 'data-plugin-icon'?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="currentColor"
      className={className}
      aria-hidden={ariaHidden}
      data-plugin-icon={dataPluginIcon}
    >
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.6069 1.4997-2.602-1.4997z" />
    </svg>
  )
}

type PluginIconType = LucideIcon | React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false'; 'data-plugin-icon'?: string }>

const pluginIconMap: Record<string, PluginIconType> = {
  keyboard: Keyboard,
  tokens: BarChart3,
  chatgpt: ChatGptIcon,
  mail: Mail,
  'git-branch': GitBranch,
  server: Server,
  'calendar-days': CalendarDays,
  default: Boxes,
}

function pluginIconKey(plugin: { id: string; icon?: string }): string {
  if (plugin.icon && pluginIconMap[plugin.icon]) return plugin.icon
  if (plugin.id.includes('keyboard')) return 'keyboard'
  if (plugin.id.includes('agent-token')) return 'chatgpt'
  if (plugin.id.includes('mail')) return 'mail'
  return 'default'
}

function PluginIcon({ plugin }: { plugin: { id: string; icon?: string } }) {
  const key = pluginIconKey(plugin)
  const Icon = pluginIconMap[key] ?? Boxes
  return <Icon aria-hidden="true" data-plugin-icon={key} />
}

function App() {
  const reduceMotion = useReducedMotion()
  const [state, setState] = useState<AppState | null>(null)
  const [catalog, setCatalog] = useState<CatalogIndex | null>(null)
  const [page, setPage] = useState<Page>('home')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const isDesignPreview = typeof window !== 'undefined' && (
    window.location.pathname.includes('design.html') || window.location.search.includes('state=')
  )
  const [pluginHtmlMap, setPluginHtmlMap] = useState<Record<string, { version: string; html: string }>>({})
  const [openedPluginIds, setOpenedPluginIds] = useState<string[]>([])
  const [confirmInstall, setConfirmInstall] = useState<CatalogPlugin | null>(null)
  const [updateProgress, setUpdateProgress] = useState<UpdateProgress | null>(null)
  const [accentThemeId, setAccentThemeId] = useState<AccentThemeId>(loadAccentThemeId)
  const [colorSchemeId, setColorSchemeId] = useState<ColorSchemeId>(loadColorSchemeId)
  const [fontThemeId, setFontThemeId] = useState<FontThemeId>(loadFontThemeId)
  const [fontWeight, setFontWeight] = useState<FontWeight>(loadFontWeight)
  const [glassMode, setGlassMode] = useState<GlassMode>(loadGlassMode)
  const [textScale, setTextScale] = useState<TextScale>(loadTextScale)
  const [pluginMenuOpen, setPluginMenuOpen] = useState(false)
  useEffect(() => saveTextScale(textScale), [textScale])
  const accentTheme = getAccentTheme(accentThemeId, colorSchemeId)
  const fontTheme = getFontTheme(fontThemeId)
  const activeTheme = useMemo(() => pluginTheme(accentTheme, fontTheme, fontWeight, glassMode, textScale), [accentTheme, fontTheme, fontWeight, glassMode, textScale])

  useEffect(() => {
    for (const [key, value] of Object.entries(activeTheme)) if (value !== undefined) document.documentElement.style.setProperty('--dw-' + key, value)
    document.documentElement.style.colorScheme = activeTheme['color-scheme']
    document.documentElement.dataset.dwGlass = glassMode
  }, [activeTheme, glassMode])

  useEffect(() => saveAccentThemeId(accentThemeId), [accentThemeId])
  useEffect(() => saveColorSchemeId(colorSchemeId), [colorSchemeId])
  useEffect(() => saveFontThemeId(fontThemeId), [fontThemeId])
  useEffect(() => saveFontWeight(fontWeight), [fontWeight])
  useEffect(() => saveGlassMode(glassMode), [glassMode])

  const refreshState = useCallback(async () => setState(await api.appState()), [])
  const refreshCatalog = useCallback(async (force = false) => setCatalog(await api.catalog(force)), [])

  useEffect(() => suppressContextMenu(), [])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    void api.onUpdateProgress(progress => setUpdateProgress(progress)).then(stop => {
      if (disposed) stop()
      else unlisten = stop
    }).catch(reason => setError(errorMessage(reason)))
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  useEffect(() => {
    Promise.all([refreshState(), refreshCatalog()]).catch(reason => setError(errorMessage(reason)))
  }, [refreshCatalog, refreshState])

  const installed = useMemo(() => new Map(state?.plugins.map(plugin => [plugin.id, plugin]) ?? []), [state])
  const selectedPlugin = typeof page === 'string' ? undefined : installed.get(page.pluginId)

  useEffect(() => {
    if (typeof page === 'string') return
    const id = page.pluginId
    const currentVersion = installed.get(id)?.version
    if (isDesignPreview) {
      setOpenedPluginIds([id])
    } else {
      setOpenedPluginIds(prev => prev.includes(id) ? prev : [...prev, id])
    }
    const cached = pluginHtmlMap[id]
    if (!cached || (currentVersion && cached.version !== currentVersion)) {
      api.pluginUi(id)
        .then(html => setPluginHtmlMap(prev => ({ ...prev, [id]: { version: currentVersion ?? '', html } })))
        .catch(reason => setError(errorMessage(reason)))
    }
  }, [page, isDesignPreview, pluginHtmlMap, installed])

  const install = async (plugin: CatalogPlugin) => {
    setBusy(plugin.id)
    setError(null)
    try {
      await api.install(plugin.id, plugin.version)
      await refreshState()
      setConfirmInstall(null)
      setPage({ pluginId: plugin.id })
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(null)
    }
  }

  const manageEnabled = async (plugin: PluginSummary, enabled: boolean) => {
    setBusy(plugin.id)
    setError(null)
    try {
      await api.setEnabled(plugin.id, enabled)
      if (!enabled) {
        setOpenedPluginIds(prev => prev.filter(id => id !== plugin.id))
      }
      await refreshState()
    } catch (reason) {
      setError(errorMessage(reason))
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
      setOpenedPluginIds(prev => prev.filter(id => id !== plugin.id))
      setPluginHtmlMap(prev => {
        const next = { ...prev }
        delete next[plugin.id]
        return next
      })
      await refreshState()
      setPage('home')
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(null)
    }
  }

  const pageTitle = typeof page === 'string'
    ? { home: '概览', catalog: '功能库', settings: '设置' }[page]
    : selectedPlugin?.name ?? '插件'
  const pluginOpen = typeof page !== 'string'

  useEffect(() => setPluginMenuOpen(false), [page])

  return (
    <div className={`app-window glass-${glassMode} ${pluginOpen ? 'plugin-open' : ''}`} data-dw-glass={glassMode} style={themeStyle(activeTheme)}>
      <WindowChrome />
      <div className="app-shell">
        <aside className="sidebar">
          <div className="sidebar-scroll">
            <SidebarGroup label="工作台">
              <NavButton active={page === 'home'} icon={<Gauge />} label="概览" onClick={() => setPage('home')} />
              <NavButton active={page === 'catalog'} icon={<Library />} label="功能库" onClick={() => setPage('catalog')} />
            </SidebarGroup>
            {state?.plugins.length ? (
              <SidebarGroup label="已安装">
                {state.plugins.map(plugin => (
                  <NavButton key={plugin.id} active={pluginOpen && page.pluginId === plugin.id}
                    icon={<PluginIcon plugin={plugin} />} label={plugin.name} status={plugin.state} onClick={() => setPage({ pluginId: plugin.id })} />
                ))}
              </SidebarGroup>
            ) : null}
          </div>
          <div className="sidebar-bottom">
            <SidebarGroup label="系统">
              <NavButton active={page === 'settings'} icon={<Settings />} label="设置" onClick={() => setPage('settings')} />
            </SidebarGroup>
          </div>
        </aside>

        <main className="main">
          <header className="topbar">
            <h1>{pageTitle}</h1>
            {selectedPlugin && (
              <div className="plugin-management">
                <span className={`compact-status ${selectedPlugin.state}`}>{stateLabel(selectedPlugin)}</span>
                <Button className="secondary compact" disabled={busy === selectedPlugin.id} onClick={() => void manageEnabled(selectedPlugin, !selectedPlugin.enabled)}>
                  {selectedPlugin.enabled ? '停用' : '启用'}
                </Button>
                <div className="plugin-more">
                  <Button className="secondary compact icon-button" aria-label="更多插件操作" aria-expanded={pluginMenuOpen} onClick={() => setPluginMenuOpen(open => !open)}><MoreHorizontal /></Button>
                  {pluginMenuOpen && <div className="plugin-more-menu" role="menu">
                    <Button role="menuitem" className="danger-button" disabled={busy === selectedPlugin.id} onClick={() => { setPluginMenuOpen(false); void uninstall(selectedPlugin) }}>移除插件</Button>
                  </div>}
                </div>
              </div>
            )}
          </header>

          {error && <Status tone="error" className="error-banner"><CircleAlert /><span>{error}</span><Button onClick={() => setError(null)}>关闭</Button></Status>}

          <section className="content">
            {!pluginOpen && (
              <AnimatePresence initial={false} mode={reduceMotion ? 'sync' : 'wait'}>
                <motion.div
                  key={page}
                  className="page-transition"
                  initial={reduceMotion ? false : { opacity: 0, y: 8, scale: .985 }}
                  animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                  exit={reduceMotion ? { opacity: 1, x: 0, scale: 1 } : { opacity: 0, x: -6, scale: .995 }}
                  transition={reduceMotion ? { duration: 0 } : { duration: .18, ease: [.2, .8, .2, 1] }}
                >
                  {page === 'home' && <Home plugins={state?.plugins ?? []} version={state?.version} onCatalog={() => setPage('catalog')} onOpen={id => setPage({ pluginId: id })} onRefresh={() => { void refreshState().catch(reason => setError(errorMessage(reason))) }} reducedMotion={Boolean(reduceMotion)} />}
                  {page === 'catalog' && <Catalog catalog={catalog} installed={installed} busy={busy} onInstall={setConfirmInstall} onRefresh={() => refreshCatalog(true)} onOpen={id => setPage({ pluginId: id })} currentTarget={state?.target} />}
                  {page === 'settings' && state && <SettingsPage state={state} progress={updateProgress} onProgressReset={() => setUpdateProgress(null)} onPluginsUpdated={refreshState} textScale={textScale} onTextScaleChange={setTextScale} accentThemeId={accentThemeId} onAccentThemeChange={setAccentThemeId} colorSchemeId={colorSchemeId} onColorSchemeChange={setColorSchemeId} fontThemeId={fontThemeId} onFontThemeChange={setFontThemeId} fontWeight={fontWeight} onFontWeightChange={setFontWeight} glassMode={glassMode} onGlassModeChange={setGlassMode} onChange={async enabled => { await api.setLaunchAtStartup(enabled); await refreshState() }} />}
                </motion.div>
              </AnimatePresence>
            )}

            {(pluginOpen && !openedPluginIds.includes(page.pluginId) ? [...openedPluginIds, page.pluginId] : openedPluginIds).map(id => {
              const plugin = installed.get(id)
              const isCurrent = pluginOpen && page.pluginId === id
              const cached = pluginHtmlMap[id]
              const html = cached && (!plugin || cached.version === plugin.version) ? cached.html : undefined
              return (
                <div
                  key={id}
                  className="plugin-host-layer"
                  style={{ display: isCurrent ? 'block' : 'none', width: '100%', height: '100%' }}
                >
                  {!plugin ? (
                    <Loading label="载入插件" />
                  ) : !plugin.enabled ? (
                    <div className="plugin-disabled"><Pause /><h2>已停用</h2></div>
                  ) : html ? (
                    <PluginFrame
                      pluginId={id}
                      html={html}
                      active={isCurrent}
                      theme={plugin?.uiDesignVersion === 1 ? activeTheme : pluginTheme(getAccentTheme('catppuccin-latte'), fontTheme, fontWeight, glassMode, textScale)}
                    />
                  ) : (
                    <Loading label="载入界面" />
                  )}
                </div>
              )
            })}
          </section>
        </main>
      </div>

      {confirmInstall && <InstallDialog plugin={confirmInstall} busy={busy === confirmInstall.id} progress={updateProgress?.operation === 'plugin-install' && updateProgress.itemId === confirmInstall.id ? updateProgress : null} onCancel={() => setConfirmInstall(null)} onConfirm={() => { setUpdateProgress(null); void install(confirmInstall) }} />}
    </div>
  )
}

function SidebarGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return <section className="sidebar-section"><h2 className="sidebar-section-label">{label}</h2><nav>{children}</nav></section>
}

function NavButton({ active, icon, label, status, onClick }: { active: boolean; icon: React.ReactNode; label: string; status?: string; onClick(): void }) {
  return <Button title={label} className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}><span>{icon}</span><b>{label}</b>{status && <i className={`state-dot ${status}`} />}</Button>
}

function Home({ plugins, version, onCatalog, onOpen, onRefresh, reducedMotion }: { plugins: PluginSummary[]; version: string | undefined; onCatalog(): void; onOpen(id: string): void; onRefresh(): void; reducedMotion: boolean }) {
  if (plugins.length === 0) return (
    <div className="empty-state">
      <div className="empty-icon"><Boxes /></div>
      <h2>还没有安装功能</h2>
      <p>从功能库选择需要的工具。</p>
      <Button className="primary" onClick={onCatalog}>浏览功能库 <ChevronRight /></Button>
    </div>
  )

  const running = plugins.filter(plugin => plugin.state === 'running').length
  const attention = plugins.filter(plugin => plugin.enabled && plugin.state === 'failed').length
  const healthy = attention === 0
  return (
    <div className="home-dashboard">
      <div className="home-intro">
        <div>
          <span className="eyebrow"><Activity />数字工作台</span>
          <h2>你的功能，都在这里</h2>
          <p>{healthy ? '当前没有停用或异常功能。' : `${attention} 个功能需要你的注意。`}</p>
        </div>
        <div className={`health-pill ${healthy ? 'healthy' : 'attention'}`}><span />{healthy ? '运行稳定' : '需要关注'}</div>
      </div>
      <div className="dashboard-summary" aria-label="Digiworld 状态摘要">
        <SummaryCard label="已安装" value={plugins.length} detail="个功能" icon={<Boxes />} tone="accent" />
        <SummaryCard label="运行中" value={running} detail={`共 ${plugins.length} 个`} icon={<Gauge />} tone="success" />
        <SummaryCard label="需关注" value={attention} detail={attention ? '请查看状态' : '暂无异常'} icon={attention ? <AlertTriangle /> : <ShieldCheck />} tone={attention ? 'warning' : 'success'} />
        <SummaryCard label="当前版本" value={version ?? '—'} detail="Digiworld" icon={<ShieldCheck />} tone="neutral" />
      </div>
      <div className="section-heading installed-heading">
        <div><span className="section-kicker">你的工作台</span><h2>已安装功能</h2></div>
        <Button className="secondary" onClick={onCatalog}><Library />添加功能</Button>
      </div>
      <div className="installed-list">
        {plugins.map((plugin, index) => (
          <motion.button key={plugin.id} className="plugin-row" onClick={() => onOpen(plugin.id)} initial={reducedMotion ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={reducedMotion ? { duration: 0 } : { delay: index * .035, duration: .18 }}>
            <span className="row-icon"><PluginIcon plugin={plugin} /></span>
            <span className="plugin-row-copy"><span className="plugin-row-heading"><strong>{plugin.name}</strong><ChevronRight className="row-chevron" /></span><small>{plugin.description || '打开以查看功能'}</small></span>
            <span className={`compact-status ${plugin.state}`}>{stateLabel(plugin)}</span>{plugin.uiDesignVersion !== 1 && <small className="legacy-design">浅色兼容 · 待适配新外观</small>}
          </motion.button>
        ))}
      </div>
      <div className="quick-actions" aria-label="快捷操作">
        <span className="section-kicker">快捷操作</span>
        <div>
          <Button className="quick-action" onClick={onCatalog}><span><Library /></span><b>浏览功能库</b><ChevronRight /></Button>
          <Button className="quick-action" onClick={onRefresh}><span><RefreshCw /></span><b>刷新状态</b><ChevronRight /></Button>
        </div>
      </div>
    </div>
  )
}

function SummaryCard({ label, value, detail, icon, tone = 'accent' }: { label: string; value: string | number; detail: string; icon: React.ReactNode; tone?: 'accent' | 'success' | 'warning' | 'neutral' }) {
  return <Card className={`summary-card ${tone}`}><span className="summary-card-icon">{icon}</span><div><small>{label}</small><strong>{value}</strong><span>{detail}</span></div></Card>
}

function Catalog({ catalog, installed, busy, onInstall, onRefresh, onOpen, currentTarget }: { catalog: CatalogIndex | null; installed: Map<string, PluginSummary>; busy: string | null; onInstall(plugin: CatalogPlugin): void; onRefresh(): void; onOpen(id: string): void; currentTarget?: string | undefined }) {
  if (!catalog) return <Loading label="载入功能库" />
  return (
    <div>
      <div className="section-heading">
        <h2>可用功能</h2>
        <Button className="icon-button" aria-label="刷新功能库" title="刷新" onClick={onRefresh}><RefreshCw /></Button>
      </div>
      <div className="catalog-grid">
        {catalog.plugins.map(plugin => {
          const current = installed.get(plugin.id)
          const supported = Boolean(currentTarget && plugin.artifacts.some(artifact => artifact.target === currentTarget))
          return (
            <Card className="catalog-card" key={plugin.id}>
              <div className="catalog-title"><span className="catalog-icon"><PluginIcon plugin={plugin} /></span><div className="catalog-version"><span className={`availability-dot ${current ? 'installed' : supported ? 'available' : 'unavailable'}`} /> <small>{current ? '已安装' : supported ? '可安装' : '暂未适配'}</small><small>v{plugin.version}</small></div></div>
              <h3>{plugin.name}</h3>
              <p>{plugin.description}</p>
              {current
                ? <Button className="secondary full" onClick={() => onOpen(plugin.id)}>打开 <ChevronRight /></Button>
                : !supported
                  ? <Button className="secondary full" disabled title={`该插件暂未适配当前系统架构 (${currentTarget})`}>暂未适配当前系统</Button>
                  : <Button className="primary full" disabled={busy === plugin.id} onClick={() => onInstall(plugin)}>{busy === plugin.id ? <LoaderCircle className="spin" /> : <Download />}安装</Button>}
            </Card>
          )
        })}
      </div>
    </div>
  )
}

type UpdateDialog =
  | { kind: 'plugins'; updates: PluginUpdateInfo[] }
  | { kind: 'core'; update: CoreUpdateInfo }

function SettingsPage({ state, progress, onProgressReset, onPluginsUpdated, textScale, onTextScaleChange, accentThemeId, onAccentThemeChange, colorSchemeId, onColorSchemeChange, fontThemeId, onFontThemeChange, fontWeight, onFontWeightChange, glassMode, onGlassModeChange, onChange }: {
  state: AppState
  progress: UpdateProgress | null
  onProgressReset(): void
  onPluginsUpdated(): Promise<void>
  textScale: TextScale
  onTextScaleChange(scale: TextScale): void
  accentThemeId: AccentThemeId
  onAccentThemeChange(id: AccentThemeId): void
  colorSchemeId: ColorSchemeId
  onColorSchemeChange(id: ColorSchemeId): void
  fontThemeId: FontThemeId
  onFontThemeChange(id: FontThemeId): void
  fontWeight: FontWeight
  onFontWeightChange(weight: FontWeight): void
  glassMode: GlassMode
  onGlassModeChange(mode: GlassMode): void
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
    api.proxySettings().then(setProxy).catch(reason => setProxyMessage(errorMessage(reason)))
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
        await onPluginsUpdated()
        setProxyMessage('代理设置已保存')
      } else {
        const result = await withDeadline(
          api.testProxySettings(proxy),
          PROXY_TEST_DEADLINE_MS,
          '代理测试超时，请确认地址、端口和代理类型后重试',
        )
        setProxyMessage(`连接成功 · ${result.latencyMs} ms`)
      }
    } catch (reason) {
      setProxyMessage(errorMessage(reason))
    } finally {
      setProxyBusy(null)
    }
  }

  const checkPluginUpdates = async () => {
    setUpdateBusy('plugin-check')
    setPluginMessage(null)
    setUpdateError(null)
    try {
      const updates = await withDeadline(
        api.checkPluginUpdates(),
        UPDATE_CHECK_DEADLINE_MS,
        '插件更新检查超时，请检查网络或代理后重试',
      )
      if (updates.length === 0) setPluginMessage('所有插件均为最新版本')
      else setUpdateDialog({ kind: 'plugins', updates })
    } catch (reason) {
      setPluginMessage(errorMessage(reason))
    } finally {
      setUpdateBusy(null)
    }
  }

  const checkCoreUpdate = async () => {
    setUpdateBusy('core-check')
    setCoreMessage(null)
    setUpdateError(null)
    try {
      const update = await withDeadline(
        api.checkCoreUpdate(),
        UPDATE_CHECK_DEADLINE_MS,
        '主程序更新检查超时，请检查网络或代理后重试',
      )
      if (update) setUpdateDialog({ kind: 'core', update })
      else setCoreMessage('当前已是最新版本')
    } catch (reason) {
      setCoreMessage(errorMessage(reason))
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
        setUpdateError(errorMessage(reason))
        await onPluginsUpdated().catch(() => undefined)
      } finally {
        setUpdateBusy(null)
      }
      return
    }

    setUpdateBusy('core-install')
    try {
      await api.installCoreUpdate(updateDialog.update.version)
    } catch (reason) {
      setUpdateError(errorMessage(reason))
      setUpdateBusy(null)
    }
  }

  return (
    <div className="settings-stack">
      <Card className="settings-card theme-card">
        <div className="theme-copy">
          <h3><Palette />主题颜色</h3>
          <p>框架与插件使用同一套完整配色</p>
        </div>
        <RadioGroup className="theme-options" aria-label="主题颜色">
          {ACCENT_THEMES.map(theme => (
            <Button
              key={theme.id}
              type="button"
              className={accentThemeId === theme.id ? 'active' : ''}
              role="radio"
              aria-checked={accentThemeId === theme.id}
              tabIndex={accentThemeId === theme.id ? 0 : -1}
              aria-label={theme.label}
              title={theme.label}
              style={{ '--theme-swatch': theme.colors.accent, '--preview-bg': theme.colors.bg, '--preview-surface': theme.colors.surface, '--preview-text': theme.colors.text } as React.CSSProperties}
              onClick={() => onAccentThemeChange(theme.id)}
            >
              <span className="theme-miniature" aria-hidden="true"><i /><b><em />Aa 123</b></span>
              <small>{theme.label}</small>
              {accentThemeId === theme.id && <Check />}
            </Button>
          ))}
        </RadioGroup>
      </Card>
      <Card className="settings-card scheme-card">
        <div className="theme-copy">
          <h3><Palette />主题配色</h3>
          <p>在当前主题风格下自定义主色调与图表色彩</p>
        </div>
        <RadioGroup className="scheme-options" aria-label="主题配色">
          {COLOR_SCHEMES.map(scheme => (
            <Button
              key={scheme.id}
              type="button"
              className={colorSchemeId === scheme.id ? 'active' : ''}
              role="radio"
              aria-checked={colorSchemeId === scheme.id}
              tabIndex={colorSchemeId === scheme.id ? 0 : -1}
              aria-label={scheme.label}
              title={scheme.label}
              onClick={() => onColorSchemeChange(scheme.id)}
            >
              <span className="scheme-swatch" style={{ background: getColorSchemePreview(accentThemeId, scheme.id) }} aria-hidden="true" />
              <div className="scheme-label-wrap">
                <strong>{scheme.label}</strong>
                <small>{scheme.description}</small>
              </div>
              {colorSchemeId === scheme.id && <Check />}
            </Button>
          ))}
        </RadioGroup>
      </Card>
      <Card className="settings-card font-card">
        <div className="theme-copy">
          <h3><Type />界面字体</h3>
          <p>字体会同步应用到主界面、插件、图表数字与键盘按键</p>
        </div>
        <RadioGroup className="font-options" aria-label="界面字体">
          {FONT_THEMES.map(theme => (
            <Button
              key={theme.id}
              type="button"
              className={fontThemeId === theme.id ? 'active' : ''}
              role="radio"
              aria-checked={fontThemeId === theme.id}
              tabIndex={fontThemeId === theme.id ? 0 : -1}
              aria-label={theme.label}
              style={{ '--font-preview': theme.fontSans, '--font-preview-display': theme.fontDisplay } as React.CSSProperties}
              onClick={() => onFontThemeChange(theme.id)}
            >
              <span className="font-option-heading"><strong>{theme.label}</strong>{fontThemeId === theme.id && <Check />}</span>
              <span className="font-sample">数字世界 Digiworld 2026</span>
              <small>{theme.description}</small>
            </Button>
          ))}
        </RadioGroup>
      </Card>
      <Card className="settings-card">
        <div><h3>文字大小</h3><p>同步应用到框架、插件与图表</p></div>
        <div className="dw-segmented" role="group" aria-label="文字大小">
          {([100, 110, 125] as TextScale[]).map(scale => <Button key={scale} className={textScale === scale ? 'active' : ''} aria-pressed={textScale === scale} onClick={() => onTextScaleChange(scale)}>{scale}%</Button>)}
        </div>
      </Card>
      <Card className="settings-card weight-card">
        <div className="theme-copy">
          <h3><Type />字体粗细</h3>
          <p>同步调整主界面与插件正文，同时保留标题的信息层级</p>
        </div>
        <div className="weight-control">
          <div><span>标准</span><span>清晰</span><span>粗重</span></div>
          <Input aria-label="字体粗细" type="range" min="400" max="600" step="100" value={fontWeight} onChange={event => onFontWeightChange(Number(event.target.value) as FontWeight)} />
          <output>{fontWeight}</output>
        </div>
      </Card>
      <Card className="settings-card appearance-card"><div><h3>玻璃效果</h3><p>应用到 Digiworld 界面和已安装插件</p></div><Switch aria-label="切换玻璃效果" checked={glassMode === 'enabled'} onCheckedChange={enabled => onGlassModeChange(enabled ? 'enabled' : 'disabled')} /></Card>
      <Card className="settings-card"><div><h3>开机启动</h3><p>在后台启动已启用的插件</p></div><Switch aria-label="切换开机启动" checked={state.launchAtStartup} onCheckedChange={enabled => void onChange(enabled)} /></Card>
      <Card className="settings-card proxy-card">
        <div className="proxy-copy">
          <h3><Network />网络代理</h3>
          <p>用于功能库、程序更新和声明网络权限的插件</p>
          <div className="dw-segmented proxy-modes" role="group" aria-label="代理模式">
            {([['system', '系统代理'], ['custom', '自定义'], ['direct', '直连']] as const).map(([mode, label]) => (
              <Button key={mode} className={proxy.mode === mode ? 'active' : ''} aria-pressed={proxy.mode === mode} onClick={() => updateMode(mode)}>{label}</Button>
            ))}
          </div>
          {proxy.mode === 'custom' && <Input aria-label="自定义代理地址" value={proxy.url ?? ''} onChange={event => setProxy({ mode: 'custom', url: event.target.value })} placeholder="http://127.0.0.1:7890 或 socks5h://127.0.0.1:7890" />}
          {proxyMessage && <small className="proxy-message">{proxyMessage}</small>}
        </div>
        <div className="proxy-actions"><Button className="secondary" disabled={proxyBusy !== null} onClick={() => void runProxyAction('test')}>{proxyBusy === 'test' ? '测试中…' : '测试连接'}</Button><Button className="primary" disabled={proxyBusy !== null} onClick={() => void runProxyAction('save')}>{proxyBusy === 'save' ? '保存中…' : '保存'}</Button></div>
      </Card>
      <Card className="settings-card update-card">
        <div><h3>插件更新</h3><p>一次检查并更新所有已安装插件，通过上方已保存的代理连接</p>{pluginMessage && <small className="update-message">{pluginMessage}</small>}</div>
        <Button className="secondary" disabled={updateBusy !== null} onClick={() => void checkPluginUpdates()}>{updateBusy === 'plugin-check' ? <><LoaderCircle className="spin" />检查中…</> : '检查全部插件'}</Button>
      </Card>
      <Card className="settings-card update-card">
        <div><h3>主程序更新</h3><p>当前版本 {state.version}，检查后由你确认是否下载和安装</p>{coreMessage && <small className="update-message">{coreMessage}</small>}</div>
        <Button className="secondary" disabled={updateBusy !== null} onClick={() => void checkCoreUpdate()}>{updateBusy === 'core-check' ? <><LoaderCircle className="spin" />检查中…</> : '检查主程序'}</Button>
      </Card>
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
    <Dialog open onClose={() => { if (!busy) onCancel() }} className="modal" aria-labelledby="install-title">
        <div className="modal-icon"><ShieldCheck /></div>
        <h2 id="install-title">安装 {plugin.name}</h2>
        <div className="permission-dialog">
          {plugin.permissions.map(permission => <div key={permission.id}><Check /><span><strong>{permissionLabel(permission.id)}</strong><small>{permission.reason}</small></span></div>)}
        </div>
        {busy && <ProgressView progress={progress} fallbackName={plugin.name} />}
        <div className="modal-actions"><Button className="secondary" disabled={busy} onClick={onCancel}>取消</Button><Button className="primary" disabled={busy} onClick={onConfirm}>{busy ? <LoaderCircle className="spin" /> : <Download />}安装</Button></div>
    </Dialog>
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
    <Dialog open onClose={() => { if (!busy) onCancel() }} className="modal update-modal" aria-labelledby="update-title">
        <div className="modal-icon"><Download /></div>
        <h2 id="update-title">{isPlugins ? `发现 ${dialog.updates.length} 个插件更新` : `发现 Digiworld ${dialog.update.version}`}</h2>
        {isPlugins ? (
          <div className="update-list">
            {dialog.updates.map(update => (
              <div key={update.id} className={!update.compatible ? 'incompatible' : ''}>
                <span><strong>{update.name}</strong><small>{update.currentVersion} → {update.version}</small>
                  {update.permissionsChanged && (
                    <span className="permission-changes">
                      {update.addedPermissions.map(permission => <small key={`added:${permission.id}`}><b>新增 {permissionLabel(permission.id)}</b>：{permission.reason}</small>)}
                      {update.removedPermissions.map(permission => <small key={`removed:${permission.id}`}><b>移除 {permissionLabel(permission.id)}</b>：{permission.reason}</small>)}
                      {update.changedPermissions.map(permission => <small key={`changed:${permission.id}`}><b>变更 {permissionLabel(permission.id)}</b>：{permission.oldReason} → {permission.newReason}</small>)}
                    </span>
                  )}
                </span>
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
        {error && <Status tone="error" className="update-error"><CircleAlert />{error}</Status>}
        <div className="modal-actions">
          <Button className="secondary" disabled={busy} onClick={onCancel}>取消</Button>
          <Button className="primary" disabled={busy || compatibleCount === 0} onClick={onConfirm}>
            {busy ? <LoaderCircle className="spin" /> : <Download />}
            {busy ? '正在更新…' : isPlugins ? `同意并更新 ${compatibleCount} 项` : '同意并更新'}
          </Button>
        </div>
    </Dialog>
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
  const stageLabel = !progress ? '准备下载' : downloading ? '正在下载' : progress.stage === 'completed' ? '安装完成' : progress.stage === 'failed' ? '更新失败' : '正在安装'
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
