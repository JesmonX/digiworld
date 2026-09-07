import type { ReactNode } from 'react'
import { Button } from '@digiworld/design-system/react'
import { t, type Locale } from '../lib/i18n'

export interface NavigationRailItem {
  id: string
  label: string
  icon: ReactNode
  active: boolean
  status?: string
  onClick(): void
}

const LOCALIZED_STATES = new Set(['running', 'starting', 'paused', 'failed', 'disabled', 'installed'])

function localizedState(status: string | undefined, locale: Locale): string | undefined {
  if (!status) return undefined
  if (!LOCALIZED_STATES.has(status)) return status
  return t(status as 'running' | 'starting' | 'paused' | 'failed' | 'disabled' | 'installed', locale)
}

function RailButton({ item, collapsed, locale }: { item: NavigationRailItem; collapsed?: boolean; locale: Locale }) {
  const status = localizedState(item.status, locale)
  const accessibleLabel = status ? `${item.label}, ${status}` : item.label
  const statusId = status ? `nav-status-${item.id}` : undefined

  return (
    <>
    <Button
      title={collapsed ? accessibleLabel : undefined}
      aria-label={item.label}
      aria-describedby={statusId}
      aria-current={item.active ? 'page' : undefined}
      className={`nav-item ${item.active ? 'active' : ''} ${collapsed ? 'collapsed' : ''}`}
      onClick={item.onClick}
    >
      <span className="nav-icon">{item.icon}</span>
      {!collapsed && <span className="nav-label">{item.label}</span>}
      {item.status && <i className={`state-dot ${item.status}`} aria-hidden="true" />}
      {status && <span id={statusId} className="dw-sr-only">{status}</span>}
    </Button>
    </>
  )
}

export function NavigationRail({
  primary,
  plugins,
  settings,
  collapsed = false,
  onToggleCollapse,
  locale = 'en',
}: {
  primary: NavigationRailItem[]
  plugins: NavigationRailItem[]
  settings: NavigationRailItem
  collapsed?: boolean | undefined
  onToggleCollapse?: (() => void) | undefined
  locale?: Locale | undefined
}) {
  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : 'expanded'}`}>
      <div className="sidebar-header">
        <div className="brand-container">
          <button
            type="button"
            className="rail-logo collapse-trigger"
            onClick={onToggleCollapse}
            aria-label={collapsed ? t('expandSidebar', locale) : t('collapseSidebar', locale)}
            data-tooltip={collapsed ? t('expandSidebar', locale) : t('collapseSidebar', locale)}
          >
            <span aria-hidden="true" />
          </button>
          {!collapsed && (
            <div className="brand-text">
              <span className="brand-title">Digiworld</span>
            </div>
          )}
        </div>
      </div>

      <div className="sidebar-scroll">
        <div className="sidebar-section">
          {!collapsed && <div className="sidebar-section-header"><span>{t('menu', locale)}</span></div>}
          <nav className="rail-primary" aria-label={t('workspaceNavLabel', locale)}>
            {primary.map(item => <RailButton key={item.id} item={item} collapsed={collapsed} locale={locale} />)}
          </nav>
        </div>

        {plugins.length > 0 && (
          <>
            <div className="rail-divider" aria-hidden="true" />
            <div className="sidebar-section">
              {!collapsed && <div className="sidebar-section-header"><span>{t('installedSection', locale)}</span></div>}
              <nav className="rail-plugins" aria-label={t('installedPluginsNavLabel', locale)}>
                {plugins.map(item => <RailButton key={item.id} item={item} collapsed={collapsed} locale={locale} />)}
              </nav>
            </div>
          </>
        )}
      </div>

      <div className="rail-divider" aria-hidden="true" />
      <div className="sidebar-bottom-section">
        {!collapsed && <div className="sidebar-section-header"><span>{t('systemSection', locale)}</span></div>}
        <nav className="sidebar-bottom" aria-label={t('systemNavLabel', locale)}>
          <RailButton item={settings} collapsed={collapsed} locale={locale} />
        </nav>
      </div>
    </aside>
  )
}
