import type { ReactNode } from 'react'
import { NavigationRail, type NavigationRailItem } from './NavigationRail'
import { PageHeader } from './PageHeader'

export function AppShell({ primary, plugins, settings, title, subtitle, actions, children }: {
  primary: NavigationRailItem[]
  plugins: NavigationRailItem[]
  settings: NavigationRailItem
  title: string
  subtitle?: string | undefined
  actions?: ReactNode | undefined
  children: ReactNode
}) {
  return (
    <div className="app-shell">
      <NavigationRail primary={primary} plugins={plugins} settings={settings} />
      <main className="main">
        <PageHeader title={title} subtitle={subtitle} actions={actions} />
        {children}
      </main>
    </div>
  )
}
