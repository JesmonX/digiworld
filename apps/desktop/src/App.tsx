import { Button, Input, Card, Panel, Dialog, Switch, Status, RadioGroup, Menu } from '@digiworld/design-system/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Check, CircleAlert, Download, Gauge, MoreHorizontal, Library, LoaderCircle, Palette, Pause, Settings, ShieldCheck, Type, Languages, Moon, Sun } from 'lucide-react'
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
import { loadLocale, saveLocale, t, type Locale } from './lib/i18n'
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
import './host-fixes.css'

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

function permissionLabel(id: string, locale: Locale = 'en'): string {
  const enLabels: Record<string, string> = {
    'background': 'Background execution',
    'global-input': 'Read global keyboard events',
    'plugin-storage': 'Local plugin storage',
    'filesystem:agent-session-data': 'Read Coding Agent session data',
    'process:ssh': 'System SSH access',
    'process:shell': 'Execute configured system shell',
    'network:openai': 'Access OpenAI Codex service',
    'network:imap': 'Access IMAP mail service',
    'network:github': 'Access GitHub API',
    'network:icloud': 'Access iCloud calendar',
    'notifications': 'Display system notifications',
    'secret:mail-credentials': 'Store email credentials securely',
    'secret:github-token': 'Store GitHub Token securely',
    'secret:icloud-app-password': 'Store iCloud App-Specific Password',
  }
  const zhLabels: Record<string, string> = {
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
  return (locale === 'zh' ? zhLabels[id] : enLabels[id]) ?? id
}

function App() {
  const reduceMotion = useReducedMotion()
  const [locale, setLocale] = useState<Locale>(loadLocale)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
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

  useEffect(() => {
    saveLocale(locale)
    document.documentElement.lang = locale
  }, [locale])

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
    const confirmMsg = t('removeConfirm', locale).replace('{name}', plugin.name)
    if (!window.confirm(confirmMsg)) return
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
    ? { home: t('workspace', locale), catalog: t('catalog', locale), settings: t('settingsTitle', locale) }[page]
    : selectedPlugin?.name ?? (locale === 'en' ? 'Plugin' : '插件')
  const pluginOpen = typeof page !== 'string'

  const primaryNavigation = [
    { id: 'home', label: t('overview', locale), icon: <Gauge />, active: page === 'home', onClick: () => setPage('home') },
    { id: 'catalog', label: t('catalog', locale), icon: <Library />, active: page === 'catalog', onClick: () => setPage('catalog') },
  ]
  const pluginNavigation = (state?.plugins ?? []).map(plugin => ({
    id: plugin.id,
    label: plugin.name,
    icon: <PluginIcon plugin={plugin} />,
    status: plugin.state,
    active: pluginOpen && page.pluginId === plugin.id,
    onClick: () => setPage({ pluginId: plugin.id }),
  }))
  const settingsNavigation = { id: 'settings', label: t('settings', locale), icon: <Settings />, active: page === 'settings', onClick: () => setPage('settings') }

  useEffect(() => setPluginMenuOpen(false), [page])

  return (
    <div className={`app-window glass-${glassMode} ${pluginOpen ? 'plugin-open' : ''}`} data-dw-glass={glassMode} style={themeStyle(activeTheme)}>
      <WindowChrome locale={locale} />
      <AppShell
        primary={primaryNavigation}
        plugins={pluginNavigation}
        settings={settingsNavigation}
        title={pageTitle}
        subtitle={undefined}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(c => !c)}
        locale={locale}
        actions={
          <div className="header-actions-wrap">
            {selectedPlugin && (
              <div className="plugin-management">
                <span className={`compact-status ${selectedPlugin.state}`}>{stateLabel(selectedPlugin, locale)}</span>
                <Button className="secondary compact" disabled={busy === selectedPlugin.id} onClick={() => void manageEnabled(selectedPlugin, !selectedPlugin.enabled)}>
                  {selectedPlugin.enabled ? t('disable', locale) : t('enable', locale)}
                </Button>
                <div className="plugin-more">
                  <Button
                    className="secondary compact icon-button"
                    aria-label={t('moreActions', locale)}
                    aria-haspopup="menu"
                    aria-expanded={pluginMenuOpen}
                    onClick={() => setPluginMenuOpen(open => !open)}
                  >
                    <MoreHorizontal />
                  </Button>
                  {pluginMenuOpen && (
                    <Menu className="plugin-more-menu">
                      <Button role="menuitem" className="danger-button" disabled={busy === selectedPlugin.id} onClick={() => { setPluginMenuOpen(false); void uninstall(selectedPlugin) }}>{t('removePlugin', locale)}</Button>
                    </Menu>
                  )}
                </div>
              </div>
            )}
            <div className="header-quick-tools">
              <button
                type="button"
                className="header-pill-toggle lang-pill"
                onClick={() => setLocale(l => l === 'en' ? 'zh' : 'en')}
                data-tooltip={locale === 'en' ? t('switchToChinese', locale) : t('switchToEnglish', locale)}
                aria-label={t('toggleLanguage', locale)}
              >
                <Languages size={13} />
                <span>{locale === 'en' ? 'EN' : '中'}</span>
              </button>
              <button
                type="button"
                className="header-pill-toggle theme-pill"
                onClick={() => setAccentThemeId(id => id === 'light' ? 'dark' : 'light')}
                data-tooltip={accentThemeId === 'light' ? t('switchToDarkMode', locale) : t('switchToLightMode', locale)}
                aria-label={t('toggleTheme', locale)}
              >
                {accentThemeId === 'light' ? <Moon size={13} /> : <Sun size={13} />}
              </button>
            </div>
          </div>
        }
      >
          {error && <Status tone="error" className="error-banner"><CircleAlert /><span>{error}</span><Button onClick={() => setError(null)}>{t('close', locale)}</Button></Status>}

          <section className="content">
            {!pluginOpen && (
              <AnimatePresence initial={false} mode={reduceMotion ? 'sync' : 'wait'}>
                <motion.div
                  key={typeof page === 'string' ? page : 'plugin'}
                  className="page-transition"
                  initial={reduceMotion ? false : { opacity: 0, y: 8, scale: .985 }}
                  animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                  exit={reduceMotion ? { opacity: 1, x: 0, scale: 1 } : { opacity: 0, x: -6, scale: .995 }}
                  transition={reduceMotion ? { duration: 0 } : { duration: .18, ease: [.2, .8, .2, 1] }}
                >
                  {page === 'home' && (
                    <HomePage
                      plugins={state?.plugins ?? []}
                      version={state?.version}
                      onCatalog={() => setPage('catalog')}
                      onOpen={id => setPage({ pluginId: id })}
                      onRefresh={() => { void refreshState().catch(reason => setError(errorMessage(reason))) }}
                      reducedMotion={Boolean(reduceMotion)}
                      locale={locale}
                    />
                  )}
                  {page === 'catalog' && (
                    <CatalogPage
                      catalog={catalog}
                      installed={installed}
                      busy={busy}
                      onInstall={setConfirmInstall}
                      onRefresh={() => refreshCatalog(true)}
                      onOpen={id => setPage({ pluginId: id })}
                      currentTarget={state?.target}
                      locale={locale}
                    />
                  )}
                  {page === 'settings' && state && (
                    <SettingsPage
                      state={state}
                      progress={updateProgress}
                      onProgressReset={() => setUpdateProgress(null)}
                      onPluginsUpdated={refreshState}
                      accentThemeId={accentThemeId}
                      onAccentThemeChange={setAccentThemeId}
                      colorSchemeId={colorSchemeId}
                      onColorSchemeChange={setColorSchemeId}
                      fontThemeId={fontThemeId}
                      onFontThemeChange={setFontThemeId}
                      fontWeight={fontWeight}
                      onFontWeightChange={setFontWeight}
                      glassMode={glassMode}
                      onGlassModeChange={setGlassMode}
                      locale={locale}
                      onLocaleChange={setLocale}
                      onChange={async enabled => { await api.setLaunchAtStartup(enabled); await refreshState() }}
                    />
                  )}
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
                    <Loading label={t('loadingPlugin', locale)} />
                  ) : !plugin.enabled ? (
                    <div className="plugin-disabled"><Pause /><h2>{t('pluginDisabled', locale)}</h2></div>
                  ) : html ? (
                    <PluginFrame
                      pluginId={id}
                      html={html}
                      active={isCurrent}
                      theme={activeTheme}
                      locale={locale}
                    />
                  ) : (
                    <Loading label={t('loadingUi', locale)} />
                  )}
                </div>
              )
            })}
          </section>
      </AppShell>

      {confirmInstall && (
        <InstallDialog
          plugin={confirmInstall}
          busy={busy === confirmInstall.id}
          progress={updateProgress?.operation === 'plugin-install' && updateProgress.itemId === confirmInstall.id ? updateProgress : null}
          locale={locale}
          onCancel={() => setConfirmInstall(null)}
          onConfirm={() => { setUpdateProgress(null); void install(confirmInstall) }}
        />
      )}
    </div>
  )
}

