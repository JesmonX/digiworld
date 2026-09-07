import { Button, Metric, MetricGrid, Panel, Section, EmptyState } from '@digiworld/design-system/react'
import { AlertTriangle, Boxes, ChevronRight, Gauge, Library, RefreshCw, ShieldCheck } from 'lucide-react'
import type { PluginSummary } from '@digiworld/plugin-sdk'
import { PluginIcon } from '../components/PluginIcon'
import { stateLabel } from '../components/PluginStatus'

export function HomePage({ plugins, onCatalog, onOpen, onRefresh }: { plugins: PluginSummary[]; version: string | undefined; onCatalog(): void; onOpen(id: string): void; onRefresh(): void; reducedMotion: boolean }) {
  if (plugins.length === 0) return <EmptyState icon={<Boxes />} title="还没有安装功能" description="从功能库选择需要的工具，建立你的本地工作台。" action={<Button variant="primary" onClick={onCatalog}>浏览功能库 <ChevronRight /></Button>} />
  const running = plugins.filter(plugin => plugin.state === 'running').length
  const attention = plugins.filter(plugin => plugin.state === 'failed').length
  return <div className="home-dashboard">
    <Panel className="workspace-summary" padding="lg">
      <MetricGrid aria-label="Digiworld 状态摘要">
        <div className="workspace-metric"><span><Boxes /></span><Metric label="已安装" value={plugins.length} unit="个功能" /></div>
        <div className="workspace-metric"><span><Gauge /></span><Metric label="运行中" value={running} hint={running === plugins.length ? '所有功能正在运行' : '其余功能状态见下方'} /></div>
        <div className="workspace-metric"><span>{attention ? <AlertTriangle /> : <ShieldCheck />}</span><Metric label="需关注" value={attention} hint={attention ? '请查看异常功能' : '暂无异常'} /></div>
      </MetricGrid>
    </Panel>
    <Panel padding="lg" className="workspace-tools">
      <Section title="已安装功能" description="选择工具，继续你的工作。" actions={<><Button onClick={onRefresh} aria-label="刷新状态"><RefreshCw />刷新</Button><Button variant="primary" onClick={onCatalog}><Library />添加功能</Button></>}>
        <div className="installed-list">
          {plugins.map(plugin => <button key={plugin.id} className="plugin-row" onClick={() => onOpen(plugin.id)}>
            <span className="row-icon"><PluginIcon plugin={plugin} /></span>
            <span className="plugin-row-copy"><span className="plugin-row-heading"><strong>{plugin.name}</strong><ChevronRight className="row-chevron" /></span><small>{plugin.description || '打开以查看功能'}</small></span>
            <span className={`compact-status ${plugin.state}`}>{stateLabel(plugin)}</span>
            {plugin.uiDesignVersion !== 1 && <small className="legacy-design">浅色兼容 · 待适配新外观</small>}
          </button>)}
        </div>
      </Section>
    </Panel>
  </div>
}
