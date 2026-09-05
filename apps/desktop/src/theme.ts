import type { CSSProperties } from 'react'
import type { PluginTheme } from '@digiworld/plugin-sdk'

import { THEMES, getTheme, resolveColors, type ThemeId, type ThemePreset, type TextScale } from '@digiworld/design-system/themes'
export type { TextScale }
export type AccentThemeId = ThemeId
export type FontThemeId = 'plex' | 'wenkai' | 'system'
export type FontWeight = 400 | 500 | 600
export type GlassMode = 'enabled' | 'disabled'

export type AccentTheme = ThemePreset

export interface FontTheme {
  id: FontThemeId
  label: string
  description: string
  fontSans: string
  fontDisplay: string
  fontBrand: string
}

export const ACCENT_THEMES = THEMES

export const FONT_THEMES: FontTheme[] = [
  {
    id: 'plex',
    label: 'Plex 灵动',
    description: '清晰现代，正文与标题保持统一',
    fontSans: '"Digiworld Inter Variable", "Digiworld Plex Sans SC", "Segoe UI Variable Text", "Microsoft YaHei UI", sans-serif',
    fontDisplay: '"Digiworld Inter Variable", "Digiworld Plex Sans SC", "Segoe UI Variable Display", "Microsoft YaHei UI", sans-serif',
    fontBrand: '"Digiworld Smiley Sans", "Digiworld Inter Variable", "Digiworld Plex Sans SC", "Microsoft YaHei UI", sans-serif',
  },
  {
    id: 'wenkai',
    label: '霞鹜文楷',
    description: '温润舒展，中文与数字都更具人文感',
    fontSans: '"Digiworld LXGW WenKai", "KaiTi", serif',
    fontDisplay: '"Digiworld LXGW WenKai", "KaiTi", serif',
    fontBrand: '"Digiworld Smiley Sans", "Digiworld LXGW WenKai", "KaiTi", serif',
  },
  {
    id: 'system',
    label: 'Windows 原生',
    description: '紧凑克制，保持熟悉的桌面观感',
    fontSans: '"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", sans-serif',
    fontDisplay: '"Segoe UI Variable Display", "Segoe UI Variable Text", "Microsoft YaHei UI", sans-serif',
    fontBrand: '"Digiworld Smiley Sans", "Segoe UI Variable Display", "Microsoft YaHei UI", sans-serif',
  },
]

export const DEFAULT_ACCENT_THEME_ID: AccentThemeId = 'catppuccin-latte'
export const DEFAULT_FONT_THEME_ID: FontThemeId = 'plex'
export const DEFAULT_FONT_WEIGHT: FontWeight = 400
export const THEME_STORAGE_KEY = 'digiworld.theme.v2'
export const FONT_THEME_STORAGE_KEY = 'digiworld.font-theme.v1'
export const FONT_WEIGHT_STORAGE_KEY = 'digiworld.font-weight.v1'
export const TEXT_SCALE_STORAGE_KEY = 'digiworld.text-scale.v1'
export function loadTextScale(storage?: Pick<Storage, 'getItem'>): TextScale {
  try { const value = Number((storage ?? window.localStorage).getItem(TEXT_SCALE_STORAGE_KEY)); return value === 110 || value === 125 ? value : 100 } catch { return 100 }
}
export function saveTextScale(value: TextScale, storage?: Pick<Storage, 'setItem'>): void {
  try { (storage ?? window.localStorage).setItem(TEXT_SCALE_STORAGE_KEY, String(value)) } catch { /* presentation only */ }
}
export const GLASS_STORAGE_KEY = 'digiworld.glass.v1'

export function getAccentTheme(id: AccentThemeId): AccentTheme {
  return getTheme(id)
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
    return (storage ?? window.localStorage).getItem(GLASS_STORAGE_KEY) === 'enabled' ? 'enabled' : 'disabled'
  } catch {
    return 'disabled'
  }
}

export function saveGlassMode(mode: GlassMode, storage?: Pick<Storage, 'setItem'>): void {
  try {
    (storage ?? window.localStorage).setItem(GLASS_STORAGE_KEY, mode)
  } catch {
    // A presentation preference should never prevent the desktop UI from working.
  }
}

export function themeStyle(theme: PluginTheme): CSSProperties {
  return { ...Object.fromEntries(Object.entries(theme).filter(([, value]) => value !== undefined).map(([key, value]) => ['--dw-' + key, value])), colorScheme: theme['color-scheme'] } as CSSProperties
}

export function fontThemeStyle(theme: FontTheme): CSSProperties {
  return {
    '--font-sans': theme.fontSans,
    '--font-display': theme.fontDisplay,
    '--font-brand': theme.fontBrand,
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

export function pluginTheme(theme: AccentTheme, font: FontTheme = getFontTheme(DEFAULT_FONT_THEME_ID), weight: FontWeight = DEFAULT_FONT_WEIGHT, glass: GlassMode = 'disabled', scale: TextScale = 100): PluginTheme {
  const weights = fontWeightStyle(weight) as Record<string, number>
  return {
    ...resolveColors(theme),
    'color-scheme': theme.scheme,
    'bg': theme.colors['bg']!,
    'surface': theme.colors['surface']!,
    'surface-raised': theme.colors['surface-raised']!,
    'surface-subtle': theme.colors['surface-subtle']!,
    'border': theme.colors['border']!,
    'border-strong': theme.colors['border-strong']!,
    'text': theme.colors['text']!,
    'text-muted': theme.colors['text-muted']!,
    'accent': theme.colors['accent']!,
    'accent-strong': theme.colors['accent-strong']!,
    'accent-contrast': theme.colors['accent-contrast']!,
    'accent-secondary': theme.colors['accent-secondary']!,
    'accent-soft': theme.colors['accent-soft']!,
    'success': theme.colors['success']!,
    'warning': theme.colors['warning']!,
    'danger': theme.colors['danger']!,
    'font-sans': font.fontSans,
    'font-display': font.fontDisplay,
    'font-brand': font.fontBrand,
    'weight-regular': String(weights['--weight-regular']),
    'weight-medium': String(weights['--weight-medium']),
    'weight-semibold': String(weights['--weight-semibold']),
    'weight-bold': String(weights['--weight-bold']),
    glass,
    'text-scale': String(scale / 100),
  }
}
