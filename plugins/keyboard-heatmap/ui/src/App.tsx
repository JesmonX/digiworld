import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Download, Flame, Keyboard, Pause, Play, RotateCcw, Upload } from 'lucide-react'
import { createPluginBridge } from '@digiworld/plugin-sdk'
import {
  formatKeyLabel, getKeyboardLayout, keyboardLayouts, layoutKeys, type KeyboardLayoutId, type KeyDefinition,
} from './keyboard'
import './styles.css'

const PLUGIN_ID = 'io.github.jesmonx.digiworld.keyboard-heatmap'
const bridge = createPluginBridge(PLUGIN_ID)

interface RankingEntry { key: string; count: number }
interface Snapshot {
  scope: 'today' | 'all'
  paused: boolean
  total: number
  uniqueKeys: number
  topKey: string | null
  counts: Record<string, number>
  topTen: RankingEntry[]
}
interface ExportPayload { content: string; filename: string; mime: string }

export default function App() {
  const [scope, setScope] = useState<'today' | 'all'>('today')
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [layoutId, setLayoutId] = useState<KeyboardLayoutId>('full')
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const importInput = useRef<HTMLInputElement>(null)
  const layoutPickerRef = useRef<HTMLDivElement>(null)
  const layoutTriggerRef = useRef<HTMLButtonElement>(null)

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await bridge.request<Snapshot>('heatmap.snapshot', { scope }))
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [scope])

  useEffect(() => {
    bridge.ready()
    void refresh()
    const interval = window.setInterval(refresh, 2000)
    return () => window.clearInterval(interval)
  }, [refresh])

  useEffect(() => {
    bridge.request<{ layout: KeyboardLayoutId }>('heatmap.getLayout')
      .then(value => setLayoutId(value.layout))
      .catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
  }, [])

  useEffect(() => {
    if (!layoutMenuOpen) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!layoutPickerRef.current?.contains(event.target as Node)) setLayoutMenuOpen(false)
    }
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setLayoutMenuOpen(false)
      layoutTriggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [layoutMenuOpen])

  const layout = getKeyboardLayout(layoutId)
  const visibleKeys = useMemo(() => layoutKeys(layout), [layout])
  const maxCount = useMemo(() => Math.max(0, ...visibleKeys.map(key => snapshot?.counts[key.id] ?? 0)), [snapshot, visibleKeys])

  const selectLayout = async (next: KeyboardLayoutId) => {
    const previous = layoutId
    setLayoutMenuOpen(false)
    layoutTriggerRef.current?.focus()
    setLayoutId(next)
    try {
      await bridge.request('heatmap.setLayout', { layout: next })
      setError(null)
    } catch (reason) {
      setLayoutId(previous)
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const togglePause = async () => {
    if (!snapshot) return
    await bridge.request('heatmap.setPaused', { paused: !snapshot.paused })
    await refresh()
  }

  const clear = async () => {
    if (!window.confirm(scope === 'today' ? '清除今天的统计？' : '清除全部统计？此操作不可撤销。')) return
    await bridge.request('heatmap.clear', { scope })
    await refresh()
  }

  const exportData = async (format: 'json' | 'csv') => {
    const data = await bridge.request<ExportPayload>('heatmap.export', { format })
    const url = URL.createObjectURL(new Blob([data.content], { type: data.mime }))
    const link = document.createElement('a')
    link.href = url
    link.download = data.filename
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
  }

  const importData = async (file: File) => {
    const mode = window.confirm('合并备份？选择“取消”将替换现有数据。') ? 'merge' : 'replace'
    await bridge.request('heatmap.import', { content: await file.text(), mode })
    await refresh()
  }

  return (
    <div className="heatmap-app">
      <header className="plugin-header">
        <div className="summary-line" aria-label="键盘统计摘要">
          <div><span>总次数</span><strong>{(snapshot?.total ?? 0).toLocaleString()}</strong></div>
          <div><Flame /><span>最高频</span><strong>{snapshot?.topKey ?? '—'}</strong></div>
        </div>
        <div className="header-actions">
          <div className="scope-toggle" role="group" aria-label="统计时间范围"><button aria-pressed={scope === 'today'} className={scope === 'today' ? 'active' : ''} onClick={() => setScope('today')}>今天</button><button aria-pressed={scope === 'all'} className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>全部</button></div>
          <button className={`pause-button ${snapshot?.paused ? 'paused' : ''}`} onClick={() => void togglePause()}>{snapshot?.paused ? <Play /> : <Pause />}{snapshot?.paused ? '继续' : '暂停'}</button>
        </div>
      </header>

      {error && <div className="plugin-error">{error}</div>}

      <section className="keyboard-card">
        <div className="layout-picker" ref={layoutPickerRef}>
          <button
            ref={layoutTriggerRef}
            type="button"
            className="layout-picker-trigger"
            aria-haspopup="menu"
            aria-expanded={layoutMenuOpen}
            aria-controls="keyboard-layout-menu"
            onClick={() => setLayoutMenuOpen(open => !open)}
          >
            <span className="layout-preview" aria-hidden="true">{layout.preview.map((row, rowIndex) => <i key={rowIndex}>{row.map((width, index) => <b key={index} style={{ flex: width }} />)}</i>)}</span>
            <span className="layout-picker-copy"><strong>{layout.label}</strong><small>键盘尺寸</small></span>
            <ChevronDown aria-hidden="true" />
          </button>
          <div id="keyboard-layout-menu" className={`layout-menu ${layoutMenuOpen ? 'open' : ''}`} role="menu" aria-label="键盘尺寸选项" aria-hidden={!layoutMenuOpen}>
            {keyboardLayouts.map(option => <button key={option.id} type="button" role="menuitemradio" aria-checked={layoutId === option.id} className={layoutId === option.id ? 'active' : ''} onClick={() => void selectLayout(option.id)}>
              <span className="layout-preview" aria-hidden="true">{option.preview.map((row, rowIndex) => <i key={rowIndex}>{row.map((width, index) => <b key={index} style={{ flex: width }} />)}</i>)}</span>
              <span><strong>{option.label}</strong><small>{option.id === 'full' ? '全尺寸' : option.id === 'tkl' ? 'TKL' : `${option.id}%`}</small></span>
              {layoutId === option.id && <Check aria-hidden="true" />}
            </button>)}
          </div>
        </div>
        <div className="keyboard-scroll" style={{ '--board-min-width': `${layout.minWidth}px` } as React.CSSProperties}>
          <div className="board-toolbar">
            <div><h2><Keyboard />按键分布</h2></div>
            <div className="legend"><span>低</span>{[.08, .22, .42, .68, 1].map(value => <i key={value} style={{ '--heat': value } as React.CSSProperties} />)}<span>高</span></div>
          </div>
          <div className={`keyboard-board layout-${layout.id}`}>
            {layout.functionRow.length > 0 && <><div className="function-row-layout"><KeyboardRow keys={layout.functionRow} counts={snapshot?.counts ?? {}} max={maxCount} /></div><div className="keyboard-gap" /></>}
            <div className={`keyboard-sections ${layout.numpadKeys.length ? '' : 'without-numpad'} ${layout.navRows.length ? '' : 'without-nav'}`}>
              <div className="alpha-section">{layout.alphaRows.map((row, index) => <KeyboardRow key={index} keys={row} counts={snapshot?.counts ?? {}} max={maxCount} />)}</div>
              {layout.navRows.length > 0 && <div className="nav-section">{layout.navRows.map((row, index) => <KeyboardRow key={index} className={index === 3 ? 'arrow-up-row' : ''} keys={row} counts={snapshot?.counts ?? {}} max={maxCount} />)}</div>}
              {layout.numpadKeys.length > 0 && <div className="numpad-section">{layout.numpadKeys.map(key => <Keycap key={key.id} definition={key} count={snapshot?.counts[key.id] ?? 0} max={maxCount} grid />)}</div>}
            </div>
          </div>
        </div>
      </section>

      <section className="lower-grid">
        <article className="ranking-card">
          <h2>高频键位</h2>
          <div className="ranking-list">
            {snapshot?.topTen.length
              ? snapshot.topTen.map((entry, index) => <div key={entry.key}><b>{index + 1}</b><span>{formatKeyLabel(entry.key)}</span><i><em style={{ width: `${(entry.count / (snapshot.topTen[0]?.count || 1)) * 100}%` }} /></i><strong>{entry.count.toLocaleString()}</strong></div>)
              : <p className="no-data">暂无数据</p>}
          </div>
        </article>
        <article className="data-card">
          <h2>数据管理</h2>
          <div className="data-actions">
            <button onClick={() => void exportData('json')}><Download />JSON 备份</button>
            <button onClick={() => void exportData('csv')}><Download />CSV</button>
            <button onClick={() => importInput.current?.click()}><Upload />导入</button>
            <button className="danger" onClick={() => void clear()}><RotateCcw />清除数据</button>
          </div>
          <input ref={importInput} type="file" accept="application/json,.json" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void importData(file); event.currentTarget.value = '' }} />
        </article>
      </section>
    </div>
  )
}

