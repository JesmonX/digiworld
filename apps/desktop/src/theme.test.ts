import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_ACCENT_THEME_ID, DEFAULT_FONT_THEME_ID, DEFAULT_FONT_WEIGHT, FONT_THEME_STORAGE_KEY,
  FONT_WEIGHT_STORAGE_KEY,
  THEME_STORAGE_KEY, getAccentTheme, getFontTheme, loadAccentThemeId,
  loadFontThemeId, loadFontWeight, loadGlassMode, pluginTheme, saveAccentThemeId, saveFontThemeId,
  saveFontWeight, saveGlassMode, GLASS_STORAGE_KEY, COLOR_SCHEME_STORAGE_KEY,
  DEFAULT_COLOR_SCHEME_ID, loadColorSchemeId, saveColorSchemeId,
} from './theme'

describe('accent themes', () => {
  it('loads a stored theme and maps legacy values cleanly', () => {
    expect(loadAccentThemeId({ getItem: () => 'light' })).toBe('light')
    expect(loadAccentThemeId({ getItem: () => 'dark' })).toBe('dark')
    expect(loadAccentThemeId({ getItem: () => 'catppuccin-mocha' })).toBe('dark')
    expect(loadAccentThemeId({ getItem: () => 'tokyo-night' })).toBe('dark')
    expect(loadAccentThemeId({ getItem: () => 'github-light' })).toBe('light')
    expect(loadAccentThemeId({ getItem: () => 'unknown' })).toBe(DEFAULT_ACCENT_THEME_ID)
  })

  it('persists the selected theme', () => {
    const setItem = vi.fn()
    saveAccentThemeId('dark', { setItem })
    expect(setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, 'dark')
    saveAccentThemeId('light', { setItem })
    expect(setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, 'light')
  })

  it('resolves complete palette and typography for plugins', () => {
    const light = pluginTheme(getAccentTheme('light'), getFontTheme('harmony'))
    expect(light).toMatchObject({
      'color-scheme': 'light',
      'bg': '#f5f7fa',
      'surface': '#ffffff',
      'accent': '#111827',
      'accent-contrast': '#ffffff',
      'font-sans': expect.stringContaining('HarmonyOS Sans SC'),
      'font-display': expect.stringContaining('HarmonyOS Sans SC'),
      'font-brand': expect.stringContaining('Digiworld Smiley Sans'),
      success: '#0d7650',
      warning: '#92400e',
      danger: '#b91c1c',
    })

    const dark = pluginTheme(getAccentTheme('dark'))
    expect(dark).toMatchObject({
      'color-scheme': 'dark',
      'bg': '#0c0e12',
      'surface': '#14171f',
      'accent': '#f8fafc',
      success: '#34d399',
      warning: '#fbbf24',
      danger: '#f87171',
    })
  })
})

describe('font themes', () => {
  it('loads a stored font and falls back for unknown values', () => {
    expect(loadFontThemeId({ getItem: () => 'harmony' })).toBe('harmony')
    expect(loadFontThemeId({ getItem: () => 'sarasa' })).toBe('sarasa')
    expect(loadFontThemeId({ getItem: () => 'wenkai' })).toBe(DEFAULT_FONT_THEME_ID)
    expect(loadFontThemeId({ getItem: () => 'system' })).toBe(DEFAULT_FONT_THEME_ID)
    expect(loadFontThemeId({ getItem: () => 'comic-sans' })).toBe(DEFAULT_FONT_THEME_ID)
  })

  it('persists the selected font', () => {
    const setItem = vi.fn()
    saveFontThemeId('sarasa', { setItem })
    expect(setItem).toHaveBeenCalledWith(FONT_THEME_STORAGE_KEY, 'sarasa')
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

  it('configures HarmonyOS Sans SC and Sarasa Gothic correctly', () => {
    const harmony = getFontTheme('harmony')
    expect(harmony.fontSans).toContain('Digiworld HarmonyOS Sans SC')
    expect(harmony.fontDisplay).toContain('Digiworld HarmonyOS Sans SC')
    expect(harmony.fontBrand).toContain('Digiworld Smiley Sans')

    const sarasa = getFontTheme('sarasa')
    expect(sarasa.fontSans).toContain('Digiworld Sarasa Gothic SC')
    expect(sarasa.fontDisplay).toContain('Digiworld Sarasa Gothic SC')
    expect(sarasa.fontBrand).toContain('Digiworld Smiley Sans')
  })

  it('persists a validated font weight and sends its hierarchy to plugins', () => {
    expect(loadFontWeight({ getItem: () => '600' })).toBe(600)
    expect(loadFontWeight({ getItem: () => '550' })).toBe(DEFAULT_FONT_WEIGHT)
    const setItem = vi.fn()
    saveFontWeight(400, { setItem })
    expect(setItem).toHaveBeenCalledWith(FONT_WEIGHT_STORAGE_KEY, '400')
    expect(pluginTheme(getAccentTheme('light'), getFontTheme('plex'), 600)).toMatchObject({
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
    expect(loadAccentThemeId(storage)).toBe('light')
    saveAccentThemeId('dark', storage)
    expect(loadAccentThemeId(storage)).toBe('dark')
    expect(pluginTheme(getAccentTheme('dark'))['color-scheme']).toBe('dark')
  })

  it('loads and saves color scheme preferences with modern defaults', () => {
    expect(loadColorSchemeId({ getItem: () => 'classic' })).toBe('classic')
    expect(loadColorSchemeId({ getItem: () => 'invalid' })).toBe(DEFAULT_COLOR_SCHEME_ID)

    const setItem = vi.fn()
    saveColorSchemeId('classic', { setItem })
    expect(setItem).toHaveBeenCalledWith(COLOR_SCHEME_STORAGE_KEY, 'classic')

    const lightTheme = getAccentTheme('light')
    expect(lightTheme.colors.accent).toBe('#111827')
    expect(lightTheme.colors['chart-1']).toBe('#059669')
    expect(lightTheme.colors['chart-2']).toBe('#2563eb')

    const darkTheme = getAccentTheme('dark')
    expect(darkTheme.colors.accent).toBe('#f8fafc')
    expect(darkTheme.colors['chart-1']).toBe('#34d399')
    expect(darkTheme.colors['chart-2']).toBe('#60a5fa')

    const plugin = pluginTheme(lightTheme)
    expect(plugin['chart-1']).toBe('#059669')
    expect(plugin['chart-8']).toBe('#ea580c')
  })
})
