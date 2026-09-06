import type { HostToPluginMessage, PluginTheme, PluginToHostMessage } from './types.js'

export interface PluginBridgeOptions {
  contextMenu?: 'disabled' | 'native'
}

export interface OperationError { code: string; message: string; retryable: boolean }
export interface JobStatus<T = unknown> { id: string; state: 'running' | 'completed' | 'failed'; stage?: string; completed?: number; total?: number; startedAt?: number; finishedAt?: number; result?: T; error?: string }

export interface RequestOptions {
  timeoutMs?: number
}

export interface DigiworldPluginBridge {
  request<T>(method: string, payload?: unknown, options?: RequestOptions): Promise<T>
  on<T>(method: string, listener: (payload: T) => void): () => void
  ready(): void
  isActive(): boolean
  dispose(): void
  job<T>(method: string, payload?: unknown): Promise<T>
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
  let active = true
  let disposed = false
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: number }>()
  const listeners = new Map<string, Set<(payload: unknown) => void>>()

  const restoreMenu = options.contextMenu !== 'native' ? suppressContextMenu() : () => {}

  const receive = (event: MessageEvent<HostToPluginMessage>) => {
    if (event.source !== window.parent) return
    const message = event.data
    if (message?.source !== 'digiworld-host' || message.pluginId !== pluginId) return

    if (message.kind === 'response' && message.requestId) {
      const request = pending.get(message.requestId)
      if (!request) return
      pending.delete(message.requestId)
      window.clearTimeout(request.timer)
      const payload = message.payload as { ok: boolean; value?: unknown; error?: string }
      if (payload.ok) request.resolve(payload.value)
      else request.reject(new Error(typeof payload.error === 'string' ? payload.error : 'Plugin request failed'))
      return
    }

    if (message.kind === 'event' && message.method) {
      if (message.method === 'host.visibility') active = Boolean((message.payload as { active: boolean })?.active)
      for (const listener of listeners.get(message.method) ?? []) listener(message.payload)
    }

    if (message.kind === 'theme' && typeof message.payload === 'object' && message.payload) {
      applyPluginTheme(message.payload as Partial<PluginTheme>)
    }
  }
  window.addEventListener('message', receive)

  function send(message: PluginToHostMessage): void {
    window.parent.postMessage(message, '*')
  }

  const bridge: DigiworldPluginBridge = {
    request<T>(method: string, payload?: unknown, options?: RequestOptions): Promise<T> {
      if (disposed) return Promise.reject(new Error('Plugin bridge disposed'))
      const requestId = `${Date.now()}-${++sequence}`
      const timeoutMs = options?.timeoutMs ?? 15_000
      return new Promise<T>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          const request = pending.get(requestId)
          if (!request) return
          pending.delete(requestId)
          request.reject(new Error(`Plugin request timed out: ${method}`))
        }, timeoutMs)
        pending.set(requestId, { resolve: value => resolve(value as T), reject, timer })
        send({ source: 'digiworld-plugin', pluginId, kind: 'request', requestId, method, payload })
      })
    },
    on<T>(method: string, listener: (payload: T) => void): () => void {
      const typed = listener as (payload: unknown) => void
      const set = listeners.get(method) ?? new Set()
      set.add(typed)
      listeners.set(method, set)
      return () => set.delete(typed)
    },
    isActive: () => active && document.visibilityState !== 'hidden',
    dispose() {
      disposed = true
      window.removeEventListener('message', receive)
      restoreMenu()
      for (const request of pending.values()) { window.clearTimeout(request.timer); request.reject(new Error('Plugin bridge disposed')) }
      pending.clear(); listeners.clear()
    },
    async job<T>(method: string, payload?: unknown): Promise<T> {
      let job = await bridge.request<{ id: string; state: string; result?: T; error?: string }>('job.start', { method, payload })
      while (job.state === 'running') {
        await new Promise(resolve => window.setTimeout(resolve, 500))
        job = await bridge.request('job.status', { id: job.id })
      }
      if (job.state === 'failed') throw new Error(job.error ?? '操作失败')
      return job.result as T
    },
    ready(): void { send({ source: 'digiworld-plugin', pluginId, kind: 'ready' }) },
  }
  return bridge
}

export function exportJson(filename: string, value: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename
  anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