type UpdateDialog =
  | { kind: 'plugins'; updates: PluginUpdateInfo[] }
  | { kind: 'core'; update: CoreUpdateInfo }

function SettingsPage({
  state, progress, onProgressReset, onPluginsUpdated,
  accentThemeId, onAccentThemeChange,
  colorSchemeId, onColorSchemeChange,
  fontThemeId, onFontThemeChange,
  fontWeight, onFontWeightChange,
  glassMode, onGlassModeChange,
  locale, onLocaleChange,
  onChange
}: {
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
  locale: Locale
  onLocaleChange(loc: Locale): void
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
  const [themeDropdownOpen, setThemeDropdownOpen] = useState(false)

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
        setProxyMessage(t('proxySaved', locale))
      } else {
        const result = await withDeadline(
          api.testProxySettings(proxy),
          PROXY_TEST_DEADLINE_MS,
          locale === 'zh' ? '代理测试超时，请确认地址、端口和代理类型后重试' : 'Proxy test timed out, verify address, port and proxy type',
        )
        setProxyMessage(`${locale === 'zh' ? '连接成功' : 'Connected'} · ${result.latencyMs} ms`)
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
        locale === 'zh' ? '插件更新检查超时，请检查网络或代理后重试' : 'Plugin update check timed out, please check network or proxy',
      )
      if (updates.length === 0) setPluginMessage(t('allPluginsUpToDate', locale))
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
        locale === 'zh' ? '主程序更新检查超时，请检查网络或代理后重试' : 'Core update check timed out, please check network or proxy',
      )
      if (update) setUpdateDialog({ kind: 'core', update })
      else setCoreMessage(t('coreUpToDate', locale))
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
        setUpdateError(locale === 'zh' ? '这些插件需要更新 Digiworld 主程序后才能安装' : 'These plugins require updating Digiworld Core first')
        return
      }
      setUpdateBusy('plugin-install')
      try {
        await api.installPluginUpdates(compatible.map(({ id, version }) => ({ id, version })))
        await onPluginsUpdated()
        setPluginMessage(locale === 'zh' ? `已更新 ${compatible.length} 个插件` : `Updated ${compatible.length} plugin(s)`)
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

  const currentTheme = ACCENT_THEMES.find(t => t.id === accentThemeId) ?? ACCENT_THEMES[0]!

  return (
    <div className="settings-stack">
      <Panel className="settings-section appearance-section" padding="none">
        <div className="settings-section-header">
          <div><strong>{t('appearanceTitle', locale)}</strong></div>
        </div>
        <div className="settings-section-body">
          {/* Appearance & Theme card */}
          <Card className={`settings-card theme-card ${themeDropdownOpen ? 'dropdown-open' : ''}`}>
            <div className="theme-copy">
              <h3><Palette />{locale === 'zh' ? '明暗模式' : 'Appearance'}</h3>
            </div>
            <ThemeDropdown
              value={accentThemeId}
              onChange={onAccentThemeChange}
              themes={ACCENT_THEMES}
              onOpenChange={setThemeDropdownOpen}
              locale={locale}
            />
          </Card>

          {/* Theme Color card */}
          <Card className="settings-card scheme-card">
            <div className="theme-copy">
              <h3><Palette />{t('themeColorTitle', locale)}</h3>
            </div>
            <RadioGroup className="scheme-options" aria-label={t('themeColorTitle', locale)}>
              {COLOR_SCHEMES.map(scheme => {
                const label = locale === 'zh' ? (scheme.labelZh ?? scheme.label) : scheme.label
                return (
                  <Button
                    key={scheme.id}
                    type="button"
                    className={colorSchemeId === scheme.id ? 'active' : ''}
                    role="radio"
                    aria-checked={colorSchemeId === scheme.id}
                    tabIndex={colorSchemeId === scheme.id ? 0 : -1}
                    aria-label={label}
                    title={label}
                    onClick={() => onColorSchemeChange(scheme.id)}
                  >
                    <span className="scheme-swatch" style={{ background: scheme.previewColor }} aria-hidden="true" />
                    <span className="scheme-name">{label}</span>
                    {colorSchemeId === scheme.id && <Check size={14} />}
                  </Button>
                )
              })}
            </RadioGroup>
          </Card>

          {/* Language card */}
          <Card className="settings-card language-card">
            <div className="theme-copy">
              <h3><Languages />{t('languageTitle', locale)}</h3>
            </div>
            <RadioGroup className="language-options" aria-label={t('languageTitle', locale)}>
              <Button
                type="button"
                role="radio"
                aria-checked={locale === 'en'}
                aria-label="English (Default)"
                className={locale === 'en' ? 'active' : ''}
                onClick={() => onLocaleChange('en')}
              >
                <span className="lang-code">EN</span>
                <div className="scheme-label-wrap">
                  <strong>{t('langEn', locale)}</strong>
                </div>
                {locale === 'en' && <Check />}
              </Button>
              <Button
                type="button"
                role="radio"
                aria-checked={locale === 'zh'}
                aria-label="Chinese (简体中文)"
                className={locale === 'zh' ? 'active' : ''}
                onClick={() => onLocaleChange('zh')}
              >
                <span className="lang-code">ZH</span>
                <div className="scheme-label-wrap">
                  <strong>{t('langZh', locale)}</strong>
                </div>
                {locale === 'zh' && <Check />}
              </Button>
            </RadioGroup>
          </Card>

          {/* Typography card */}
          <Card className="settings-card font-card">
            <div className="theme-copy">
              <h3><Type />{t('typographyTitle', locale)}</h3>
            </div>
            <RadioGroup className="font-options" aria-label={t('typographyTitle', locale)}>
              {FONT_THEMES.map(theme => (
                <Button
                  key={theme.id}
                  type="button"
                  className={fontThemeId === theme.id ? 'active' : ''}
                  role="radio"
                  aria-checked={fontThemeId === theme.id}
                  tabIndex={fontThemeId === theme.id ? 0 : -1}
                  aria-label={theme.label}
                  onClick={() => onFontThemeChange(theme.id)}
                >
                  <span>{theme.label}</span>
                  {fontThemeId === theme.id && <Check size={14} />}
                </Button>
              ))}
            </RadioGroup>
          </Card>
        </div>
      </Panel>

      <Panel className="settings-section behavior-section" padding="none">
        <div className="settings-section-header">
          <div><strong>{t('generalTitle', locale)}</strong></div>
        </div>
        <div className="settings-section-body">
          <Card className="settings-card appearance-card">
            <div>
              <h3 className="setting-label-help">{t('glassTitle', locale)}<Button className="icon" aria-label={locale === 'zh' ? '毛玻璃说明' : 'About glass'} title={t('glassDesc', locale)}>?</Button></h3>
            </div>
            <Switch aria-label={t('glassTitle', locale)} checked={glassMode === 'enabled'} onCheckedChange={enabled => onGlassModeChange(enabled ? 'enabled' : 'disabled')} />
          </Card>
          <Card className="settings-card">
            <div>
              <h3>{t('launchAtStartup', locale)}</h3>
            </div>
            <Switch aria-label={t('launchAtStartup', locale)} checked={state.launchAtStartup} onCheckedChange={enabled => void onChange(enabled)} />
          </Card>
        </div>
      </Panel>

      <Panel className="settings-section network-section" padding="none">
        <div className="settings-section-header">
          <div><strong>{t('proxyTitle', locale)}</strong></div>
        </div>
        <div className="settings-section-body">
          <Card className="settings-card proxy-card">
            <div className="proxy-copy">
              <div className="dw-segmented proxy-modes" role="group" aria-label={locale === 'zh' ? '代理模式' : 'Proxy Mode'}>
                {([['system', locale === 'zh' ? '系统代理' : 'System'], ['custom', locale === 'zh' ? '自定义' : 'Custom'], ['direct', locale === 'zh' ? '直连' : 'Direct']] as const).map(([mode, label]) => (
                  <Button key={mode} className={proxy.mode === mode ? 'active' : ''} aria-pressed={proxy.mode === mode} onClick={() => updateMode(mode)}>{label}</Button>
                ))}
              </div>
              {proxy.mode === 'custom' && <Input aria-label={locale === 'zh' ? '自定义代理地址' : 'Custom Proxy URL'} value={proxy.url ?? ''} onChange={event => setProxy({ mode: 'custom', url: event.target.value })} placeholder="http://127.0.0.1:7890 or socks5h://127.0.0.1:7890" />}
              {proxyMessage && <small className="proxy-message">{proxyMessage}</small>}
            </div>
            <div className="proxy-actions">
              <Button className="secondary" disabled={proxyBusy !== null} onClick={() => void runProxyAction('test')}>
                {proxyBusy === 'test' ? t('testing', locale) : t('testConnection', locale)}
              </Button>
              <Button className="primary" disabled={proxyBusy !== null} onClick={() => void runProxyAction('save')}>
                {proxyBusy === 'save' ? t('saving', locale) : t('save', locale)}
              </Button>
            </div>
          </Card>
        </div>
      </Panel>

      <Panel className="settings-section updates-section" padding="none">
        <div className="settings-section-header">
          <div><strong>{t('updatesTitle', locale)}</strong></div>
        </div>
        <div className="settings-section-body">
          <Card className="settings-card update-card">
            <div><h3>{t('pluginUpdates', locale)}</h3>{pluginMessage && <small className="update-message">{pluginMessage}</small>}</div>
            <Button className="secondary" disabled={updateBusy !== null} onClick={() => void checkPluginUpdates()}>
              {updateBusy === 'plugin-check' ? <><LoaderCircle className="spin" />{t('checking', locale)}</> : t('checkAllPlugins', locale)}
            </Button>
          </Card>
          <Card className="settings-card update-card">
            <div><h3>{t('coreUpdates', locale)}</h3>{coreMessage && <small className="update-message">{coreMessage}</small>}</div>
            <Button className="secondary" disabled={updateBusy !== null} onClick={() => void checkCoreUpdate()}>
              {updateBusy === 'core-check' ? <><LoaderCircle className="spin" />{t('checking', locale)}</> : t('checkCore', locale)}
            </Button>
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
          locale={locale}
          onCancel={() => { if (!updateBusy) setUpdateDialog(null) }}
          onConfirm={() => void confirmUpdate()}
        />
      )}
    </div>
  )
}

