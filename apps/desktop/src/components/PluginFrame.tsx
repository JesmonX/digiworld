import { useEffect, useMemo, useRef } from 'react'
import type { HostToPluginMessage, PluginTheme, PluginToHostMessage } from '@digiworld/plugin-sdk'
import hostTypographyCss from '@digiworld/typography/fonts.css?inline'
import { api } from '../lib/api'

interface PluginFrameProps {
  pluginId: string
  html: string
  theme: PluginTheme
}

export function resolveTypographyUrls(css: string, baseUrl?: string): string {
  if (!baseUrl) return css
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, quote, url) => {
    const trimmed = url.trim()
    if (
      trimmed.startsWith('data:') ||
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://') ||
      trimmed.startsWith('blob:')
    ) {
      return match
    }
    try {
      const resolved = new URL(trimmed, baseUrl).href
      return `url(${quote || '"'}${resolved}${quote || '"'})`
    } catch {
      return match
    }
  })
}

export function withHostTypography(
  html: string,
  typographyCss: string = hostTypographyCss,
  baseUrl?: string,
): string {
  const effectiveBase = baseUrl ?? (typeof document !== 'undefined' ? (document.baseURI || window.location.href) : '')
  const resolvedCss = resolveTypographyUrls(typographyCss, effectiveBase)
  const baseTag = effectiveBase && !/<base(?:\s[^>]*)?>/i.test(html)
    ? `<base href="${effectiveBase}" />`
    : ''
  const style = `<style data-digiworld-host-typography>${resolvedCss}</style>`
  const injection = `${baseTag}${style}`

  return /<head(?:\s[^>]*)?>/i.test(html)
    ? html.replace(/<head(?:\s[^>]*)?>/i, match => `${match}${injection}`)
    : `${injection}${html}`
}

export function PluginFrame({ pluginId, html, theme }: PluginFrameProps) {
  const frame = useRef<HTMLIFrameElement>(null)
  const ready = useRef(false)
  const source = useMemo(() => withHostTypography(html), [html])

  useEffect(() => {
    ready.current = false
  }, [pluginId, source])

  useEffect(() => {
    const onMessage = async (event: MessageEvent<PluginToHostMessage>) => {
      if (event.source !== frame.current?.contentWindow) return
      const message = event.data
      if (message?.source !== 'digiworld-plugin' || message.pluginId !== pluginId) return

      if (message.kind === 'ready') {
        ready.current = true
        const themeMessage: HostToPluginMessage = {
          source: 'digiworld-host', pluginId, kind: 'theme', payload: theme,
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
  }, [pluginId, theme])

  useEffect(() => {
    if (!ready.current) return
    const themeMessage: HostToPluginMessage = {
      source: 'digiworld-host', pluginId, kind: 'theme', payload: theme,
    }
    frame.current?.contentWindow?.postMessage(themeMessage, '*')
  }, [pluginId, theme])

  return <iframe ref={frame} className="plugin-frame" title={pluginId} sandbox="allow-scripts allow-downloads" style={{ backgroundColor: theme.bg }} srcDoc={source} />
}
