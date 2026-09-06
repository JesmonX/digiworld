import React, { type ReactNode } from 'react'
import { NavigationRail } from './NavigationRail'
import type { PluginSummary } from '@digiworld/plugin-sdk'
import type { Page } from '../App'

export interface AppShellProps {
  page: Page
  plugins: PluginSummary[]
  onNavigate(page: Page): void
  header: ReactNode
  children: ReactNode
}

export function AppShell({ page, plugins, onNavigate, header, children }: AppShellProps) {
  return (
    <div className="app-shell">
      <NavigationRail page={page} plugins={plugins} onNavigate={onNavigate} />
      <main className="main">
        {header}
        {children}
      </main>
    </div>
  )
}
