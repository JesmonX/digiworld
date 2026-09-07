import { Button, Panel } from '@digiworld/design-system/react'
import { ChevronRight, Download, LoaderCircle, RefreshCw } from 'lucide-react'
import type { CatalogIndex, CatalogPlugin, PluginSummary } from '@digiworld/plugin-sdk'
import { Loading } from '../components/Loading'
import { PluginIcon } from '../components/PluginIcon'
import { t, type Locale } from '../lib/i18n'

export function CatalogPage({
  catalog,
  installed,
  busy,
  onInstall,
  onRefresh,
  onOpen,
  currentTarget,
  locale = 'en'
}: {
  catalog: CatalogIndex | null
  installed: Map<string, PluginSummary>
  busy: string | null
  onInstall(plugin: CatalogPlugin): void
  onRefresh(): void
  onOpen(id: string): void
  currentTarget?: string | undefined
  locale?: Locale
}) {
  if (!catalog) return <Loading label={t('loadingPlugin', locale)} />
  return (
    <div>
      <div className="section-heading">
        <h2>{t('availableTools', locale)}</h2>
        <Button className="icon-button" aria-label={t('refreshStore', locale)} title={t('refresh', locale)} onClick={onRefresh}>
          <RefreshCw />
        </Button>
      </div>
      <div className="catalog-grid">
        {catalog.plugins.map(plugin => {
          const current = installed.get(plugin.id)
          const supported = Boolean(currentTarget && plugin.artifacts.some(artifact => artifact.target === currentTarget))
          const unsupportedTitle = currentTarget
            ? `${t('unsupportedArchitecture', locale)} (${currentTarget})`
            : t('unsupportedBtn', locale)
          return (
            <Panel padding="lg" className="catalog-card" key={plugin.id}>
              <div className="catalog-title">
                <span className="catalog-icon"><PluginIcon plugin={plugin} /></span>
                <div className="catalog-version">
                  <span className={`availability-dot ${current ? 'installed' : supported ? 'available' : 'unavailable'}`} />
                  <small>{current ? t('statusInstalled', locale) : supported ? t('statusAvailable', locale) : t('statusUnsupported', locale)}</small>
                  <small>v{plugin.version}</small>
                </div>
              </div>
              <h3>{plugin.name}</h3>
              <p>{plugin.description}</p>
              {current
                ? <Button className="secondary full" onClick={() => onOpen(plugin.id)}>{t('openBtn', locale)} <ChevronRight /></Button>
                : !supported
                  ? <Button className="secondary full" disabled title={unsupportedTitle}>{t('unsupportedBtn', locale)}</Button>
                  : <Button className="primary full" disabled={busy === plugin.id} onClick={() => onInstall(plugin)}>{busy === plugin.id ? <LoaderCircle className="spin" /> : <Download />}{t('installBtn', locale)}</Button>}
            </Panel>
          )
        })}
      </div>
    </div>
  )
}
