import { describe, expect, it } from 'vitest'
import { calendarCells, heatLevel } from './heatmap'

describe('calendar heatmap', () => {
  it('aligns Monday-first weeks and fills missing dates', () => {
    const cells = calendarCells('2026-08-31', '2026-09-02', [{
      day: '2026-09-01', inputTokens: 10, outputTokens: 2,
      cacheReadTokens: 4, cacheWriteTokens: 0, totalTokens: 12,
    }], 'totalTokens')
    expect(cells).toHaveLength(3)
    expect(cells.map(cell => cell.value)).toEqual([0, 12, 0])
  })

  it('uses a bounded logarithmic intensity scale', () => {
    expect(heatLevel(0, 100)).toBe(0)
    expect(heatLevel(100, 100)).toBe(5)
    expect(heatLevel(10, 100)).toBeGreaterThan(1)
  })
})
