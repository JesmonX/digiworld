import { invoke } from '@tauri-apps/api/core'
import type { CatalogIndex, PluginSummary } from '@digiworld/plugin-sdk'

export interface AppState {
  version: string
  platform: string
  target: string
  plugins: PluginSummary[]
  catalogSequence: number
  launchAtStartup: boolean
  updateAvailable?: { version: string; notes?: string }
}

export interface InstallResult {
  plugin: PluginSummary
  permissionsChanged: boolean
}

export type ProxyMode = 'system' | 'custom' | 'direct'

export interface ProxySettings {
  mode: ProxyMode
  url?: string
}

export interface ProxyTestResult {
  ok: boolean
  latencyMs: number
  message: string
}

export const api = {
  appState: () => invoke<AppState>('get_app_state'),
  catalog: (refresh = false) => invoke<CatalogIndex>('get_catalog', { refresh }),
  install: (pluginId: string) => invoke<InstallResult>('install_plugin', { pluginId }),
  setEnabled: (pluginId: string, enabled: boolean) =>
    invoke<PluginSummary>('set_plugin_enabled', { pluginId, enabled }),
  uninstall: (pluginId: string, deleteData: boolean) =>
    invoke<void>('uninstall_plugin', { pluginId, deleteData }),
  pluginUi: (pluginId: string) => invoke<string>('get_plugin_ui', { pluginId }),
  pluginRequest: <T>(pluginId: string, method: string, payload?: unknown) =>
    invoke<T>('plugin_request', { pluginId, method, payload }),
  setLaunchAtStartup: (enabled: boolean) => invoke<void>('set_launch_at_startup', { enabled }),
  proxySettings: () => invoke<ProxySettings>('get_proxy_settings'),
  setProxySettings: (settings: ProxySettings) =>
    invoke<ProxySettings>('set_proxy_settings', { settings }),
  testProxySettings: (settings: ProxySettings) =>
    invoke<ProxyTestResult>('test_proxy_settings', { settings }),
  checkCoreUpdate: () => invoke<{ version: string; notes?: string } | null>('check_core_update'),
  installCoreUpdate: () => invoke<void>('install_core_update'),
  exportDiagnostics: () => invoke<string>('export_diagnostics'),
}
