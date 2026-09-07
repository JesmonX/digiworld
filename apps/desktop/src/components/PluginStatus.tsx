import type { PluginSummary } from '@digiworld/plugin-sdk'
import { t, type Locale } from '../lib/i18n'

export function stateLabel(plugin: PluginSummary, locale: Locale = 'en'): string {
  if (!plugin.enabled || plugin.state === 'disabled') return t('disabled', locale)
  const map: Partial<Record<PluginSummary['state'], 'installed' | 'starting' | 'running' | 'paused' | 'failed'>> = {
    installed: 'installed', starting: 'starting', running: 'running', paused: 'paused', failed: 'failed',
  }
  const key = map[plugin.state]
  return key ? t(key, locale) : plugin.state
}