function InstallDialog({ plugin, busy, progress, locale = 'en', onCancel, onConfirm }: { plugin: CatalogPlugin; busy: boolean; progress: UpdateProgress | null; locale?: Locale; onCancel(): void; onConfirm(): void }) {
  return (
    <Dialog open onClose={() => { if (!busy) onCancel() }} className="modal" aria-labelledby="install-title">
        <div className="modal-icon"><ShieldCheck /></div>
        <h2 id="install-title">{locale === 'zh' ? `安装 ${plugin.name}` : `Install ${plugin.name}`}</h2>
        <div className="permission-dialog">
          {plugin.permissions.map(permission => (
            <div key={permission.id}>
              <Check />
              <span>
                <strong>{permissionLabel(permission.id, locale)}</strong>
                <small>{permission.reason}</small>
              </span>
            </div>
          ))}
        </div>
        {busy && <ProgressView progress={progress} fallbackName={plugin.name} locale={locale} />}
        <div className="modal-actions">
          <Button className="secondary" disabled={busy} onClick={onCancel}>{t('cancel', locale)}</Button>
          <Button className="primary" disabled={busy} onClick={onConfirm}>{busy ? <LoaderCircle className="spin" /> : <Download />}{t('installBtn', locale)}</Button>
        </div>
    </Dialog>
  )
}

