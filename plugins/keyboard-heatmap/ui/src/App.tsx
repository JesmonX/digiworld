import { Button, Card, Menu, Status } from '@digiworld/design-system/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Flame, Keyboard, Pause, Play } from 'lucide-react'
import { createPluginBridge } from '@digiworld/plugin-sdk'
import {
  formatKeyLabel, getKeyboardLayout, heatLevel, keyboardLayouts, layoutKeys, type KeyboardLayoutId, type KeyDefinition,
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
export default function App() {
  const [scope, setScope] = useState<'today' | 'all'>('today')
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [layoutId, setLayoutId] = useState<KeyboardLayoutId>('full')
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
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

  return (
    <div className="heatmap-app">
      <header className="dw-toolbar plugin-header">
        <div className="summary-line" aria-label="键盘统计摘要">
          <div><span>总次数</span><strong>{(snapshot?.total ?? 0).toLocaleString()}</strong></div>
          <div><Flame /><span>最高频</span><strong>{snapshot?.topKey ?? '—'}</strong></div>
        </div>
        <div className="header-actions">
          <div className="dw-segmented scope-toggle" role="group" aria-label="统计时间范围"><Button aria-pressed={scope === 'today'} className={scope === 'today' ? 'active' : ''} onClick={() => setScope('today')}>今天</Button><Button aria-pressed={scope === 'all'} className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>全部</Button></div>
          <Button className={`pause-button ${snapshot?.paused ? 'paused' : ''}`} onClick={() => void togglePause()}>{snapshot?.paused ? <Play /> : <Pause />}{snapshot?.paused ? '继续' : '暂停'}</Button>
        </div>
      </header>

      {error && <Status tone="error" className="plugin-error">{error}</Status>}

      <section className="dw-card keyboard-card">
        <div className="layout-picker" ref={layoutPickerRef}>
          <Button
            ref={layoutTriggerRef}
            type="button"
            className="layout-picker-trigger"
            aria-haspopup="menu"
            aria-expanded={layoutMenuOpen}
            aria-controls="keyboard-layout-menu"
            onClick={() => setLayoutMenuOpen(open => !open)}
          >
            <span className="layout-preview" aria-hidden="true">{layout.preview.map((row, rowIndex) => <i key={rowIndex}>{row.map((width, index) => <b key={index} style={{ flex: width }} />)}</i>)}</span>
            <span className="layout-picker-copy"><strong>{layout.label}</strong></span>
            <ChevronDown aria-hidden="true" />
          </Button>
          <Menu id="keyboard-layout-menu" className={`layout-menu ${layoutMenuOpen ? 'open' : ''}`} role="menu" aria-label="键盘尺寸选项" aria-hidden={!layoutMenuOpen}>
            {keyboardLayouts.map(option => <Button key={option.id} type="button" role="menuitemradio" aria-checked={layoutId === option.id} className={layoutId === option.id ? 'active' : ''} onClick={() => void selectLayout(option.id)}>
              <span className="layout-preview" aria-hidden="true">{option.preview.map((row, rowIndex) => <i key={rowIndex}>{row.map((width, index) => <b key={index} style={{ flex: width }} />)}</i>)}</span>
              <span><strong>{option.label}</strong><small>{option.id === 'full' ? '全尺寸' : option.id === 'tkl' ? 'TKL' : `${option.id}%`}</small></span>
              {layoutId === option.id && <Check aria-hidden="true" />}
            </Button>)}
          </Menu>
        </div>
        <div className="keyboard-scroll" style={{ '--board-min-width': `${layout.minWidth}px` } as React.CSSProperties}>
          <div className="board-toolbar">
            <div><h2><Keyboard />按键分布</h2></div>
            <div className="legend"><span>低</span>{[1, 2, 3, 4, 5].map(level => <i key={level} className={`level-${level}`} />)}<span>高</span></div>
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
        <Card className="dw-card ranking-card">
          <h2>高频键位</h2>
          <div className="ranking-list">
            {snapshot?.topTen.length
              ? snapshot.topTen.map((entry, index) => <div key={entry.key}><b>{index + 1}</b><span>{formatKeyLabel(entry.key)}</span><i><em style={{ width: `${(entry.count / (snapshot.topTen[0]?.count || 1)) * 100}%` }} /></i><strong>{entry.count.toLocaleString()}</strong></div>)
              : <p className="no-data">暂无数据</p>}
          </div>
        </Card>
      </section>
    </div>
  )
}

function KeyboardRow({ keys, counts, max, className = '' }: { keys: KeyDefinition[]; counts: Record<string, number>; max: number; className?: string }) {
  return <div className={`key-row ${className}`}>{keys.map(key => <Keycap key={key.id} definition={key} count={counts[key.id] ?? 0} max={max} />)}</div>
}

function Keycap({ definition, count, max, grid = false }: { definition: KeyDefinition; count: number; max: number; grid?: boolean }) {
  const level = heatLevel(count, max)
  const style = grid
    ? { gridRow: `${definition.row} / span ${definition.rowSpan ?? 1}`, gridColumn: `${definition.column} / span ${definition.columnSpan ?? 1}` }
    : { '--width': definition.width ?? 1, '--spacer': definition.spacer ?? 0 }
  return (
    <div className={`key level-${level} ${count > 0 ? 'has-count' : ''} ${level >= 3 ? 'strong-heat' : ''}`} title={`${definition.id}: ${count.toLocaleString()} 次`} aria-label={`${definition.label || definition.id}，${count.toLocaleString()} 次`} style={style as React.CSSProperties}>
      <span>{definition.label}</span>
      {count > 0 && <small>{count > 999 ? `${(count / 1000).toFixed(1)}k` : count}</small>}
    </div>
  )
}
