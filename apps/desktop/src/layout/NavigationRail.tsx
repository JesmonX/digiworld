import React from 'react'
import { Button } from '@digiworld/design-system/react'
import { Gauge, Library, Settings } from 'lucide-react'
import type { PluginSummary } from '@digiworld/plugin-sdk'
import { PluginIcon } from '../components/PluginIcon'
import type { Page } from '../App'

export interface NavigationRailProps {
  page: Page
  plugins: PluginSummary[]
  onNavigate(page: Page): void
}

export function NavigationRail({ page, plugins, onNavigate }: NavigationRailProps) {
  const isPluginOpen = typeof page !== 'string'
  const activePluginId = isPluginOpen ? page.pluginId : null

  return (
    <aside className="nav-rail" aria-label="主导航">
      {/* Brand Logo */}
      <div className="nav-rail-brand" data-tauri-drag-region>
        <button
          type="button"
          className="nav-brand-button"
          aria-label="Digiworld 首页"
          title="Digiworld"
          onClick={() => onNavigate('home')}
        >
          <span className="nav-brand-mark" aria-hidden="true" />
        </button>
      </div>

      <nav className="nav-rail-group" aria-label="工作台">
        <span className="sidebar-section-label dw-sr-only">工作台</span>
        <button
          type="button"
          aria-label="概览"
          title="概览"
          className={`nav-rail-item ${page === 'home' ? 'active' : ''}`}
          onClick={() => onNavigate('home')}
        >
          <Gauge aria-hidden="true" />
          <span className="dw-sr-only">概览</span>
        </button>
        <button
          type="button"
          aria-label="功能库"
          title="功能库"
          className={`nav-rail-item ${page === 'catalog' ? 'active' : ''}`}
          onClick={() => onNavigate('catalog')}
        >
          <Library aria-hidden="true" />
          <span className="dw-sr-only">功能库</span>
        </button>
      </nav>

      {plugins.length > 0 && (
        <div className="nav-rail-divider" role="separator" aria-hidden="true" />
      )}

      {plugins.length > 0 && (
        <nav className="nav-rail-plugins" aria-label="已安装插件">
          <span className="sidebar-section-label dw-sr-only">已安装</span>
          {plugins.map(plugin => {
            const isActive = activePluginId === plugin.id
            const hasStatus = plugin.state === 'running' || plugin.state === 'failed'
            return (
              <button
                key={plugin.id}
                type="button"
                aria-label={plugin.name}
                title={plugin.name}
                className={`nav-rail-item ${isActive ? 'active' : ''}`}
                onClick={() => onNavigate({ pluginId: plugin.id })}
              >
                <span className="nav-rail-icon">
                  <PluginIcon plugin={plugin} />
                </span>
                {hasStatus && (
                  <span className={`state-dot ${plugin.state}`} aria-hidden="true" />
                )}
                <span className="dw-sr-only">{plugin.name}</span>
              </button>
            )
          })}
        </nav>
      )}

      <div className="nav-rail-spacer" />

      <nav className="nav-rail-group nav-rail-bottom" aria-label="系统">
        <span className="sidebar-section-label dw-sr-only">系统</span>
        <button
          type="button"
          aria-label="设置"
          title="设置"
          className={`nav-rail-item ${page === 'settings' ? 'active' : ''}`}
          onClick={() => onNavigate('settings')}
        >
          <Settings aria-hidden="true" />
          <span className="dw-sr-only">设置</span>
        </button>
      </nav>
    </aside>
  )
}
