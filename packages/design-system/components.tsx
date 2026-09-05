import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react'
import './components.css'

export function Button({ className = '', variant, ...props }: ComponentProps<'button'> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  return <button type="button" {...props} className={`dw-button ${variant ?? ''} ${className}`} />
}
export function Input({ className = '', ...props }: ComponentProps<'input'>) { return <input {...props} className={`dw-input ${className}`} /> }
export function Select({ className = '', ...props }: ComponentProps<'select'>) { return <select {...props} className={`dw-select ${className}`} /> }
export function Textarea({ className = '', ...props }: ComponentProps<'textarea'>) { return <textarea {...props} className={`dw-textarea ${className}`} /> }
export function Card({ className = '', ...props }: ComponentProps<'article'>) { return <article {...props} className={`dw-card ${className}`} /> }
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
    if (open && !dialog.open) {
      if (dialog.showModal) dialog.showModal()
      else dialog.setAttribute('open', '')
    } else if (!open && dialog.open) {
      if (dialog.close) dialog.close()
      else dialog.removeAttribute('open')
    }
  }, [open])
  return <dialog {...props} ref={ref} className={`dw-dialog ${props.className ?? ''}`} onCancel={event => { event.preventDefault(); onClose() }}>{children}</dialog>
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
