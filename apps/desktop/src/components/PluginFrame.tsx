import { useEffect, useMemo, useRef } from 'react'
import type { HostToPluginMessage, PluginTheme, PluginToHostMessage } from '@digiworld/plugin-sdk'
import { api } from '../lib/api'

interface PluginFrameProps {
  pluginId: string
  html: string
}

const THEME: PluginTheme = {
  'color-scheme': 'light',
  'bg': '#f5f7fb',
  'surface': '#ffffff',
  'surface-raised': '#ffffff',
  'surface-subtle': '#f0f3f8',
  'border': '#dde3ec',
  'text': '#172033',
  'text-muted': '#667085',
  'accent': '#5b5ce2',
  'accent-strong': '#4338ca',
  'accent-contrast': '#ffffff',
  'accent-secondary': '#8b5cf6',
  'danger': '#d92d20',
  'font-sans': '"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", sans-serif',
}

export function PluginFrame({ pluginId, html }: PluginFrameProps) {
  const frame = useRef<HTMLIFrameElement>(null)
  const source = useMemo(() => html, [html])

  useEffect(() => {
    const onMessage = async (event: MessageEvent<PluginToHostMessage>) => {
      if (event.source !== frame.current?.contentWindow) return
      const message = event.data
      if (message?.source !== 'digiworld-plugin' || message.pluginId !== pluginId) return

      if (message.kind === 'ready') {
        const themeMessage: HostToPluginMessage = {
          source: 'digiworld-host', pluginId, kind: 'theme', payload: THEME,
        }
        frame.current?.contentWindow?.postMessage(themeMessage, '*')
        return
      }

      if (message.kind !== 'request' || !message.requestId || !message.method) return
      let payload: { ok: boolean; value?: unknown; error?: string }
      try {
        const value = await api.pluginRequest(pluginId, message.method, message.payload)
        payload = { ok: true, value }
      } catch (error) {
        payload = { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
      const response: HostToPluginMessage = {
        source: 'digiworld-host', pluginId, kind: 'response', requestId: message.requestId, payload,
      }
      frame.current?.contentWindow?.postMessage(response, '*')
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [pluginId])

  return <iframe ref={frame} className="plugin-frame" title={pluginId} sandbox="allow-scripts allow-downloads" srcDoc={source} />
}
