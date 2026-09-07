import { useId, type ComponentProps, type ReactNode } from 'react'
import { Button } from './components'

export function PluginPage({ toolbar, scroll = 'page', className = '', children, ...props }: ComponentProps<'main'> & { toolbar?: ReactNode; scroll?: 'page' | 'panes' }) {
  return <main {...props} className={`dw-page dw-page-${scroll} ${className}`}>{toolbar}{children}</main>
}

export function PageToolbar({ filters, actions, children, className = '', ...props }: ComponentProps<'header'> & { filters?: ReactNode; actions?: ReactNode }) {
  return <header {...props} className={`dw-toolbar dw-page-toolbar ${className}`}>{filters && <div className="dw-toolbar-filters">{filters}</div>}{children}{actions && <div className="dw-toolbar-actions">{actions}</div>}</header>
}

export function Section({ title, description, actions, children, className = '', ...props }: Omit<ComponentProps<'section'>, 'title'> & { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  const id = useId()
  return <section {...props} aria-labelledby={id} className={`dw-section ${className}`}><header className="dw-section-heading"><div><h2 id={id}>{title}</h2>{description && <p>{description}</p>}</div>{actions && <div className="dw-toolbar-actions">{actions}</div>}</header>{children}</section>
}

export function MetricGrid({ className = '', ...props }: ComponentProps<'div'>) {
  return <div {...props} className={`dw-metric-grid ${className}`} />
}

export function SplitPane({ aside, side = 'left', children, className = '', ...props }: ComponentProps<'div'> & { aside: ReactNode; side?: 'left' | 'right' }) {
  return <div {...props} className={`dw-split-pane dw-split-${side} ${className}`}><aside className="dw-split-aside">{aside}</aside><div className="dw-split-main">{children}</div></div>
}

export function MasterDetail({ list, detail, selected, onBack, backLabel = '返回列表', className = '', ...props }: ComponentProps<'div'> & { list: ReactNode; detail: ReactNode; selected: boolean; onBack(): void; backLabel?: string }) {
  return <div {...props} className={`dw-master-detail ${selected ? 'dw-detail-selected' : ''} ${className}`}><div className="dw-master-list">{list}</div><div className="dw-master-content"><Button className="dw-master-back" onClick={onBack}>{backLabel}</Button>{detail}</div></div>
}

export function EmptyState({ icon, title, description, action, className = '', ...props }: Omit<ComponentProps<'div'>, 'title'> & { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return <div {...props} className={`dw-empty-state ${className}`}>{icon && <span className="dw-empty-icon" aria-hidden="true">{icon}</span>}<strong>{title}</strong>{description && <p>{description}</p>}{action}</div>
}

export function LoadingState({ label = '正在载入…' }: { label?: string }) {
  return <EmptyState role="status" aria-live="polite" title={label} />
}

export function FormField({ label, hint, error, children, className = '', ...props }: ComponentProps<'label'> & { label: ReactNode; hint?: ReactNode; error?: ReactNode }) {
  return <label {...props} className={`dw-form-field ${className}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}{error && <small role="alert" className="dw-field-error">{error}</small>}</label>
}
