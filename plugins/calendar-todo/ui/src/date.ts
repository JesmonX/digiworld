export type DateKey = string // YYYY-MM-DD

export function dateKey(value: string | Date): DateKey {
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
    if (/^\d{8}/.test(value)) {
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
