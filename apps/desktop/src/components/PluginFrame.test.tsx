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
    const violet = pluginTheme(getAccentTheme('violet'))
    const blue = pluginTheme(getAccentTheme('blue'), getFontTheme('wenkai'))
    await act(async () => root.render(<PluginFrame pluginId="sample" html="<main />" theme={violet} />))

    const iframe = container.querySelector('iframe')!
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
    expect(blue['font-sans']).toContain('LXGW WenKai')
    expect(blue['weight-regular']).toBe('500')

    await act(async () => root.unmount())
  })
})
