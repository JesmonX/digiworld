import type { HostToPluginMessage, PluginTheme, PluginToHostMessage } from './types.js'

export interface PluginBridgeOptions {
  contextMenu?: 'disabled' | 'native'
}

export interface DigiworldPluginBridge {
  request<T>(method: string, payload?: unknown): Promise<T>
  on<T>(method: string, listener: (payload: T) => void): () => void
  ready(): void
}

export function applyPluginTheme(theme: Partial<PluginTheme>, root: HTMLElement = document.documentElement): void {
  for (const [key, value] of Object.entries(theme)) {
    if (value === undefined) continue
    root.style.setProperty(`--dw-${key}`, String(value))
  }
  if (theme['color-scheme']) {
    root.style.colorScheme = theme['color-scheme']
    root.dataset.dwScheme = theme['color-scheme']
  }
  if (theme.glass) root.dataset.dwGlass = theme.glass
}

export function suppressContextMenu(target: EventTarget = window): () => void {
  const preventMenu = (event: Event) => event.preventDefault()
  target.addEventListener('contextmenu', preventMenu)
  return () => target.removeEventListener('contextmenu', preventMenu)
}

export function createPluginBridge(pluginId: string, options: PluginBridgeOptions = {}): DigiworldPluginBridge {
  let sequence = 0
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>()
  const listeners = new Map<string, Set<(payload: unknown) => void>>()

  if (options.contextMenu !== 'native') suppressContextMenu()

  window.addEventListener('message', (event: MessageEvent<HostToPluginMessage>) => {
    const message = event.data
    if (message?.source !== 'digiworld-host' || message.pluginId !== pluginId) return

    if (message.kind === 'response' && message.requestId) {
      const request = pending.get(message.requestId)
      if (!request) return
      pending.delete(message.requestId)
      const payload = message.payload as { ok: boolean; value?: unknown; error?: string }
      if (payload.ok) request.resolve(payload.value)
      else request.reject(new Error(payload.error ?? 'Plugin request failed'))
      return
    }

    if (message.kind === 'event' && message.method) {
      for (const listener of listeners.get(message.method) ?? []) listener(message.payload)
    }

    if (message.kind === 'theme' && typeof message.payload === 'object' && message.payload) {
      applyPluginTheme(message.payload as Partial<PluginTheme>)
    }
  })

  function send(message: PluginToHostMessage): void {
    window.parent.postMessage(message, '*')
  }

  return {
    request<T>(method: string, payload?: unknown): Promise<T> {
      const requestId = `${Date.now()}-${++sequence}`
      return new Promise<T>((resolve, reject) => {
        pending.set(requestId, { resolve: value => resolve(value as T), reject })
        send({ source: 'digiworld-plugin', pluginId, kind: 'request', requestId, method, payload })
        window.setTimeout(() => {
          const request = pending.get(requestId)
          if (!request) return
          pending.delete(requestId)
          request.reject(new Error(`Plugin request timed out: ${method}`))
        }, 15_000)
      })
    },
    on<T>(method: string, listener: (payload: T) => void): () => void {
      const typed = listener as (payload: unknown) => void
      const set = listeners.get(method) ?? new Set()
      set.add(typed)
      listeners.set(method, set)
      return () => set.delete(typed)
    },
    ready(): void {
      send({ source: 'digiworld-plugin', pluginId, kind: 'ready' })
    },
  }
}
