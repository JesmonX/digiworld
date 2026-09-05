import { useEffect, useMemo, useRef } from 'react'
import type { HostToPluginMessage, PluginTheme, PluginToHostMessage } from '@digiworld/plugin-sdk'
import hostTypographyCss from '@digiworld/typography/fonts.css?inline'
import designTokensCss from '@digiworld/design-system/tokens.css?inline'
import designBaseCss from '@digiworld/design-system/base.css?inline'
import { api } from '../lib/api'

interface PluginFrameProps {
  pluginId: string
  html: string
  theme: PluginTheme
  active?: boolean
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

export function withInitialTheme(html: string, theme: PluginTheme): string {
  const declarations = Object.entries(theme)
    .filter(([key, value]) => /^[a-z][a-z0-9-]*$/.test(key) && value !== undefined)
    .map(([key, value]) => `--dw-${key}:${String(value).replace(/[<>;{}]/g, '')}`)
    .join(';')
  const style = `<style data-digiworld-host-design>${designTokensCss}\n${designBaseCss}\n:root{${declarations};color-scheme:${theme['color-scheme']}}</style>`
  // Last in head: initial host values must win over bundled fallback tokens.
  const themed = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${style}</head>`) : `${style}${html}`
  return /<html(?:\s[^>]*)?>/i.test(themed)
    ? themed.replace(/<html(\s[^>]*)?>/i, (match, attrs) => {
        if (attrs && attrs.includes('data-dw-scheme')) return match
        return `<html${attrs ?? ''} data-dw-scheme="${theme['color-scheme']}">`
      })
    : themed
}

export function PluginFrame({ pluginId, html, theme, active = true }: PluginFrameProps) {
  const frame = useRef<HTMLIFrameElement>(null)
  const ready = useRef(false)
  // Theme changes travel over the bridge; changing srcDoc would destroy plugin state.
  const initialTheme = useRef(theme)
  initialTheme.current = theme
  const source = useMemo(() => withInitialTheme(withHostTypography(html), initialTheme.current), [html, pluginId])

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
        const visibilityMessage: HostToPluginMessage = {
          source: 'digiworld-host', pluginId, kind: 'event', method: 'host.visibility', payload: { active },
        }
        frame.current?.contentWindow?.postMessage(visibilityMessage, '*')
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
  }, [pluginId, theme, active])

  useEffect(() => {
    if (!ready.current) return
    const themeMessage: HostToPluginMessage = {
      source: 'digiworld-host', pluginId, kind: 'theme', payload: theme,
    }
    frame.current?.contentWindow?.postMessage(themeMessage, '*')
  }, [pluginId, theme])

  useEffect(() => {
    if (!ready.current) return
    const visibilityMessage: HostToPluginMessage = {
      source: 'digiworld-host', pluginId, kind: 'event', method: 'host.visibility', payload: { active },
    }
    frame.current?.contentWindow?.postMessage(visibilityMessage, '*')
  }, [pluginId, active])

  return <iframe ref={frame} className="plugin-frame" title={pluginId} sandbox="allow-scripts allow-downloads" style={{ backgroundColor: theme.bg }} srcDoc={source} />
}
