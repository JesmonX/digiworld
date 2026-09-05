/** Palette sources and adaptation policy: see PALETTES.md. */
export type ThemeId = 'catppuccin-latte' | 'catppuccin-mocha' | 'rose-pine-dawn' | 'rose-pine-moon'
export type ColorSchemeId = 'classic' | 'ocean' | 'pine' | 'amber' | 'rose'
export type TextScale = 100 | 110 | 125

export interface ColorSchemeOption {
  id: ColorSchemeId
  label: string
  description: string
  previewColor: string
}

export const COLOR_SCHEMES: ColorSchemeOption[] = [
  { id: 'classic', label: '经典紫罗兰', description: '高雅紫调，源自主题原生主色', previewColor: '#8839ef' },
  { id: 'ocean', label: '海洋湛蓝', description: '深邃纯净的蓝调与天青', previewColor: '#1e66f5' },
  { id: 'pine', label: '青翠松柏', description: '清新通透的松绿与薄荷', previewColor: '#179299' },
  { id: 'amber', label: '暖杏琥珀', description: '温润明亮的落日金与杏黄', previewColor: '#d25400' },
  { id: 'rose', label: '绯红蔷薇', description: '柔美优雅的珊瑚粉与花瓣红', previewColor: '#ea76cb' },
]

export const DEFAULT_COLOR_SCHEME_ID: ColorSchemeId = 'classic'

export interface ThemePreset {
  id: ThemeId
  label: string
  scheme: 'light' | 'dark'
  colors: Record<string, string>
}

interface SchemePalette {
  accent: string
  secondary: string
  chart: [string, string, string, string, string, string, string, string]
}

