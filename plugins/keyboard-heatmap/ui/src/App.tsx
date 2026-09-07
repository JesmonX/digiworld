import { rovingDataKeyDown,  PluginPage, PageToolbar, Button, Card, Menu, Status } from '@digiworld/design-system/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Flame, Keyboard, Pause, Play } from 'lucide-react'
import { createPluginBridge } from '@digiworld/plugin-sdk'
import {
  formatKeyLabel, getKeyboardLayout, heatLevel, keyboardLayouts, layoutKeys, type KeyboardLayout, type KeyboardLayoutId, type KeyDefinition,
} from './keyboard'
import { t, type Locale } from './i18n'
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
  const [locale, setLocale] = useState<Locale>(() => {
    return (document.documentElement.lang?.startsWith('zh') ? 'zh' : 'en') as Locale
  })
  const [scope, setScope] = useState<'today' | 'all'>('today')
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [layoutId, setLayoutId] = useState<KeyboardLayoutId>('full')
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pauseBusy, setPauseBusy] = useState(false)
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

    const unlistenLocale = bridge.on('locale', (payload: unknown) => {
      const nextLocale = typeof payload === 'string' ? payload : (payload as { locale?: Locale })?.locale
      if (nextLocale === 'en' || nextLocale === 'zh') {
        setLocale(nextLocale)
      }
    })

    return () => {
      window.clearInterval(interval)
      if (typeof unlistenLocale === 'function') unlistenLocale()
    }
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
    if (!snapshot || pauseBusy) return
    setPauseBusy(true)
    try {
      await bridge.request('heatmap.setPaused', { paused: !snapshot.paused })
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setPauseBusy(false)
    }
  }

  const getLayoutLabel = (opt: KeyboardLayout) => {
    if (locale === 'en') {
      const map: Record<string, string> = { full: '104-Key', tkl: '87-Key', '75': '84-Key', '65': '68-Key', '60': '61-Key' }
      return map[opt.id] || opt.label
    }
    return opt.label
  }

  return (
    <PluginPage className="heatmap-app">
      <PageToolbar className=" plugin-header">
        <div className="summary-line" aria-label={t('summaryAria', locale)}>
          <div><span>{t('totalCount', locale)}</span><strong>{(snapshot?.total ?? 0).toLocaleString()}</strong></div>
          <div><Flame /><span>{t('topKey', locale)}</span><strong>{snapshot?.topKey ? formatKeyLabel(snapshot.topKey, locale) : '—'}</strong></div>
        </div>
        <div className="header-actions">
          <div className="dw-segmented scope-toggle" role="group" aria-label={t('scopeAria', locale)}>
            <Button aria-pressed={scope === 'today'} className={scope === 'today' ? 'active' : ''} onClick={() => setScope('today')}>{t('today', locale)}</Button>
            <Button aria-pressed={scope === 'all'} className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>{t('all', locale)}</Button>
          </div>
          <Button className={`pause-button ${snapshot?.paused ? 'paused' : ''}`} disabled={pauseBusy || !snapshot} onClick={() => void togglePause()}>
            {snapshot?.paused ? <Play /> : <Pause />}
            {pauseBusy ? t('processing', locale) : snapshot?.paused ? t('resume', locale) : t('pause', locale)}
          </Button>
        </div>
      </PageToolbar>

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
            <span className="layout-picker-copy"><strong>{getLayoutLabel(layout)}</strong></span>
            <ChevronDown aria-hidden="true" />
          </Button>
          <Menu id="keyboard-layout-menu" className={`layout-menu ${layoutMenuOpen ? 'open' : ''}`} role="menu" aria-label={t('layoutOptionsAria', locale)} aria-hidden={!layoutMenuOpen}>
            {keyboardLayouts.map(option => <Button key={option.id} type="button" role="menuitemradio" aria-checked={layoutId === option.id} className={layoutId === option.id ? 'active' : ''} onClick={() => void selectLayout(option.id)}>
              <span className="layout-preview" aria-hidden="true">{option.preview.map((row, rowIndex) => <i key={rowIndex}>{row.map((width, index) => <b key={index} style={{ flex: width }} />)}</i>)}</span>
              <span><strong>{getLayoutLabel(option)}</strong><small>{option.id === 'full' ? t('fullSize', locale) : option.id === 'tkl' ? 'TKL' : `${option.id}%`}</small></span>
              {layoutId === option.id && <Check aria-hidden="true" />}
            </Button>)}
          </Menu>
        </div>
        <div className="keyboard-scroll" tabIndex={0} aria-label={t('scrollAria', locale)} style={{ '--board-min-width': `${layout.minWidth}px` } as React.CSSProperties}>
          <div className="board-toolbar">
            <div><h2><Keyboard />{t('keyDistribution', locale)}</h2></div>
            <div className="legend"><span>{t('low', locale)}</span>{[1, 2, 3, 4, 5].map(level => <i key={level} className={`level-${level}`} />)}<span>{t('high', locale)}</span></div>
          </div>
          <div onKeyDown={event => rovingDataKeyDown(event)} className={`keyboard-board layout-${layout.id}`}>
            {layout.functionRow.length > 0 && <><div className="function-row-layout"><KeyboardRow keys={layout.functionRow} counts={snapshot?.counts ?? {}} max={maxCount} locale={locale} /></div><div className="keyboard-gap" /></>}
            <div className={`keyboard-sections ${layout.numpadKeys.length ? '' : 'without-numpad'} ${layout.navRows.length ? '' : 'without-nav'}`}>
              <div className="alpha-section">{layout.alphaRows.map((row, index) => <KeyboardRow key={index} keys={row} counts={snapshot?.counts ?? {}} max={maxCount} locale={locale} />)}</div>
              {layout.navRows.length > 0 && <div className="nav-section">{layout.navRows.map((row, index) => <KeyboardRow key={index} className={index === 3 ? 'arrow-up-row' : ''} keys={row} counts={snapshot?.counts ?? {}} max={maxCount} locale={locale} />)}</div>}
              {layout.numpadKeys.length > 0 && <div className="numpad-section">{layout.numpadKeys.map(key => <Keycap key={key.id} definition={key} count={snapshot?.counts[key.id] ?? 0} max={maxCount} grid locale={locale} />)}</div>}
            </div>
          </div>
        </div>
      </section>

      <section className="lower-grid">
        <Card className="dw-card ranking-card">
          <h2>{t('topKeys', locale)}</h2>
          <div className="ranking-list">
            {snapshot?.topTen.length
              ? snapshot.topTen.map((entry, index) => <div key={entry.key}><b>{index + 1}</b><span>{formatKeyLabel(entry.key, locale)}</span><i><em style={{ width: `${(entry.count / (snapshot.topTen[0]?.count || 1)) * 100}%` }} /></i><strong>{entry.count.toLocaleString()}</strong></div>)
              : <p className="no-data">{t('noData', locale)}</p>}
          </div>
        </Card>
      </section>
    </PluginPage>
  )
}

