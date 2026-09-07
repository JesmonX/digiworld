import type { ReactNode } from 'react'
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
  return (
    <Button
      title={item.label}
      aria-label={item.label}
      className={`nav-item ${item.active ? 'active' : ''}`}
      onClick={item.onClick}
    >
      <span>{item.icon}</span>
      {item.status && <i className={`state-dot ${item.status}`} aria-label={item.status} />}
    </Button>
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
