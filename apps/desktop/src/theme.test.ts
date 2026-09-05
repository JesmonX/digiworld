import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_ACCENT_THEME_ID, DEFAULT_FONT_THEME_ID, DEFAULT_FONT_WEIGHT, FONT_THEME_STORAGE_KEY,
  FONT_WEIGHT_STORAGE_KEY, loadTextScale, saveTextScale, TEXT_SCALE_STORAGE_KEY,
  THEME_STORAGE_KEY, getAccentTheme, getFontTheme, loadAccentThemeId,
  loadFontThemeId, loadFontWeight, loadGlassMode, pluginTheme, saveAccentThemeId, saveFontThemeId,
  saveFontWeight, saveGlassMode, GLASS_STORAGE_KEY, COLOR_SCHEME_STORAGE_KEY,
  DEFAULT_COLOR_SCHEME_ID, loadColorSchemeId, saveColorSchemeId,
} from './theme'

describe('accent themes', () => {
  it('loads a stored theme and falls back for unknown values', () => {
    expect(loadAccentThemeId({ getItem: () => 'catppuccin-mocha' })).toBe('catppuccin-mocha')
    expect(loadAccentThemeId({ getItem: () => 'dark' })).toBe(DEFAULT_ACCENT_THEME_ID)
  })

  it('persists the selected theme', () => {
    const setItem = vi.fn()
    saveAccentThemeId('rose-pine-moon', { setItem })
    expect(setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, 'rose-pine-moon')
  })

  it('resolves complete palette and typography for plugins', () => {
    const theme = pluginTheme(getAccentTheme('rose-pine-dawn'), getFontTheme('wenkai'))
    expect(theme).toMatchObject({
      'color-scheme': 'light',
      'bg': '#faf4ed',
      'surface': '#fffaf3',
      'accent': '#79569b',
      'accent-strong': expect.stringContaining('color-mix'),
      'accent-soft': expect.stringContaining('color-mix'),
      'font-sans': expect.stringContaining('LXGW WenKai'),
      'font-display': expect.stringContaining('LXGW WenKai'),
      'font-brand': expect.stringContaining('Digiworld Smiley Sans'),
      success: '#436b58',
      warning: '#916000',
    })
  })
})

describe('font themes', () => {
  it('loads a stored font and falls back for unknown values', () => {
    expect(loadFontThemeId({ getItem: () => 'wenkai' })).toBe('wenkai')
    expect(loadFontThemeId({ getItem: () => 'comic-sans' })).toBe(DEFAULT_FONT_THEME_ID)
  })

  it('persists the selected font', () => {
    const setItem = vi.fn()
    saveFontThemeId('system', { setItem })
    expect(setItem).toHaveBeenCalledWith(FONT_THEME_STORAGE_KEY, 'system')
  })

  it('uses Inter for Latin UI text, Plex for Chinese fallback, and Smiley only for brand text', () => {
    const plex = getFontTheme('plex')
    expect(plex.fontSans).toContain('Digiworld Inter Variable')
    expect(plex.fontSans).toContain('Digiworld Plex Sans SC')
    expect(plex.fontDisplay).toContain('Digiworld Inter Variable')
    expect(plex.fontDisplay).toContain('Digiworld Plex Sans SC')
    expect(plex.fontDisplay).not.toContain('Smiley Sans')
    expect(plex.fontBrand).toContain('Digiworld Smiley Sans')
  })

  it('persists a validated font weight and sends its hierarchy to plugins', () => {
    expect(loadFontWeight({ getItem: () => '600' })).toBe(600)
    expect(loadFontWeight({ getItem: () => '550' })).toBe(DEFAULT_FONT_WEIGHT)
    const setItem = vi.fn()
    saveFontWeight(400, { setItem })
    expect(setItem).toHaveBeenCalledWith(FONT_WEIGHT_STORAGE_KEY, '400')
    expect(pluginTheme(getAccentTheme('catppuccin-latte'), getFontTheme('plex'), 600)).toMatchObject({
      'weight-regular': '600',
      'weight-medium': '600',
      'weight-semibold': '700',
      'weight-bold': '800',
    })
  })

  it('loads and saves the glass preference with a disabled fallback', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
    }
    expect(loadGlassMode(storage)).toBe('disabled')
    saveGlassMode('disabled', storage)
    expect(loadGlassMode(storage)).toBe('disabled')
    values.set(GLASS_STORAGE_KEY, 'unexpected')
    expect(loadGlassMode(storage)).toBe('disabled')
  })
})

describe('complete theme preferences', () => {
  it('migrates old accent preferences once without overwriting the new selection', () => {
    const values = new Map([['digiworld.accent-theme.v1', 'rose']])
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
    expect(loadAccentThemeId(storage)).toBe('catppuccin-latte')
    saveAccentThemeId('catppuccin-mocha', storage)
    expect(loadAccentThemeId(storage)).toBe('catppuccin-mocha')
    expect(pluginTheme(getAccentTheme('catppuccin-mocha'))['color-scheme']).toBe('dark')
    saveTextScale(125, storage)
    expect(values.get(TEXT_SCALE_STORAGE_KEY)).toBe('125')
    expect(loadTextScale(storage)).toBe(125)
    expect(pluginTheme(getAccentTheme('catppuccin-latte'), getFontTheme('plex'), 400, 'disabled', 125)['text-scale']).toBe('1.25')
  })

  it('loads, saves and applies color scheme preferences', () => {
    expect(loadColorSchemeId({ getItem: () => 'ocean' })).toBe('ocean')
    expect(loadColorSchemeId({ getItem: () => 'invalid' })).toBe(DEFAULT_COLOR_SCHEME_ID)

    const setItem = vi.fn()
    saveColorSchemeId('amber', { setItem })
    expect(setItem).toHaveBeenCalledWith(COLOR_SCHEME_STORAGE_KEY, 'amber')

    const oceanTheme = getAccentTheme('catppuccin-latte', 'ocean')
    expect(oceanTheme.colors.accent).toBe('#1e66f5')
    expect(oceanTheme.colors['chart-1']).toBe('#1e66f5')
    expect(oceanTheme.colors['chart-2']).toBe('#209fb5')

    const pineMoonTheme = getAccentTheme('rose-pine-moon', 'pine')
    expect(pineMoonTheme.colors.accent).toBe('#a3c9ad')
    expect(pineMoonTheme.colors['chart-1']).toBe('#a3c9ad')
    expect(pineMoonTheme.colors['chart-2']).toBe('#3e8fb0')

    const plugin = pluginTheme(oceanTheme)
    expect(plugin['chart-1']).toBe('#1e66f5')
    expect(plugin['chart-8']).toBe('#d25400')
  })
})