function KeyboardRow({ keys, counts, max, className = '', locale = 'en' }: { keys: KeyDefinition[]; counts: Record<string, number>; max: number; className?: string; locale?: Locale }) {
  return <div className={`key-row ${className}`}>{keys.map(key => <Keycap key={key.id} definition={key} count={counts[key.id] ?? 0} max={max} locale={locale} />)}</div>
}

function Keycap({ definition, count, max, grid = false, locale = 'en' }: { definition: KeyDefinition; count: number; max: number; grid?: boolean; locale?: Locale }) {
  const level = heatLevel(count, max)
  const style = grid
    ? { gridRow: `${definition.row} / span ${definition.rowSpan ?? 1}`, gridColumn: `${definition.column} / span ${definition.columnSpan ?? 1}` }
    : { '--width': definition.width ?? 1, '--spacer': definition.spacer ?? 0 }
  const label = formatKeyLabel(definition.id, locale)
  const countText = t('presses', locale).replace('{count}', count.toLocaleString())
  return (
    <div tabIndex={definition.id === 'Escape' ? 0 : -1} className={`key level-${level} ${count > 0 ? 'has-count' : ''} ${level >= 3 ? 'strong-heat' : ''}`} data-tooltip={`${definition.label || label} (${definition.id}): ${countText}`} aria-label={`${definition.label || label}, ${countText}`} style={style as React.CSSProperties}>
      <span>{definition.id === 'Backspace' ? 'Bksp' : definition.label || label}</span>
      {count > 0 && <small>{count > 999 ? `${(count / 1000).toFixed(1)}k` : count}</small>}
    </div>
  )
}
