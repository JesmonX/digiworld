export type Metric = 'totalTokens' | 'inputTokens' | 'outputTokens' | 'cacheReadTokens'

export interface UsageDay {
  day: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  cacheAvailable?: boolean
}

export interface WeeklyUsagePoint extends UsageDay {
  cacheRate: number | undefined
}

export interface CacheRateScale {
  minimum: number
  maximum: number
}

export interface CalendarCell {
  day?: string
  value: number
  usage?: UsageDay
}

export function calendarCells(startDay: string, endDay: string, days: UsageDay[], metric: Metric): CalendarCell[] {
  const values = new Map(days.map(day => [day.day, day]))
  const start = parseDay(startDay)
  const end = parseDay(endDay)
  const leading = (start.getUTCDay() + 6) % 7
  const cells: CalendarCell[] = Array.from({ length: leading }, () => ({ value: 0 }))
  for (let current = start; current <= end; current = new Date(current.getTime() + 86_400_000)) {
    const day = current.toISOString().slice(0, 10)
    const usage = values.get(day)
    cells.push(usage ? { day, usage, value: usage[metric] } : { day, value: 0 })
  }
  return cells
}

export function heatLevel(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0
  const ratio = value / max
  if (ratio >= .5) return 5
  if (ratio >= .1) return 4
  if (ratio >= .01) return 3
  if (ratio >= .001) return 2
  return 1
}

export function formatTokens(value: number): string {
  const units = [
    { threshold: 1_000_000_000, suffix: 'B' },
    { threshold: 1_000_000, suffix: 'M' },
    { threshold: 1_000, suffix: 'K' },
  ]
  const unit = units.find(candidate => Math.abs(value) >= candidate.threshold)
  if (!unit) return Math.round(value).toLocaleString('en-US')
  const scaled = value / unit.threshold
  const digits = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2
  const fixed = scaled.toFixed(digits)
  const compact = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed
  return `${compact}${unit.suffix}`
}

export function weeklyUsage(endDay: string, days: UsageDay[]): WeeklyUsagePoint[] {
  const values = new Map(days.map(day => [day.day, day]))
  const end = parseDay(endDay)
  const start = new Date(end.getTime() - 6 * 86_400_000)
  const result: WeeklyUsagePoint[] = []
  for (let current = start; current <= end; current = new Date(current.getTime() + 86_400_000)) {
    const day = current.toISOString().slice(0, 10)
    const usage = values.get(day) ?? {
      day, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
      cacheWriteTokens: 0, totalTokens: 0, cacheAvailable: false,
    }
    result.push({
      ...usage,
      cacheRate: usage.cacheAvailable && usage.inputTokens > 0
        ? usage.cacheReadTokens / usage.inputTokens
        : undefined,
    })
  }
  return result
}

export function cacheRateScale(rates: Array<number | undefined>): CacheRateScale {
  const values = rates.flatMap(rate => rate == null || !Number.isFinite(rate) ? [] : [Math.max(0, Math.min(1, rate))])
  if (!values.length) return { minimum: 0, maximum: 1 }

  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const center = (minimum + maximum) / 2
  const span = Math.max(.2, maximum - minimum + .1)
  let axisMinimum = center - span / 2
  let axisMaximum = center + span / 2
  if (axisMinimum < 0) {
    axisMaximum -= axisMinimum
    axisMinimum = 0
  }
  if (axisMaximum > 1) {
    axisMinimum -= axisMaximum - 1
    axisMaximum = 1
  }

  const tick = .05
  axisMinimum = Math.max(0, Math.floor((axisMinimum + 1e-9) / tick) * tick)
  axisMaximum = Math.min(1, Math.ceil((axisMaximum - 1e-9) / tick) * tick)
  return {
    minimum: Math.round(axisMinimum * 100) / 100,
    maximum: Math.round(axisMaximum * 100) / 100,
  }
}

function parseDay(day: string): Date {
  return new Date(`${day}T00:00:00Z`)
}
