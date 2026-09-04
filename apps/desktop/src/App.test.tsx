// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { FONT_THEME_STORAGE_KEY, FONT_WEIGHT_STORAGE_KEY, GLASS_STORAGE_KEY } from './theme'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  catalog: vi.fn(),
  testProxySettings: vi.fn(),
  checkPluginUpdates: vi.fn(),
  installPluginUpdates: vi.fn(),
  checkCoreUpdate: vi.fn(),
  installCoreUpdate: vi.fn(),
}))

vi.mock('./components/WindowChrome', () => ({ WindowChrome: () => <div /> }))
vi.mock('framer-motion', async importOriginal => {
  const actual = await importOriginal<typeof import('framer-motion')>()
  return { ...actual, useReducedMotion: () => true }
})
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
    catalog: mocks.catalog,
    proxySettings: vi.fn(async () => ({ mode: 'system' })),
    onUpdateProgress: vi.fn(async () => () => {}),
    setLaunchAtStartup: vi.fn(async () => {}),
    setProxySettings: vi.fn(async settings => settings),
    testProxySettings: mocks.testProxySettings,
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

async function navigate(container: HTMLElement, label: string) {
  await act(async () => {
    button(container, label)?.click()
    await flush()
  })
}

describe('workspace redesign', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    mocks.catalog.mockReset()
    mocks.catalog.mockResolvedValue({ schemaVersion: 1, sequence: 1, generatedAt: '', plugins: [] })
    localStorage.clear()
  })

  afterEach(() => {
    container.remove()
  })

  it('renders grouped navigation and the status-focused home workspace', async () => {
    const root = createRoot(container)
    await act(async () => { root.render(<App />); await flush() })

    expect(Array.from(container.querySelectorAll('.sidebar-section-label')).map(item => item.textContent)).toEqual(['工作台', '已安装', '系统'])
    expect(container.textContent).toContain('数字工作台')
    expect(container.textContent).toContain('已安装功能')
    expect(container.textContent).toContain('快捷操作')
    expect(container.textContent).toContain('运行稳定')
    expect(container.querySelectorAll('.summary-card')).toHaveLength(4)
    expect(container.querySelectorAll('.plugin-row')).toHaveLength(1)

    await act(async () => root.unmount())
  })
})

describe('explicit update consent', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    mocks.catalog.mockReset()
    mocks.catalog.mockResolvedValue({ schemaVersion: 1, sequence: 1, generatedAt: '', plugins: [] })
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
    await navigate(container, '设置')

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
    await navigate(container, '设置')

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
      removedPermissions: [{ id: 'network:openai', reason: '读取限额' }],
      changedPermissions: [{ id: 'plugin-storage', oldReason: '保存旧数据', newReason: '保存聚合数据' }],
    }])
    const root = createRoot(container)
    await act(async () => { root.render(<App />); await flush() })
    await navigate(container, '设置')
    await act(async () => { button(container, '检查全部插件')?.click(); await flush() })

    expect(mocks.checkPluginUpdates).toHaveBeenCalledOnce()
    expect(mocks.installPluginUpdates).not.toHaveBeenCalled()
    expect(container.textContent).toContain('1.0.0 → 1.1.0')
    expect(container.textContent).toContain('运行已配置的系统 Shell：运行用户选择的命令')
    expect(container.textContent).toContain('移除 访问 OpenAI Codex 服务：读取限额')
    expect(container.textContent).toContain('变更 本地插件存储：保存旧数据 → 保存聚合数据')

    await act(async () => { button(container, '同意并更新 1 项')?.click(); await flush() })
    expect(mocks.installPluginUpdates).toHaveBeenCalledWith([{ id: 'example.plugin', version: '1.1.0' }])
    await act(async () => root.unmount())
  })

  it('does not show the removed diagnostics export', async () => {
    const root = createRoot(container)
    await act(async () => { root.render(<App />); await flush() })
    await navigate(container, '设置')

    expect(container.textContent).not.toContain('诊断信息')
    expect(container.textContent).not.toContain('导出版本、平台、代理模式和插件状态')
    await act(async () => root.unmount())
  })

  it('checks a core update without installing until the user confirms', async () => {
    mocks.checkCoreUpdate.mockResolvedValue({ version: '0.2.3', notes: '更新说明' })
    // Keep the promise pending so the test can inspect the installation call before restart.
    mocks.installCoreUpdate.mockReturnValue(new Promise(() => {}))
    const root = createRoot(container)
    await act(async () => { root.render(<App />); await flush() })
    await navigate(container, '设置')
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
    await navigate(container, '设置')

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
    expect(stylesheet).toMatch(/\.page-transition \{[^}]*height: 100%;/)
    await act(async () => root.unmount())
  })

  it('applies and persists the glass preference across the shell', async () => {
    const root = createRoot(container)
    await act(async () => { root.render(<App />); await flush() })
    await navigate(container, '设置')
    const toggle = container.querySelector<HTMLButtonElement>('[aria-label="切换玻璃效果"]')!
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    await act(async () => toggle.click())
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(localStorage.getItem(GLASS_STORAGE_KEY)).toBe('disabled')
    expect(container.querySelector('.app-window')?.className).toContain('glass-disabled')
    await act(async () => root.unmount())
  })

  it('disables installation and notifies user when catalog plugin is not supported on the current platform', async () => {
    mocks.catalog.mockResolvedValue({
      schemaVersion: 1,
      sequence: 1,
      generatedAt: '',
      plugins: [{
        id: 'unsupported.plugin',
        version: '1.0.0',
        name: '未适配插件',
        description: '仅支持 macOS',
        author: 'JesmonX',
        minCoreVersion: '0.1.0',
        permissions: [],
        artifacts: [{
          target: 'darwin-x86_64',
          url: '',
          sha256: '',
          signature: '',
          size: 100,
        }],
      }],
    })
    const root = createRoot(container)
    await act(async () => { root.render(<App />); await flush() })
    await navigate(container, '功能库')
    await flush()

    expect(container.textContent).toContain('未适配插件')
    const disabledBtn = container.querySelector<HTMLButtonElement>('button[disabled]')
    expect(disabledBtn?.textContent).toContain('暂未适配当前系统')
    await act(async () => root.unmount())
  })

  it('does not treat a catalog entry without artifacts as installable', async () => {
    mocks.catalog.mockResolvedValue({
      schemaVersion: 1,
      sequence: 1,
      generatedAt: '',
      plugins: [{
        id: 'empty.plugin', version: '1.0.0', name: '缺少产物', description: '', author: '',
        minCoreVersion: '0.1.0', permissions: [], artifacts: [],
      }],
    })
    const root = createRoot(container)
    await act(async () => { root.render(<App />); await flush() })
    await navigate(container, '功能库')
    await flush()

    expect(button(container, '暂未适配当前系统')?.disabled).toBe(true)
    await act(async () => root.unmount())
  })
})
