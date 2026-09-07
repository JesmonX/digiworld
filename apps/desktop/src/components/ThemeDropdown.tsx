import { useState, useRef, useEffect, useCallback, type CSSProperties, type KeyboardEvent } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import type { AccentThemeId, AccentTheme } from '../theme'
import type { Locale } from '../lib/i18n'

export interface ThemeDropdownProps {
  value: AccentThemeId
  onChange(id: AccentThemeId): void
  themes: AccentTheme[]
  onOpenChange?(open: boolean): void
  locale?: Locale
}

export function ThemeDropdown({ value, onChange, themes, onOpenChange, locale = 'en' }: ThemeDropdownProps) {
  const [open, setOpen] = useState(false)
  const [highlightedId, setHighlightedId] = useState<AccentThemeId>(value)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listboxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    onOpenChange?.(open)
  }, [open, onOpenChange])

  const currentTheme = themes.find(t => t.id === value) ?? themes[0]!
  const lightThemes = themes.filter(t => t.scheme === 'light')
  const darkThemes = themes.filter(t => t.scheme === 'dark')
  const allThemesInOrder = [...lightThemes, ...darkThemes]

  // Close when clicking outside
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  // Reset highlight on open
  useEffect(() => {
    if (open) {
      setHighlightedId(value)
      // Focus current option or listbox
      requestAnimationFrame(() => {
        const activeOption = listboxRef.current?.querySelector<HTMLButtonElement>(`[data-theme-id="${value}"]`)
        activeOption?.focus()
      })
    }
  }, [open, value])

  const selectTheme = useCallback((id: AccentThemeId) => {
    onChange(id)
    setOpen(false)
    triggerRef.current?.focus()
  }, [onChange])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault()
        setOpen(true)
      }
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
      return
    }

    const currentIndex = allThemesInOrder.findIndex(t => t.id === highlightedId)
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      const nextIndex = (currentIndex + 1) % allThemesInOrder.length
      const nextId = allThemesInOrder[nextIndex]!.id
      setHighlightedId(nextId)
      listboxRef.current?.querySelector<HTMLButtonElement>(`[data-theme-id="${nextId}"]`)?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      const prevIndex = (currentIndex - 1 + allThemesInOrder.length) % allThemesInOrder.length
      const prevId = allThemesInOrder[prevIndex]!.id
      setHighlightedId(prevId)
      listboxRef.current?.querySelector<HTMLButtonElement>(`[data-theme-id="${prevId}"]`)?.focus()
    } else if (event.key === 'Home') {
      event.preventDefault()
      const firstId = allThemesInOrder[0]!.id
      setHighlightedId(firstId)
      listboxRef.current?.querySelector<HTMLButtonElement>(`[data-theme-id="${firstId}"]`)?.focus()
    } else if (event.key === 'End') {
      event.preventDefault()
      const lastId = allThemesInOrder[allThemesInOrder.length - 1]!.id
      setHighlightedId(lastId)
      listboxRef.current?.querySelector<HTMLButtonElement>(`[data-theme-id="${lastId}"]`)?.focus()
    }
  }

  return (
    <div
      className="theme-dropdown-container"
      ref={containerRef}
      onKeyDown={handleKeyDown}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`dw-button theme-dropdown-trigger ${open ? 'open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="theme-dropdown-listbox"
        aria-label={locale === 'zh' ? `当前主题：${currentTheme.label}，点击展开主题下拉菜单` : `Current theme: ${currentTheme.label}, click to expand menu`}
        onClick={() => setOpen(prev => !prev)}
        style={{
          '--theme-swatch': currentTheme.colors.accent,
          '--preview-bg': currentTheme.colors.bg,
          '--preview-surface': currentTheme.colors.surface,
          '--preview-text': currentTheme.colors.text,
        } as CSSProperties}
      >
        <span className="theme-trigger-swatch" aria-hidden="true">
          <i style={{ background: currentTheme.colors.bg }} />
          <b style={{ background: currentTheme.colors.surface }} />
          <em style={{ background: currentTheme.colors.accent }} />
        </span>
        <span className="theme-trigger-text">
          <strong className="theme-trigger-label">{currentTheme.label}</strong>
          <span className="theme-trigger-scheme">{currentTheme.scheme === 'light' ? (locale === 'zh' ? '浅色' : 'Light') : (locale === 'zh' ? '深色' : 'Dark')}</span>
        </span>
        <ChevronDown className={`theme-trigger-chevron ${open ? 'rotated' : ''}`} aria-hidden="true" />
      </button>

      {open && (
        <div
          id="theme-dropdown-listbox"
          ref={listboxRef}
          className="theme-dropdown-menu"
          role="listbox"
          aria-label={locale === 'zh' ? '选择主题' : 'Select theme'}
          tabIndex={-1}
        >
          <div className="theme-dropdown-group" role="group" aria-label={locale === 'zh' ? '浅色主题' : 'Light themes'}>
            <div className="theme-dropdown-group-header">{locale === 'zh' ? '浅色模式 (Light)' : 'Light Theme'}</div>
            {lightThemes.map(theme => (
              <button
                key={theme.id}
                type="button"
                role="option"
                data-theme-id={theme.id}
                aria-selected={theme.id === value}
                className={`theme-dropdown-item ${theme.id === value ? 'active' : ''} ${theme.id === highlightedId ? 'highlighted' : ''}`}
                tabIndex={theme.id === highlightedId ? 0 : -1}
                onClick={() => selectTheme(theme.id)}
                onMouseEnter={() => setHighlightedId(theme.id)}
                style={{
                  '--item-accent': theme.colors.accent,
                  '--item-bg': theme.colors.bg,
                  '--item-surface': theme.colors.surface,
                  '--item-text': theme.colors.text,
                } as CSSProperties}
              >
                <span className="theme-item-swatch" aria-hidden="true">
                  <i style={{ background: theme.colors.bg }} />
                  <b style={{ background: theme.colors.surface }} />
                  <em style={{ background: theme.colors.accent }} />
                </span>
                <span className="theme-item-label">{theme.label}</span>
                {theme.id === value && <Check className="theme-item-check" aria-hidden="true" />}
              </button>
            ))}
          </div>

          <div className="theme-dropdown-group" role="group" aria-label={locale === 'zh' ? '深色主题' : 'Dark themes'}>
            <div className="theme-dropdown-group-header">{locale === 'zh' ? '深色模式 (Dark)' : 'Dark Theme'}</div>
            {darkThemes.map(theme => (
              <button
                key={theme.id}
                type="button"
                role="option"
                data-theme-id={theme.id}
                aria-selected={theme.id === value}
                className={`theme-dropdown-item ${theme.id === value ? 'active' : ''} ${theme.id === highlightedId ? 'highlighted' : ''}`}
                tabIndex={theme.id === highlightedId ? 0 : -1}
                onClick={() => selectTheme(theme.id)}
                onMouseEnter={() => setHighlightedId(theme.id)}
                style={{
                  '--item-accent': theme.colors.accent,
                  '--item-bg': theme.colors.bg,
                  '--item-surface': theme.colors.surface,
                  '--item-text': theme.colors.text,
                } as CSSProperties}
              >
                <span className="theme-item-swatch" aria-hidden="true">
                  <i style={{ background: theme.colors.bg }} />
                  <b style={{ background: theme.colors.surface }} />
                  <em style={{ background: theme.colors.accent }} />
                </span>
                <span className="theme-item-label">{theme.label}</span>
                {theme.id === value && <Check className="theme-item-check" aria-hidden="true" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
