import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_ACCENT_THEME_ID, DEFAULT_FONT_THEME_ID, DEFAULT_FONT_WEIGHT, FONT_THEME_STORAGE_KEY,
  FONT_WEIGHT_STORAGE_KEY,
  THEME_STORAGE_KEY, getAccentTheme, getFontTheme, loadAccentThemeId,
  loadFontThemeId, loadFontWeight, pluginTheme, saveAccentThemeId, saveFontThemeId,
  saveFontWeight,
} from './theme'

describe('accent themes', () => {
  it('loads a stored theme and falls back for unknown values', () => {
    expect(loadAccentThemeId({ getItem: () => 'teal' })).toBe('teal')
    expect(loadAccentThemeId({ getItem: () => 'dark' })).toBe(DEFAULT_ACCENT_THEME_ID)
  })

  it('persists the selected theme', () => {
    const setItem = vi.fn()
    saveAccentThemeId('orange', { setItem })
    expect(setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, 'orange')
  })

  it('changes plugin accents without changing the light surfaces', () => {
    const theme = pluginTheme(getAccentTheme('rose'), getFontTheme('wenkai'))
    expect(theme).toMatchObject({
      'color-scheme': 'light',
      'bg': '#f5f7fb',
      'surface': '#ffffff',
      'accent': '#e11d48',
      'accent-strong': '#be123c',
      'accent-soft': '#fff0f3',
      'font-sans': expect.stringContaining('LXGW WenKai'),
      'font-display': expect.stringContaining('LXGW WenKai'),
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

  it('uses Plex consistently for body and display text', () => {
    const plex = getFontTheme('plex')
    expect(plex.fontSans).toContain('Digiworld Plex Sans SC')
    expect(plex.fontDisplay).toContain('Digiworld Plex Sans SC')
    expect(plex.fontDisplay).not.toContain('Smiley Sans')
  })

  it('persists a validated font weight and sends its hierarchy to plugins', () => {
    expect(loadFontWeight({ getItem: () => '600' })).toBe(600)
    expect(loadFontWeight({ getItem: () => '550' })).toBe(DEFAULT_FONT_WEIGHT)
    const setItem = vi.fn()
    saveFontWeight(400, { setItem })
    expect(setItem).toHaveBeenCalledWith(FONT_WEIGHT_STORAGE_KEY, '400')
    expect(pluginTheme(getAccentTheme('violet'), getFontTheme('plex'), 600)).toMatchObject({
      'weight-regular': '600',
      'weight-medium': '600',
      'weight-semibold': '700',
      'weight-bold': '800',
    })
  })
})
