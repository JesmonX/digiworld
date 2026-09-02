export type Metric = 'totalTokens' | 'inputTokens' | 'outputTokens' | 'cacheReadTokens'

export interface UsageDay {
  day: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
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
  return Math.max(1, Math.min(5, Math.ceil((Math.log1p(value) / Math.log1p(max)) * 5)))
}

function parseDay(day: string): Date {
  return new Date(`${day}T00:00:00Z`)
}
