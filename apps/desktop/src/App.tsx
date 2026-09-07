import { Button, Input, Card, Panel, Dialog, Switch, Status, RadioGroup } from '@digiworld/design-system/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Check, CircleAlert, Download, Gauge, MoreHorizontal, Library, LoaderCircle, Network, Palette, Pause, Settings, ShieldCheck, Type } from 'lucide-react'
import { suppressContextMenu, type CatalogIndex, type CatalogPlugin, type PluginSummary } from '@digiworld/plugin-sdk'
import { PluginFrame } from './components/PluginFrame'
import { WindowChrome } from './components/WindowChrome'
import { ThemeDropdown } from './components/ThemeDropdown'
import { AppShell } from './layout/AppShell'
import { PluginIcon } from './components/PluginIcon'
import { stateLabel } from './components/PluginStatus'
import { Loading } from './components/Loading'
import { HomePage } from './pages/HomePage'
import { CatalogPage } from './pages/CatalogPage'
import {
  api, type AppState, type CoreUpdateInfo, type PluginUpdateInfo, type ProxyMode,
  type ProxySettings, type UpdateProgress,
} from './lib/api'
import {
  ACCENT_THEMES, FONT_THEMES, COLOR_SCHEMES, getColorSchemePreview, themeStyle,
  type ColorSchemeId, getAccentTheme, getFontTheme, loadAccentThemeId, loadColorSchemeId,
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
  const [pluginMenuOpen, setPluginMenuOpen] = useState(false)
  const accentTheme = getAccentTheme(accentThemeId, colorSchemeId)
  const fontTheme = getFontTheme(fontThemeId)
  const activeTheme = useMemo(() => pluginTheme(accentTheme, fontTheme, fontWeight, glassMode), [accentTheme, fontTheme, fontWeight, glassMode])

  useEffect(() => {
    for (const [key, value] of Object.entries(activeTheme)) if (value !== undefined) document.documentElement.style.setProperty('--dw-' + key, value)
    document.documentElement.style.colorScheme = activeTheme['color-scheme']
    document.documentElement.dataset.dwGlass = glassMode
    document.documentElement.dataset.dwScheme = activeTheme['color-scheme']
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
    ? { home: 'Dashboard', catalog: '功能库', settings: '设置' }[page]
    : selectedPlugin?.name ?? '插件'
  const pluginOpen = typeof page !== 'string'
  const pageSubtitle = page === 'home' ? '你的本地数字工作台' : undefined

  const primaryNavigation = [
    { id: 'home', label: '概览', icon: <Gauge />, active: page === 'home', onClick: () => setPage('home') },
    { id: 'catalog', label: '功能库', icon: <Library />, active: page === 'catalog', onClick: () => setPage('catalog') },
  ]
  const pluginNavigation = (state?.plugins ?? []).map(plugin => ({
    id: plugin.id,
    label: plugin.name,
    icon: <PluginIcon plugin={plugin} />,
    status: plugin.state,
    active: pluginOpen && page.pluginId === plugin.id,
    onClick: () => setPage({ pluginId: plugin.id }),
  }))
  const settingsNavigation = { id: 'settings', label: '设置', icon: <Settings />, active: page === 'settings', onClick: () => setPage('settings') }

  useEffect(() => setPluginMenuOpen(false), [page])

  return (
    <div className={`app-window glass-${glassMode} ${pluginOpen ? 'plugin-open' : ''}`} data-dw-glass={glassMode} style={themeStyle(activeTheme)}>
      <WindowChrome />
      <AppShell
        primary={primaryNavigation}
        plugins={pluginNavigation}
        settings={settingsNavigation}
        title={pageTitle}
        subtitle={pageSubtitle}
        actions={selectedPlugin && (
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
      >
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
                  {page === 'home' && <HomePage plugins={state?.plugins ?? []} version={state?.version} onCatalog={() => setPage('catalog')} onOpen={id => setPage({ pluginId: id })} onRefresh={() => { void refreshState().catch(reason => setError(errorMessage(reason))) }} reducedMotion={Boolean(reduceMotion)} />}
                  {page === 'catalog' && <CatalogPage catalog={catalog} installed={installed} busy={busy} onInstall={setConfirmInstall} onRefresh={() => refreshCatalog(true)} onOpen={id => setPage({ pluginId: id })} currentTarget={state?.target} />}
                  {page === 'settings' && state && <SettingsPage state={state} progress={updateProgress} onProgressReset={() => setUpdateProgress(null)} onPluginsUpdated={refreshState} accentThemeId={accentThemeId} onAccentThemeChange={setAccentThemeId} colorSchemeId={colorSchemeId} onColorSchemeChange={setColorSchemeId} fontThemeId={fontThemeId} onFontThemeChange={setFontThemeId} fontWeight={fontWeight} onFontWeightChange={setFontWeight} glassMode={glassMode} onGlassModeChange={setGlassMode} onChange={async enabled => { await api.setLaunchAtStartup(enabled); await refreshState() }} />}
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
                      theme={plugin?.uiDesignVersion === 1 ? activeTheme : pluginTheme(getAccentTheme('catppuccin-latte'), fontTheme, fontWeight, glassMode)}
                    />
                  ) : (
                    <Loading label="载入界面" />
                  )}
                </div>
              )
            })}
          </section>
      </AppShell>

      {confirmInstall && <InstallDialog plugin={confirmInstall} busy={busy === confirmInstall.id} progress={updateProgress?.operation === 'plugin-install' && updateProgress.itemId === confirmInstall.id ? updateProgress : null} onCancel={() => setConfirmInstall(null)} onConfirm={() => { setUpdateProgress(null); void install(confirmInstall) }} />}
    </div>
  )
}

