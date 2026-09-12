import type { CatalogPlugin, LocalizedNames, PluginSummary } from '@digiworld/plugin-sdk'
import type { Locale } from './i18n'
import type { UpdateProgress } from './api'

type NamedPlugin = Pick<CatalogPlugin | PluginSummary, 'id' | 'name'> & { localizedNames?: LocalizedNames }

const BUILT_IN_NAMES: Record<string, LocalizedNames> = {
  'io.github.jesmonx.digiworld.agent-token-heatmap': { zh: 'Agent 概览', en: 'Agent Overview' },
  'io.github.jesmonx.digiworld.keyboard-heatmap': { zh: '键盘热力图', en: 'Keyboard Heatmap' },
  'io.github.jesmonx.digiworld.github-actions': { zh: 'Git 工作流', en: 'Git Actions' },
  'io.github.jesmonx.digiworld.mail-assistant': { zh: '邮件助手', en: 'Mail Assistant' },
  'io.github.jesmonx.digiworld.calendar-todo': { zh: '日历与待办', en: 'Calendar & Todo' },
  'io.github.jesmonx.digiworld.server-monitor': { zh: '服务器监控', en: 'Server Monitor' },
}

export function pluginDisplayName(plugin: NamedPlugin, locale: Locale): string {
  return plugin.localizedNames?.[locale] ?? BUILT_IN_NAMES[plugin.id]?.[locale] ?? plugin.name
}

const BUILT_IN_DESCRIPTIONS: Record<string, string> = {
  'keyboard-heatmap': 'Explore physical keyboard activity across full-size, compact and Mac layouts. Only daily totals are stored.',
  'agent-token-heatmap': 'View agent token usage, daily activity and account quotas across your devices.',
  'mail-assistant': 'Read and manage mail from Gmail, QQ, 163 and custom IMAP accounts.',
  'github-actions': 'Follow your GitHub workflow runs, jobs and steps in selected repositories.',
  'server-monitor': 'Monitor remote Linux CPU, memory, GPU, disks and network usage over SSH.',
  'calendar-todo': 'Sync iCloud calendars and manage local tasks.',
  markpad: 'Capture, search and revisit local notes by date.',
}

export function pluginDescription(plugin: NamedPlugin & { description?: string }, locale: Locale): string {
  const prefix = 'io.github.jesmonx.digiworld.'
  if (locale === 'en' && plugin.id.startsWith(prefix)) {
    return BUILT_IN_DESCRIPTIONS[plugin.id.slice(prefix.length)] ?? plugin.description ?? ''
  }
  return plugin.description ?? ''
}

export function pluginSearchNames(plugin: NamedPlugin): string[] {
  return [...new Set([plugin.name, plugin.localizedNames?.zh, plugin.localizedNames?.en, BUILT_IN_NAMES[plugin.id]?.zh, BUILT_IN_NAMES[plugin.id]?.en].filter((name): name is string => Boolean(name)))]
}

export function progressDisplayName(progress: UpdateProgress | null, plugins: readonly NamedPlugin[], fallback: string, locale: Locale): string {
  if (!progress) return fallback
  if (progress.operation === 'core-update') return progress.itemName || fallback
  if (!progress.itemId) return fallback
  const plugin = plugins.find(item => item.id === progress.itemId)
  return pluginDisplayName(plugin ?? { id: progress.itemId, name: progress.itemName || fallback }, locale)
}
