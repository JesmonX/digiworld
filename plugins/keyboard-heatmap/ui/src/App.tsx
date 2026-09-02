import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Clock3, Download, Flame, Keyboard, Pause, Play, RotateCcw, Upload } from 'lucide-react'
import { createPluginBridge } from '@digiworld/plugin-sdk'
import { alphaRows, functionRow, navRows, numpadRows, type KeyDefinition } from './keyboard'
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
  const [error, setError] = useState<string | null>(null)
  const [privacyOpen, setPrivacyOpen] = useState(true)
  const importInput = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    try { setSnapshot(await bridge.request<Snapshot>('heatmap.snapshot', { scope })); setError(null) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }, [scope])

  useEffect(() => {
    bridge.ready()
    void bridge.request<{ accepted: boolean }>('heatmap.privacyStatus').then(result => setPrivacyOpen(!result.accepted))
    void refresh()
    const interval = window.setInterval(refresh, 2000)
    return () => window.clearInterval(interval)
  }, [refresh])

  const maxCount = useMemo(() => Math.max(0, ...Object.values(snapshot?.counts ?? {})), [snapshot])
  const togglePause = async () => {
    if (!snapshot) return
    await bridge.request('heatmap.setPaused', { paused: !snapshot.paused })
    await refresh()
  }
  const clear = async () => {
    if (!window.confirm(scope === 'today' ? '清除今天的全部键盘统计？' : '清除全部历史键盘统计？此操作不可撤销。')) return
    await bridge.request('heatmap.clear', { scope })
    await refresh()
  }
  const exportData = async (format: 'json' | 'csv') => {
    const data = await bridge.request<ExportPayload>('heatmap.export', { format })
    const url = URL.createObjectURL(new Blob([data.content], { type: data.mime }))
    const link = document.createElement('a'); link.href = url; link.download = data.filename; link.click()
    URL.revokeObjectURL(url)
  }
  const importData = async (file: File) => {
    const mode = window.confirm('点击“确定”将合并备份；点击“取消”将替换现有数据。替换前会自动备份。') ? 'merge' : 'replace'
    await bridge.request('heatmap.import', { content: await file.text(), mode })
    await refresh()
  }
  const acceptPrivacy = async () => {
    await bridge.request('heatmap.acceptPrivacy')
    setPrivacyOpen(false)
  }

  return <div className="heatmap-app">
    <header className="plugin-header">
      <div><p>PHYSICAL KEY ACTIVITY</p><h1>键盘热力图</h1><span>只统计实体键位次数，不保存输入内容或顺序</span></div>
      <div className="header-actions">
        <div className="scope-toggle"><button className={scope === 'today' ? 'active' : ''} onClick={() => setScope('today')}>今天</button><button className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>全部</button></div>
        <button className={`pause-button ${snapshot?.paused ? 'paused' : ''}`} onClick={togglePause}>{snapshot?.paused ? <Play /> : <Pause />}{snapshot?.paused ? '继续' : '暂停'}</button>
      </div>
    </header>

    {error && <div className="plugin-error">{error}</div>}
    <section className="metrics">
      <Metric icon={<Activity />} label="总按键次数" value={(snapshot?.total ?? 0).toLocaleString()} accent />
      <Metric icon={<Flame />} label="最高频键" value={snapshot?.topKey ?? '—'} />
      <Metric icon={<Keyboard />} label="活跃键位" value={String(snapshot?.uniqueKeys ?? 0)} suffix="/ 104" />
      <Metric icon={<Clock3 />} label="统计范围" value={scope === 'today' ? '今天' : '全部时间'} />
    </section>

    <section className="keyboard-card">
      <div className="card-heading"><div><h2>实体键位分布</h2><p>颜色越亮，使用频率越高；悬停查看准确次数</p></div><div className="legend"><span>低</span>{[.08,.22,.42,.68,1].map(value => <i key={value} style={{ '--heat': value } as React.CSSProperties} />)}<span>高</span></div></div>
      <div className="keyboard-board">
        <KeyboardRow keys={functionRow} counts={snapshot?.counts ?? {}} max={maxCount} />
        <div className="keyboard-gap" />
        <div className="keyboard-sections">
          <div className="alpha-section">{alphaRows.map((row, index) => <KeyboardRow key={index} keys={row} counts={snapshot?.counts ?? {}} max={maxCount} />)}</div>
          <div className="nav-section">{navRows.map((row, index) => <KeyboardRow key={index} keys={row} counts={snapshot?.counts ?? {}} max={maxCount} />)}</div>
          <div className="numpad-section">{numpadRows.map((row, index) => <KeyboardRow key={index} keys={row} counts={snapshot?.counts ?? {}} max={maxCount} />)}</div>
        </div>
      </div>
    </section>

    <section className="lower-grid">
      <article className="ranking-card"><div className="card-heading"><div><h2>高频键位</h2><p>当前范围 Top 10</p></div></div><div className="ranking-list">{snapshot?.topTen.length ? snapshot.topTen.map((entry, index) => <div key={entry.key}><b>{String(index + 1).padStart(2, '0')}</b><span>{entry.key}</span><i><em style={{ width: `${(entry.count / (snapshot.topTen[0]?.count || 1)) * 100}%` }} /></i><strong>{entry.count.toLocaleString()}</strong></div>) : <p className="no-data">敲几个键后，这里会出现排行</p>}</div></article>
      <article className="data-card"><div className="card-heading"><div><h2>数据管理</h2><p>数据仅存储在本机插件目录</p></div></div><div className="data-actions"><button onClick={() => exportData('json')}><Download />导出 JSON 备份</button><button onClick={() => exportData('csv')}><Download />导出 CSV</button><button onClick={() => importInput.current?.click()}><Upload />导入 JSON 备份</button><button className="danger" onClick={clear}><RotateCcw />清除{scope === 'today' ? '今天' : '全部'}数据</button></div><input ref={importInput} type="file" accept="application/json,.json" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void importData(file); event.currentTarget.value = '' }} /></article>
    </section>

    {privacyOpen && <div className="privacy-overlay"><div className="privacy-dialog"><div className="privacy-icon"><Keyboard /></div><p>PRIVACY FIRST</p><h2>启用全局键位统计</h2><span>Digiworld 可能在密码框获得键位通知，但只会增加对应实体键的聚合计数。不会保存字符、顺序、组合键、应用名称、窗口标题或设备身份。</span><ul><li>仅保存每日键位总数</li><li>数据留在本机</li><li>随时暂停、导出或清除</li></ul><button onClick={() => void acceptPrivacy()}>我已了解，开始统计</button></div></div>}
  </div>
}

function Metric({ icon, label, value, suffix, accent }: { icon: React.ReactNode; label: string; value: string; suffix?: string; accent?: boolean }) {
  return <article className={`metric ${accent ? 'accent' : ''}`}><div>{icon}<span>{label}</span></div><strong>{value}<small>{suffix}</small></strong></article>
}

function KeyboardRow({ keys, counts, max }: { keys: KeyDefinition[]; counts: Record<string, number>; max: number }) {
  return <div className="key-row">{keys.map((key, index) => {
    const count = counts[key.id] ?? 0
    const heat = max > 0 ? Math.log1p(count) / Math.log1p(max) : 0
    return <div key={`${key.id}-${index}`} className="key" title={`${key.id}: ${count.toLocaleString()} 次`} style={{ '--width': key.width ?? 1, '--spacer': key.spacer ?? 0, '--heat': heat } as React.CSSProperties}><span>{key.label}</span>{count > 0 && <small>{count > 999 ? `${(count / 1000).toFixed(1)}k` : count}</small>}</div>
  })}</div>
}
