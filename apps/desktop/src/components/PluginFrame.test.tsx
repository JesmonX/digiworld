// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAccentTheme, pluginTheme } from '../theme'
import { PluginFrame } from './PluginFrame'

describe('PluginFrame theme', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
  })

  afterEach(() => container.remove())

  it('sends the current theme when ready and after a live theme change', async () => {
    const root = createRoot(container)
    const violet = pluginTheme(getAccentTheme('violet'))
    const blue = pluginTheme(getAccentTheme('blue'))
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

    await act(async () => root.unmount())
  })
})
