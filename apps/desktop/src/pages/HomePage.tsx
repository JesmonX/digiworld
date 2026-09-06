import React from 'react'
import { Button, Card } from '@digiworld/design-system/react'
import { motion } from 'framer-motion'
import {
  Activity, AlertTriangle, Boxes, ChevronRight, Gauge, Library, RefreshCw, ShieldCheck,
} from 'lucide-react'
import type { PluginSummary } from '@digiworld/plugin-sdk'
import { PluginIcon } from '../components/PluginIcon'
import { stateLabel } from '../components/plugin/PluginManagement'

export function SummaryCard({ label, value, detail, icon, tone = 'accent' }: { label: string; value: string | number; detail: string; icon: React.ReactNode; tone?: 'accent' | 'success' | 'warning' | 'neutral' }) {
  return <Card className={`summary-card ${tone}`}><span className="summary-card-icon">{icon}</span><div><small>{label}</small><strong>{value}</strong><span>{detail}</span></div></Card>
}

export function HomePage({
  plugins,
  version,
  onCatalog,
  onOpen,
  onRefresh,
  reducedMotion,
}: {
  plugins: PluginSummary[]
  version: string | undefined
  onCatalog(): void
  onOpen(id: string): void
  onRefresh(): void
  reducedMotion: boolean
}) {
  if (plugins.length === 0) return (
    <div className="empty-state">
      <div className="empty-icon"><Boxes /></div>
      <h2>还没有安装功能</h2>
      <p>从功能库选择需要的工具。</p>
      <Button className="primary" onClick={onCatalog}>浏览功能库 <ChevronRight /></Button>
    </div>
  )

  const running = plugins.filter(plugin => plugin.state === 'running').length
  const attention = plugins.filter(plugin => plugin.enabled && plugin.state === 'failed').length
  const healthy = attention === 0
  return (
    <div className="home-dashboard">
      <div className="home-intro">
        <div>
          <span className="eyebrow"><Activity />数字工作台</span>
          <h2>你的功能，都在这里</h2>
          <p>{healthy ? '当前没有停用或异常功能。' : `${attention} 个功能需要你的注意。`}</p>
        </div>
        <div className={`health-pill ${healthy ? 'healthy' : 'attention'}`}><span />{healthy ? '运行稳定' : '需要关注'}</div>
      </div>
      <div className="dashboard-summary" aria-label="Digiworld 状态摘要">
        <SummaryCard label="已安装" value={plugins.length} detail="个功能" icon={<Boxes />} tone="accent" />
        <SummaryCard label="运行中" value={running} detail={`共 ${plugins.length} 个`} icon={<Gauge />} tone="success" />
        <SummaryCard label="需关注" value={attention} detail={attention ? '请查看状态' : '暂无异常'} icon={attention ? <AlertTriangle /> : <ShieldCheck />} tone={attention ? 'warning' : 'success'} />
        <SummaryCard label="当前版本" value={version ?? '—'} detail="Digiworld" icon={<ShieldCheck />} tone="neutral" />
      </div>
      <div className="section-heading installed-heading">
        <div><span className="section-kicker">你的工作台</span><h2>已安装功能</h2></div>
        <Button className="secondary" onClick={onCatalog}><Library />添加功能</Button>
      </div>
      <div className="installed-list">
        {plugins.map((plugin, index) => (
          <motion.button
            key={plugin.id}
            className="plugin-row"
            onClick={() => onOpen(plugin.id)}
            initial={reducedMotion ? false : { opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reducedMotion ? { duration: 0 } : { delay: index * .035, duration: .18 }}
          >
            <span className="row-icon"><PluginIcon plugin={plugin} /></span>
            <span className="plugin-row-copy">
              <span className="plugin-row-heading"><strong>{plugin.name}</strong><ChevronRight className="row-chevron" /></span>
              <small>{plugin.description || '打开以查看功能'}</small>
            </span>
            <span className={`compact-status ${plugin.state}`}>{stateLabel(plugin)}</span>
            {plugin.uiDesignVersion !== 1 && <small className="legacy-design">浅色兼容 · 待适配新外观</small>}
          </motion.button>
        ))}
      </div>
      <div className="quick-actions" aria-label="快捷操作">
        <span className="section-kicker">快捷操作</span>
        <div>
          <Button className="quick-action" onClick={onCatalog}><span><Library /></span><b>浏览功能库</b><ChevronRight /></Button>
          <Button className="quick-action" onClick={onRefresh}><span><RefreshCw /></span><b>刷新状态</b><ChevronRight /></Button>
        </div>
      </div>
    </div>
  )
}
