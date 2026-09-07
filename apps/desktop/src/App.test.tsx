// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { api } from './lib/api'

const mocks = vi.hoisted(() => ({
  appState: vi.fn(),
  catalog: vi.fn(),
  pluginUi: vi.fn(),
  install: vi.fn(),
  uninstall: vi.fn(),
  setEnabled: vi.fn(),
  setLaunchAtStartup: vi.fn(),
  proxySettings: vi.fn(),
  setProxySettings: vi.fn(),
  testProxySettings: vi.fn(),
  checkPluginUpdates: vi.fn(),
  installPluginUpdates: vi.fn(),
  checkCoreUpdate: vi.fn(),
  installCoreUpdate: vi.fn(),
  onUpdateProgress: vi.fn(),
}))

vi.mock('./lib/api', () => ({
  api: mocks,
}))

vi.mock('./components/PluginFrame', () => ({ PluginFrame: () => <div data-testid="plugin-frame" /> }))
vi.mock('./components/WindowChrome', () => ({ WindowChrome: () => <div data-testid="window-chrome" /> }))

const baseState = {
  version: '0.2.50',
  platform: 'windows',
  target: 'windows-x86_64',
  catalogSequence: 1,
  launchAtStartup: false,
  plugins: [{
    id: 'example.plugin',
    name: 'Example Plugin',
    version: '1.0.0',
    description: 'Example description',
    enabled: true,
    state: 'running',
    permissions: [],
    uiDesignVersion: 1,
  }],
}

function flush() {
  return new Promise(resolve => setTimeout(resolve, 0))
}

function button(container: HTMLElement, label: string) {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.includes(label))
}

