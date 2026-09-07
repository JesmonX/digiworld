import { useState, type ReactNode, type SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@digiworld/design-system/react'

export interface NavigationRailItem {
  id: string
  label: string
  icon: ReactNode
  active: boolean
  status?: string
  onClick(): void
}
function RailButton({ item }: { item: NavigationRailItem }) {
  const [tooltip, setTooltip] = useState<{ top: number; left: number } | null>(null)
  const show = (event: SyntheticEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setTooltip({ top: rect.top + rect.height / 2, left: rect.right + 12 })
  }
  return (
    <>
    <Button
      title={item.label}
      aria-label={item.label}
      aria-current={item.active ? 'page' : undefined}
      className={`nav-item ${item.active ? 'active' : ''}`}
      onClick={item.onClick}
      onMouseEnter={show}
      onFocus={show}
      onMouseLeave={() => setTooltip(null)}
      onBlur={() => setTooltip(null)}
      onKeyDown={event => { if (event.key === 'Escape') setTooltip(null) }}
    >
      <span>{item.icon}</span>
      {item.status && <i className={`state-dot ${item.status}`} aria-label={item.status} />}
    </Button>
    {tooltip && createPortal(<span role="tooltip" className="rail-tooltip" style={tooltip}>{item.label}</span>, document.body)}
    </>
  )
}

export function NavigationRail({ primary, plugins, settings }: { primary: NavigationRailItem[]; plugins: NavigationRailItem[]; settings: NavigationRailItem }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-scroll">
        <div className="rail-logo" title="Digiworld" aria-label="Digiworld"><span aria-hidden="true" /></div>
        <nav className="rail-primary" aria-label="工作台">{primary.map(item => <RailButton key={item.id} item={item} />)}</nav>
        {plugins.length > 0 && <>
          <div className="rail-divider" aria-hidden="true" />
          <nav className="rail-plugins" aria-label="已安装插件">{plugins.map(item => <RailButton key={item.id} item={item} />)}</nav>
        </>}
      </div>
      <nav className="sidebar-bottom" aria-label="系统"><RailButton item={settings} /></nav>
    </aside>
  )
}
