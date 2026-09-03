import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_ACCENT_THEME_ID, DEFAULT_FONT_THEME_ID, FONT_THEME_STORAGE_KEY,
  THEME_STORAGE_KEY, getAccentTheme, getFontTheme, loadAccentThemeId,
  loadFontThemeId, pluginTheme, saveAccentThemeId, saveFontThemeId,
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
})
