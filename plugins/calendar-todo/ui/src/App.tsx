import { useEffect, useMemo, useState } from 'react'
import { PluginPage, PageToolbar, SplitPane, Button, Input, Card, Status, Textarea, Select, Dialog } from '@digiworld/design-system/react'
import { createPluginBridge } from '@digiworld/plugin-sdk'
import { CalendarDays, Plus, RefreshCw, Settings, Trash2, X, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  DateKey,
  dateKey,
  todayKey,
  toIcalDate,
  toIcalDateTime,
  nextDayKey,
  formatDisplayDate,
  formatDisplayMonth,
  monthDays,
} from './date'
import { t, type Locale } from './i18n'

const bridge = createPluginBridge('io.github.jesmonx.digiworld.calendar-todo')

type Cal = {
  id: string
  name: string
  href: string
  readOnly: boolean
  capabilities?: { create: 'allowed' | 'denied' | 'unknown'; update: 'allowed' | 'denied' | 'unknown'; delete: 'allowed' | 'denied' | 'unknown' }
}

type Event = {
  id: string
  calendarId: string
  href: string
  etag: string
  title: string
  start: string
  end: string
  startTimezone?: string | null
  endTimezone?: string | null
  allDay: boolean
  location: string
  notes: string
  recurring: boolean
}

type CalendarSyncResult = {
  calendars: Cal[]
  events: Event[]
  warnings?: string[]
}

type Todo = {
  id: string
  title: string
  done: boolean
  due?: string | null
  createdAt: string
  updatedAt: string
}

type AgendaItem =
  | { kind: 'event'; event: Event }
  | { kind: 'todo'; todo: Todo }

const blank = (cal = '', dk?: DateKey): Event => {
  const targetDay = dk || todayKey()
  return {
    id: '',
    calendarId: cal,
    href: '',
    etag: '',
    title: '',
    start: toIcalDateTime(targetDay, 9, 0),
    end: toIcalDateTime(targetDay, 10, 0),
    startTimezone: null,
    endTimezone: null,
    allDay: false,
    location: '',
    notes: '',
    recurring: false,
  }
}

type CalendarCapability = 'create' | 'update' | 'delete'
const capability = (calendar: Cal | undefined, operation: CalendarCapability) => calendar?.capabilities?.[operation] ?? (calendar?.readOnly ? 'denied' : 'unknown')

