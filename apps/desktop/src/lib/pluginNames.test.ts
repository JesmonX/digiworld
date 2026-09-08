import { describe, expect, it } from 'vitest'
import { pluginDisplayName, pluginSearchNames, progressDisplayName } from './pluginNames'
import type { UpdateProgress } from './api'

describe('plugin display names', () => {
  it('localizes live installation and update progress instead of backend names', () => {
    const progress: UpdateProgress = { operation: 'plugin-install', itemId: 'io.github.jesmonx.digiworld.mail-assistant', itemName: '邮件助手', stage: 'downloading', downloaded: 10, completedItems: 0, totalItems: 1 }
    expect(progressDisplayName(progress, [], 'Install', 'en')).toBe('Mail Assistant')
    expect(progressDisplayName({ ...progress, operation: 'plugin-update' }, [], 'Plugin Updates', 'en')).toBe('Mail Assistant')
    const { itemId: _itemId, ...withoutId } = progress
    expect(progressDisplayName({ ...withoutId, itemName: '插件更新', stage: 'failed' }, [], 'Plugin Updates', 'en')).toBe('Plugin Updates')
    const plugin = { id: 'third.party', name: '原名', localizedNames: { en: 'Translated' } }
    expect(progressDisplayName({ ...progress, itemId: plugin.id }, [plugin], 'Install', 'en')).toBe('Translated')
    expect(progressDisplayName({ ...progress, operation: 'core-update', itemName: 'Digiworld 0.2.59' }, [], 'Update', 'en')).toBe('Digiworld 0.2.59')
    expect(progressDisplayName(null, [], 'Preparing', 'en')).toBe('Preparing')
  })
  it('uses built-in translations for older installed manifests', () => {
    const plugin = { id: 'io.github.jesmonx.digiworld.agent-token-heatmap', name: 'Agent Overview' }
    expect(pluginDisplayName(plugin, 'zh')).toBe('Agent 概览')
    expect(pluginDisplayName(plugin, 'en')).toBe('Agent Overview')
    expect(pluginSearchNames(plugin)).toEqual(expect.arrayContaining(['Agent Overview', 'Agent 概览']))
  })

  it('prefers manifest translations and keeps third-party names intact', () => {
    const localized = { id: 'example.plugin', name: 'Example', localizedNames: { zh: '示例', en: 'Example Tool' } }
    expect(pluginDisplayName(localized, 'zh')).toBe('示例')
    expect(pluginDisplayName(localized, 'en')).toBe('Example Tool')
    const thirdParty = { id: 'other.plugin', name: 'Original Name' }
    expect(pluginDisplayName(thirdParty, 'zh')).toBe('Original Name')
    expect(pluginSearchNames(thirdParty)).toEqual(['Original Name'])
  })
})
