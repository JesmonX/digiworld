import React, { type ReactNode } from 'react'
import { WindowControls } from './WindowControls'

export interface PageHeaderProps {
  title: string
  subtitle?: string | undefined
  actions?: ReactNode
  showWindowControls?: boolean
}

export function PageHeader({
  title,
  subtitle,
  actions,
  showWindowControls = true,
}: PageHeaderProps) {
  return (
    <header className="page-header" data-tauri-drag-region>
      <div className="page-header-titles" data-tauri-drag-region>
        <h1>{title}</h1>
        {subtitle && <p className="page-header-subtitle">{subtitle}</p>}
      </div>
      <div className="page-header-right">
        {actions && <div className="page-header-actions">{actions}</div>}
        {showWindowControls && <WindowControls />}
      </div>
    </header>
  )
}