beforeEach(() => {
  mocks.appState.mockReset()
  mocks.appState.mockResolvedValue(baseState)
  mocks.pluginUi.mockReset()
  mocks.pluginUi.mockResolvedValue('<html></html>')
  mocks.install.mockReset()
  mocks.install.mockResolvedValue(undefined)
  mocks.uninstall.mockReset()
  mocks.uninstall.mockResolvedValue(undefined)
  mocks.setEnabled.mockReset()
  mocks.setEnabled.mockResolvedValue(undefined)
  mocks.setLaunchAtStartup.mockReset()
  mocks.setLaunchAtStartup.mockResolvedValue(undefined)
  mocks.proxySettings.mockReset()
  mocks.proxySettings.mockResolvedValue({ mode: 'system' })
  mocks.setProxySettings.mockReset()
  mocks.setProxySettings.mockImplementation(async value => value)
  mocks.testProxySettings.mockReset()
  mocks.testProxySettings.mockResolvedValue({ latencyMs: 8 })
  mocks.checkPluginUpdates.mockReset()
  mocks.checkPluginUpdates.mockResolvedValue([])
  mocks.installPluginUpdates.mockReset()
  mocks.installPluginUpdates.mockResolvedValue(undefined)
  mocks.checkCoreUpdate.mockReset()
  mocks.checkCoreUpdate.mockResolvedValue(null)
  mocks.installCoreUpdate.mockReset()
  mocks.installCoreUpdate.mockResolvedValue(undefined)
  mocks.onUpdateProgress.mockReset()
  mocks.onUpdateProgress.mockResolvedValue(() => {})
})

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

    expect(container.querySelector('[aria-label="Workspace navigation"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Installed plugins"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="System navigation"]')).not.toBeNull()
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
    localStorage.clear()
  })

  afterEach(() => container.remove())

  it('stops showing proxy testing when the backend call never returns', async () => {
    vi.useFakeTimers()
    mocks.testProxySettings.mockImplementation(() => new Promise(() => {}))
    const root = createRoot(container)
    await act(async () => { root.render(<App />); await flush() })
    await navigate(container, 'Settings')
    await act(async () => { button(container, 'Test Connection')?.click() })
    expect(container.textContent).toContain('Testing...')
    await act(async () => { vi.advanceTimersByTime(20_001); await Promise.resolve() })
    expect(container.textContent).not.toContain('Testing...')
    vi.useRealTimers()
    await act(async () => root.unmount())
  })

  it('stops showing plugin update checks when the backend call never returns', async () => {
    vi.useFakeTimers()
    mocks.checkPluginUpdates.mockImplementation(() => new Promise(() => {}))
    const root = createRoot(container)
    await act(async () => { root.render(<App />); await flush() })
    await navigate(container, 'Settings')
    await act(async () => { button(container, 'Check All Plugins')?.click() })
    expect(container.textContent).toContain('Checking...')
    await act(async () => { vi.advanceTimersByTime(35_001); await Promise.resolve() })
    expect(container.textContent).not.toContain('Checking...')
    vi.useRealTimers()
    await act(async () => root.unmount())
  })

  it('checks plugin updates without installing until the user confirms', async () => {
    mocks.checkPluginUpdates.mockResolvedValue([{
      id: 'example.plugin', name: '示例插件', currentVersion: '1.0.0', version: '1.1.0',
      compatible: true, minCoreVersion: '0.2.0', permissionsChanged: false,
      addedPermissions: [], removedPermissions: [], changedPermissions: [],
    }])
    const root = createRoot(container)
    await act(async () => { root.render(<App />); await flush() })
    await navigate(container, 'Settings')
    await act(async () => { button(container, 'Check All Plugins')?.click(); await flush() })
    expect(mocks.checkPluginUpdates).toHaveBeenCalledOnce()
    expect(mocks.installPluginUpdates).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Found 1 Plugin Updates')
    await act(async () => { button(container, 'Agree & Update 1 items')?.click(); await flush() })
    expect(mocks.installPluginUpdates).toHaveBeenCalledOnce()
    await act(async () => root.unmount())
  })

  it('does not show the removed diagnostics export', async () => {
    const root = createRoot(container)
    await act(async () => { root.render(<App />); await flush() })
    await navigate(container, 'Settings')
    expect(container.textContent).not.toContain('Diagnostics')
    expect(container.textContent).not.toContain('Export Diagnostics')
    await act(async () => root.unmount())
  })

  it('does not render redundant explanatory text in settings', async () => {
    const root = createRoot(container)
    await act(async () => { root.render(<App />); await flush() })
    await navigate(container, 'Settings')
    expect(container.textContent).not.toContain('Clean, restrained surfaces')
    expect(container.textContent).not.toContain('Use shared host typography')
    await act(async () => root.unmount())
  })

  it('checks a core update without installing until the user confirms', async () => {
    mocks.checkCoreUpdate.mockResolvedValue({ version: '0.3.0', notes: 'release notes' })
    const root = createRoot(container)
    await act(async () => { root.render(<App />); await flush() })
    await navigate(container, 'Settings')
    await act(async () => { button(container, 'Check Digiworld Core')?.click(); await flush() })
    expect(mocks.checkCoreUpdate).toHaveBeenCalledOnce()
    expect(mocks.installCoreUpdate).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Digiworld 0.3.0 Available')
    await act(async () => { button(container, 'Agree & Update')?.click(); await flush() })
    expect(mocks.installCoreUpdate).toHaveBeenCalledWith('0.3.0')
    await act(async () => root.unmount())
  })

  it('applies and persists a font preset across the shell', async () => {
    const root = createRoot(container)
    await act(async () => { root.render(<App />); await flush() })
    await navigate(container, 'Settings')
    const fontButton = button(container, 'IBM Plex Sans SC')
    await act(async () => { fontButton?.click(); await flush() })
    expect(localStorage.getItem('digiworld.font-theme.v1')).toBe('plex')
    await act(async () => root.unmount())
  })

  it('applies and persists theme color selection across 5 colors', async () => {
    const root = createRoot(container)
    await act(async () => { root.render(<App />); await flush() })
    await navigate(container, 'Settings')
    const options = container.querySelectorAll('.scheme-options button')
    expect(options.length).toBeGreaterThanOrEqual(5)
    await act(async () => { (options[1] as HTMLButtonElement)?.click(); await flush() })
    expect(localStorage.getItem('digiworld.color-scheme.v1')).toBeTruthy()
    await act(async () => root.unmount())
  })

  it('applies and persists the glass preference across the shell', async () => {
    const root = createRoot(container)
    await act(async () => { root.render(<App />); await flush() })
    await navigate(container, 'Settings')
    const glassSwitch = container.querySelector<HTMLButtonElement>('[aria-label="Panel Frost Effect"]')
    await act(async () => { glassSwitch?.click(); await flush() })
    expect(localStorage.getItem('digiworld.glass.v1')).toBeTruthy()
    await act(async () => root.unmount())
  })

  it('applies and persists language preference across the shell', async () => {
    const root = createRoot(container)
    await act(async () => { root.render(<App />); await flush() })
    const languageToggle = container.querySelector<HTMLButtonElement>('[aria-label="Toggle language"]')
    await act(async () => { languageToggle?.click(); await flush() })
    expect(localStorage.getItem('digiworld.locale.v1')).toBe('zh')
    expect(document.documentElement.lang).toBe('zh')
    await act(async () => root.unmount())
  })

  it('applies and persists theme selection via dropdown menu', async () => {
    const root = createRoot(container)
    await act(async () => { root.render(<App />); await flush() })
    await navigate(container, 'Settings')
    const trigger = container.querySelector<HTMLButtonElement>('.theme-dropdown-trigger')
    await act(async () => { trigger?.click(); await flush() })
    const option = container.querySelector<HTMLButtonElement>('[data-theme-id="dark"]')
    await act(async () => { option?.click(); await flush() })
    expect(localStorage.getItem('digiworld.accent-theme.v1')).toBe('dark')
    await act(async () => root.unmount())
  })

  it('disables installation and notifies user when catalog plugin is not supported on the current platform', async () => {
    mocks.catalog.mockResolvedValue({ schemaVersion: 1, sequence: 1, generatedAt: '', plugins: [{
      id: 'unsupported.plugin', name: 'Unsupported', version: '1.0.0', description: '', permissions: [], artifacts: [{ target: 'linux-x86_64', url: '', sha256: '' }],
    }] })
    const root = createRoot(container)
    await act(async () => { root.render(<App />); await flush() })
    await navigate(container, 'Plugins Store')
    expect(container.textContent).toContain('Not supported on current system')
    expect(button(container, 'Not supported on current system')?.disabled).toBe(true)
    await act(async () => root.unmount())
  })

  it('does not treat a catalog entry without artifacts as installable', async () => {
    mocks.catalog.mockResolvedValue({ schemaVersion: 1, sequence: 1, generatedAt: '', plugins: [{
      id: 'empty.plugin', name: 'Empty', version: '1.0.0', description: '', permissions: [], artifacts: [],
    }] })
    const root = createRoot(container)
    await act(async () => { root.render(<App />); await flush() })
    await navigate(container, 'Plugins Store')
    expect(button(container, 'Not supported on current system')?.disabled).toBe(true)
    await act(async () => root.unmount())
  })
})
