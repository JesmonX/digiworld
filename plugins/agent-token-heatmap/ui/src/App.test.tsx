// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  ready: vi.fn(),
  request: vi.fn(),
}))

vi.mock('@digiworld/plugin-sdk', () => ({
  createPluginBridge: () => ({ ready: mocks.ready, request: mocks.request, on: vi.fn() }),
}))

const settings = {
  localAgents: ['codex', 'claude', 'pi', 'zcode', 'agy'],
  localRoots: {},
  sshSources: [],
  codexQuota: { sourceId: 'local', shellPreset: 'auto', preCommand: '', refreshIntervalSeconds: null },
}

const snapshot = {
  startDay: '2026-08-05',
  endDay: '2026-09-03',
  totals: {
    inputTokens: 1_000,
    outputTokens: 200,
    cacheReadTokens: 600,
    cacheWriteTokens: 50,
    totalTokens: 1_200,
    cacheRate: .6,
  },
  days: [
    {
      day: '2026-09-02', inputTokens: 800, outputTokens: 200,
      cacheReadTokens: 576, cacheWriteTokens: 40, totalTokens: 1_000,
      cacheAvailable: true,
    },
    {
      day: '2026-09-03', inputTokens: 1_000, outputTokens: 200,
      cacheReadTokens: 750, cacheWriteTokens: 50, totalTokens: 1_200,
      cacheAvailable: true,
    },
  ],
  breakdown: [],
  modelBreakdown: [],
}

const quota = {
  status: 'ready',
  sourceId: 'local',
  sourceLabel: '本机',
  fetchedAt: '2026-09-03T06:00:00Z',
  planType: 'Plus',
  windows: [{ usedPercent: 32, windowDurationMins: 300, resetsAt: null }],
  error: null,
}

async function flush() {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('token usage layout', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    mocks.ready.mockReset()
    mocks.request.mockReset()
    mocks.request.mockImplementation(async (method: string) => {
      if (method === 'usage.getSettings') return settings
      if (method === 'usage.snapshot') return snapshot
      if (method === 'usage.getCodexQuota') return quota
      throw new Error(`unexpected method: ${method}`)
    })
  })

  afterEach(() => container.remove())

  it('groups range totals with the heatmap and colors the remaining quota from the left', async () => {
    const root = createRoot(container)
    await act(async () => {
      root.render(<App />)
      await flush()
      await flush()
    })

    const filterBar = container.querySelector('.filter-bar')!
    const insights = container.querySelector('.insights-grid')!
    const heatmap = container.querySelector('.heatmap-card')!
    expect(filterBar.querySelector('.range-group')).toBeNull()
    expect(insights.compareDocumentPosition(heatmap) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(heatmap.querySelector('.range-group')).not.toBeNull()
    expect(heatmap.querySelector('.summary-grid')?.children).toHaveLength(6)
    expect(mocks.request).toHaveBeenCalledWith('usage.getCodexQuota', { force: false })

    const cacheAxisLabels = Array.from(container.querySelectorAll('.weekly-chart .chart-axis-label')).filter((_, index) => index % 2 === 1).map(label => label.textContent)
    expect(cacheAxisLabels).toEqual(['85%', '73%', '60%'])
    expect(Array.from(container.querySelectorAll('.cache-point-label')).map(label => label.textContent)).toEqual(['72.0%', '75.0%'])

    const quotaFill = container.querySelector<HTMLElement>('.quota-track i')!
    expect(quotaFill.style.width).toBe('68%')
    const quotaRule = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8').match(/\.quota-track i \{[^}]+\}/)?.[0]
    expect(quotaRule).not.toContain('margin-left: auto')

    mocks.request.mockClear()
    const thirtyDays = Array.from(heatmap.querySelectorAll('button')).find(button => button.textContent === '30 天')!
    await act(async () => {
      thirtyDays.click()
      await flush()
    })
    expect(mocks.request).toHaveBeenCalledWith('usage.snapshot', expect.objectContaining({ range: '30' }))

    mocks.request.mockClear()
    const quotaRefresh = container.querySelector<HTMLButtonElement>('.quota-card .panel-action')!
    await act(async () => {
      quotaRefresh.click()
      await flush()
    })
    expect(mocks.request).toHaveBeenCalledWith('usage.getCodexQuota', { force: true })

    await act(async () => root.unmount())
  })
})
