import { cloneElement, useEffect, type ReactElement, type KeyboardEvent } from 'react'

/** Adds a shared tooltip without an extra layout box, including for SVG targets. */
export function Tooltip({ content, pointerOnly = false, children }: { content: string; pointerOnly?: boolean; children: ReactElement<Record<string, unknown>> }) {
  return cloneElement(children, { 'data-tooltip': content, 'data-tooltip-pointer-only': pointerOnly ? 'true' : undefined, title: undefined })
}

/** One delegated, top-layer tooltip per document. Mount beside the application root. */
export function TooltipLayer() {
  useEffect(() => {
    const tip = document.createElement('div')
    tip.className = 'dw-tooltip'
    tip.id = `dw-tooltip-${crypto.randomUUID()}`
    tip.setAttribute('role', 'tooltip')
    tip.setAttribute('popover', 'manual')
    tip.hidden = true
    document.body.append(tip)
    let target: Element | null = null
    let originalDescription: string | null = null
    let frame = 0
    let closeTimer = 0
    const close = () => {
      clearTimeout(closeTimer)
      cancelAnimationFrame(frame)
      if (target) {
        if (originalDescription === null) target.removeAttribute('aria-describedby')
        else target.setAttribute('aria-describedby', originalDescription)
      }
      target = null
      tip.removeAttribute('data-variant')
      if (tip.matches(':popover-open')) tip.hidePopover()
      tip.hidden = true
    }
    const position = () => {
      if (!target?.isConnected) { close(); return }
      const rect = target.getBoundingClientRect()
      if (!rect.width || !rect.height || rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth) { close(); return }
      const box = tip.getBoundingClientRect()
      const left = Math.max(8, Math.min(innerWidth - box.width - 8, rect.left + (rect.width - box.width) / 2))
      const top = rect.top >= box.height + 16 ? rect.top - box.height - 8 : Math.min(innerHeight - box.height - 8, rect.bottom + 8)
      tip.style.left = `${left}px`
      tip.style.top = `${Math.max(8, top)}px`
      frame = requestAnimationFrame(position)
    }
    const show = (element: Element) => {
      clearTimeout(closeTimer)
      if (target === element) return
      close()
      const content = element.getAttribute('data-tooltip')
      if (!content) return
      target = element
      originalDescription = element.getAttribute('aria-describedby')
      element.setAttribute('aria-describedby', [originalDescription, tip.id].filter(Boolean).join(' '))
      tip.textContent = content
      const variant = element.getAttribute('data-tooltip-variant') ?? element.closest('[data-tooltip-variant]')?.getAttribute('data-tooltip-variant')
      if (variant) tip.dataset.variant = variant
      else tip.removeAttribute('data-variant')
      tip.hidden = false
      tip.showPopover?.()
      position()
    }
    const enter = (event: Event) => {
      const element = event.target instanceof Element ? event.target.closest('[data-tooltip]') : null
      if (element?.hasAttribute('data-tooltip-pointer-only') && event.type === 'focusin') {
        close()
        return
      }
      if (element) show(element)
    }
    const leave = (event: Event) => {
      const source = event.target
      if (!(source instanceof Node) || (!target?.contains(source) && !tip.contains(source))) return
      const next = (event as MouseEvent).relatedTarget
      if (next instanceof Node && (target?.contains(next) || tip.contains(next))) return
      if (event.type === 'pointerout' && target?.contains(document.activeElement)) return
      closeTimer = window.setTimeout(close, 120)
    }
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') close() }
    tip.addEventListener('pointerenter', () => clearTimeout(closeTimer))
    tip.addEventListener('pointerleave', leave)
    document.addEventListener('pointerover', enter)
    document.addEventListener('focusin', enter)
    document.addEventListener('pointerout', leave)
    document.addEventListener('focusout', leave)
    document.addEventListener('keydown', escape)
    window.addEventListener('blur', close)
    return () => {
      close(); tip.remove()
      document.removeEventListener('pointerover', enter)
      document.removeEventListener('focusin', enter)
      document.removeEventListener('pointerout', leave)
      document.removeEventListener('focusout', leave)
      document.removeEventListener('keydown', escape)
      window.removeEventListener('blur', close)
    }
  }, [])
  return null
}

/** One Tab stop per data region, with arrows/Home/End moving between data points. */
export function rovingDataKeyDown(event: KeyboardEvent<HTMLElement | SVGElement>, selector = '[data-tooltip][tabindex]') {
  const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 1, ArrowUp: -1 }
  if (!(event.key in moves) && event.key !== 'Home' && event.key !== 'End') return
  const items = [...event.currentTarget.querySelectorAll<HTMLElement | SVGElement>(selector)]
  const index = items.indexOf(document.activeElement as HTMLElement)
  if (index < 0 || !items.length) return
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + moves[event.key]! + items.length) % items.length
  event.preventDefault()
  items.forEach((item, i) => item.setAttribute('tabindex', i === next ? '0' : '-1'))
  items[next]!.focus()
}
