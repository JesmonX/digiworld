import { describe, expect, it } from 'vitest'
import { pluginDisplayName, pluginSearchNames } from './pluginNames'

describe('plugin display names', () => {
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
