export const MANIFEST_SCHEMA_VERSION = 1 as const
export const PROTOCOL_VERSION = 1 as const

export type PluginPermission =
  | 'background'
  | 'global-input'
  | 'notifications'
  | 'plugin-storage'
  | 'filesystem:agent-session-data'
  | 'process:ssh'
  | `network:${string}`
  | `secret:${string}`

export interface PlatformArtifact {
  backend: string
  sha256: string
}

export interface PluginManifest {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION
  protocolVersion: typeof PROTOCOL_VERSION
  id: string
  version: string
  name: string
  description: string
  author: string
  license: string
  minCoreVersion: string
  icon?: string
  ui: string
  background: 'always' | 'on-enable' | 'none'
  permissions: Array<{
    id: PluginPermission
    reason: string
  }>
  platforms: Record<string, PlatformArtifact>
}

export interface CatalogArtifact {
  target: string
  url: string
  sha256: string
  signature: string
  size: number
}

export interface CatalogPlugin {
  id: string
  version: string
  name: string
  description: string
  author: string
  icon?: string
  minCoreVersion: string
  permissions: PluginManifest['permissions']
  artifacts: CatalogArtifact[]
}

export interface CatalogIndex {
  schemaVersion: 1
  sequence: number
  generatedAt: string
  plugins: CatalogPlugin[]
}

export interface PluginTheme {
  'color-scheme': 'light' | 'dark'
  'bg': string
  'surface': string
  'surface-raised': string
  'surface-subtle': string
  'border': string
  'text': string
  'text-muted': string
  'accent': string
  'accent-strong': string
  'accent-contrast': string
  'accent-secondary': string
  'danger': string
  'font-sans': string
}

export type RpcId = string | number

export interface RpcRequest<T = unknown> {
  jsonrpc: '2.0'
  id: RpcId
  method: string
  params?: T
}

export interface RpcSuccess<T = unknown> {
  jsonrpc: '2.0'
  id: RpcId
  result: T
}

export interface RpcFailure {
  jsonrpc: '2.0'
  id: RpcId | null
  error: {
    code: number
    message: string
    data?: unknown
  }
}

export interface PluginSummary {
  id: string
  version: string
  name: string
  description: string
  enabled: boolean
  state: 'installed' | 'starting' | 'running' | 'paused' | 'failed' | 'disabled'
  permissions: PluginManifest['permissions']
  error?: string
}

export interface HostToPluginMessage {
  source: 'digiworld-host'
  pluginId: string
  kind: 'response' | 'event' | 'theme'
  requestId?: string
  method?: string
  payload?: unknown
}

export interface PluginToHostMessage {
  source: 'digiworld-plugin'
  pluginId: string
  kind: 'ready' | 'request'
  requestId?: string
  method?: string
  payload?: unknown
}
