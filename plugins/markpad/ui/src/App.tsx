import { useEffect, useMemo, useRef, useState } from 'react'
import { createPluginBridge } from '@digiworld/plugin-sdk'
import { Button, Card, Dialog, EmptyState, Input, PageToolbar, PluginPage, SplitPane, Status, Textarea } from '@digiworld/design-system/react'
import { Bold, BookOpen, Pencil, Plus, Search, Trash2 } from 'lucide-react'

const bridge = createPluginBridge('io.github.jesmonx.digiworld.markpad', { contextMenu: 'native' })
type Note = { id: string; day: string; content: string; createdAt: string; updatedAt: string }
const dayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
const plain = (value: string) => value.replace(/\*\*(.+?)\*\*/g, '$1')
function Reading({ content }: { content: string }) {
  return <div className="markpad-reading">{content.split(/(\*\*[^\n]+?\*\*)/g).map((part, i) => part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2,-2)}</strong> : part)}</div>
}

export default function App() {
  const [locale, setLocale] = useState(document.documentElement.lang)
  const t = (zh: string, en: string) => locale.startsWith('zh') ? zh : en
  const [notes, setNotes] = useState<Note[]>([])
  const [selected, setSelected] = useState('')
  const [day, setDay] = useState(dayKey)
  const [query, setQuery] = useState('')
  const [reading, setReading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [revision, setRevision] = useState(0)
  const [remove, setRemove] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const deletingRef = useRef(false)
  const dirty = useRef(new Map<string, Note>())
  const activeSave = useRef<Promise<boolean> | null>(null)
  const editor = useRef<HTMLTextAreaElement>(null)
  const current = notes.find(n => n.id === selected)
  const visible = useMemo(() => notes.filter(n => (!day || n.day === day) && plain(n.content).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a,b) => b.day.localeCompare(a.day) || b.createdAt.localeCompare(a.createdAt)), [notes, day, query])
  const days = [...new Set(notes.map(n => n.day))].sort().reverse()

  async function load() {
    setError('')
    try { setNotes(await bridge.request<Note[]>('markpad.list')); setLoaded(true) }
    catch (e) { setError(String(e)) }
  }
  useEffect(() => {
    const off = bridge.on<{ locale: string }>('locale', p => setLocale(p.locale))
    bridge.ready(); void load()
    return off
  }, [])

  function flush(): Promise<boolean> {
    if (activeSave.current) return activeSave.current
    if (deletingRef.current) return Promise.resolve(false)
    if (!dirty.current.size) return Promise.resolve(true)
    const work = async () => {
      setSaving(true)
      try {
        while (dirty.current.size) {
          const note = dirty.current.values().next().value!
          const saved = await bridge.request<{ updatedAt: string }>('markpad.save', note)
          if (dirty.current.get(note.id) === note) dirty.current.delete(note.id)
          setNotes(all => all.map(n => n.id === note.id ? { ...n, updatedAt: saved.updatedAt } : n))
        }
        setError(''); return true
      } catch (e) { setError(String(e)); return false }
      finally { setSaving(false); activeSave.current = null }
    }
    activeSave.current = work()
    return activeSave.current
  }
  useEffect(() => {
    if (!dirty.current.size) return
    const timer = window.setTimeout(() => { void flush() }, 700)
    return () => window.clearTimeout(timer)
  }, [revision])
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden' && dirty.current.size) void flush() }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [])

  function change(content: string) {
    if (!current) return
    const next = { ...current, content }
    dirty.current.set(next.id, next)
    setNotes(all => all.map(n => n.id === next.id ? next : n))
    setRevision(r => r + 1)
  }
  function add() {
    const existing = notes.find(n => !n.content && !dirty.current.has(n.id))
    const now = new Date().toISOString()
    const note = existing ?? { id: crypto.randomUUID(), day: day || dayKey(), content: '', createdAt: now, updatedAt: now }
    if (!existing) setNotes(all => [note, ...all])
    setSelected(note.id); setDay(note.day); setQuery(''); setReading(false)
    window.setTimeout(() => editor.current?.focus(), 0)
  }
  function bold() {
    const el = editor.current
    if (!el || !current) return
    const start = el.selectionStart, end = el.selectionEnd
    const text = current.content.slice(start, end)
    const wrapped = text.startsWith('**') && text.endsWith('**') && text.length > 4
    const replacement = wrapped ? text.slice(2,-2) : `**${text || t('加粗文字','bold text')}**`
    change(current.content.slice(0,start) + replacement + current.content.slice(end))
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + (wrapped ? 0 : 2), start + replacement.length - (wrapped ? 0 : 2)) })
  }
  async function deleteNote() {
    if (!current) return
    setDeleting(true)
    deletingRef.current = true
    // Drain in-flight writes before deleting, so a late save cannot recreate the note.
    if (activeSave.current) await activeSave.current
    try {
      await bridge.request('markpad.delete', { id: current.id })
      dirty.current.delete(current.id)
      setNotes(all => all.filter(n => n.id !== current.id)); setSelected(''); setRemove(false); setError('')
    } catch (e) { setError(String(e)) }
    finally { setDeleting(false); deletingRef.current = false; setRevision(r => r + 1) }
  }
  return <PluginPage className="markpad" toolbar={<PageToolbar actions={<Button variant="primary" disabled={!loaded} onClick={add}><Plus size={16}/>{t('写一条','New note')}</Button>}><div><h1>MarkPad</h1><span className="markpad-muted">{t('随手记下，慢慢回看。','Capture a thought. Return to it later.')}</span></div></PageToolbar>}>
    {error && <Status tone="error">{error} <Button onClick={() => { void (loaded ? flush() : load()) }}>{t('重试','Retry')}</Button>{loaded && t(' 未保存内容仍保留在当前页面。',' Unsaved text is still on this page.')}</Status>}
    {!loaded ? <Status>{t('正在载入随笔…','Loading notes…')}</Status> : <SplitPane aside={<div className="markpad-sidebar">
      <label className="markpad-search"><Search size={16}/><Input aria-label={t('搜索随笔','Search notes')} placeholder={t('搜索随笔内容…','Search notes…')} value={query} onChange={e => { setQuery(e.target.value); setDay('') }}/></label>
      <div className="markpad-filters"><Input type="date" aria-label={t('记录日期','Note date')} value={day} onChange={e => setDay(e.target.value)}/><Button aria-pressed={day === dayKey()} onClick={() => setDay(dayKey())}>{t('今天','Today')}</Button><Button aria-pressed={!day} onClick={() => setDay('')}>{t('全部','All')}</Button></div>
      <details><summary>{t('有记录的日期','Dates with notes')} · {days.length}</summary><div className="markpad-days">{days.map(d => <Button key={d} aria-pressed={day === d} onClick={() => setDay(d)}>{d} · {notes.filter(n => n.day === d).length}</Button>)}</div></details>
      <span className="markpad-muted" role="status">{day || t('全部日期','All dates')} · {visible.length} {t('条记录','notes')}</span>
      <div className="markpad-list">{visible.map(n => <Button className="markpad-note" key={n.id} aria-pressed={selected === n.id} onClick={() => { setSelected(n.id); setReading(false) }}><span className="markpad-note-title">{plain(n.content).split('\n').find(line => line.trim()) || t('新的随笔','New note')}</span><span className="markpad-excerpt">{plain(n.content).slice(0,120) || t('从一个想法开始…','Start with a thought…')}</span><span className="markpad-muted">{n.day} · {new Date(n.createdAt).toLocaleTimeString(locale, { hour:'2-digit', minute:'2-digit' })}{dirty.current.has(n.id) ? ' · •' : ''}</span></Button>)}</div>
      {!visible.length && <EmptyState title={t('暂无记录','No notes')} description={query ? t('试试其他关键词或日期。','Try another keyword or date.') : t('写下今天的第一条想法。','Write your first thought for the day.')}/>}
    </div>}>
      <Card className="markpad-editor">{current ? <><div className="markpad-editor-head"><div><strong>{current.day}</strong><span className="markpad-muted" aria-live="polite">{saving ? t('正在保存…','Saving…') : dirty.current.has(current.id) ? t('尚未保存','Unsaved') : current.content ? t('已保存到本地','Saved locally') : t('开始输入后自动保存','Autosaves when you type')}</span></div><div className="markpad-actions"><Button aria-pressed={reading} onClick={() => setReading(!reading)}>{reading ? <Pencil size={16}/> : <BookOpen size={16}/>} {reading ? t('编辑','Edit') : t('阅读','Read')}</Button><Button aria-label={t('删除随笔','Delete note')} onClick={() => setRemove(true)}><Trash2 size={16}/></Button></div></div>
      {reading ? <Reading content={current.content}/> : <><div className="markpad-actions"><Button aria-label={t('加粗 (Ctrl+B)','Bold (Ctrl+B)')} onMouseDown={e => e.preventDefault()} onClick={bold}><Bold size={16}/></Button><span className="markpad-muted">{t('选中文字加粗 · Ctrl / ⌘ + B','Select text to bold · Ctrl / ⌘ + B')}</span></div><Textarea ref={editor} className="markpad-textarea" aria-label={t('随笔内容','Note content')} placeholder={t('此刻，有什么想记下来？','What would you like to remember?')} value={current.content} maxLength={50000} disabled={remove} onChange={e => change(e.target.value)} onKeyDown={e => { if (e.nativeEvent.isComposing) return; if ((e.ctrlKey || e.metaKey) && ['b','s'].includes(e.key.toLowerCase())) { e.preventDefault(); if(e.key.toLowerCase() === 'b') bold(); else void flush() } }}/></>}
      <div className="markpad-footer"><span className="markpad-muted">{plain(current.content).length} / 50000 {t('字符','characters')}</span><Button disabled={saving || !dirty.current.size || remove} onClick={() => void flush()}>{t('保存','Save')}</Button></div></> : <EmptyState icon={<Pencil/>} title={t('留一点空间给想法','Make room for a thought')} description={t('选择一条记录回顾，或开始新的随笔。','Choose a note to revisit, or start a new one.')} action={<Button onClick={add}>{t('写一条随笔','Write a note')}</Button>}/>}</Card>
    </SplitPane>}
    <Dialog open={remove} onClose={() => { if (!deleting) setRemove(false) }} aria-label={t('删除随笔','Delete note')}><h2>{t('删除这条随笔？','Delete this note?')}</h2><p>{t('删除后无法恢复。','This cannot be undone.')}</p><div className="markpad-actions"><Button disabled={deleting} onClick={() => setRemove(false)}>{t('取消','Cancel')}</Button><Button variant="danger" disabled={deleting} onClick={() => void deleteNote()}>{t('删除','Delete')}</Button></div></Dialog>
  </PluginPage>
}
