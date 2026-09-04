import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
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

export interface CoreUpdateInfo {
  version: string
  notes?: string
}

export interface PluginUpdateInfo {
  id: string
  name: string
  currentVersion: string
  version: string
  minCoreVersion: string
  compatible: boolean
  permissionsChanged: boolean
  addedPermissions: Array<{ id: string; reason: string }>
  removedPermissions: Array<{ id: string; reason: string }>
  changedPermissions: Array<{ id: string; oldReason: string; newReason: string }>
}

export interface UpdateProgress {
  operation: 'plugin-install' | 'plugin-update' | 'core-update'
  itemId?: string
  itemName: string
  stage: 'downloading' | 'installing' | 'completed' | 'failed'
  downloaded: number
  total?: number
  completedItems: number
  totalItems: number
}

export const api = {
  appState: () => invoke<AppState>('get_app_state'),
  catalog: (refresh = false) => invoke<CatalogIndex>('get_catalog', { refresh }),
  install: (pluginId: string, version: string) =>
    invoke<InstallResult>('install_plugin', { pluginId, version }),
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
  checkPluginUpdates: () => invoke<PluginUpdateInfo[]>('check_plugin_updates'),
  installPluginUpdates: (updates: Array<{ id: string; version: string }>) =>
    invoke<InstallResult[]>('install_plugin_updates', { updates }),
  checkCoreUpdate: () => invoke<CoreUpdateInfo | null>('check_core_update'),
  installCoreUpdate: (version: string) => invoke<void>('install_core_update', { version }),
  onUpdateProgress: (handler: (progress: UpdateProgress) => void): Promise<UnlistenFn> =>
    listen<UpdateProgress>('update-progress', event => handler(event.payload)),
}