const SCHEME_PALETTES: Record<ThemeId, Record<ColorSchemeId, SchemePalette>> = {
  'catppuccin-latte': {
    classic: {
      accent: '#8839ef', secondary: '#176b85',
      chart: ['#8839ef', '#176b85', '#7287fd', '#209fb5', '#ea76cb', '#d25400', '#347a1b', '#1e66f5'],
    },
    ocean: {
      accent: '#1e66f5', secondary: '#209fb5',
      chart: ['#1e66f5', '#209fb5', '#04a5e5', '#7287fd', '#179299', '#8839ef', '#ea76cb', '#d25400'],
    },
    pine: {
      accent: '#179299', secondary: '#347a1b',
      chart: ['#179299', '#347a1b', '#209fb5', '#40a02b', '#04a5e5', '#7287fd', '#8839ef', '#d25400'],
    },
    amber: {
      accent: '#d25400', secondary: '#946100',
      chart: ['#d25400', '#946100', '#ea76cb', '#8839ef', '#209fb5', '#179299', '#7287fd', '#347a1b'],
    },
    rose: {
      accent: '#d20f39', secondary: '#ea76cb',
      chart: ['#ea76cb', '#d20f39', '#8839ef', '#7287fd', '#d25400', '#209fb5', '#179299', '#347a1b'],
    },
  },
  'catppuccin-mocha': {
    classic: {
      accent: '#cba6f7', secondary: '#89dceb',
      chart: ['#cba6f7', '#89dceb', '#b4befe', '#74c7ec', '#f5c2e7', '#fab387', '#a6e3a1', '#89b4fa'],
    },
    ocean: {
      accent: '#89b4fa', secondary: '#74c7ec',
      chart: ['#89b4fa', '#74c7ec', '#89dceb', '#94e2d5', '#b4befe', '#cba6f7', '#f5c2e7', '#fab387'],
    },
    pine: {
      accent: '#94e2d5', secondary: '#a6e3a1',
      chart: ['#94e2d5', '#a6e3a1', '#74c7ec', '#89dceb', '#b4befe', '#cba6f7', '#fab387', '#f5c2e7'],
    },
    amber: {
      accent: '#fab387', secondary: '#f9e2af',
      chart: ['#fab387', '#f9e2af', '#eba0ac', '#f5c2e7', '#cba6f7', '#74c7ec', '#94e2d5', '#b4befe'],
    },
    rose: {
      accent: '#f5c2e7', secondary: '#f38ba8',
      chart: ['#f5c2e7', '#f38ba8', '#eba0ac', '#cba6f7', '#fab387', '#b4befe', '#74c7ec', '#94e2d5'],
    },
  },
  'rose-pine-dawn': {
    classic: {
      accent: '#79569b', secondary: '#286983',
      chart: ['#79569b', '#286983', '#56949f', '#d7827e', '#916000', '#b03759', '#436b58', '#8a8597'],
    },
    ocean: {
      accent: '#286983', secondary: '#56949f',
      chart: ['#286983', '#56949f', '#79569b', '#d7827e', '#436b58', '#916000', '#b03759', '#8a8597'],
    },
    pine: {
      accent: '#436b58', secondary: '#56949f',
      chart: ['#436b58', '#56949f', '#286983', '#79569b', '#916000', '#d7827e', '#b03759', '#8a8597'],
    },
    amber: {
      accent: '#916000', secondary: '#b03759',
      chart: ['#916000', '#d7827e', '#b03759', '#79569b', '#286983', '#56949f', '#436b58', '#8a8597'],
    },
    rose: {
      accent: '#b03759', secondary: '#d7827e',
      chart: ['#b03759', '#d7827e', '#79569b', '#916000', '#286983', '#56949f', '#436b58', '#8a8597'],
    },
  },
  'rose-pine-moon': {
    classic: {
      accent: '#c4a7e7', secondary: '#9ccfd8',
      chart: ['#c4a7e7', '#9ccfd8', '#3e8fb0', '#ea9a97', '#f6c177', '#eb6f92', '#a3c9ad', '#b4afce'],
    },
    ocean: {
      accent: '#9ccfd8', secondary: '#3e8fb0',
      chart: ['#9ccfd8', '#3e8fb0', '#c4a7e7', '#a3c9ad', '#ea9a97', '#f6c177', '#eb6f92', '#b4afce'],
    },
    pine: {
      accent: '#a3c9ad', secondary: '#3e8fb0',
      chart: ['#a3c9ad', '#3e8fb0', '#9ccfd8', '#c4a7e7', '#ea9a97', '#f6c177', '#eb6f92', '#b4afce'],
    },
    amber: {
      accent: '#f6c177', secondary: '#eb6f92',
      chart: ['#f6c177', '#ea9a97', '#eb6f92', '#c4a7e7', '#9ccfd8', '#3e8fb0', '#a3c9ad', '#b4afce'],
    },
    rose: {
      accent: '#eb6f92', secondary: '#ea9a97',
      chart: ['#eb6f92', '#ea9a97', '#c4a7e7', '#f6c177', '#9ccfd8', '#3e8fb0', '#a3c9ad', '#b4afce'],
    },
  },
}

export function getColorSchemePreview(themeId: string, schemeId: ColorSchemeId): string {
  const scheme = SCHEME_PALETTES[themeId as ThemeId]?.[schemeId] ?? SCHEME_PALETTES['catppuccin-latte'][schemeId]
  return scheme.accent
}

const RAW_THEME_COLORS: Record<ThemeId, [string, string, string, string, string, string, string, string, string, string, string, string, string]> = {
  'catppuccin-latte': ['#eff1f5', '#ffffff', '#ffffff', '#e6e9ef', '#ccd0da', '#8c8fa1', '#4c4f69', '#62667c', '#8839ef', '#176b85', '#347a1b', '#946100', '#d20f39'],
  'catppuccin-mocha': ['#1e1e2e', '#242437', '#313244', '#181825', '#45475a', '#7f849c', '#cdd6f4', '#a6adc8', '#cba6f7', '#89dceb', '#a6e3a1', '#f9e2af', '#f38ba8'],
  'rose-pine-dawn': ['#faf4ed', '#fffaf3', '#fffdf9', '#f2e9e1', '#dfdad9', '#8a8597', '#575279', '#635d74', '#79569b', '#286983', '#436b58', '#916000', '#b03759'],
  'rose-pine-moon': ['#232136', '#2a273f', '#393552', '#2d2a45', '#44415a', '#817c9c', '#e0def4', '#b4afce', '#c4a7e7', '#9ccfd8', '#a3c9ad', '#f6c177', '#f28aa8'],
}

