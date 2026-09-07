/** Palette sources and adaptation policy: see PALETTES.md. */
export type ThemeId = 'light' | 'dark'
export type ColorSchemeId = 'classic'

export interface ColorSchemeOption {
  id: ColorSchemeId
  label: string
  description: string
  previewColor: string
}

export const COLOR_SCHEMES: ColorSchemeOption[] = [
  { id: 'classic', label: 'Default', description: 'Standard modern palette', previewColor: '#059669' },
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

export function getColorSchemePreview(_themeId?: string, _schemeId?: ColorSchemeId): string {
  return '#059669'
}

export function getTheme(id: string, _schemeId: ColorSchemeId = DEFAULT_COLOR_SCHEME_ID): ThemePreset {
  const isDark = id === 'dark' || id === 'catppuccin-mocha' || id === 'rose-pine-moon' || id === 'tokyo-night' || id === 'nord' || id === 'dracula'
  return isDark ? THEMES[1]! : THEMES[0]!
}

export function resolveColors(theme: ThemePreset): Record<string, string> {
  return { ...theme.colors, 'color-scheme': theme.scheme, 'ui-design-version': String(UI_DESIGN_VERSION) }
}
