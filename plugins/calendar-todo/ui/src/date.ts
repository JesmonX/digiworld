export type DateKey = string // YYYY-MM-DD

export function dateKey(value: string | Date): DateKey {
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.slice(0, 10)
    if (/^\d{8}/.test(value)) {
      if (/^\d{8}T\d{6}Z$/.test(value)) {
        const utc = new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)), Number(value.slice(9, 11)), Number(value.slice(11, 13)), Number(value.slice(13, 15))))
        return dateKey(utc)
      }
      return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
    }
  }
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(+d)) return String(value)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function todayKey(): DateKey {
  return dateKey(new Date())
}

export function toIcalDate(dk: DateKey): string {
  return dk.replaceAll('-', '')
}

export function toIcalDateTime(dk: DateKey, hour: number, minute: number): string {
  const hh = String(hour).padStart(2, '0')
  const mm = String(minute).padStart(2, '0')
  return `${toIcalDate(dk)}T${hh}${mm}00`
}

export function nextDayKey(dk: DateKey): DateKey {
  const parts = dk.split('-').map(Number)
  const y = parts[0] ?? 2026
  const m = parts[1] ?? 1
  const d = parts[2] ?? 1
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() + 1)
  return dateKey(date)
}

export function formatDisplayDate(dk: DateKey): string {
  const parts = dk.split('-').map(Number)
  const y = parts[0] ?? 2026
  const m = parts[1] ?? 1
  const d = parts[2] ?? 1
  return `${y}年${m}月${d}日`
}

export function formatDisplayMonth(year: number, month: number): string {
  return `${year}年${month}月`
}

export interface MonthDayCell {
  key: DateKey
  dayNum: number
  inMonth: boolean
  isToday: boolean
}

export function monthDays(year: number, month: number): MonthDayCell[] {
  const today = todayKey()
  const firstDay = new Date(year, month - 1, 1)
  // Monday = 0, Sunday = 6
  const leadCount = (firstDay.getDay() + 6) % 7
  const daysInMonth = new Date(year, month, 0).getDate()
  const daysInPrevMonth = new Date(year, month - 1, 0).getDate()

  const cells: MonthDayCell[] = []

  // Leading days from previous month
  for (let i = leadCount - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i
    const prevDate = new Date(year, month - 2, d)
    const key = dateKey(prevDate)
    cells.push({
      key,
      dayNum: d,
      inMonth: false,
      isToday: key === today,
    })
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    const curDate = new Date(year, month - 1, d)
    const key = dateKey(curDate)
    cells.push({
      key,
      dayNum: d,
      inMonth: true,
      isToday: key === today,
    })
  }

  // Trailing days to fill the 7-column grid
  const totalGrid = Math.ceil(cells.length / 7) * 7
  const trailingCount = totalGrid - cells.length
  for (let d = 1; d <= trailingCount; d++) {
    const nextDate = new Date(year, month, d)
    const key = dateKey(nextDate)
    cells.push({
      key,
      dayNum: d,
      inMonth: false,
      isToday: key === today,
    })
  }

  return cells
}

/** Floating times stay local; TZID wall times are converted before day grouping. */
export function eventInstant(value: string, timezone?: string | null): Date | null {
  if (!/^\d{8}T\d{6}Z?$/.test(value)) { const d = new Date(value); return Number.isNaN(+d) ? null : d }
  const fields = [Number(value.slice(0,4)), Number(value.slice(4,6))-1, Number(value.slice(6,8)), Number(value.slice(9,11)), Number(value.slice(11,13)), Number(value.slice(13,15))] as const
  if (value.endsWith('Z')) return new Date(Date.UTC(...fields))
  if (!timezone) return new Date(...fields)
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    const wall = Date.UTC(...fields)
    let instant = wall
    for (let i=0; i<3; i++) {
      const p = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(p => [p.type, p.value]))
      const rendered = Date.UTC(Number(p.year), Number(p.month)-1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second))
      const delta = wall - rendered
      instant += delta
      if (!delta) return new Date(instant)
    }
    return null
  } catch { return null }
}
export function coveredDays(event: {start: string; end: string; allDay: boolean; startTimezone?: string | null; endTimezone?: string | null}): DateKey[] {
  const start = event.allDay ? dateKey(event.start) : dateKey(eventInstant(event.start, event.startTimezone) ?? event.start)
  const last = event.allDay ? dateKey(event.end) : dateKey(new Date(+(eventInstant(event.end, event.endTimezone) ?? eventInstant(event.start, event.startTimezone) ?? new Date()) - 1))
  const days: string[] = []
  for (let key = start; key <= last && days.length < 1098; key = nextDayKey(key)) {
    if (event.allDay && key === last && last !== start) break
    days.push(key)
  }
  return days.length ? days : [start]
}
