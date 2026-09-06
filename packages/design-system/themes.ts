/** Palette sources and adaptation policy: see PALETTES.md. */
export type ThemeId =
  | 'catppuccin-latte'
  | 'catppuccin-mocha'
  | 'rose-pine-dawn'
  | 'rose-pine-moon'
  | 'tokyo-night'
  | 'tokyo-night-day'
  | 'nord'
  | 'github-light'
  | 'dracula'
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
  'tokyo-night': {
    classic: {
      accent: '#7aa2f7', secondary: '#2ac3de',
      chart: ['#7aa2f7', '#2ac3de', '#bb9af7', '#7dcfff', '#ff9e64', '#e0af68', '#9ece6a', '#f7768e'],
    },
    ocean: {
      accent: '#7dcfff', secondary: '#2ac3de',
      chart: ['#7dcfff', '#2ac3de', '#7aa2f7', '#b4f9f8', '#bb9af7', '#9ece6a', '#ff9e64', '#f7768e'],
    },
    pine: {
      accent: '#73daca', secondary: '#9ece6a',
      chart: ['#73daca', '#9ece6a', '#41a6b5', '#b4f9f8', '#7dcfff', '#bb9af7', '#ff9e64', '#f7768e'],
    },
    amber: {
      accent: '#ff9e64', secondary: '#e0af68',
      chart: ['#ff9e64', '#e0af68', '#f7768e', '#bb9af7', '#7aa2f7', '#7dcfff', '#73daca', '#9ece6a'],
    },
    rose: {
      accent: '#f7768e', secondary: '#bb9af7',
      chart: ['#f7768e', '#bb9af7', '#ff9e64', '#e0af68', '#7aa2f7', '#7dcfff', '#73daca', '#9ece6a'],
    },
  },
  'tokyo-night-day': {
    classic: {
      accent: '#1864cc', secondary: '#007197',
      chart: ['#1864cc', '#007197', '#7847bd', '#166775', '#9854f1', '#a83900', '#27621c', '#be1b47'],
    },
    ocean: {
      accent: '#007197', secondary: '#166775',
      chart: ['#007197', '#166775', '#1864cc', '#007a8a', '#7847bd', '#27621c', '#a83900', '#be1b47'],
    },
    pine: {
      accent: '#166775', secondary: '#27621c',
      chart: ['#166775', '#27621c', '#007a8a', '#3f6b28', '#007197', '#1864cc', '#a83900', '#be1b47'],
    },
    amber: {
      accent: '#a83900', secondary: '#855300',
      chart: ['#a83900', '#855300', '#be1b47', '#7847bd', '#1864cc', '#007197', '#166775', '#27621c'],
    },
    rose: {
      accent: '#be1b47', secondary: '#7847bd',
      chart: ['#be1b47', '#7847bd', '#a83900', '#855300', '#1864cc', '#007197', '#166775', '#27621c'],
    },
  },
  'nord': {
    classic: {
      accent: '#88c0d0', secondary: '#81a1c1',
      chart: ['#88c0d0', '#81a1c1', '#8fbcbb', '#5e81ac', '#b48ead', '#ebcb8b', '#a3be8c', '#ff8894'],
    },
    ocean: {
      accent: '#81a1c1', secondary: '#5e81ac',
      chart: ['#81a1c1', '#5e81ac', '#88c0d0', '#8fbcbb', '#b48ead', '#a3be8c', '#ebcb8b', '#ff8894'],
    },
    pine: {
      accent: '#8fbcbb', secondary: '#a3be8c',
      chart: ['#8fbcbb', '#a3be8c', '#88c0d0', '#81a1c1', '#5e81ac', '#ebcb8b', '#b48ead', '#ff8894'],
    },
    amber: {
      accent: '#ebcb8b', secondary: '#d08770',
      chart: ['#ebcb8b', '#d08770', '#ff8894', '#b48ead', '#88c0d0', '#81a1c1', '#8fbcbb', '#a3be8c'],
    },
    rose: {
      accent: '#b48ead', secondary: '#ff8894',
      chart: ['#b48ead', '#ff8894', '#d08770', '#ebcb8b', '#88c0d0', '#81a1c1', '#8fbcbb', '#a3be8c'],
    },
  },
  'github-light': {
    classic: {
      accent: '#0969da', secondary: '#0550ae',
      chart: ['#0969da', '#0550ae', '#8250df', '#147432', '#cf222e', '#8c5c00', '#0a3069', '#6639ba'],
    },
    ocean: {
      accent: '#0550ae', secondary: '#0969da',
      chart: ['#0550ae', '#0969da', '#0969da', '#0a3069', '#8250df', '#147432', '#8c5c00', '#cf222e'],
    },
    pine: {
      accent: '#147432', secondary: '#116329',
      chart: ['#147432', '#116329', '#2da44e', '#0969da', '#8250df', '#0550ae', '#8c5c00', '#cf222e'],
    },
    amber: {
      accent: '#8c5c00', secondary: '#704800',
      chart: ['#8c5c00', '#704800', '#cf222e', '#8250df', '#0969da', '#0550ae', '#147432', '#116329'],
    },
    rose: {
      accent: '#cf222e', secondary: '#8250df',
      chart: ['#cf222e', '#8250df', '#8c5c00', '#704800', '#0969da', '#0550ae', '#147432', '#116329'],
    },
  },
  'dracula': {
    classic: {
      accent: '#bd93f9', secondary: '#8be9fd',
      chart: ['#bd93f9', '#8be9fd', '#ff79c6', '#50fa7b', '#f1fa8c', '#ffb86c', '#ff6e6e', '#6272a4'],
    },
    ocean: {
      accent: '#8be9fd', secondary: '#bd93f9',
      chart: ['#8be9fd', '#bd93f9', '#ff79c6', '#50fa7b', '#6272a4', '#f1fa8c', '#ffb86c', '#ff6e6e'],
    },
    pine: {
      accent: '#50fa7b', secondary: '#8be9fd',
      chart: ['#50fa7b', '#8be9fd', '#bd93f9', '#ff79c6', '#6272a4', '#f1fa8c', '#ffb86c', '#ff6e6e'],
    },
    amber: {
      accent: '#ffb86c', secondary: '#f1fa8c',
      chart: ['#ffb86c', '#f1fa8c', '#ff79c6', '#ff6e6e', '#bd93f9', '#8be9fd', '#50fa7b', '#6272a4'],
    },
    rose: {
      accent: '#ff79c6', secondary: '#ff6e6e',
      chart: ['#ff79c6', '#ff6e6e', '#bd93f9', '#ffb86c', '#8be9fd', '#50fa7b', '#f1fa8c', '#6272a4'],
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
  'tokyo-night': ['#1a1b26', '#202333', '#292e42', '#16161e', '#3b4261', '#6673a3', '#c0caf5', '#9aa5ce', '', '', '#9ece6a', '#e0af68', '#f7768e'],
  'tokyo-night-day': ['#e1e2e7', '#f0f1f4', '#ffffff', '#d5d6db', '#c4c8da', '#737a9f', '#2e3962', '#4e577d', '', '', '#27621c', '#855300', '#be1b47'],
  'nord': ['#242933', '#2e3440', '#3b4252', '#1e222a', '#434c5e', '#6e7e9e', '#eceff4', '#b8c4d6', '', '', '#a3be8c', '#ebcb8b', '#ff8894'],
  'github-light': ['#f6f8fa', '#ffffff', '#ffffff', '#eaeef2', '#d0d7de', '#6e7781', '#1f2328', '#57606a', '', '', '#147432', '#8c5c00', '#cf222e'],
  'dracula': ['#21222c', '#282a36', '#343746', '#191a21', '#44475a', '#6272a4', '#f8f8f2', '#b8bfe0', '', '', '#50fa7b', '#f1fa8c', '#ff6e6e'],
}

const THEME_LABELS: Record<ThemeId, { label: string; scheme: ThemePreset['scheme'] }> = {
  'catppuccin-latte': { label: 'Catppuccin Latte', scheme: 'light' },
  'catppuccin-mocha': { label: 'Catppuccin Mocha', scheme: 'dark' },
  'rose-pine-dawn': { label: 'Rosé Pine Dawn', scheme: 'light' },
  'rose-pine-moon': { label: 'Rosé Pine Moon', scheme: 'dark' },
  'tokyo-night': { label: 'Tokyo Night', scheme: 'dark' },
  'tokyo-night-day': { label: 'Tokyo Night Day', scheme: 'light' },
  'nord': { label: 'Nord', scheme: 'dark' },
  'github-light': { label: 'GitHub Light', scheme: 'light' },
  'dracula': { label: 'Dracula', scheme: 'dark' },
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
      // Dark palettes keep success states readable without creating large green-tinted slabs.
      'success-soft': scheme === 'dark' ? subtle : mix(success, 10), 'warning-soft': mix(warning, 10), 'danger-soft': mix(danger, 10),
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
      'chart-cache-rate': id === 'catppuccin-mocha' ? '#f9e2af' : id === 'rose-pine-dawn' ? '#ea9d34' : id === 'rose-pine-moon' ? '#f6c177' : id === 'tokyo-night' ? '#e0af68' : id === 'tokyo-night-day' ? '#855300' : id === 'nord' ? '#ebcb8b' : id === 'github-light' ? '#8c5c00' : id === 'dracula' ? '#f1fa8c' : '#df8e1d',
      'heat-empty': subtle, 'heat-low': mix(accent, 18), 'heat-mid': mix(accent, 35),
      'heat-high': accent, 'heat-text': text, 'heat-text-high': scheme === 'light' ? '#ffffff' : bg,
      'heat-count-text': scheme === 'light' ? text : '#ffffff',
      'heat-count-strong': '#ffffff',
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
  buildPreset('tokyo-night'),
  buildPreset('tokyo-night-day'),
  buildPreset('nord'),
  buildPreset('github-light'),
  buildPreset('dracula'),
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
