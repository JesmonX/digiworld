/** Palette sources and adaptation policy: see PALETTES.md. */
export type ThemeId = 'catppuccin-latte' | 'catppuccin-mocha' | 'rose-pine-dawn' | 'rose-pine-moon'
export type TextScale = 100 | 110 | 125
export interface ThemePreset {
  id: ThemeId
  label: string
  scheme: 'light' | 'dark'
  colors: Record<string, string>
}

function preset(id: ThemeId, label: string, scheme: ThemePreset['scheme'], colors: string[]): ThemePreset {
  const [bg, surface, raised, subtle, border, control, text, muted, accent, secondary, success, warning, danger] = colors as [string, string, string, string, string, string, string, string, string, string, string, string, string]
  const mix = (color: string, percent: number, base = surface) => `color-mix(in srgb, ${color} ${percent}%, ${base})`
  return { id, label, scheme, colors: {
    bg, surface, 'surface-raised': raised, 'surface-subtle': subtle, border, 'border-strong': control,
    text, 'text-muted': muted, accent, 'accent-strong': scheme === 'light' ? mix(accent, 85, text) : accent,
    'accent-contrast': scheme === 'light' ? '#ffffff' : bg, 'accent-secondary': secondary,
    'accent-soft': mix(accent, scheme === 'light' ? 9 : 14), 'accent-border': accent, success, warning, danger,
    'success-soft': mix(success, 10), 'warning-soft': mix(warning, 10), 'danger-soft': mix(danger, 10),
    'success-border': mix(success, 45), 'warning-border': mix(warning, 45), 'danger-border': mix(danger, 45),
    focus: accent, 'overlay': 'rgba(15, 17, 26, .48)',
    'chart-grid': border, 'chart-1': accent, 'chart-2': secondary, 'chart-3': success, 'chart-4': warning,
    'heat-empty': subtle, 'heat-low': mix(accent, 18), 'heat-mid': mix(accent, 35),
    'heat-high': accent, 'heat-text': text, 'heat-text-high': scheme === 'light' ? '#ffffff' : bg,
    'glass-surface': mix(surface, 92, 'transparent'), 'glass-filter': 'blur(14px) saturate(115%)',
    'shadow-xs': '0 1px 2px rgba(15, 17, 26, .04)', 'shadow-sm': '0 2px 8px rgba(15, 17, 26, .04)',
    'shadow-md': '0 4px 16px rgba(15, 17, 26, .06)', 'shadow-lg': '0 12px 32px rgba(15, 17, 26, .16)',
  } }
}

export const THEMES: ThemePreset[] = [
  preset('catppuccin-latte', 'Catppuccin Latte', 'light', ['#eff1f5', '#ffffff', '#ffffff', '#e6e9ef', '#ccd0da', '#8c8fa1', '#4c4f69', '#62667c', '#8839ef', '#176b85', '#347a1b', '#946100', '#d20f39']),
  preset('catppuccin-mocha', 'Catppuccin Mocha', 'dark', ['#1e1e2e', '#242437', '#313244', '#181825', '#45475a', '#7f849c', '#cdd6f4', '#a6adc8', '#cba6f7', '#89dceb', '#a6e3a1', '#f9e2af', '#f38ba8']),
  preset('rose-pine-dawn', 'Rosé Pine Dawn', 'light', ['#faf4ed', '#fffaf3', '#fffdf9', '#f2e9e1', '#dfdad9', '#8a8597', '#575279', '#635d74', '#79569b', '#286983', '#436b58', '#916000', '#b03759']),
  preset('rose-pine-moon', 'Rosé Pine Moon', 'dark', ['#232136', '#2a273f', '#393552', '#2d2a45', '#44415a', '#817c9c', '#e0def4', '#b4afce', '#c4a7e7', '#9ccfd8', '#a3c9ad', '#f6c177', '#f28aa8']),
]
export const DEFAULT_THEME_ID: ThemeId = 'catppuccin-latte'
export const UI_DESIGN_VERSION = 1
export function getTheme(id: string): ThemePreset { return THEMES.find(theme => theme.id === id) ?? THEMES[0]! }
export function resolveColors(theme: ThemePreset): Record<string, string> {
  return { ...theme.colors, 'color-scheme': theme.scheme, 'ui-design-version': String(UI_DESIGN_VERSION) }
}
