/** Palette sources and adaptation policy: see PALETTES.md. */
export type ThemeId = 'light' | 'dark'
export type ColorSchemeId = 'classic' | 'ocean' | 'violet' | 'amber' | 'rose'

export interface ColorSchemeOption {
  id: ColorSchemeId
  label: string
  labelZh?: string
  description: string
  previewColor: string
}

export const COLOR_SCHEMES: ColorSchemeOption[] = [
  { id: 'classic', label: 'Emerald', labelZh: '翡翠绿', description: 'Fresh emerald and mint', previewColor: '#059669' },
  { id: 'ocean', label: 'Ocean', labelZh: '海洋蓝', description: 'Deep azure and cyan', previewColor: '#2563eb' },
  { id: 'violet', label: 'Violet', labelZh: '极光紫', description: 'Modern violet and lavender', previewColor: '#7c3aed' },
  { id: 'amber', label: 'Amber', labelZh: '暖杏橙', description: 'Warm amber and golden sunset', previewColor: '#d97706' },
  { id: 'rose', label: 'Rose', labelZh: '蔷薇红', description: 'Vibrant coral and rose pink', previewColor: '#e11d48' },
]

export const DEFAULT_COLOR_SCHEME_ID: ColorSchemeId = 'classic'

export interface ThemePreset {
  id: ThemeId
  label: string
  scheme: 'light' | 'dark'
  colors: Record<string, string>
}

const LIGHT_COLORS: Record<string, string> = {
  bg: '#f5f7fa',
  surface: '#ffffff',
  'surface-raised': '#ffffff',
  'surface-subtle': '#f0f3f8',
  border: '#e8ecf2',
  'border-strong': '#64748b',
  text: '#111827',
  'text-muted': '#525866',
  accent: '#111827',
  'accent-strong': '#000000',
  'accent-contrast': '#ffffff',
  'accent-secondary': '#059669',
  'accent-soft': '#dcfce7',
  'accent-border': '#059669',
  success: '#0d7650',
  'success-soft': '#e6f6ee',
  'success-border': '#9dd8ba',
  warning: '#92400e',
  'warning-soft': '#fef3c7',
  'warning-border': '#fcd34d',
  danger: '#b91c1c',
  'danger-soft': '#fee2e2',
  'danger-border': '#fca5a5',
  focus: '#111827',
  overlay: 'rgba(15, 17, 26, .48)',
  'chart-grid': '#e8ecf2',
  'chart-1': '#059669',
  'chart-2': '#2563eb',
  'chart-3': '#7c3aed',
  'chart-4': '#d97706',
  'chart-5': '#db2777',
  'chart-6': '#0891b2',
  'chart-7': '#4f46e5',
  'chart-8': '#ea580c',
  'chart-cache-rate': '#059669',
  'heat-empty': '#f0f3f8',
  'heat-low': '#dcfce7',
  'heat-mid': '#86efac',
  'heat-high': '#047857',
  'heat-text': '#111827',
  'heat-text-high': '#ffffff',
  'heat-count-text': '#111827',
  'heat-count-strong': '#ffffff',
  'glass-surface': 'color-mix(in srgb, #ffffff 92%, transparent)',
  'glass-filter': 'blur(18px) saturate(115%)',
  'material-panel': 'color-mix(in srgb, #ffffff 84%, transparent)',
  'material-card': 'color-mix(in srgb, #ffffff 94%, transparent)',
  'material-raised': '#ffffff',
  'material-inset': 'color-mix(in srgb, #f0f3f8 75%, transparent)',
  'material-border': 'color-mix(in srgb, #e8ecf2 75%, transparent)',
  'material-border-strong': 'color-mix(in srgb, #64748b 85%, transparent)',
  'shadow-xs': '0 1px 2px rgba(0, 0, 0, 0.03)',
  'shadow-sm': '0 4px 16px -2px rgba(0, 0, 0, 0.04), 0 2px 6px -1px rgba(0, 0, 0, 0.02)',
  'shadow-md': '0 10px 24px -4px rgba(0, 0, 0, 0.06), 0 4px 10px -2px rgba(0, 0, 0, 0.03)',
  'shadow-lg': '0 20px 40px -8px rgba(0, 0, 0, 0.08), 0 8px 16px -4px rgba(0, 0, 0, 0.04)',
}

