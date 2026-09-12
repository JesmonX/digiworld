import { Button, Input, Panel } from '@digiworld/design-system/react'
import { useMemo, useState } from 'react'
import { ChevronRight, Download, LoaderCircle, RefreshCw, Search } from 'lucide-react'
import type { CatalogIndex, CatalogPlugin, PluginSummary } from '@digiworld/plugin-sdk'
import { Loading } from '../components/Loading'
import { PluginIcon } from '../components/PluginIcon'
import { t, type Locale } from '../lib/i18n'
import { pluginDescription, pluginDisplayName, pluginSearchNames } from '../lib/pluginNames'

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
  const [query, setQuery] = useState('')
  const plugins = catalog?.plugins ?? []
  const filteredPlugins = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return plugins
    return plugins.filter(plugin => pluginSearchNames(plugin).some(name => name.toLocaleLowerCase().includes(normalized)))
  }, [plugins, query])
  if (!catalog) return <Loading label={t('loadingPlugin', locale)} />
  return (
    <div>
      <div className="section-heading">
        <h2>{t('availableTools', locale)}</h2>
        <div className="catalog-actions">
          <label className="catalog-search">
            <Search size={15} />
            <Input aria-label={t('searchPlugins', locale)} value={query} onChange={event => setQuery(event.target.value)} placeholder={t('searchPluginsPlaceholder', locale)} />
          </label>
          <Button className="icon-button" aria-label={t('refreshStore', locale)} title={t('refresh', locale)} onClick={onRefresh}>
            <RefreshCw />
          </Button>
        </div>
      </div>
      {filteredPlugins.length === 0 ? <p className="catalog-empty">{t('noPluginSearchResults', locale)}</p> : <div className="catalog-grid">
        {filteredPlugins.map(plugin => {
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
              <h3>{pluginDisplayName(plugin, locale)}</h3>
              <p>{pluginDescription(plugin, locale)}</p>
              {current
                ? <Button className="secondary full" onClick={() => onOpen(plugin.id)}>{t('openBtn', locale)} <ChevronRight /></Button>
                : !supported
                  ? <Button className="secondary full" disabled title={unsupportedTitle}>{t('unsupportedBtn', locale)}</Button>
                  : <Button className="primary full" disabled={busy === plugin.id} onClick={() => onInstall(plugin)}>{busy === plugin.id ? <LoaderCircle className="spin" /> : <Download />}{t('installBtn', locale)}</Button>}
            </Panel>
          )
        })}
      </div>}
    </div>
  )
}
