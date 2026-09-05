// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAccentTheme, getFontTheme, pluginTheme } from '../theme'
import { PluginFrame, resolveTypographyUrls, withHostTypography } from './PluginFrame'

describe('PluginFrame theme', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
  })

  it('supplies host-owned fonts without requiring them in plugin bundles', () => {
    const source = withHostTypography(
      '<!doctype html><html><head></head><body></body></html>',
      '@font-face { font-family: "Digiworld Plex Sans SC"; }',
    )

    expect(source).toContain('<style data-digiworld-host-typography>')
    expect(source).toContain('@font-face')
    expect(source).toContain('Digiworld Plex Sans SC')
    expect(source).toContain('<body></body>')
  })

  it('resolves relative font URLs against host baseUrl and injects base tag', () => {
    const baseUrl = 'http://tauri.localhost/'
    const css = '@font-face { font-family: "Digiworld Plex Sans SC"; src: url("/assets/IBMPlexSansSC-Regular.woff2") format("woff2"); }'
    const resolved = resolveTypographyUrls(css, baseUrl)
    expect(resolved).toContain('url("http://tauri.localhost/assets/IBMPlexSansSC-Regular.woff2")')

    const source = withHostTypography(
      '<!doctype html><html><head><title>Plugin</title></head><body></body></html>',
      css,
      baseUrl,
    )
    expect(source).toContain('<base href="http://tauri.localhost/" />')
    expect(source).toContain('url("http://tauri.localhost/assets/IBMPlexSansSC-Regular.woff2")')
  })

  afterEach(() => container.remove())

  it('sends the current theme when ready and after a live theme change', async () => {
    const root = createRoot(container)
    const violet = pluginTheme(getAccentTheme('catppuccin-latte'))
    const blue = pluginTheme(getAccentTheme('catppuccin-mocha'), getFontTheme('wenkai'), 500, 'disabled')
    await act(async () => root.render(<PluginFrame pluginId="sample" html="<main />" theme={violet} />))

    const iframe = container.querySelector('iframe')!
    const expectedBackground = document.createElement('div')
    expectedBackground.style.backgroundColor = violet.bg
    expect(iframe.style.backgroundColor).toBe(expectedBackground.style.backgroundColor)
    const postMessage = vi.spyOn(iframe.contentWindow!, 'postMessage')
    await act(async () => window.dispatchEvent(new MessageEvent('message', {
      source: iframe.contentWindow,
      data: { source: 'digiworld-plugin', pluginId: 'sample', kind: 'ready' },
    })))

    expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'theme', payload: violet,
    }), '*')

    await act(async () => root.render(<PluginFrame pluginId="sample" html="<main />" theme={blue} />))
    expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'theme', payload: blue,
    }), '*')
    expect(iframe.srcdoc).toContain('data-digiworld-host-design')
    expect(iframe.srcdoc).toContain('--dw-bg:#eff1f5')
    expect(blue['font-sans']).toContain('LXGW WenKai')
    expect(blue['weight-regular']).toBe('500')

    await act(async () => root.unmount())
  })

  it('notifies plugin of visibility changes', async () => {
    const root = createRoot(container)
    const theme = pluginTheme(getAccentTheme('catppuccin-latte'))
    await act(async () => root.render(<PluginFrame pluginId="sample" html="<main />" theme={theme} active={true} />))

    const iframe = container.querySelector('iframe')!
    const postMessage = vi.spyOn(iframe.contentWindow!, 'postMessage')
    await act(async () => window.dispatchEvent(new MessageEvent('message', {
      source: iframe.contentWindow,
      data: { source: 'digiworld-plugin', pluginId: 'sample', kind: 'ready' },
    })))

    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'event', method: 'host.visibility', payload: { active: true },
    }), '*')

    await act(async () => root.render(<PluginFrame pluginId="sample" html="<main />" theme={theme} active={false} />))
    expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'event', method: 'host.visibility', payload: { active: false },
    }), '*')

    await act(async () => root.unmount())
  })
})
