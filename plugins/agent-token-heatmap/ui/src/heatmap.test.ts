import { describe, expect, it } from 'vitest'
import { cacheRateScale, calendarCells, formatTokens, heatLevel, weeklyUsage } from './heatmap'

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

  it('builds a fixed seven-day series and only reports available cache rates', () => {
    const points = weeklyUsage('2026-09-03', [{
      day: '2026-09-02', inputTokens: 100, outputTokens: 10,
      cacheReadTokens: 60, cacheWriteTokens: 0, totalTokens: 110,
      cacheAvailable: true,
    }])
    expect(points).toHaveLength(7)
    expect(points.map(point => point.day)).toEqual([
      '2026-08-28', '2026-08-29', '2026-08-30', '2026-08-31',
      '2026-09-01', '2026-09-02', '2026-09-03',
    ])
    expect(points[5]!.cacheRate).toBe(.6)
    expect(points[6]!.cacheRate).toBeUndefined()
  })

  it('zooms the cache-rate axis around nearby values with rounded padding', () => {
    expect(cacheRateScale([.72, .75])).toEqual({ minimum: .6, maximum: .85 })
    expect(cacheRateScale([.75])).toEqual({ minimum: .65, maximum: .85 })
    expect(cacheRateScale([undefined, Number.NaN])).toEqual({ minimum: 0, maximum: 1 })
  })
})
