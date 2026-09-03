// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { FONT_THEME_STORAGE_KEY, FONT_WEIGHT_STORAGE_KEY } from './theme'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  testProxySettings: vi.fn(),
  checkPluginUpdates: vi.fn(),
  installPluginUpdates: vi.fn(),
  checkCoreUpdate: vi.fn(),
  installCoreUpdate: vi.fn(),
}))

vi.mock('./components/WindowChrome', () => ({ WindowChrome: () => <div /> }))
vi.mock('./lib/api', () => ({
  api: {
    appState: vi.fn(async () => ({
      version: '0.2.2', platform: 'windows', target: 'windows-x86_64',
      plugins: [{
        id: 'example.plugin', version: '1.0.0', name: '示例插件', description: '',
        enabled: true, state: 'running', permissions: [],
      }],
      catalogSequence: 1, launchAtStartup: false,
    })),
    catalog: vi.fn(async () => ({ schemaVersion: 1, sequence: 1, generatedAt: '', plugins: [] })),
    proxySettings: vi.fn(async () => ({ mode: 'system' })),
    onUpdateProgress: vi.fn(async () => () => {}),
    setLaunchAtStartup: vi.fn(async () => {}),
    setProxySettings: vi.fn(async settings => settings),
    testProxySettings: mocks.testProxySettings,
    exportDiagnostics: vi.fn(async () => ''),
    checkPluginUpdates: mocks.checkPluginUpdates,
    installPluginUpdates: mocks.installPluginUpdates,
    checkCoreUpdate: mocks.checkCoreUpdate,
    installCoreUpdate: mocks.installCoreUpdate,
  },
}))

function button(container: HTMLElement, label: string) {
  return Array.from(container.querySelectorAll('button')).find(item => item.textContent?.includes(label))
}

async function flush() {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('explicit update consent', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    mocks.testProxySettings.mockReset()
    mocks.checkPluginUpdates.mockReset()
    mocks.installPluginUpdates.mockReset()
    mocks.checkCoreUpdate.mockReset()
    mocks.installCoreUpdate.mockReset()
    mocks.testProxySettings.mockResolvedValue({ ok: true, latencyMs: 1, message: '' })
    mocks.installPluginUpdates.mockResolvedValue([])
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    container.remove()
  })

  it('stops showing proxy testing when the backend call never returns', async () => {
    mocks.testProxySettings.mockReturnValue(new Promise(() => {}))
    const root = createRoot(container)
    await act(async () => { root.render(<App />); await flush() })
    await act(async () => button(container, '设置')?.click())

    vi.useFakeTimers()
    await act(async () => button(container, '测试连接')?.click())
    expect(container.textContent).toContain('测试中…')
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })

    expect(container.textContent).toContain('代理测试超时')
    expect(container.textContent).toContain('测试连接')
    await act(async () => root.unmount())
  })

  it('stops showing plugin update checks when the backend call never returns', async () => {
    mocks.checkPluginUpdates.mockReturnValue(new Promise(() => {}))
    const root = createRoot(container)
    await act(async () => { root.render(<App />); await flush() })
    await act(async () => button(container, '设置')?.click())

    vi.useFakeTimers()
    await act(async () => button(container, '检查全部插件')?.click())
    expect(container.textContent).toContain('检查中…')
    await act(async () => { await vi.advanceTimersByTimeAsync(35_000) })

    expect(container.textContent).toContain('插件更新检查超时')
    expect(container.textContent).toContain('检查全部插件')
    await act(async () => root.unmount())
  })

  it('checks plugin updates without installing until the user confirms', async () => {
    mocks.checkPluginUpdates.mockResolvedValue([{
      id: 'example.plugin', name: '示例插件', currentVersion: '1.0.0', version: '1.1.0',
      minCoreVersion: '0.2.0', compatible: true, permissionsChanged: true,
      addedPermissions: [{ id: 'process:shell', reason: '运行用户选择的命令' }],
    }])
    const root = createRoot(container)
    await act(async () => { root.render(<App />); await flush() })
    await act(async () => button(container, '设置')?.click())
    await act(async () => { button(container, '检查全部插件')?.click(); await flush() })

    expect(mocks.checkPluginUpdates).toHaveBeenCalledOnce()
    expect(mocks.installPluginUpdates).not.toHaveBeenCalled()
    expect(container.textContent).toContain('1.0.0 → 1.1.0')
    expect(container.textContent).toContain('运行已配置的系统 Shell：运行用户选择的命令')

    await act(async () => { button(container, '同意并更新 1 项')?.click(); await flush() })
    expect(mocks.installPluginUpdates).toHaveBeenCalledWith([{ id: 'example.plugin', version: '1.1.0' }])
    await act(async () => root.unmount())
  })

  it('checks a core update without installing until the user confirms', async () => {
    mocks.checkCoreUpdate.mockResolvedValue({ version: '0.2.3', notes: '更新说明' })
    // Keep the promise pending so the test can inspect the installation call before restart.
    mocks.installCoreUpdate.mockReturnValue(new Promise(() => {}))
    const root = createRoot(container)
    await act(async () => { root.render(<App />); await flush() })
    await act(async () => button(container, '设置')?.click())
    await act(async () => { button(container, '检查主程序')?.click(); await flush() })

    expect(mocks.checkCoreUpdate).toHaveBeenCalledOnce()
    expect(mocks.installCoreUpdate).not.toHaveBeenCalled()
    expect(container.textContent).toContain('发现 Digiworld 0.2.3')

    await act(async () => button(container, '同意并更新')?.click())
    expect(mocks.installCoreUpdate).toHaveBeenCalledWith('0.2.3')
    await act(async () => root.unmount())
  })

  it('applies and persists a font preset across the shell', async () => {
    const root = createRoot(container)
    await act(async () => { root.render(<App />); await flush() })
    await act(async () => button(container, '设置')?.click())

    const wenkai = container.querySelector<HTMLButtonElement>('button[aria-label="霞鹜文楷"]')
    await act(async () => { wenkai?.click(); await flush() })

    expect(container.querySelector<HTMLElement>('.app-window')?.style.getPropertyValue('--font-sans')).toContain('LXGW WenKai')
    expect(localStorage.getItem(FONT_THEME_STORAGE_KEY)).toBe('wenkai')

    const weight = container.querySelector<HTMLInputElement>('input[aria-label="字体粗细"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(weight, '600')
      weight.dispatchEvent(new Event('input', { bubbles: true }))
      await flush()
    })
    expect(container.querySelector<HTMLElement>('.app-window')?.style.getPropertyValue('--weight-regular')).toBe('600')
    expect(localStorage.getItem(FONT_WEIGHT_STORAGE_KEY)).toBe('600')

    const stylesheet = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')
    expect(stylesheet).toMatch(/\.main \{[^}]*min-height: 0;/)
    expect(stylesheet).toMatch(/\.content \{[^}]*overflow: auto;/)
    await act(async () => root.unmount())
  })
})