const DARK_COLORS: Record<string, string> = {
  bg: '#0c0e12',
  surface: '#14171f',
  'surface-raised': '#1c202a',
  'surface-subtle': '#1e232e',
  border: '#252c38',
  'border-strong': '#64748b',
  text: '#f8fafc',
  'text-muted': '#94a3b8',
  accent: '#f8fafc',
  'accent-strong': '#ffffff',
  'accent-contrast': '#0c0e12',
  'accent-secondary': '#34d399',
  'accent-soft': '#1e293b',
  'accent-border': '#34d399',
  success: '#34d399',
  'success-soft': '#132e27',
  'success-border': '#10b981',
  warning: '#fbbf24',
  'warning-soft': '#261e0b',
  'warning-border': '#f59e0b',
  danger: '#f87171',
  'danger-soft': '#2b1418',
  'danger-border': '#ef4444',
  focus: '#34d399',
  overlay: 'rgba(0, 0, 0, .68)',
  'chart-grid': '#252c38',
  'chart-1': '#34d399',
  'chart-2': '#60a5fa',
  'chart-3': '#a78bfa',
  'chart-4': '#fbbf24',
  'chart-5': '#f472b6',
  'chart-6': '#22d3ee',
  'chart-7': '#818cf8',
  'chart-8': '#fb923c',
  'chart-cache-rate': '#34d399',
  'heat-empty': '#1e232e',
  'heat-low': '#132e27',
  'heat-mid': '#065f46',
  'heat-high': '#34d399',
  'heat-text': '#f8fafc',
  'heat-text-high': '#0c0e12',
  'heat-count-text': '#ffffff',
  'heat-count-strong': '#ffffff',
  'glass-surface': 'color-mix(in srgb, #14171f 94%, transparent)',
  'glass-filter': 'blur(18px) saturate(115%)',
  'material-panel': 'color-mix(in srgb, #14171f 88%, transparent)',
  'material-card': 'color-mix(in srgb, #14171f 96%, transparent)',
  'material-raised': '#1c202a',
  'material-inset': 'color-mix(in srgb, #1e232e 80%, transparent)',
  'material-border': 'color-mix(in srgb, #252c38 80%, transparent)',
  'material-border-strong': 'color-mix(in srgb, #64748b 85%, transparent)',
  'shadow-xs': '0 1px 2px rgba(0, 0, 0, 0.2)',
  'shadow-sm': '0 4px 16px -2px rgba(0, 0, 0, 0.3), 0 2px 6px -1px rgba(0, 0, 0, 0.15)',
  'shadow-md': '0 10px 24px -4px rgba(0, 0, 0, 0.4), 0 4px 10px -2px rgba(0, 0, 0, 0.25)',
  'shadow-lg': '0 20px 40px -8px rgba(0, 0, 0, 0.5), 0 8px 16px -4px rgba(0, 0, 0, 0.35)',
}

export const THEMES: ThemePreset[] = [
  { id: 'light', label: 'Light', scheme: 'light', colors: LIGHT_COLORS },
  { id: 'dark', label: 'Dark', scheme: 'dark', colors: DARK_COLORS },
]

export const DEFAULT_THEME_ID: ThemeId = 'light'
export const UI_DESIGN_VERSION = 1

interface SchemePalette {
  preview: string
  light: {
    secondary: string
    soft: string
    border: string
    strong: string
    chart1: string
    chart2: string
  }
  dark: {
    secondary: string
    soft: string
    border: string
    strong: string
    chart1: string
    chart2: string
  }
}

