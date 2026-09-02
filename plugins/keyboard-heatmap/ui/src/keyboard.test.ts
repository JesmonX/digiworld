import { describe, expect, it } from 'vitest'
import { getKeyboardLayout, keyboardLayouts, layoutKeys, numpadKeys } from './keyboard'

describe('keyboard layouts', () => {
  it('covers the mainstream 104, 87, 84, 68 and 61-key distributions', () => {
    expect(keyboardLayouts.map(layout => layout.keyCount)).toEqual([104, 87, 84, 68, 61])
    for (const layout of keyboardLayouts) {
      const ids = layoutKeys(layout).map(key => key.id)
      expect(ids).toHaveLength(layout.keyCount)
      expect(new Set(ids).size).toBe(layout.keyCount)
      expect(ids).toContain('Space')
      expect(ids).toContain('ControlLeft')
    }
    expect(layoutKeys(getKeyboardLayout('full')).map(key => key.id)).toContain('NumpadEnter')
    expect(layoutKeys(getKeyboardLayout('60')).map(key => key.id)).not.toContain('F1')
  })

  it('renders tall numpad keys as single physical keys', () => {
    expect(numpadKeys.filter(key => key.id === 'NumpadAdd')).toHaveLength(1)
    expect(numpadKeys.find(key => key.id === 'NumpadAdd')?.rowSpan).toBe(2)
    expect(numpadKeys.filter(key => key.id === 'NumpadEnter')).toHaveLength(1)
    expect(numpadKeys.find(key => key.id === 'NumpadEnter')?.rowSpan).toBe(2)
  })
})
