import type { CSSProperties } from 'react'
import type { PluginTheme } from '@digiworld/plugin-sdk'

export type AccentThemeId = 'violet' | 'blue' | 'teal' | 'orange' | 'rose'

export interface AccentTheme {
  id: AccentThemeId
  label: string
  accent: string
  accentStrong: string
  accentSecondary: string
  accentSoft: string
}

export const ACCENT_THEMES: AccentTheme[] = [
  { id: 'violet', label: '紫罗兰', accent: '#5b5ce2', accentStrong: '#4338ca', accentSecondary: '#8b5cf6', accentSoft: '#ededff' },
  { id: 'blue', label: '海蓝', accent: '#2563eb', accentStrong: '#1d4ed8', accentSecondary: '#0ea5e9', accentSoft: '#eaf2ff' },
  { id: 'teal', label: '青绿', accent: '#0f766e', accentStrong: '#0f5f59', accentSecondary: '#14b8a6', accentSoft: '#e8f7f5' },
  { id: 'orange', label: '暖橙', accent: '#c2410c', accentStrong: '#9a3412', accentSecondary: '#f59e0b', accentSoft: '#fff1e8' },
  { id: 'rose', label: '玫瑰', accent: '#e11d48', accentStrong: '#be123c', accentSecondary: '#f43f5e', accentSoft: '#fff0f3' },
]

export const DEFAULT_ACCENT_THEME_ID: AccentThemeId = 'violet'
export const THEME_STORAGE_KEY = 'digiworld.accent-theme.v1'

export function getAccentTheme(id: AccentThemeId): AccentTheme {
  return ACCENT_THEMES.find(theme => theme.id === id) ?? ACCENT_THEMES[0]!
}

export function loadAccentThemeId(storage?: Pick<Storage, 'getItem'>): AccentThemeId {
  try {
    const value = (storage ?? window.localStorage).getItem(THEME_STORAGE_KEY)
    return ACCENT_THEMES.some(theme => theme.id === value) ? value as AccentThemeId : DEFAULT_ACCENT_THEME_ID
  } catch {
    return DEFAULT_ACCENT_THEME_ID
  }
}

export function saveAccentThemeId(id: AccentThemeId, storage?: Pick<Storage, 'setItem'>): void {
  try {
    (storage ?? window.localStorage).setItem(THEME_STORAGE_KEY, id)
  } catch {
    // A theme preference should never prevent the desktop UI from working.
  }
}

export function accentThemeStyle(theme: AccentTheme): CSSProperties {
  return {
    '--accent': theme.accent,
    '--accent-strong': theme.accentStrong,
    '--accent-secondary': theme.accentSecondary,
    '--accent-soft': theme.accentSoft,
  } as CSSProperties
}

export function pluginTheme(theme: AccentTheme): PluginTheme {
  return {
    'color-scheme': 'light',
    'bg': '#f5f7fb',
    'surface': '#ffffff',
    'surface-raised': '#ffffff',
    'surface-subtle': '#f0f3f8',
    'border': '#dde3ec',
    'text': '#172033',
    'text-muted': '#667085',
    'accent': theme.accent,
    'accent-strong': theme.accentStrong,
    'accent-contrast': '#ffffff',
    'accent-secondary': theme.accentSecondary,
    'accent-soft': theme.accentSoft,
    'danger': '#d92d20',
    'font-sans': '"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", sans-serif',
  }
}
