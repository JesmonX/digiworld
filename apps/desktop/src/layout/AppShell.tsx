import type { ReactNode } from 'react'
import { NavigationRail, type NavigationRailItem } from './NavigationRail'
import { PageHeader } from './PageHeader'
import type { Locale } from '../lib/i18n'

export function AppShell({
  primary,
  plugins,
  settings,
  title,
  subtitle,
  actions,
  collapsed,
  onToggleCollapse,
  locale,
  children
}: {
  primary: NavigationRailItem[]
  plugins: NavigationRailItem[]
  settings: NavigationRailItem
  title: string
  subtitle?: string | undefined
  actions?: ReactNode | undefined
  collapsed?: boolean
  onToggleCollapse?(): void
  locale?: Locale
  children: ReactNode
}) {
  return (
    <div className={`app-shell ${collapsed ? 'shell-collapsed' : 'shell-expanded'}`}>
      <NavigationRail
        primary={primary}
        plugins={plugins}
        settings={settings}
        collapsed={collapsed ?? false}
        onToggleCollapse={onToggleCollapse}
        locale={locale}
      />
      <main className="main">
        <PageHeader title={title} subtitle={subtitle} actions={actions} />
        {children}
      </main>
    </div>
  )
}
