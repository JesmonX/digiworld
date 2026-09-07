import { Button, Metric, MetricGrid, Panel, Section, EmptyState } from '@digiworld/design-system/react'
import { AlertTriangle, Boxes, ChevronRight, Gauge, Library, RefreshCw, ShieldCheck } from 'lucide-react'
import type { PluginSummary } from '@digiworld/plugin-sdk'
import { PluginIcon } from '../components/PluginIcon'
import { stateLabel } from '../components/PluginStatus'
import { t, type Locale } from '../lib/i18n'

export function HomePage({
  plugins,
  onCatalog,
  onOpen,
  onRefresh,
  locale = 'en'
}: {
  plugins: PluginSummary[]
  version: string | undefined
  onCatalog(): void
  onOpen(id: string): void
  onRefresh(): void
  reducedMotion: boolean
  locale?: Locale
}) {
  if (plugins.length === 0) {
    return (
      <EmptyState
        icon={<Boxes />}
        title={t('noInstalledTitle', locale)}
        description={t('noInstalledDesc', locale)}
        action={<Button variant="primary" className="pill" onClick={onCatalog}>{t('browseCatalog', locale)} <ChevronRight size={15} /></Button>}
      />
    )
  }

  const running = plugins.filter(plugin => plugin.state === 'running').length
  const attention = plugins.filter(plugin => plugin.state === 'failed').length

  return (
    <div className="home-dashboard">
      <Panel className="workspace-summary" padding="lg">
        <MetricGrid aria-label={t('summaryTitle', locale)}>
          <div className="workspace-metric metric-card">
            <span className="metric-icon mint"><Boxes /></span>
            <div className="metric-details">
              <Metric label={t('installedCount', locale)} value={plugins.length} unit={t('installedUnit', locale)} />
              <div className="metric-trend positive"><span>100% active</span></div>
            </div>
          </div>
          <div className="workspace-metric metric-card">
            <span className="metric-icon blue"><Gauge /></span>
            <div className="metric-details">
              <Metric
                label={t('runningCount', locale)}
                value={running}
                hint={running === plugins.length ? t('allRunning', locale) : t('someRunning', locale)}
              />
              <div className="metric-trend neutral"><span>{running}/{plugins.length}</span></div>
            </div>
          </div>
          <div className="workspace-metric metric-card">
            <span className={`metric-icon ${attention ? 'coral' : 'emerald'}`}>
              {attention ? <AlertTriangle /> : <ShieldCheck />}
            </span>
            <div className="metric-details">
              <Metric
                label={t('needsAttention', locale)}
                value={attention}
                hint={attention ? t('issuesFound', locale) : t('noIssues', locale)}
              />
              <div className={`metric-trend ${attention ? 'negative' : 'positive'}`}>
                <span>{attention ? 'Needs Check' : 'Operational'}</span>
              </div>
            </div>
          </div>
        </MetricGrid>
      </Panel>

      <Panel padding="lg" className="workspace-tools">
        <Section
          title={t('installedTools', locale)}
          description={t('installedToolsDesc', locale)}
          actions={
            <>
              <Button onClick={onRefresh} aria-label={t('refresh', locale)}>
                <RefreshCw size={14} /> {t('refresh', locale)}
              </Button>
              <Button variant="primary" className="pill" onClick={onCatalog}>
                <Library size={14} /> {t('addPlugin', locale)}
              </Button>
            </>
          }
        >
          <div className="installed-list">
            {plugins.map(plugin => (
              <button key={plugin.id} className="plugin-row" onClick={() => onOpen(plugin.id)}>
                <span className="row-icon"><PluginIcon plugin={plugin} /></span>
                <span className="plugin-row-copy">
                  <span className="plugin-row-heading">
                    <strong>{plugin.name}</strong>
                    <ChevronRight className="row-chevron" size={15} />
                  </span>
                  <small>{plugin.description || t('openTool', locale)}</small>
                </span>
                <span className={`compact-status ${plugin.state}`}>
                  {stateLabel(plugin, locale)}
                </span>
                {plugin.uiDesignVersion !== 1 && (
                  <small className="legacy-design">
                    {locale === 'zh' ? '浅色兼容 · 待适配新外观' : 'Compatibility Mode'}
                  </small>
                )}
              </button>
            ))}
          </div>
        </Section>
      </Panel>
    </div>
  )
}