function KeyboardRow({ keys, counts, max, className = '' }: { keys: KeyDefinition[]; counts: Record<string, number>; max: number; className?: string }) {
  return <div className={`key-row ${className}`}>{keys.map(key => <Keycap key={key.id} definition={key} count={counts[key.id] ?? 0} max={max} />)}</div>
}

function Keycap({ definition, count, max, grid = false }: { definition: KeyDefinition; count: number; max: number; grid?: boolean }) {
  const heat = max > 0 ? Math.log1p(count) / Math.log1p(max) : 0
  const style = grid
    ? { gridRow: `${definition.row} / span ${definition.rowSpan ?? 1}`, gridColumn: `${definition.column} / span ${definition.columnSpan ?? 1}`, '--heat': heat }
    : { '--width': definition.width ?? 1, '--spacer': definition.spacer ?? 0, '--heat': heat }
  return (
    <div className={`key ${count > 0 ? 'has-count' : ''} ${heat >= .58 ? 'strong-heat' : ''}`} title={`${definition.id}: ${count.toLocaleString()} 次`} aria-label={`${definition.label || definition.id}，${count.toLocaleString()} 次`} style={style as React.CSSProperties}>
      <span>{definition.label}</span>
      {count > 0 && <small>{count > 999 ? `${(count / 1000).toFixed(1)}k` : count}</small>}
    </div>
  )
}
