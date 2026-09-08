import type { CatalogPlugin, LocalizedNames, PluginSummary } from '@digiworld/plugin-sdk'
import type { Locale } from './i18n'

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

export function pluginSearchNames(plugin: NamedPlugin): string[] {
  return [...new Set([plugin.name, plugin.localizedNames?.zh, plugin.localizedNames?.en, BUILT_IN_NAMES[plugin.id]?.zh, BUILT_IN_NAMES[plugin.id]?.en].filter((name): name is string => Boolean(name)))]
}
