import { useState, type ReactNode, type SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@digiworld/design-system/react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { t, type Locale } from '../lib/i18n'

export interface NavigationRailItem {
  id: string
  label: string
  icon: ReactNode
  active: boolean
  status?: string
  onClick(): void
}

function RailButton({ item, collapsed }: { item: NavigationRailItem; collapsed?: boolean }) {
  const [tooltip, setTooltip] = useState<{ top: number; left: number } | null>(null)
  const show = (event: SyntheticEvent<HTMLButtonElement>) => {
    if (!collapsed) return
    const rect = event.currentTarget.getBoundingClientRect()
    setTooltip({ top: rect.top + rect.height / 2, left: rect.right + 12 })
  }
  return (
    <>
    <Button
      title={collapsed ? item.label : undefined}
      aria-label={item.label}
      aria-current={item.active ? 'page' : undefined}
      className={`nav-item ${item.active ? 'active' : ''} ${collapsed ? 'collapsed' : ''}`}
      onClick={item.onClick}
      onMouseEnter={show}
      onFocus={show}
      onMouseLeave={() => setTooltip(null)}
      onBlur={() => setTooltip(null)}
      onKeyDown={event => { if (event.key === 'Escape') setTooltip(null) }}
    >
      <span className="nav-icon">{item.icon}</span>
      {!collapsed && <span className="nav-label">{item.label}</span>}
      {item.status && <i className={`state-dot ${item.status}`} aria-label={item.status} />}
    </Button>
    {tooltip && createPortal(<span role="tooltip" className="rail-tooltip" style={tooltip}>{item.label}</span>, document.body)}
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
          <div className="rail-logo" title="Digiworld" aria-label="Digiworld"><span aria-hidden="true" /></div>
          {!collapsed && (
            <div className="brand-text">
              <span className="brand-title">Digiworld</span>
              <span className="brand-sub">Digital Hub</span>
            </div>
          )}
        </div>
        {onToggleCollapse && (
          <button
            type="button"
            className="collapse-toggle-btn"
            onClick={onToggleCollapse}
            aria-label={collapsed ? t('expandSidebar', locale) : t('collapseSidebar', locale)}
            title={collapsed ? t('expandSidebar', locale) : t('collapseSidebar', locale)}
          >
            {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>
        )}
      </div>

      <div className="sidebar-scroll">
        <div className="sidebar-section">
          {!collapsed && <div className="sidebar-section-header"><span>{t('menu', locale)}</span></div>}
          <nav className="rail-primary" aria-label="工作台">
            {primary.map(item => <RailButton key={item.id} item={item} collapsed={collapsed} />)}
          </nav>
        </div>

        {plugins.length > 0 && (
          <>
            <div className="rail-divider" aria-hidden="true" />
            <div className="sidebar-section">
              {!collapsed && <div className="sidebar-section-header"><span>{t('installedSection', locale)}</span></div>}
              <nav className="rail-plugins" aria-label="已安装插件">
                {plugins.map(item => <RailButton key={item.id} item={item} collapsed={collapsed} />)}
              </nav>
            </div>
          </>
        )}
      </div>

      <div className="rail-divider" aria-hidden="true" />
      <div className="sidebar-bottom-section">
        {!collapsed && <div className="sidebar-section-header"><span>{t('systemSection', locale)}</span></div>}
        <nav className="sidebar-bottom" aria-label="系统">
          <RailButton item={settings} collapsed={collapsed} />
        </nav>
      </div>
    </aside>
  )
}