function UpdateDialogView({ dialog, busy, progress, error, locale = 'en', onCancel, onConfirm }: { dialog: UpdateDialog; busy: boolean; progress: UpdateProgress | null; error: string | null; locale?: Locale; onCancel(): void; onConfirm(): void }) {
  const isPlugins = dialog.kind === 'plugins'
  const compatibleCount = isPlugins ? dialog.updates.filter(update => update.compatible).length : 1
  const matchingProgress = progress && (
    (isPlugins && progress.operation === 'plugin-update') ||
    (!isPlugins && progress.operation === 'core-update')
  ) ? progress : null
  return (
    <Dialog open onClose={() => { if (!busy) onCancel() }} className="modal update-modal" aria-labelledby="update-title">
        <div className="modal-icon"><Download /></div>
        <h2 id="update-title">{isPlugins ? (locale === 'zh' ? `发现 ${dialog.updates.length} 个插件更新` : `Found ${dialog.updates.length} Plugin Updates`) : (locale === 'zh' ? `发现 Digiworld ${dialog.update.version}` : `Digiworld ${dialog.update.version} Available`)}</h2>
        {isPlugins ? (
          <div className="update-list">
            {dialog.updates.map(update => (
              <div key={update.id} className={!update.compatible ? 'incompatible' : ''}>
                <span><strong>{update.name}</strong><small>{update.currentVersion} → {update.version}</small>
                  {update.permissionsChanged && (
                    <span className="permission-changes">
                      {update.addedPermissions.map(permission => <small key={`added:${permission.id}`}><b>{locale === 'zh' ? '新增' : 'Added'} {permissionLabel(permission.id, locale)}</b>: {permission.reason}</small>)}
                      {update.removedPermissions.map(permission => <small key={`removed:${permission.id}`}><b>{locale === 'zh' ? '移除' : 'Removed'} {permissionLabel(permission.id, locale)}</b>: {permission.reason}</small>)}
                      {update.changedPermissions.map(permission => <small key={`changed:${permission.id}`}><b>{locale === 'zh' ? '变更' : 'Changed'} {permissionLabel(permission.id, locale)}</b>: {permission.oldReason} → {permission.newReason}</small>)}
                    </span>
                  )}
                </span>
                <span className="update-flags">
                  {update.permissionsChanged && <small>{locale === 'zh' ? '权限有变化' : 'Permissions Changed'}</small>}
                  {!update.compatible && <small>{locale === 'zh' ? `需 Digiworld ${update.minCoreVersion}` : `Requires Digiworld ${update.minCoreVersion}`}</small>}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="core-release-notes">
            <p>{stateVersionLabel(dialog.update.version, locale)}</p>
            {dialog.update.notes && <pre>{dialog.update.notes}</pre>}
          </div>
        )}
        {!busy && <p className="consent-copy">{locale === 'zh' ? '检查更新不会自动安装。点击下方按钮后才会通过当前代理下载并安装。' : 'Updates will only be downloaded and installed after your confirmation.'}</p>}
        {busy && <ProgressView progress={matchingProgress} fallbackName={isPlugins ? (locale === 'zh' ? '插件更新' : 'Plugin Updates') : `Digiworld ${dialog.update.version}`} locale={locale} />}
        {error && <Status tone="error" className="update-error"><CircleAlert />{error}</Status>}
        <div className="modal-actions">
          <Button className="secondary" disabled={busy} onClick={onCancel}>{t('cancel', locale)}</Button>
          <Button className="primary" disabled={busy || compatibleCount === 0} onClick={onConfirm}>
            {busy ? <LoaderCircle className="spin" /> : <Download />}
            {busy ? (locale === 'zh' ? '正在更新…' : 'Updating...') : isPlugins ? (locale === 'zh' ? `同意并更新 ${compatibleCount} 项` : `Agree & Update ${compatibleCount} items`) : (locale === 'zh' ? '同意并更新' : 'Agree & Update')}
          </Button>
        </div>
    </Dialog>
  )
}

function stateVersionLabel(version: string, locale: Locale = 'en') {
  return locale === 'zh'
    ? `将下载并安装版本 ${version}，安装完成后 Digiworld 会重启。`
    : `Will download and install version ${version}. Digiworld will restart once complete.`
}

function ProgressView({ progress, fallbackName, locale = 'en' }: { progress: UpdateProgress | null; fallbackName: string; locale?: Locale }) {
  const downloading = progress?.stage === 'downloading'
  const percent = downloading && progress.total
    ? Math.min(100, Math.round(progress.downloaded / progress.total * 100))
    : null
  const stageLabel = !progress
    ? t('progressPreparing', locale)
    : downloading
      ? t('progressDownloading', locale)
      : progress.stage === 'completed'
        ? t('progressCompleted', locale)
        : progress.stage === 'failed'
          ? t('progressFailed', locale)
          : t('progressInstalling', locale)
  const currentItem = progress?.stage === 'completed' ? progress.completedItems : (progress?.completedItems ?? 0) + 1
  const itemCount = progress && progress.totalItems > 1 ? ` · ${Math.min(currentItem, progress.totalItems)}/${progress.totalItems}` : ''
  return (
    <div className="update-progress" aria-live="polite">
      <div><strong>{stageLabel}{itemCount}</strong><span>{progress?.itemName ?? fallbackName}</span></div>
      <div className={`progress-track ${percent === null ? 'indeterminate' : ''}`} role="progressbar" aria-label={`${t('updateProgress', locale)}: ${stageLabel}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
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