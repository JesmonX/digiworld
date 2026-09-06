import { Status } from '@digiworld/design-system/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { CircleAlert, Pause } from 'lucide-react'
import { suppressContextMenu, type CatalogIndex, type CatalogPlugin, type PluginSummary } from '@digiworld/plugin-sdk'
import { PluginFrame } from './components/PluginFrame'
import { Loading } from './components/Loading'
import { PluginManagement } from './components/plugin/PluginManagement'
import { NavigationRail } from './layout/NavigationRail'
import { PageHeader } from './layout/PageHeader'
import { HomePage } from './pages/HomePage'
import { CatalogPage, InstallDialog } from './pages/CatalogPage'
import { SettingsPage } from './pages/SettingsPage'
import { api, type AppState, type UpdateProgress } from './lib/api'
import {
  themeStyle,
  type ColorSchemeId, getAccentTheme, getFontTheme, loadAccentThemeId, loadColorSchemeId,
  loadFontThemeId, loadFontWeight, pluginTheme, saveAccentThemeId, saveColorSchemeId, saveFontThemeId,
  saveFontWeight, loadGlassMode, saveGlassMode, type AccentThemeId, type FontThemeId, type FontWeight, type GlassMode,
} from './theme'
import './styles.css'

export type Page = 'home' | 'catalog' | 'settings' | { pluginId: string }

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

export function App() {
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

  const pluginOpen = typeof page !== 'string'

  const { headerTitle, headerSubtitle } = useMemo(() => {
    if (page === 'home') return { headerTitle: 'Dashboard', headerSubtitle: '你的本地数字工作台' }
    if (page === 'catalog') return { headerTitle: '功能库', headerSubtitle: '浏览并安装可用插件' }
    if (page === 'settings') return { headerTitle: '设置', headerSubtitle: '个性化外观与应用偏好' }
    return { headerTitle: selectedPlugin?.name ?? '插件', headerSubtitle: undefined }
  }, [page, selectedPlugin])

  useEffect(() => setPluginMenuOpen(false), [page])

  return (
    <div
      className={`app-window glass-${glassMode} ${pluginOpen ? 'plugin-open' : ''}`}
      data-dw-glass={glassMode}
      style={themeStyle(activeTheme)}
    >
      <div className="app-shell">
        <NavigationRail
          page={page}
          plugins={state?.plugins ?? []}
          onNavigate={setPage}
        />

        <main className="main">
          <PageHeader
            title={headerTitle}
            subtitle={headerSubtitle}
            actions={
              selectedPlugin ? (
                <PluginManagement
                  plugin={selectedPlugin}
                  busy={busy === selectedPlugin.id}
                  menuOpen={pluginMenuOpen}
                  onMenuOpenChange={setPluginMenuOpen}
                  onToggleEnabled={() => void manageEnabled(selectedPlugin, !selectedPlugin.enabled)}
                  onUninstall={() => void uninstall(selectedPlugin)}
                />
              ) : undefined
            }
          />

          {error && (
            <Status tone="error" className="error-banner">
              <CircleAlert />
              <span>{error}</span>
              <button type="button" onClick={() => setError(null)}>关闭</button>
            </Status>
          )}

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
                  {page === 'home' && (
                    <HomePage
                      plugins={state?.plugins ?? []}
                      version={state?.version}
                      onCatalog={() => setPage('catalog')}
                      onOpen={id => setPage({ pluginId: id })}
                      onRefresh={() => { void refreshState().catch(reason => setError(errorMessage(reason))) }}
                      reducedMotion={Boolean(reduceMotion)}
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
        </main>
      </div>

      {confirmInstall && (
        <InstallDialog
          plugin={confirmInstall}
          busy={busy === confirmInstall.id}
          progress={updateProgress?.operation === 'plugin-install' && updateProgress.itemId === confirmInstall.id ? updateProgress : null}
          onCancel={() => setConfirmInstall(null)}
          onConfirm={() => { setUpdateProgress(null); void install(confirmInstall) }}
        />
      )}
    </div>
  )
}

export default App
