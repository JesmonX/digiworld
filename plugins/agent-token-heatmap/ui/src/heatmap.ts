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

function parseDay(day: string): Date {
  return new Date(`${day}T00:00:00Z`)
}
