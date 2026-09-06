import React from 'react'
import { Button, Card, Dialog } from '@digiworld/design-system/react'
import { Check, ChevronRight, Download, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react'
import type { CatalogIndex, CatalogPlugin, PluginSummary } from '@digiworld/plugin-sdk'
import type { UpdateProgress } from '../lib/api'
import { PluginIcon } from '../components/PluginIcon'
import { Loading } from '../components/Loading'
import { permissionLabel } from '../components/plugin/PluginManagement'

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function ProgressView({ progress, fallbackName }: { progress: UpdateProgress | null; fallbackName: string }) {
  const downloading = progress?.stage === 'downloading'
  const percent = downloading && progress.total
    ? Math.min(100, Math.round(progress.downloaded / progress.total * 100))
    : null
  const stageLabel = !progress ? '准备下载' : downloading ? '正在下载' : progress.stage === 'completed' ? '安装完成' : progress.stage === 'failed' ? '更新失败' : '正在安装'
  const currentItem = progress?.stage === 'completed' ? progress.completedItems : (progress?.completedItems ?? 0) + 1
  const itemCount = progress && progress.totalItems > 1 ? ` · ${Math.min(currentItem, progress.totalItems)}/${progress.totalItems}` : ''
  return (
    <div className="update-progress" aria-live="polite">
      <div><strong>{stageLabel}{itemCount}</strong><span>{progress?.itemName ?? fallbackName}</span></div>
      <div className={`progress-track ${percent === null ? 'indeterminate' : ''}`} role="progressbar" aria-label={`${stageLabel}进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
        <span style={percent === null ? undefined : { width: `${percent}%` }} />
      </div>
      {downloading && <small>{formatBytes(progress.downloaded)}{progress.total ? ` / ${formatBytes(progress.total)} · ${percent}%` : ''}</small>}
    </div>
  )
}

export function InstallDialog({ plugin, busy, progress, onCancel, onConfirm }: { plugin: CatalogPlugin; busy: boolean; progress: UpdateProgress | null; onCancel(): void; onConfirm(): void }) {
  return (
    <Dialog open onClose={() => { if (!busy) onCancel() }} className="modal" aria-labelledby="install-title">
      <div className="modal-icon"><ShieldCheck /></div>
      <h2 id="install-title">安装 {plugin.name}</h2>
      <div className="permission-dialog">
        {plugin.permissions.map(permission => <div key={permission.id}><Check /><span><strong>{permissionLabel(permission.id)}</strong><small>{permission.reason}</small></span></div>)}
      </div>
      {busy && <ProgressView progress={progress} fallbackName={plugin.name} />}
      <div className="modal-actions"><Button className="secondary" disabled={busy} onClick={onCancel}>取消</Button><Button className="primary" disabled={busy} onClick={onConfirm}>{busy ? <LoaderCircle className="spin" /> : <Download />}安装</Button></div>
    </Dialog>
  )
}

export function CatalogPage({
  catalog,
  installed,
  busy,
  onInstall,
  onRefresh,
  onOpen,
  currentTarget,
}: {
  catalog: CatalogIndex | null
  installed: Map<string, PluginSummary>
  busy: string | null
  onInstall(plugin: CatalogPlugin): void
  onRefresh(): void
  onOpen(id: string): void
  currentTarget?: string | undefined
}) {
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
            <Card className="catalog-card" key={plugin.id}>
              <div className="catalog-title"><span className="catalog-icon"><PluginIcon plugin={plugin} /></span><div className="catalog-version"><span className={`availability-dot ${current ? 'installed' : supported ? 'available' : 'unavailable'}`} /> <small>{current ? '已安装' : supported ? '可安装' : '暂未适配'}</small><small>v{plugin.version}</small></div></div>
              <h3>{plugin.name}</h3>
              <p>{plugin.description}</p>
              {current
                ? <Button className="secondary full" onClick={() => onOpen(plugin.id)}>打开 <ChevronRight /></Button>
                : !supported
                  ? <Button className="secondary full" disabled title={`该插件暂未适配当前系统架构 (${currentTarget})`}>暂未适配当前系统</Button>
                  : <Button className="primary full" disabled={busy === plugin.id} onClick={() => onInstall(plugin)}>{busy === plugin.id ? <LoaderCircle className="spin" /> : <Download />}安装</Button>}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