type UpdateDialog =
  | { kind: 'plugins'; updates: PluginUpdateInfo[] }
  | { kind: 'core'; update: CoreUpdateInfo }

function SettingsPage({ state, progress, onProgressReset, onPluginsUpdated, accentThemeId, onAccentThemeChange, colorSchemeId, onColorSchemeChange, fontThemeId, onFontThemeChange, fontWeight, onFontWeightChange, glassMode, onGlassModeChange, onChange }: {
  state: AppState
  progress: UpdateProgress | null
  onProgressReset(): void
  onPluginsUpdated(): Promise<void>
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

  const [themeDropdownOpen, setThemeDropdownOpen] = useState(false)
  const currentTheme = ACCENT_THEMES.find(t => t.id === accentThemeId) ?? ACCENT_THEMES[0]!

  return (
    <div className="settings-stack">
      <Panel className="settings-section appearance-section" padding="none">
        <div className="settings-section-header">
          <div><strong>外观与显示</strong><span>调整主题、字体和界面层次</span></div>
        </div>
        <div className="settings-section-body">
        <Card className={`settings-card theme-card ${themeDropdownOpen ? 'dropdown-open' : ''}`}>
        <div className="theme-header-row">
          <div className="theme-copy">
            <h3><Palette />主题颜色</h3>
          </div>
          <ThemeDropdown
            value={accentThemeId}
            onChange={onAccentThemeChange}
            themes={ACCENT_THEMES}
            onOpenChange={setThemeDropdownOpen}
          />
        </div>
        <div
          className="theme-active-preview"
          style={{
            '--theme-swatch': currentTheme.colors.accent,
            '--preview-bg': currentTheme.colors.bg,
            '--preview-surface': currentTheme.colors.surface,
            '--preview-text': currentTheme.colors.text,
            '--preview-border': currentTheme.colors.border,
          } as React.CSSProperties}
        >
          <span className="theme-miniature" aria-hidden="true"><i /><b><em />Aa 123</b></span>
          <div className="theme-preview-details">
            <div className="theme-preview-meta">
              <strong>{currentTheme.label}</strong>
              <span className="theme-preview-pill">{currentTheme.scheme === 'light' ? '浅色模式' : '深色模式'}</span>
            </div>
            <div className="theme-preview-swatches" aria-label="主题核心色彩" title="主题核心色彩">
              <span style={{ background: currentTheme.colors.bg }} title={`背景色: ${currentTheme.colors.bg}`} />
              <span style={{ background: currentTheme.colors.surface }} title={`表面色: ${currentTheme.colors.surface}`} />
              <span style={{ background: currentTheme.colors['surface-raised'] }} title={`浮层色: ${currentTheme.colors['surface-raised']}`} />
              <span style={{ background: currentTheme.colors.accent }} title={`主强调色: ${currentTheme.colors.accent}`} />
              <span style={{ background: currentTheme.colors['accent-secondary'] }} title={`次强调色: ${currentTheme.colors['accent-secondary']}`} />
              <span style={{ background: currentTheme.colors.text }} title={`文字色: ${currentTheme.colors.text}`} />
            </div>
          </div>
        </div>
        </Card>
      <Card className="settings-card scheme-card">
        <div className="theme-copy">
          <h3><Palette />主题配色</h3>
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
              </div>
              {colorSchemeId === scheme.id && <Check />}
            </Button>
          ))}
        </RadioGroup>
        </Card>
      <Card className="settings-card font-card">
        <div className="theme-copy">
          <h3><Type />界面字体</h3>
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
            </Button>
          ))}
        </RadioGroup>
        </Card>
      <Card className="settings-card weight-card">
        <div className="theme-copy">
          <h3><Type />字体粗细</h3>
        </div>
        <div className="weight-control">
          <div><span>标准</span><span>清晰</span><span>粗重</span></div>
          <Input aria-label="字体粗细" type="range" min="400" max="600" step="100" value={fontWeight} onChange={event => onFontWeightChange(Number(event.target.value) as FontWeight)} />
          <output>{fontWeight}</output>
        </div>
        </Card>
        </div>
      </Panel>
      <Panel className="settings-section behavior-section" padding="none">
        <div className="settings-section-header">
          <div><strong>使用体验</strong><span>控制启动和背景效果</span></div>
        </div>
        <div className="settings-section-body">
      <Card className="settings-card appearance-card">
        <h3>玻璃效果</h3>
        <Switch aria-label="切换玻璃效果" checked={glassMode === 'enabled'} onCheckedChange={enabled => onGlassModeChange(enabled ? 'enabled' : 'disabled')} />
      </Card>
      <Card className="settings-card">
        <h3>开机启动</h3>
        <Switch aria-label="切换开机启动" checked={state.launchAtStartup} onCheckedChange={enabled => void onChange(enabled)} />
      </Card>
        </div>
      </Panel>
      <Panel className="settings-section network-section" padding="none">
        <div className="settings-section-header">
          <div><strong>连接</strong><span>管理插件和更新所使用的网络</span></div>
        </div>
        <div className="settings-section-body">
      <Card className="settings-card proxy-card">
        <div className="proxy-copy">
          <h3><Network />网络代理</h3>
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
        </div>
      </Panel>
      <Panel className="settings-section updates-section" padding="none">
        <div className="settings-section-header">
          <div><strong>更新</strong><span>检查插件和 Digiworld 主程序的新版本</span></div>
        </div>
        <div className="settings-section-body">
      <Card className="settings-card update-card">
        <div><h3>插件更新</h3>{pluginMessage && <small className="update-message">{pluginMessage}</small>}</div>
        <Button className="secondary" disabled={updateBusy !== null} onClick={() => void checkPluginUpdates()}>{updateBusy === 'plugin-check' ? <><LoaderCircle className="spin" />检查中…</> : '检查全部插件'}</Button>
      </Card>
      <Card className="settings-card update-card">
        <div><h3>主程序更新</h3>{coreMessage && <small className="update-message">{coreMessage}</small>}</div>
        <Button className="secondary" disabled={updateBusy !== null} onClick={() => void checkCoreUpdate()}>{updateBusy === 'core-check' ? <><LoaderCircle className="spin" />检查中…</> : '检查主程序'}</Button>
      </Card>
        </div>
      </Panel>
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

export default App
