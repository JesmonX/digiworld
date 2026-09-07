// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { COLOR_SCHEME_STORAGE_KEY, FONT_THEME_STORAGE_KEY, FONT_WEIGHT_STORAGE_KEY, GLASS_STORAGE_KEY, THEME_STORAGE_KEY } from './theme'
import { LOCALE_STORAGE_KEY } from './lib/i18n'

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

const LABEL_MAP: Record<string, string[]> = {
  '设置': ['设置', 'Settings'],
  'Settings': ['Settings', '设置'],
  '功能库': ['功能库', 'Plugins Store', 'Store', 'Catalog'],
  '概览': ['概览', 'Overview'],
  '测试连接': ['测试连接', 'Test Connection'],
  '测试中…': ['测试中…', 'Testing...'],
  '保存': ['保存', 'Save'],
  '检查全部插件': ['检查全部插件', 'Check All Plugins'],
  '检查主程序': ['检查主程序', 'Check Digiworld Core', 'Check Core'],
  '同意并更新 1 项': ['同意并更新 1 项', 'Agree & Update 1 item', 'Agree & Update 1 items', 'Agree & Update'],
  '同意并更新': ['同意并更新', 'Agree & Update'],
  '暂未适配当前系统': ['暂未适配当前系统', 'Not supported on current system'],
}