export default function App() {
  const [locale, setLocale] = useState<Locale>(() => {
    return (document.documentElement.lang?.startsWith('zh') ? 'zh' : 'en') as Locale
  })
  const today = todayKey()
  const [account, setAccount] = useState<{ username: string; serverUrl: string; selectedCalendars: string[] } | null>(null)
  const [accountDraft, setAccountDraft] = useState({ username: '', serverUrl: 'https://caldav.icloud.com', selectedCalendars: [] as string[] })
  const [secret, setSecret] = useState('')
  const [cals, setCals] = useState<Cal[]>([])
  const [events, setEvents] = useState<Event[]>([])
  const [todos, setTodos] = useState<Todo[]>([])
  const [edit, setEdit] = useState<Event | null>(null)
  const [todoText, setTodoText] = useState('')
  const [todoDue, setTodoDue] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const [previousAccount, setPreviousAccount] = useState<typeof account>(null)

  const [viewYear, setViewYear] = useState(() => Number(today.slice(0, 4)))
  const [viewMonth, setViewMonth] = useState(() => Number(today.slice(5, 7)))
  const [selectedDate, setSelectedDate] = useState<DateKey | null>(null)

  const prevMonth = () => {
    if (viewMonth === 1) {
      setViewYear(y => y - 1)
      setViewMonth(12)
    } else {
      setViewMonth(m => m - 1)
    }
  }

  const nextMonth = () => {
    if (viewMonth === 12) {
      setViewYear(y => y + 1)
      setViewMonth(1)
    } else {
      setViewMonth(m => m + 1)
    }
  }

  const jumpToToday = () => {
    const t = todayKey()
    setViewYear(Number(t.slice(0, 4)))
    setViewMonth(Number(t.slice(5, 7)))
    selectDate(t)
  }

  const createEventForDate = (dk: DateKey) => {
    setSelectedDate(dk)
    setTodoDue(dk)
    setEdit(blank(cals.find(calendar => capability(calendar, 'create') !== 'denied')?.id, dk))
  }

  const selectDate = (dk: DateKey) => {
    setSelectedDate(dk)
    setTodoDue(dk)
  }

  const load = async (sync = false) => {
    setBusy(true)
    setError('')
    try {
      const a = await bridge.request<typeof account>('calendar.account.get')
      setAccount(a)
      const data = sync && a
        ? await bridge.request<CalendarSyncResult>('calendar.sync')
        : await bridge.request<CalendarSyncResult>('calendar.cached')
      setCals(data.calendars)
      setEvents(data.events)
      if (data.warnings?.length) setError(data.warnings.join('；'))
      setTodos(await bridge.request<Todo[]>('todo.list'))
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
      setInitialized(true)
    }
  }

  useEffect(() => {
    void load()
    bridge.ready()

    const unlistenLocale = bridge.on('locale', (payload: unknown) => {
      const nextLocale = typeof payload === 'string' ? payload : (payload as { locale?: Locale })?.locale
      if (nextLocale === 'en' || nextLocale === 'zh') {
        setLocale(nextLocale)
      }
    })

    return () => {
      if (typeof unlistenLocale === 'function') unlistenLocale()
    }
  }, [])

  useEffect(() => {
    if (!account) return
    const t = setInterval(() => void load(true), 60000)
    return () => clearInterval(t)
  }, [account?.username])

  const eventMap = useMemo(() => {
    const m = new Map<DateKey, Event[]>()
    for (const e of events) {
      const k = dateKey(e.start)
      const list = m.get(k) || []
      list.push(e)
      m.set(k, list)
    }
    return m
  }, [events])

  const todoMap = useMemo(() => {
    const m = new Map<DateKey, Todo[]>()
    for (const todo of todos) {
      if (!todo.due) continue
      const list = m.get(todo.due) || []
      list.push(todo)
      m.set(todo.due, list)
    }
    return m
  }, [todos])

  const agendaMap = useMemo(() => {
    const m = new Map<DateKey, AgendaItem[]>()
    for (const [day, list] of eventMap) m.set(day, list.map(event => ({ kind: 'event' as const, event })))
    for (const [day, list] of todoMap) {
      const existing = m.get(day) || []
      m.set(day, [...existing, ...list.map(todo => ({ kind: 'todo' as const, todo }))])
    }
    for (const list of m.values()) {
      list.sort((left, right) => {
        const leftKey = left.kind === 'event' ? left.event.start : `${left.todo.due}T23:59`
        const rightKey = right.kind === 'event' ? right.event.start : `${right.todo.due}T23:59`
        return leftKey.localeCompare(rightKey)
      })
    }
    return m
  }, [eventMap, todoMap])

  const unscheduledTodos = useMemo(() => todos.filter(todo => !todo.due), [todos])

  const upcomingDays = useMemo(() => {
    const currentDay = todayKey()
    return [...agendaMap.entries()]
      .filter(([day, list]) => day >= currentDay || list.some(item => item.kind === 'todo' && item.todo.due != null && item.todo.due < currentDay))
      .sort((a, b) => a[0].localeCompare(b[0]))
  }, [agendaMap])

  const displayDays = useMemo(() => {
    if (selectedDate) {
      const list = agendaMap.get(selectedDate)
      return list && list.length > 0 ? [[selectedDate, list] as [DateKey, AgendaItem[]]] : []
    }
    return upcomingDays
  }, [agendaMap, selectedDate, upcomingDays])

  const connect = async () => {
    setBusy(true)
    try {
      const found = await bridge.request<Cal[]>('calendar.account.save', { account: accountDraft, secret })
      setCals(found)
      const calendarIds = found.map(c => c.id)
      const updated = await bridge.request<typeof account>('calendar.selection.save', { calendarIds })
      setAccount(updated || { ...accountDraft, selectedCalendars: calendarIds })
      await load(true)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const saveEvent = async () => {
    if (!edit) return
    setBusy(true); setError('')
    try {
      await bridge.request('calendar.event.save', { event: edit, overwrite: false })
      setEdit(null)
      await load(true)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const delEvent = async () => {
    if (!edit) return
    try {
      await bridge.request('calendar.event.delete', { event: edit, overwrite: false })
      setEdit(null)
      await load(true)
    } catch (e) {
      setError(String(e))
    }
  }

  const selectCalendar = async (id: string, checked: boolean) => {
    if (!account) return
    const ids = checked ? [...account.selectedCalendars, id] : account.selectedCalendars.filter(x => x !== id)
    const updated = await bridge.request<typeof account>('calendar.selection.save', { calendarIds: ids })
    setAccount(updated || { ...account, selectedCalendars: ids })
    await load(true)
  }

  const saveTodo = async () => {
    if (!todoText.trim()) return
    setBusy(true); setError('')
    try { await bridge.request('todo.save', { todo: { id: '', title: todoText, done: false, due: todoDue || null, createdAt: '', updatedAt: '' } }); setTodoText(''); setTodoDue(selectedDate ?? ''); await load() }
    catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }

  const toggle = async (t: Todo) => {
    await bridge.request('todo.save', { todo: { ...t, done: !t.done } })
    await load()
  }

  const removeTodo = async (id: string) => {
    await bridge.request('todo.delete', { id })
    await load()
  }

  if (!initialized) return <main className="connect"><Status>{t('loadingCalendar', locale)}</Status></main>
  if (!account) {
    return (
      <main className="connect">
        <Card>
          <CalendarDays size={28} />
          <h1>{t('connectTitle', locale)}</h1>
          <p>{t('connectSubtitle', locale)}</p>
          <label>
            {t('appleAccount', locale)}
            <Input type="email" value={accountDraft.username} onChange={e => setAccountDraft({ ...accountDraft, username: e.target.value })} />
          </label>
          <label>
            {t('appSpecificPassword', locale)}
            <Input type="password" value={secret} onChange={e => setSecret(e.target.value)} />
          </label>
          <Button variant="primary" onClick={() => void connect()} disabled={busy || !secret}>
            {busy ? t('connecting', locale) : t('connectButton', locale)}
          </Button>
          {previousAccount && <Button onClick={() => { setAccount(previousAccount); setPreviousAccount(null); setError('') }}>{t('cancel', locale)}</Button>}
          {error && <Status tone="error">{error}</Status>}
        </Card>
      </main>
    )
  }

  const weekdays = locale === 'zh' ? ['一', '二', '三', '四', '五', '六', '日'] : ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
  const createCalendar = cals.find(calendar => capability(calendar, 'create') !== 'denied')
  const editCalendar = cals.find(calendar => calendar.id === edit?.calendarId)
  const editOperation: CalendarCapability = edit?.href ? 'update' : 'create'
  const editCapability = capability(editCalendar, editOperation)
  const editDeleteCapability = capability(editCalendar, 'delete')

  return (
    <PluginPage>
      <PageToolbar className="">
        <div className="calendar-toolbar-title"><CalendarDays size={17} /><strong>{t('calendarTab', locale)}</strong></div>
        <Button onClick={() => void load(true)} disabled={busy}>
          <RefreshCw size={15} />{t('sync', locale)}
        </Button>
        <Button onClick={() => { setPreviousAccount(account); setAccountDraft(account); setAccount(null) }}>
          <Settings size={15} />{t('account', locale)}
        </Button>
      </PageToolbar>

      {error && <Status tone="error">{error}</Status>}

      <SplitPane aside={<div className="calendar-sidebar">
            <Card className="month-card">
              <header className="month-header">
                <h3>{formatDisplayMonth(viewYear, viewMonth, locale)}</h3>
                <div className="month-nav">
                  <Button aria-label={t('prevMonth', locale)} onClick={prevMonth}><ChevronLeft size={15} /></Button>
                  <Button onClick={jumpToToday}>{t('today', locale)}</Button>
                  <Button aria-label={t('nextMonth', locale)} onClick={nextMonth}><ChevronRight size={15} /></Button>

                </div>
              </header>

              <div className="calendar-weekdays" aria-hidden="true">
                {weekdays.map(w => (
                  <span key={w}>{w}</span>
                ))}
              </div>

              <div className="calendar-grid" role="grid" aria-label={t('monthCalendarAria', locale)}>
                {monthDays(viewYear, viewMonth).map(cell => {
                  const dayEvents = eventMap.get(cell.key) || []
                  const dayTodos = todoMap.get(cell.key) || []
                  const isSelected = selectedDate === cell.key
                  return (
                    <button
                      type="button"
                      key={cell.key}
                      className={`calendar-cell ${cell.inMonth ? '' : 'other-month'} ${cell.isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''}`}
                      onClick={() => selectDate(cell.key)}
                      onDoubleClick={() => createEventForDate(cell.key)}
                      aria-label={`${cell.key}${dayEvents.length ? ` · ${dayEvents.length} ${t('eventMarker', locale)}` : ''}${dayTodos.length ? ` · ${dayTodos.length} ${t('todoMarker', locale)}` : ''}`}
                      aria-selected={isSelected}
                    >
                      <span className="cell-day">{cell.dayNum}</span>
                      <span className="cell-dots">
                        {dayEvents.length > 0 && <span className="event-dot" title={t('eventMarker', locale)} />}
                        {dayTodos.length > 0 && <span className="todo-dot" title={t('todoMarker', locale)} />}
                      </span>
                    </button>
                  )
                })}
              </div>
            </Card>

            <div className="calendar-meta-card">
              <div className="meta-head">
                <small>{t('eventsCount', locale).replace('{events}', String(events.length)).replace('{todos}', String(todos.length)).replace('{cals}', String(cals.length))}</small>
              </div>
              <div className="calendar-picker">
                {cals.map(c => (
                  <label key={c.id}>
                    <input
                      type="checkbox"
                      checked={account.selectedCalendars.includes(c.id)}
                      onChange={e => void selectCalendar(c.id, e.target.checked)}
                    />
                    {c.name}
                  </label>
                ))}
              </div>
            </div>
          </div>}>
          <div className="calendar-agenda-pane">
            <header className="agenda-header">
              <div>
                <strong>{selectedDate ? `${formatDisplayDate(selectedDate, locale)}${selectedDate === today ? ` (${t('todayLabel', locale)})` : ''}` : t('upcomingEvents', locale)}</strong>
                <small>{t('totalEventsCount', locale).replace('{count}', String(displayDays.reduce((acc, [, list]) => acc + list.length, 0) + (!selectedDate ? unscheduledTodos.length : 0)))}</small>
              </div>
              <div className="agenda-actions">
                {selectedDate && (
                  <Button onClick={() => { setSelectedDate(null); setTodoDue('') }}>
                    {t('viewAllUpcoming', locale)}
                  </Button>
                )}
                <Button
                  variant="primary"
                  onClick={() => createEventForDate(selectedDate || today)}
                  disabled={!createCalendar}
                >
                  <Plus size={15} />{t('newEvent', locale)}
                </Button>
              </div>
            </header>

            <Card className="todo-add">
              <Input
                value={todoText}
                onChange={e => setTodoText(e.target.value)}
                placeholder={t('addTodoPlaceholder', locale)}
                onKeyDown={e => { if (e.key === 'Enter') void saveTodo() }}
              />
              <Input type="date" aria-label={t('dueDateAria', locale)} value={todoDue} onChange={e => setTodoDue(e.target.value)} />
              <Button variant="primary" aria-label={t('addTodo', locale)} onClick={() => void saveTodo()}><Plus size={15} /></Button>
            </Card>

            <section className="agenda">
              {displayDays.map(([day, list]) => (
                <Card key={day} className="agenda-day-card">
                  <time>{formatDisplayDate(day, locale)}</time>
                  <div className="agenda-day-events">
                    {list.map(item => item.kind === 'event' ? (
                      <Button key={`event-${item.event.href}-${item.event.id}`} className="event agenda-item" onClick={() => setEdit(item.event)}>
                        <span>
                          <strong>{item.event.title || t('untitled', locale)}</strong>
                          <small>{item.event.allDay ? t('allDay', locale) : formatTime(item.event.start, locale)}{item.event.location ? ` · ${item.event.location}` : ''}</small>
                        </span>
                        <small className="item-kind">{item.event.recurring ? t('recurring', locale) : t('eventMarker', locale)}</small>
                      </Button>
                    ) : (
                      <div key={`todo-${item.todo.id}`} className={`todo-item agenda-item ${item.todo.done ? 'done' : ''}`}>
                        <input type="checkbox" aria-label={item.todo.title} checked={item.todo.done} onChange={() => void toggle(item.todo)} />
                        <span>
                          <strong>{item.todo.title}</strong>
                          <small>{t('todoMarker', locale)}{item.todo.due ? ` · ${t('dueLabel', locale).replace('{date}', item.todo.due)}` : ''}</small>
                        </span>
                        <Button aria-label={`${t('deleteTodo', locale)}: ${item.todo.title}`} onClick={() => void removeTodo(item.todo.id)}><Trash2 size={15} /></Button>
                      </div>
                    ))}
                  </div>
                </Card>
              ))}
              {!selectedDate && unscheduledTodos.length > 0 && (
                <Card className="agenda-day-card agenda-unscheduled">
                  <time>{t('unscheduled', locale)}</time>
                  <div className="agenda-day-events">
                    {unscheduledTodos.map(item => (
                      <div key={item.id} className={`todo-item agenda-item ${item.done ? 'done' : ''}`}>
                        <input type="checkbox" aria-label={item.title} checked={item.done} onChange={() => void toggle(item)} />
                        <span><strong>{item.title}</strong><small>{t('todoMarker', locale)}</small></span>
                        <Button aria-label={`${t('deleteTodo', locale)}: ${item.title}`} onClick={() => void removeTodo(item.id)}><Trash2 size={15} /></Button>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
              {!displayDays.length && (selectedDate || unscheduledTodos.length === 0) && (
                <Status>
                  {selectedDate ? t('noItemsOnDate', locale).replace('{date}', formatDisplayDate(selectedDate, locale)) : t('noUpcomingEvents', locale)}
                </Status>
              )}
            </section>
          </div>
        </SplitPane>

      {edit && (
        <Dialog open onClose={() => !busy && setEdit(null)} className="editor" aria-label={edit.href ? t('editEvent', locale) : t('newEventHeading', locale)}>
          <header>
            <h2>{edit.href ? t('editEvent', locale) : t('newEventHeading', locale)}</h2>
            <Button onClick={() => setEdit(null)}><X size={16} /></Button>
          </header>
          {edit.recurring && <Status>{t('recurringNotice', locale)}</Status>}
          {editCalendar && editCapability === 'denied' && <Status>{t('readOnlyNotice', locale)}</Status>}
          {editCalendar && editCapability === 'unknown' && <Status>{t('permissionPending', locale)}</Status>}
          <label>
            {t('eventTitle', locale)}
            <Input disabled={edit.recurring} value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value })} />
          </label>
          <label>
            {t('calendar', locale)}
            <Select disabled={!!edit.href || edit.recurring} value={edit.calendarId} onChange={e => setEdit({ ...edit, calendarId: e.target.value })}>
              {cals.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </label>
          <label className="check">
            <input
              disabled={edit.recurring}
              type="checkbox"
              checked={edit.allDay}
              onChange={e => {
                const allDay = e.target.checked
                const dk = dateKey(edit.start) || todayKey()
                if (allDay) {
                  setEdit({
                    ...edit,
                    allDay: true,
                    start: toIcalDate(dk),
                    end: toIcalDate(nextDayKey(dk)),
                  })
                } else {
                  setEdit({
                    ...edit,
                    allDay: false,
                    start: toIcalDateTime(dk, 9, 0),
                    end: toIcalDateTime(dk, 10, 0),
                  })
                }
              }}
            />
            {t('allDayCheck', locale)}
          </label>
          <label>
            {t('start', locale)}
            <Input type={edit.allDay ? 'date' : 'datetime-local'} disabled={edit.recurring} value={fromIcalInput(edit.start, edit.allDay)} onChange={e => setEdit({ ...edit, start: toIcalInput(e.target.value, edit.allDay, edit.start.endsWith('Z')) })} />
            {!edit.allDay && edit.startTimezone && <small>{t('timezone', locale).replace('{tz}', edit.startTimezone)}</small>}
          </label>
          <label>
            {t('end', locale)}
            <Input type={edit.allDay ? 'date' : 'datetime-local'} disabled={edit.recurring} value={fromIcalInput(edit.end, edit.allDay)} onChange={e => setEdit({ ...edit, end: toIcalInput(e.target.value, edit.allDay, edit.end.endsWith('Z')) })} />
            {!edit.allDay && edit.endTimezone && edit.endTimezone !== edit.startTimezone && <small>{t('timezone', locale).replace('{tz}', edit.endTimezone)}</small>}
          </label>
          <label>
            {t('location', locale)}
            <Input disabled={edit.recurring} value={edit.location} onChange={e => setEdit({ ...edit, location: e.target.value })} />
          </label>
          <label>
            {t('notes', locale)}
            <Textarea disabled={edit.recurring} value={edit.notes} onChange={e => setEdit({ ...edit, notes: e.target.value })} />
          </label>
          <footer>
            {edit.href && !edit.recurring ? (
              <Button variant="danger" disabled={busy || editDeleteCapability === 'denied'} onClick={() => void delEvent()}>{t('delete', locale)}</Button>
            ) : <span />}
            <div>
              <Button onClick={() => setEdit(null)}>{t('cancel', locale)}</Button>
              <Button variant="primary" disabled={busy || edit.recurring || editCapability === 'denied' || !edit.title || !edit.start || !edit.end} onClick={() => void saveEvent()}>
                {busy ? t('saving', locale) : t('save', locale)}
              </Button>
            </div>
          </footer>
        </Dialog>
      )}
    </PluginPage>
  )
}

function formatTime(v: string, locale: Locale = 'en') {
  const loc = locale === 'zh' ? 'zh-CN' : 'en-US'
  if (/^\d{8}T\d{6}Z$/.test(v)) {
    const date = icalUtcDate(v)
    return new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit' }).format(date)
  }
  if (/^\d{8}T\d{6}$/.test(v)) return `${v.slice(9, 11)}:${v.slice(11, 13)}`
  const d = new Date(v)
  return Number.isNaN(+d) ? v : new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit' }).format(d)
}
function fromIcalInput(value: string, allDay: boolean) {
  if (!allDay && /^\d{8}T\d{6}Z$/.test(value)) {
    const date = icalUtcDate(value)
    const parts = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')]
    return `${parts.join('-')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }
  const date = dateKey(value)
  if (allDay) return date
  const time = /^\d{8}T\d{6}/.test(value) ? `${value.slice(9, 11)}:${value.slice(11, 13)}` : '09:00'
  return `${date}T${time}`
}
function toIcalInput(value: string, allDay: boolean, utc = false) {
  if (!value) return ''
  if (allDay) return value.replaceAll('-', '')
  if (utc) {
    const date = new Date(value)
    return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}T${String(date.getUTCHours()).padStart(2, '0')}${String(date.getUTCMinutes()).padStart(2, '0')}00Z`
  }
  return `${value.slice(0, 10).replaceAll('-', '')}T${value.slice(11, 16).replace(':', '')}00`
}
function icalUtcDate(value: string) {
  return new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)), Number(value.slice(9, 11)), Number(value.slice(11, 13)), Number(value.slice(13, 15))))
}
