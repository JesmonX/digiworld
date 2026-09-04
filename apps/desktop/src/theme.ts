import type { CSSProperties } from 'react'
import type { PluginTheme } from '@digiworld/plugin-sdk'

export type AccentThemeId = 'violet' | 'blue' | 'teal' | 'orange' | 'rose'
export type FontThemeId = 'plex' | 'wenkai' | 'system'
export type FontWeight = 400 | 500 | 600
export type GlassMode = 'enabled' | 'disabled'

export interface AccentTheme {
  id: AccentThemeId
  label: string
  accent: string
  accentStrong: string
  accentSecondary: string
  accentSoft: string
}

export interface FontTheme {
  id: FontThemeId
  label: string
  description: string
  fontSans: string
  fontDisplay: string
}

export const ACCENT_THEMES: AccentTheme[] = [
  { id: 'violet', label: '紫罗兰', accent: '#5b5ce2', accentStrong: '#4338ca', accentSecondary: '#8b5cf6', accentSoft: '#ededff' },
  { id: 'blue', label: '海蓝', accent: '#2563eb', accentStrong: '#1d4ed8', accentSecondary: '#0ea5e9', accentSoft: '#eaf2ff' },
  { id: 'teal', label: '青绿', accent: '#0f766e', accentStrong: '#0f5f59', accentSecondary: '#14b8a6', accentSoft: '#e8f7f5' },
  { id: 'orange', label: '暖橙', accent: '#c2410c', accentStrong: '#9a3412', accentSecondary: '#f59e0b', accentSoft: '#fff1e8' },
  { id: 'rose', label: '玫瑰', accent: '#e11d48', accentStrong: '#be123c', accentSecondary: '#f43f5e', accentSoft: '#fff0f3' },
]

export const FONT_THEMES: FontTheme[] = [
  {
    id: 'plex',
    label: 'Plex 灵动',
    description: '清晰现代，正文与标题保持统一',
    fontSans: '"Digiworld Plex Sans SC", "Segoe UI Variable Text", "Microsoft YaHei UI", sans-serif',
    fontDisplay: '"Digiworld Plex Sans SC", "Segoe UI Variable Display", "Microsoft YaHei UI", sans-serif',
  },
  {
    id: 'wenkai',
    label: '霞鹜文楷',
    description: '温润舒展，中文与数字都更具人文感',
    fontSans: '"Digiworld LXGW WenKai", "KaiTi", serif',
    fontDisplay: '"Digiworld LXGW WenKai", "KaiTi", serif',
  },
  {
    id: 'system',
    label: 'Windows 原生',
    description: '紧凑克制，保持熟悉的桌面观感',
    fontSans: '"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", sans-serif',
    fontDisplay: '"Segoe UI Variable Display", "Segoe UI Variable Text", "Microsoft YaHei UI", sans-serif',
  },
]

export const DEFAULT_ACCENT_THEME_ID: AccentThemeId = 'violet'
export const DEFAULT_FONT_THEME_ID: FontThemeId = 'plex'
export const DEFAULT_FONT_WEIGHT: FontWeight = 500
export const THEME_STORAGE_KEY = 'digiworld.accent-theme.v1'
export const FONT_THEME_STORAGE_KEY = 'digiworld.font-theme.v1'
export const FONT_WEIGHT_STORAGE_KEY = 'digiworld.font-weight.v1'
export const GLASS_STORAGE_KEY = 'digiworld.glass.v1'

export function getAccentTheme(id: AccentThemeId): AccentTheme {
  return ACCENT_THEMES.find(theme => theme.id === id) ?? ACCENT_THEMES[0]!
}

export function getFontTheme(id: FontThemeId): FontTheme {
  return FONT_THEMES.find(theme => theme.id === id) ?? FONT_THEMES[0]!
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

export function loadFontThemeId(storage?: Pick<Storage, 'getItem'>): FontThemeId {
  try {
    const value = (storage ?? window.localStorage).getItem(FONT_THEME_STORAGE_KEY)
    return FONT_THEMES.some(theme => theme.id === value) ? value as FontThemeId : DEFAULT_FONT_THEME_ID
  } catch {
    return DEFAULT_FONT_THEME_ID
  }
}

export function saveFontThemeId(id: FontThemeId, storage?: Pick<Storage, 'setItem'>): void {
  try {
    (storage ?? window.localStorage).setItem(FONT_THEME_STORAGE_KEY, id)
  } catch {
    // A typography preference should never prevent the desktop UI from working.
  }
}

export function loadFontWeight(storage?: Pick<Storage, 'getItem'>): FontWeight {
  try {
    const value = Number((storage ?? window.localStorage).getItem(FONT_WEIGHT_STORAGE_KEY))
    return value === 400 || value === 500 || value === 600 ? value : DEFAULT_FONT_WEIGHT
  } catch {
    return DEFAULT_FONT_WEIGHT
  }
}

export function saveFontWeight(weight: FontWeight, storage?: Pick<Storage, 'setItem'>): void {
  try {
    (storage ?? window.localStorage).setItem(FONT_WEIGHT_STORAGE_KEY, String(weight))
  } catch {
    // A typography preference should never prevent the desktop UI from working.
  }
}

export function loadGlassMode(storage?: Pick<Storage, 'getItem'>): GlassMode {
  try {
    return (storage ?? window.localStorage).getItem(GLASS_STORAGE_KEY) === 'disabled' ? 'disabled' : 'enabled'
  } catch {
    return 'enabled'
  }
}

export function saveGlassMode(mode: GlassMode, storage?: Pick<Storage, 'setItem'>): void {
  try {
    (storage ?? window.localStorage).setItem(GLASS_STORAGE_KEY, mode)
  } catch {
    // A presentation preference should never prevent the desktop UI from working.
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

export function fontThemeStyle(theme: FontTheme): CSSProperties {
  return {
    '--font-sans': theme.fontSans,
    '--font-display': theme.fontDisplay,
  } as CSSProperties
}

export function fontWeightStyle(weight: FontWeight): CSSProperties {
  return {
    '--weight-regular': weight,
    '--weight-medium': weight === 400 ? 500 : weight,
    '--weight-semibold': weight === 600 ? 700 : 600,
    '--weight-bold': weight === 600 ? 800 : 700,
  } as CSSProperties
}

export function pluginTheme(theme: AccentTheme, font: FontTheme = getFontTheme(DEFAULT_FONT_THEME_ID), weight: FontWeight = DEFAULT_FONT_WEIGHT, glass: GlassMode = 'enabled'): PluginTheme {
  const weights = fontWeightStyle(weight) as Record<string, number>
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
    'font-sans': font.fontSans,
    'font-display': font.fontDisplay,
    'weight-regular': String(weights['--weight-regular']),
    'weight-medium': String(weights['--weight-medium']),
    'weight-semibold': String(weights['--weight-semibold']),
    'weight-bold': String(weights['--weight-bold']),
    glass,
  }
}
