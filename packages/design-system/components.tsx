export { Tooltip, TooltipLayer, rovingDataKeyDown } from './tooltip'
import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react'
import './components.css'
import './layouts.css'
export { PluginPage, PageToolbar, Section, MetricGrid, SplitPane, MasterDetail, EmptyState, LoadingState, FormField } from './layouts'

export interface PanelProps extends ComponentProps<'section'> {
  variant?: 'default' | 'raised' | 'inset'
  padding?: 'none' | 'sm' | 'md' | 'lg'
}

function hasText(node: ReactNode): boolean {
  if (typeof node === 'string' || typeof node === 'number') return Boolean(String(node).trim())
  if (Array.isArray(node)) return node.some(hasText)
  if (node && typeof node === 'object' && 'props' in node) return hasText((node.props as { children?: ReactNode }).children)
  return false
}

export function Button({ className = '', variant, ...props }: ComponentProps<'button'> & { variant?: 'primary' | 'secondary' | 'danger'; 'data-tooltip'?: string }) {
  const iconOnly = !hasText(props.children)
  const tooltip = props['data-tooltip'] ?? props.title ?? (iconOnly ? props['aria-label'] : undefined)
  return <button type="button" {...props} title={undefined} aria-label={props['aria-label'] ?? (iconOnly ? props.title : undefined)} data-tooltip={tooltip} className={`dw-button ${variant ?? ''} ${className}`} />
}
export function Input({ className = '', ...props }: ComponentProps<'input'>) { return <input {...props} className={`dw-input ${className}`} /> }
export function Select({ className = '', ...props }: ComponentProps<'select'>) { return <select {...props} className={`dw-select ${className}`} /> }
export function Textarea({ className = '', ...props }: ComponentProps<'textarea'>) { return <textarea {...props} className={`dw-textarea ${className}`} /> }
export function Card({ className = '', ...props }: ComponentProps<'article'>) { return <article {...props} className={`dw-card ${className}`} /> }
export function Panel({ className = '', variant = 'default', padding = 'md', ...props }: PanelProps) {
  return <section {...props} className={`dw-panel dw-panel-${variant} dw-panel-padding-${padding} ${className}`} />
}
export function Metric({ label, value, unit, hint, className = '' }: { label: ReactNode; value: ReactNode; unit?: ReactNode; hint?: ReactNode; className?: string }) {
  return <div className={`dw-metric ${className}`}><span className="dw-metric-label">{label}</span><strong className="dw-metric-value">{value}{unit && <span className="dw-metric-unit">{unit}</span>}</strong>{hint && <span className="dw-metric-hint">{hint}</span>}</div>
}
export function Progress({ value, max = 100, label, secondaryLabel, tone = 'accent', emphasized = false, showValue = true, className = '' }: { value: number; max?: number; label?: ReactNode; secondaryLabel?: ReactNode; tone?: 'accent' | 'success' | 'warning' | 'danger'; emphasized?: boolean; showValue?: boolean; className?: string }) {
  const percent = Math.max(0, Math.min(100, max > 0 ? value / max * 100 : 0))
  return <div className={`dw-progress dw-progress-${tone} ${emphasized ? 'dw-progress-emphasized' : ''} ${className}`}>{showValue && <div className="dw-progress-header">{label && <span className="dw-progress-label">{label}</span>}<span className="dw-progress-value">{secondaryLabel ?? `${Math.round(percent)}%`}</span></div>}<div className="dw-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(max, Math.max(0, value))} aria-label={typeof label === 'string' ? label : undefined}><span style={{ width: `${percent}%` }} /></div></div>
}
export function Toolbar({ className = '', ...props }: ComponentProps<'div'>) { return <div {...props} className={`dw-toolbar ${className}`} /> }
export function Segmented({ className = '', ...props }: ComponentProps<'div'>) { return <div role="group" {...props} className={`dw-segmented ${className}`} /> }
export function RadioGroup({ onKeyDown, ...props }: ComponentProps<'div'>) {
  return <div role="radiogroup" {...props} onKeyDown={event => {
    onKeyDown?.(event)
    if (event.defaultPrevented || !['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return
    const choices = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=radio]:not(:disabled)')]
    if (!choices.length) return
    const index = choices.indexOf(document.activeElement as HTMLButtonElement)
    const next = choices[(index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + choices.length) % choices.length]!
    event.preventDefault(); next.focus(); next.click()
  }} />
}
export function Status({ tone = 'info', className = '', ...props }: ComponentProps<'div'> & { tone?: 'info' | 'error' | 'success' }) { return <div role={tone === 'error' ? 'alert' : 'status'} {...props} data-tone={tone} className={`dw-status ${className}`} /> }
export function Switch({ checked, onCheckedChange, ...props }: Omit<ComponentProps<'button'>, 'onChange'> & { checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return <button type="button" {...props} className="dw-switch" role="switch" aria-checked={checked} onClick={() => onCheckedChange(!checked)}><span /></button>
}
export function Dialog({ open, onClose, children, ...props }: Omit<ComponentProps<'dialog'>, 'onClose'> & { open: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current!
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    if (!dialog.open) {
      if (dialog.showModal) dialog.showModal()
      else dialog.setAttribute('open', '')
    }
    return () => {
      if (dialog.open) {
        if (dialog.close) dialog.close()
        else dialog.removeAttribute('open')
      }
      if (opener?.isConnected) opener.focus()
    }
  }, [open])
  return <dialog {...props} ref={ref} className={`dw-dialog ${props.className ?? ''}`} onKeyDown={event => {
    props.onKeyDown?.(event)
    if (event.defaultPrevented || event.key !== 'Tab') return
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], summary, [tabindex]')]
      .filter(el => !el.matches(':disabled') && el.tabIndex >= 0 && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')
    const index = items.indexOf(document.activeElement as HTMLElement)
    if (!items.length) { event.preventDefault(); return }
    if (event.shiftKey && index <= 0) { event.preventDefault(); items.at(-1)!.focus() }
    else if (!event.shiftKey && (index === items.length - 1 || index < 0)) { event.preventDefault(); items[0]!.focus() }
  }} onCancel={event => { event.preventDefault(); onClose() }}>{children}</dialog>
}
export function Menu({ className = '', onKeyDown, ...props }: ComponentProps<'div'>) {
  return <div role="menu" {...props} className={`dw-menu ${className}`} onKeyDown={event => {
    onKeyDown?.(event)
    if (event.defaultPrevented || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
    if (!items.length) return
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
    event.preventDefault(); items[next]?.focus()
  }} />
}
