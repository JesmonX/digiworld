import React, { useEffect, useState } from 'react'
import { Button, Input, Panel, Dialog, Switch, Status, RadioGroup } from '@digiworld/design-system/react'
import { Check, CircleAlert, Download, LoaderCircle, Network, Palette, ShieldCheck, Sparkles, Type } from 'lucide-react'
import { ThemeDropdown } from '../components/ThemeDropdown'
import {
  api, type AppState, type CoreUpdateInfo, type PluginUpdateInfo, type ProxyMode,
  type ProxySettings, type UpdateProgress,
} from '../lib/api'
import {
  ACCENT_THEMES, FONT_THEMES, COLOR_SCHEMES, getColorSchemePreview,
  type ColorSchemeId, type AccentThemeId, type FontThemeId, type FontWeight, type GlassMode,
} from '../theme'
import { permissionLabel } from '../components/plugin/PluginManagement'

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

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
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

export type UpdateDialog =
  | { kind: 'plugins'; updates: PluginUpdateInfo[] }
  | { kind: 'core'; update: CoreUpdateInfo }

export function UpdateDialogView({ dialog, busy, progress, error, onCancel, onConfirm }: { dialog: UpdateDialog; busy: boolean; progress: UpdateProgress | null; error: string | null; onCancel(): void; onConfirm(): void }) {
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
        <Button className="secondary compact" disabled={busy} onClick={onCancel}>取消</Button>
        <Button className="primary compact" disabled={busy || compatibleCount === 0} onClick={onConfirm}>
          {busy ? <LoaderCircle className="spin" /> : <Download />}
          {busy ? '正在更新…' : isPlugins ? `同意并更新 ${compatibleCount} 项` : '同意并更新'}
        </Button>
      </div>
    </Dialog>
  )
}

export function SettingsPage({
  state,
  progress,
  onProgressReset,
  onPluginsUpdated,
  accentThemeId,
  onAccentThemeChange,
  colorSchemeId,
  onColorSchemeChange,
  fontThemeId,
  onFontThemeChange,
  fontWeight,
  onFontWeightChange,
  glassMode,
  onGlassModeChange,
  onChange,
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
      {/* Section 1: Appearance */}
      <section className="settings-group">
        <h2 className="settings-group-title"><Sparkles />外观与视觉</h2>
        <Panel className="settings-section-panel" padding="lg">
          {/* Theme Color */}
          <div className={`setting-row ${themeDropdownOpen ? 'dropdown-open' : ''}`}>
            <div className="setting-label">
              <h3><Palette />主题颜色</h3>
            </div>
            <div className="setting-control">
              <ThemeDropdown
                value={accentThemeId}
                onChange={onAccentThemeChange}
                themes={ACCENT_THEMES}
                onOpenChange={setThemeDropdownOpen}
              />
            </div>
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

          <div className="setting-row-divider" />

          {/* Color Scheme */}
          <div className="setting-row vertical">
            <div className="setting-label">
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
          </div>

          <div className="setting-row-divider" />

          {/* Font Theme */}
          <div className="setting-row vertical">
            <div className="setting-label">
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
          </div>

          <div className="setting-row-divider" />

          {/* Font Weight */}
          <div className="setting-row">
            <div className="setting-label">
              <h3><Type />字体粗细</h3>
            </div>
            <div className="weight-control">
              <div><span>标准</span><span>清晰</span><span>粗重</span></div>
              <Input aria-label="字体粗细" type="range" min="400" max="600" step="100" value={fontWeight} onChange={event => onFontWeightChange(Number(event.target.value) as FontWeight)} />
              <output>{fontWeight}</output>
            </div>
          </div>

          <div className="setting-row-divider" />

          {/* Glass Mode */}
          <div className="setting-row">
            <div className="setting-label">
              <h3>玻璃效果</h3>
            </div>
            <Switch aria-label="切换玻璃效果" checked={glassMode === 'enabled'} onCheckedChange={enabled => onGlassModeChange(enabled ? 'enabled' : 'disabled')} />
          </div>
        </Panel>
      </section>

      {/* Section 2: Network */}
      <section className="settings-group">
        <h2 className="settings-group-title"><Network />网络与代理</h2>
        <Panel className="settings-section-panel" padding="lg">
          <div className="setting-row vertical">
            <div className="setting-label">
              <h3><Network />网络代理</h3>
            </div>
            <div className="dw-segmented proxy-modes" role="group" aria-label="代理模式">
              {([['system', '系统代理'], ['custom', '自定义'], ['direct', '直连']] as const).map(([mode, label]) => (
                <Button key={mode} className={proxy.mode === mode ? 'active' : ''} aria-pressed={proxy.mode === mode} onClick={() => updateMode(mode)}>{label}</Button>
              ))}
            </div>
            {proxy.mode === 'custom' && (
              <Input
                aria-label="自定义代理地址"
                value={proxy.url ?? ''}
                onChange={event => setProxy({ mode: 'custom', url: event.target.value })}
                placeholder="http://127.0.0.1:7890 或 socks5h://127.0.0.1:7890"
              />
            )}
            {proxyMessage && <small className="proxy-message">{proxyMessage}</small>}
            <div className="proxy-actions">
              <Button className="secondary compact" disabled={proxyBusy !== null} onClick={() => void runProxyAction('test')}>
                {proxyBusy === 'test' ? '测试中…' : '测试连接'}
              </Button>
              <Button className="primary compact" disabled={proxyBusy !== null} onClick={() => void runProxyAction('save')}>
                {proxyBusy === 'save' ? '保存中…' : '保存'}
              </Button>
            </div>
          </div>
        </Panel>
      </section>

      {/* Section 3: Application */}
      <section className="settings-group">
        <h2 className="settings-group-title"><ShieldCheck />系统与更新</h2>
        <Panel className="settings-section-panel" padding="lg">
          <div className="setting-row">
            <div className="setting-label">
              <h3>开机启动</h3>
            </div>
            <Switch aria-label="切换开机启动" checked={state.launchAtStartup} onCheckedChange={enabled => void onChange(enabled)} />
          </div>

          <div className="setting-row-divider" />

          <div className="setting-row">
            <div className="setting-label">
              <h3>插件更新</h3>
              {pluginMessage && <small className="update-message">{pluginMessage}</small>}
            </div>
            <Button className="secondary compact" disabled={updateBusy !== null} onClick={() => void checkPluginUpdates()}>
              {updateBusy === 'plugin-check' ? <><LoaderCircle className="spin" />检查中…</> : '检查全部插件'}
            </Button>
          </div>

          <div className="setting-row-divider" />

          <div className="setting-row">
            <div className="setting-label">
              <h3>主程序更新</h3>
              {coreMessage && <small className="update-message">{coreMessage}</small>}
            </div>
            <Button className="secondary compact" disabled={updateBusy !== null} onClick={() => void checkCoreUpdate()}>
              {updateBusy === 'core-check' ? <><LoaderCircle className="spin" />检查中…</> : '检查主程序'}
            </Button>
          </div>

          <div className="setting-row-divider" />

          <div className="version-line"><ShieldCheck /> Digiworld {state.version}</div>
        </Panel>
      </section>

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