function button(container: HTMLElement, label: string) {
  const candidates = LABEL_MAP[label] ?? [label]
  return Array.from(container.querySelectorAll('button')).find(item => (
    candidates.some(cand =>
      item.textContent?.includes(cand) ||
      item.getAttribute('aria-label') === cand ||
      item.getAttribute('title') === cand
    )
  ))
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

    expect(container.querySelector('[aria-label="工作台"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="已安装插件"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="系统"]')).not.toBeNull()
    expect(container.querySelector('.rail-divider')).not.toBeNull()
    expect(container.textContent).toContain('Digital Workspace')
    expect(container.textContent).toContain('Installed Tools')
    expect(container.textContent).not.toContain('快捷操作')
    expect(container.textContent).toContain('All systems normal')
    expect(container.querySelectorAll('.workspace-metric')).toHaveLength(3)
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
    await navigate(container, 'Settings')

    vi.useFakeTimers()
    await act(async () => button(container, 'Test Connection')?.click())
    expect(container.textContent).toContain('Testing...')
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })

    expect(container.textContent).toContain('Proxy test timed out')
    expect(container.textContent).toContain('Test Connection')
    await act(async () => root.unmount())
  })

  it('stops showing plugin update checks when the backend call never returns', async () => {
    mocks.checkPluginUpdates.mockReturnValue(new Promise(() => {}))
    const root = createRoot(container)
    await act(async () => { root.render(<App />); await flush() })
    await navigate(container, 'Settings')

    vi.useFakeTimers()
    await act(async () => button(container, 'Check All Plugins')?.click())
    expect(container.textContent).toContain('Checking...')
    await act(async () => { await vi.advanceTimersByTimeAsync(35_000) })

    expect(container.textContent).toContain('Plugin update check timed out')
    expect(container.textContent).toContain('Check All Plugins')
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
    await navigate(container, 'Settings')
    await act(async () => { button(container, 'Check All Plugins')?.click(); await flush() })

    expect(mocks.checkPluginUpdates).toHaveBeenCalledOnce()
    expect(mocks.installPluginUpdates).not.toHaveBeenCalled()
    expect(container.textContent).toContain('1.0.0 → 1.1.0')
    expect(container.textContent).toContain('Execute configured system shell: 运行用户选择的命令')
    expect(container.textContent).toContain('Access OpenAI Codex service: 读取限额')
    expect(container.textContent).toContain('Local plugin storage: 保存旧数据 → 保存聚合数据')

    await act(async () => { button(container, 'Agree & Update')?.click(); await flush() })
    expect(mocks.installPluginUpdates).toHaveBeenCalledWith([{ id: 'example.plugin', version: '1.1.0' }])
    await act(async () => root.unmount())
  })

  it('does not show the removed diagnostics export', async () => {
    const root = createRoot(container)
    await act(async () => { root.render(<App />); await flush() })
    await navigate(container, 'Settings')

    expect(container.textContent).not.toContain('诊断信息')
    expect(container.textContent).not.toContain('导出版本、平台、代理模式和插件状态')
    await act(async () => root.unmount())
  })

  it('does not render redundant explanatory text in settings', async () => {
    const root = createRoot(container)
    await act(async () => { root.render(<App />); await flush() })
    await navigate(container, 'Settings')

    expect(container.textContent).not.toContain('在当前主题风格下自定义主色调与图表色彩')
    expect(container.textContent).not.toContain('高雅紫调，源自主题原生主色')
    expect(container.textContent).not.toContain('框架与插件使用同一套完整配色')
    expect(container.textContent).not.toContain('字体会同步应用到主界面')
    expect(container.textContent).not.toContain('清晰现代，正文与标题保持统一')
    expect(container.textContent).not.toContain('同步调整主界面与插件正文')
    expect(container.textContent).not.toContain('应用到 Digiworld 界面和已安装插件')
    expect(container.textContent).not.toContain('在后台启动已启用的插件')
    expect(container.textContent).not.toContain('用于功能库、程序更新和声明网络权限的插件')
    expect(container.textContent).not.toContain('一次检查并更新所有已安装插件')
    expect(container.textContent).not.toContain('检查后由你确认是否下载和安装')
    await act(async () => root.unmount())
  })

  it('checks a core update without installing until the user confirms', async () => {
    mocks.checkCoreUpdate.mockResolvedValue({ version: '0.2.3', notes: 'Release Notes' })
    mocks.installCoreUpdate.mockReturnValue(new Promise(() => {}))
    const root = createRoot(container)
    await act(async () => { root.render(<App />); await flush() })
    await navigate(container, 'Settings')
    await act(async () => { button(container, 'Check Digiworld Core')?.click(); await flush() })

    expect(mocks.checkCoreUpdate).toHaveBeenCalledOnce()
    expect(mocks.installCoreUpdate).not.toHaveBeenCalled()
    expect(container.textContent).toContain('0.2.3')

    await act(async () => button(container, 'Agree & Update')?.click())
    expect(mocks.installCoreUpdate).toHaveBeenCalledWith('0.2.3')
    await act(async () => root.unmount())
  })

  it('applies and persists a font preset across the shell', async () => {
    const root = createRoot(container)
    await act(async () => { root.render(<App />); await flush() })
    await navigate(container, 'Settings')

    const harmony = container.querySelector<HTMLButtonElement>('button[aria-label="HarmonyOS Sans SC"]')
    await act(async () => { harmony?.click(); await flush() })

    expect(container.querySelector<HTMLElement>('.app-window')?.style.getPropertyValue('--dw-font-sans')).toContain('HarmonyOS Sans SC')
    expect(localStorage.getItem(FONT_THEME_STORAGE_KEY)).toBe('harmony')

    const stylesheet = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')
    expect(stylesheet).toMatch(/\.main \{[^}]*min-height: 0;/)
    expect(stylesheet).toMatch(/\.content \{[^}]*overflow: auto;/)
    expect(stylesheet).toMatch(/\.page-transition \{[^}]*height: 100%;/)
    await act(async () => root.unmount())
  })

  it('applies and persists theme color selection across 5 colors', async () => {
    const root = createRoot(container)
    await act(async () => { root.render(<App />); await flush() })
    await navigate(container, 'Settings')

    const ocean = container.querySelector<HTMLButtonElement>('button[aria-label="Ocean"]')
    expect(ocean).not.toBeNull()
    await act(async () => { ocean?.click(); await flush() })

    expect(localStorage.getItem(COLOR_SCHEME_STORAGE_KEY)).toBe('ocean')
    expect(container.querySelector<HTMLElement>('.app-window')?.style.getPropertyValue('--dw-accent-secondary')).toBe('#2563eb')

    await act(async () => root.unmount())
  })

  it('applies and persists the glass preference across the shell', async () => {
    const root = createRoot(container)
    await act(async () => { root.render(<App />); await flush() })
    await navigate(container, 'Settings')
    const toggle = container.querySelector<HTMLButtonElement>('.appearance-card button[role="switch"], [aria-label="Panel Frost Effect"], [aria-label="面板毛玻璃"], [aria-label="切换玻璃效果"]')!
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    await act(async () => { toggle.click(); await flush() })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(localStorage.getItem(GLASS_STORAGE_KEY)).toBe('enabled')
    expect(container.querySelector('.app-window')?.className).toContain('glass-enabled')
    await act(async () => root.unmount())
  })

  it('applies and persists language preference across the shell', async () => {
    const root = createRoot(container)
    await act(async () => { root.render(<App />); await flush() })
    await navigate(container, 'Settings')

    const zhButton = container.querySelector<HTMLButtonElement>('button[aria-label="Chinese (简体中文)"]')
    expect(zhButton).not.toBeNull()
    await act(async () => { zhButton?.click(); await flush() })

    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('zh')
    expect(document.documentElement.lang).toBe('zh')
    await act(async () => root.unmount())
  })

  it('applies and persists theme selection via dropdown menu', async () => {
    const root = createRoot(container)
    await act(async () => { root.render(<App />); await flush() })
    await navigate(container, 'Settings')

    const trigger = container.querySelector<HTMLButtonElement>('.theme-dropdown-trigger')
    expect(trigger).not.toBeNull()
    expect(trigger?.getAttribute('aria-expanded')).toBe('false')

    // Open dropdown
    await act(async () => { trigger?.click(); await flush() })
    expect(trigger?.getAttribute('aria-expanded')).toBe('true')
    const listbox = container.querySelector('#theme-dropdown-listbox')
    expect(listbox).not.toBeNull()

    // Select dark
    const darkOption = container.querySelector<HTMLButtonElement>('[data-theme-id="dark"]')
    expect(darkOption).not.toBeNull()
    await act(async () => { darkOption?.click(); await flush() })

    // Menu should close and theme should be persisted and applied
    expect(container.querySelector('#theme-dropdown-listbox')).toBeNull()
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(container.querySelector<HTMLElement>('.app-window')?.style.getPropertyValue('--dw-color-scheme')).toBe('dark')
    expect(container.querySelector<HTMLElement>('.app-window')?.style.getPropertyValue('--dw-bg')).toBe('#0c0e12')

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
    await navigate(container, 'Plugins Store')
    await flush()

    expect(container.textContent).toContain('未适配插件')
    const disabledBtn = container.querySelector<HTMLButtonElement>('button[disabled]')
    expect(disabledBtn?.textContent).toContain('Not supported on current system')
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
    await navigate(container, 'Plugins Store')
    await flush()

    expect(button(container, 'Not supported on current system')?.disabled).toBe(true)
    await act(async () => root.unmount())
  })
})