const THEME_LABELS: Record<ThemeId, { label: string; scheme: ThemePreset['scheme'] }> = {
  'catppuccin-latte': { label: 'Catppuccin Latte', scheme: 'light' },
  'catppuccin-mocha': { label: 'Catppuccin Mocha', scheme: 'dark' },
  'rose-pine-dawn': { label: 'Rosé Pine Dawn', scheme: 'light' },
  'rose-pine-moon': { label: 'Rosé Pine Moon', scheme: 'dark' },
}

function buildPreset(id: ThemeId, schemeId: ColorSchemeId = DEFAULT_COLOR_SCHEME_ID): ThemePreset {
  const { label, scheme } = THEME_LABELS[id]
  const [bg, surface, raised, subtle, border, control, text, muted, , , success, warning, danger] = RAW_THEME_COLORS[id]
  const palette = SCHEME_PALETTES[id]?.[schemeId] ?? SCHEME_PALETTES[id].classic
  const { accent, secondary, chart } = palette
  const mix = (color: string, percent: number, base = surface) => `color-mix(in srgb, ${color} ${percent}%, ${base})`

  return {
    id,
    label,
    scheme,
    colors: {
      bg, surface, 'surface-raised': raised, 'surface-subtle': subtle, border, 'border-strong': control,
      text, 'text-muted': muted, accent, 'accent-strong': scheme === 'light' ? mix(accent, 85, text) : accent,
      'accent-contrast': scheme === 'light' ? '#ffffff' : bg, 'accent-secondary': secondary,
      'accent-soft': mix(accent, scheme === 'light' ? 9 : 14), 'accent-border': accent, success, warning, danger,
      'success-soft': mix(success, 10), 'warning-soft': mix(warning, 10), 'danger-soft': mix(danger, 10),
      'success-border': mix(success, 45), 'warning-border': mix(warning, 45), 'danger-border': mix(danger, 45),
      focus: accent, 'overlay': 'rgba(15, 17, 26, .48)',
      'chart-grid': border,
      'chart-1': chart[0],
      'chart-2': chart[1],
      'chart-3': chart[2],
      'chart-4': chart[3],
      'chart-5': chart[4],
      'chart-6': chart[5],
      'chart-7': chart[6],
      'chart-8': chart[7],
      'heat-empty': subtle, 'heat-low': mix(accent, 18), 'heat-mid': mix(accent, 35),
      'heat-high': accent, 'heat-text': text, 'heat-text-high': scheme === 'light' ? '#ffffff' : bg,
      'glass-surface': mix(surface, 92, 'transparent'), 'glass-filter': 'blur(14px) saturate(115%)',
      'shadow-xs': '0 1px 2px rgba(15, 17, 26, .04)', 'shadow-sm': '0 2px 8px rgba(15, 17, 26, .04)',
      'shadow-md': '0 4px 16px rgba(15, 17, 26, .06)', 'shadow-lg': '0 12px 32px rgba(15, 17, 26, .16)',
    },
  }
}

export const THEMES: ThemePreset[] = [
  buildPreset('catppuccin-latte'),
  buildPreset('catppuccin-mocha'),
  buildPreset('rose-pine-dawn'),
  buildPreset('rose-pine-moon'),
]

export const DEFAULT_THEME_ID: ThemeId = 'catppuccin-latte'
export const UI_DESIGN_VERSION = 1

export function getTheme(id: string, schemeId: ColorSchemeId = DEFAULT_COLOR_SCHEME_ID): ThemePreset {
  const validId = (id in THEME_LABELS ? id : DEFAULT_THEME_ID) as ThemeId
  if (schemeId === DEFAULT_COLOR_SCHEME_ID) {
    return THEMES.find(theme => theme.id === validId) ?? THEMES[0]!
  }
  return buildPreset(validId, schemeId)
}

export function resolveColors(theme: ThemePreset): Record<string, string> {
  return { ...theme.colors, 'color-scheme': theme.scheme, 'ui-design-version': String(UI_DESIGN_VERSION) }
}
