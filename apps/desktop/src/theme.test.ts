import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_ACCENT_THEME_ID, THEME_STORAGE_KEY, getAccentTheme, loadAccentThemeId,
  pluginTheme, saveAccentThemeId,
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
    const theme = pluginTheme(getAccentTheme('rose'))
    expect(theme).toMatchObject({
      'color-scheme': 'light',
      'bg': '#f5f7fb',
      'surface': '#ffffff',
      'accent': '#e11d48',
      'accent-strong': '#be123c',
      'accent-soft': '#fff0f3',
    })
  })
})