const SCHEME_PALETTES: Record<ColorSchemeId, SchemePalette> = {
  classic: {
    preview: '#059669',
    light: {
      secondary: '#059669',
      soft: '#dcfce7',
      border: '#059669',
      strong: '#047857',
      chart1: '#059669',
      chart2: '#2563eb',
    },
    dark: {
      secondary: '#34d399',
      soft: '#132e27',
      border: '#34d399',
      strong: '#34d399',
      chart1: '#34d399',
      chart2: '#60a5fa',
    },
  },
  ocean: {
    preview: '#2563eb',
    light: {
      secondary: '#2563eb',
      soft: '#dbeafe',
      border: '#2563eb',
      strong: '#1d4ed8',
      chart1: '#2563eb',
      chart2: '#059669',
    },
    dark: {
      secondary: '#60a5fa',
      soft: '#172554',
      border: '#60a5fa',
      strong: '#60a5fa',
      chart1: '#60a5fa',
      chart2: '#34d399',
    },
  },
  violet: {
    preview: '#7c3aed',
    light: {
      secondary: '#7c3aed',
      soft: '#ede9fe',
      border: '#7c3aed',
      strong: '#6d28d9',
      chart1: '#7c3aed',
      chart2: '#2563eb',
    },
    dark: {
      secondary: '#a78bfa',
      soft: '#2e1065',
      border: '#a78bfa',
      strong: '#a78bfa',
      chart1: '#a78bfa',
      chart2: '#60a5fa',
    },
  },
  amber: {
    preview: '#d97706',
    light: {
      secondary: '#d97706',
      soft: '#fef3c7',
      border: '#d97706',
      strong: '#92400e',
      chart1: '#d97706',
      chart2: '#059669',
    },
    dark: {
      secondary: '#fbbf24',
      soft: '#261e0b',
      border: '#fbbf24',
      strong: '#fbbf24',
      chart1: '#fbbf24',
      chart2: '#34d399',
    },
  },
  rose: {
    preview: '#e11d48',
    light: {
      secondary: '#e11d48',
      soft: '#ffe4e6',
      border: '#e11d48',
      strong: '#be123c',
      chart1: '#e11d48',
      chart2: '#2563eb',
    },
    dark: {
      secondary: '#fb7185',
      soft: '#2b1418',
      border: '#fb7185',
      strong: '#fb7185',
      chart1: '#fb7185',
      chart2: '#60a5fa',
    },
  },
}

export function getColorSchemePreview(themeId?: string, schemeId?: ColorSchemeId): string {
  const scheme = schemeId && schemeId in SCHEME_PALETTES ? SCHEME_PALETTES[schemeId] : SCHEME_PALETTES.classic
  const isDark = themeId === 'dark' || themeId === 'catppuccin-mocha' || themeId === 'rose-pine-moon' || themeId === 'tokyo-night' || themeId === 'nord' || themeId === 'dracula'
  return isDark ? scheme.dark.secondary : scheme.preview
}

export function getTheme(id: string, schemeId: ColorSchemeId = DEFAULT_COLOR_SCHEME_ID): ThemePreset {
  const isDark = id === 'dark' || id === 'catppuccin-mocha' || id === 'rose-pine-moon' || id === 'tokyo-night' || id === 'nord' || id === 'dracula'
  const base = isDark ? THEMES[1]! : THEMES[0]!
  const scheme = schemeId && schemeId in SCHEME_PALETTES ? SCHEME_PALETTES[schemeId] : SCHEME_PALETTES[DEFAULT_COLOR_SCHEME_ID]
  const config = isDark ? scheme.dark : scheme.light
  return {
    ...base,
    colors: {
      ...base.colors,
      'accent-secondary': config.secondary,
      focus: config.secondary,
      'accent-border': config.border,
      'accent-soft': config.soft,
      'accent-strong': config.strong,
      'chart-1': config.chart1,
      'chart-2': config.chart2,
    },
  }
}

export function resolveColors(theme: ThemePreset): Record<string, string> {
  return { ...theme.colors, 'color-scheme': theme.scheme, 'ui-design-version': String(UI_DESIGN_VERSION) }
}
