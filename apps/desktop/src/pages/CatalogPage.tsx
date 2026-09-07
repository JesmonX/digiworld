import { Button, Panel } from '@digiworld/design-system/react'
import { ChevronRight, Download, LoaderCircle, RefreshCw } from 'lucide-react'
import type { CatalogIndex, CatalogPlugin, PluginSummary } from '@digiworld/plugin-sdk'
import { Loading } from '../components/Loading'
import { PluginIcon } from '../components/PluginIcon'

export function CatalogPage({ catalog, installed, busy, onInstall, onRefresh, onOpen, currentTarget }: { catalog: CatalogIndex | null; installed: Map<string, PluginSummary>; busy: string | null; onInstall(plugin: CatalogPlugin): void; onRefresh(): void; onOpen(id: string): void; currentTarget?: string | undefined }) {
  if (!catalog) return <Loading label="载入功能库" />
  return (
    <div>
      <div className="section-heading">
        <h2>可用功能</h2>
        <Button className="icon-button" aria-label="刷新功能库" title="刷新" onClick={onRefresh}><RefreshCw /></Button>
      </div>
      <div className="catalog-grid">
        {catalog.plugins.map(plugin => {
          const current = installed.get(plugin.id)
          const supported = Boolean(currentTarget && plugin.artifacts.some(artifact => artifact.target === currentTarget))
          return (
            <Panel padding="lg" className="catalog-card" key={plugin.id}>
              <div className="catalog-title"><span className="catalog-icon"><PluginIcon plugin={plugin} /></span><div className="catalog-version"><span className={`availability-dot ${current ? 'installed' : supported ? 'available' : 'unavailable'}`} /> <small>{current ? '已安装' : supported ? '可安装' : '暂未适配'}</small><small>v{plugin.version}</small></div></div>
              <h3>{plugin.name}</h3>
              <p>{plugin.description}</p>
              {current
                ? <Button className="secondary full" onClick={() => onOpen(plugin.id)}>打开 <ChevronRight /></Button>
                : !supported
                  ? <Button className="secondary full" disabled title={`该插件暂未适配当前系统架构 (${currentTarget})`}>暂未适配当前系统</Button>
                  : <Button className="primary full" disabled={busy === plugin.id} onClick={() => onInstall(plugin)}>{busy === plugin.id ? <LoaderCircle className="spin" /> : <Download />}安装</Button>}
            </Panel>
          )
        })}
      </div>
    </div>
  )
}
