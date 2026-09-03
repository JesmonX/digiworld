import { describe, expect, it } from 'vitest'
import { calendarCells, formatTokens, heatLevel } from './heatmap'

describe('calendar heatmap', () => {
  it('aligns Monday-first weeks and fills missing dates', () => {
    const cells = calendarCells('2026-08-31', '2026-09-02', [{
      day: '2026-09-01', inputTokens: 10, outputTokens: 2,
      cacheReadTokens: 4, cacheWriteTokens: 0, totalTokens: 12,
    }], 'totalTokens')
    expect(cells).toHaveLength(3)
    expect(cells.map(cell => cell.value)).toEqual([0, 12, 0])
  })

  it('separates values that differ by orders of magnitude', () => {
    expect(heatLevel(0, 200_000_000)).toBe(0)
    expect(heatLevel(2_000_000, 200_000_000)).toBe(3)
    expect(heatLevel(20_000_000, 200_000_000)).toBe(4)
    expect(heatLevel(200_000_000, 200_000_000)).toBe(5)
  })

  it('formats token quantities with computer-style units', () => {
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(12_500)).toBe('12.5K')
    expect(formatTokens(200_000_000)).toBe('200M')
    expect(formatTokens(1_250_000_000)).toBe('1.25B')
  })
})
