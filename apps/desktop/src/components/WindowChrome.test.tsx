// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WindowChrome } from './WindowChrome'

const windowMocks = vi.hoisted(() => ({
  minimize: vi.fn(async () => {}),
  toggleMaximize: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  isMaximized: vi.fn(async () => false),
  onResized: vi.fn(async () => () => {}),
}))

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => windowMocks }))

describe('WindowChrome', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    for (const mock of Object.values(windowMocks)) mock.mockClear()
  })

  afterEach(() => container.remove())

  it('routes the three controls to the native window', async () => {
    const root = createRoot(container)
    await act(async () => root.render(<WindowChrome />))

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="最小化"]')?.click()
      container.querySelector<HTMLButtonElement>('[aria-label="最大化"]')?.click()
      container.querySelector<HTMLButtonElement>('[aria-label="关闭"]')?.click()
    })

    expect(windowMocks.minimize).toHaveBeenCalledOnce()
    expect(windowMocks.toggleMaximize).toHaveBeenCalledOnce()
    expect(windowMocks.close).toHaveBeenCalledOnce()
    await act(async () => root.unmount())
  })

  it('toggles maximize when the drag region is double-clicked', async () => {
    const root = createRoot(container)
    await act(async () => root.render(<WindowChrome />))
    const chrome = container.querySelector<HTMLElement>('.window-chrome')
    await act(async () => chrome?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    expect(windowMocks.toggleMaximize).toHaveBeenCalledOnce()
    await act(async () => root.unmount())
  })
})
