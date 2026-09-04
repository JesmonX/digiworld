import { describe, expect, it } from 'vitest'
import { applyPluginTheme, suppressContextMenu } from './bridge.js'

describe('plugin presentation helpers', () => {
  it('applies semantic theme variables and the document color scheme', () => {
    const properties = new Map<string, string>()
    const root = {
      style: {
        colorScheme: '',
        setProperty(name: string, value: string) { properties.set(name, value) },
      },
      dataset: {} as DOMStringMap,
    } as unknown as HTMLElement

    applyPluginTheme({
      'color-scheme': 'light',
      text: '#172033',
      accent: '#5b5ce2',
      'font-sans': '"Digiworld LXGW WenKai", serif',
      'font-display': '"Digiworld LXGW WenKai", serif',
      'font-brand': '"Digiworld Smiley Sans", sans-serif',
      'weight-regular': '500',
      'weight-semibold': '600',
      glass: 'disabled',
    }, root)

    expect(root.style.colorScheme).toBe('light')
    expect(properties.get('--dw-text')).toBe('#172033')
    expect(properties.get('--dw-accent')).toBe('#5b5ce2')
    expect(properties.get('--dw-font-sans')).toBe('"Digiworld LXGW WenKai", serif')
    expect(properties.get('--dw-font-display')).toBe('"Digiworld LXGW WenKai", serif')
    expect(properties.get('--dw-font-brand')).toBe('"Digiworld Smiley Sans", sans-serif')
    expect(properties.get('--dw-weight-regular')).toBe('500')
    expect(properties.get('--dw-weight-semibold')).toBe('600')
    expect(properties.get('--dw-glass')).toBe('disabled')
    expect(root.dataset.dwGlass).toBe('disabled')
  })

  it('suppresses and restores the native context menu', () => {
    const target = new EventTarget()
    const restore = suppressContextMenu(target)
    const blocked = new Event('contextmenu', { cancelable: true })
    target.dispatchEvent(blocked)
    expect(blocked.defaultPrevented).toBe(true)

    restore()
    const restored = new Event('contextmenu', { cancelable: true })
    target.dispatchEvent(restored)
    expect(restored.defaultPrevented).toBe(false)
  })
})
