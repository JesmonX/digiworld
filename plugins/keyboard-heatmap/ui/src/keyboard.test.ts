import { describe, expect, it } from 'vitest'
import { formatKeyLabel, getKeyboardLayout, heatLevel, keyboardLayouts, layoutKeys, numpadKeys } from './keyboard'

describe('keyboard layouts', () => {
  it('covers the mainstream 108, 104, 98, 87, 84, 68 and 61-key distributions', () => {
    expect(keyboardLayouts.map(layout => layout.keyCount)).toEqual([108, 104, 98, 87, 84, 68, 61, 78])
    for (const layout of keyboardLayouts) {
      const ids = layoutKeys(layout).map(key => key.id)
      expect(ids).toHaveLength(layout.keyCount)
      expect(new Set(ids).size).toBe(layout.keyCount)
      expect(ids).toContain('Space')
      expect(ids).toContain('ControlLeft')
    }
    expect(layoutKeys(getKeyboardLayout('full')).map(key => key.id)).toContain('NumpadEnter')
    expect(layoutKeys(getKeyboardLayout('60')).map(key => key.id)).not.toContain('F1')
    expect(layoutKeys(getKeyboardLayout('108')).map(key => key.id)).toContain('VolumeUp')
  })

  it('places every key on a non-overlapping grid cell inside the board', () => {
    for (const layout of keyboardLayouts) {
      const occupied = new Set<string>()
      for (const key of layout.keys) {
        const rowSpan = key.rowSpan ?? 1
        const columnSpan = key.columnSpan ?? 1
        expect(key.row).toBeGreaterThanOrEqual(1)
        expect(key.column).toBeGreaterThanOrEqual(1)
        expect(key.row + rowSpan - 1).toBeLessThanOrEqual(layout.rows)
        expect(key.column + columnSpan - 1).toBeLessThanOrEqual(layout.tracks)
        for (let row = key.row; row < key.row + rowSpan; row += 1) {
          for (let column = key.column; column < key.column + columnSpan; column += 1) {
            const cell = `${row}:${column}`
            expect(occupied.has(cell), `${layout.id} ${key.id} overlaps ${cell}`).toBe(false)
            occupied.add(cell)
          }
        }
      }
    }
  })

  it('aligns the bottom row with the right edge of the main block', () => {
    for (const layout of keyboardLayouts) {
      const edge = ['96', '75', '65'].includes(layout.id) ? 64 : 60
      const bottomRow = layout.keys.filter(key => key.row + (key.rowSpan ?? 1) - 1 === layout.rows && key.column + (key.columnSpan ?? 1) - 1 <= edge)
      const rightEdge = Math.max(...bottomRow.map(key => key.column + (key.columnSpan ?? 1) - 1))
      expect(rightEdge, `${layout.id} bottom row`).toBe(edge)
    }
  })

  it('keeps function rows adjacent and Mac labels isolated from PC layouts', () => {
    for (const layout of keyboardLayouts.filter(layout => layout.rows === 6)) {
      expect(layout.keys.find(key => key.id === 'Digit1')?.row).toBe(2)
    }
    expect(formatKeyLabel('MetaLeft', 'en', 'mac')).toBe('⌘')
    expect(formatKeyLabel('MetaLeft', 'en', 'full')).toBe('Win')
    expect(getKeyboardLayout('75').tracks).toBeLessThan(getKeyboardLayout('tkl').tracks)
  })

  it('renders tall numpad keys as single physical keys', () => {
    expect(numpadKeys.filter(key => key.id === 'NumpadAdd')).toHaveLength(1)
    expect(numpadKeys.find(key => key.id === 'NumpadAdd')?.rowSpan).toBe(2)
    expect(numpadKeys.filter(key => key.id === 'NumpadEnter')).toHaveLength(1)
    expect(numpadKeys.find(key => key.id === 'NumpadEnter')?.rowSpan).toBe(2)
  })

  it('formats raw key identifiers into readable labels', () => {
    expect(formatKeyLabel('KeyA')).toBe('A')
    expect(formatKeyLabel('Digit1')).toBe('1')
    expect(formatKeyLabel('Space')).toBe('空格')
    expect(formatKeyLabel('BracketLeft')).toBe('[')
    expect(formatKeyLabel('UnknownCustomKey')).toBe('UnknownCustomKey')
  })

  it('allocates distinct heat levels based on frequency ratios', () => {
    expect(heatLevel(0, 1000)).toBe(0)
    expect(heatLevel(0, 0)).toBe(0)
    expect(heatLevel(1, 2000)).toBe(1)
    expect(heatLevel(5, 1000)).toBe(2)
    expect(heatLevel(50, 1000)).toBe(3)
    expect(heatLevel(200, 1000)).toBe(4)
    expect(heatLevel(600, 1000)).toBe(5)
  })
})
