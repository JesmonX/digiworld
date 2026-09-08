// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App, { formatCardPeriod, formatCreditBalance } from './App'

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
  autoRefreshIntervalSeconds: 300,
  codexQuota: { sourceId: 'local', shellPreset: 'auto', preCommand: '', refreshIntervalSeconds: null },
  agyQuota: { sourceId: 'local', shellPreset: 'auto', preCommand: '', refreshIntervalSeconds: 60 },
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
      models: [{ model: 'gpt-5.6-mini', totalTokens: 1_000 }],
    },
    {
      day: '2026-09-03', inputTokens: 1_000, outputTokens: 200,
      cacheReadTokens: 750, cacheWriteTokens: 50, totalTokens: 1_200,
      cacheAvailable: true,
      models: [{ model: 'gpt-5.6-sol', totalTokens: 1_200 }],
    },
  ],
  breakdown: [],
  modelBreakdown: [
    { sourceId: 'local', sourceLabel: '本机', agent: 'codex', model: 'gpt-5.6-mini', inputTokens: 600, outputTokens: 100, cacheReadTokens: 300, cacheWriteTokens: 20, totalTokens: 700 },
    { sourceId: 'remote', sourceLabel: '服务器', agent: 'claude', model: 'gpt-5.6-mini', inputTokens: 300, outputTokens: 50, cacheReadTokens: 100, cacheWriteTokens: 10, totalTokens: 350 },
    { sourceId: 'local', sourceLabel: '本机', agent: 'codex', model: 'gpt-5.6-sol', inputTokens: 900, outputTokens: 100, cacheReadTokens: 350, cacheWriteTokens: 20, totalTokens: 500 },
  ],
}

const quota = {
  status: 'ready',
  sourceId: 'local',
  sourceLabel: '本机',
  fetchedAt: '2026-09-03T06:00:00Z',
  planType: 'Plus',
  windows: [{ usedPercent: 32, windowDurationMins: 300, resetsAt: null }],
  resetCredits: {
    availableCount: 1,
    credits: [
      {
        id: 'credit-1',
        title: '赠送重置卡',
        description: '系统补偿额度',
        grantedAt: 1788500000,
        expiresAt: 1789500000,
        status: 'available',
      },
    ],
  },
  error: null,
}

const agyQuota = {
  status: 'ready',
  sourceId: 'local',
  sourceLabel: '本机',
  fetchedAt: '2026-09-03T06:00:00Z',
  planType: 'Pro tier',
  description: 'Gemini models and Claude/GPT models have separate quotas.',
  groups: [
    {
      name: 'Gemini Models',
      description: 'Gemini 2.5 Pro & Flash',
      buckets: [
        {
          id: 'gemini-5h',
          name: 'Gemini 5h Limit',
          window: '5h',
          windowDurationMins: 300,
          usedPercent: 15,
          remainingPercent: 85,
          remainingFraction: 0.85,
          resetTime: '2026-09-03T11:00:00Z',
          resetsAt: 1788433200,
        },
        {
          id: 'gemini-weekly',
          name: 'Gemini Weekly Limit',
          window: 'weekly',
          windowDurationMins: 10080,
          usedPercent: 63,
          remainingPercent: 37,
          remainingFraction: 0.37,
          resetTime: '2026-09-10T00:00:00Z',
          resetsAt: 1789000000,
        },
      ],
    },
    {
      name: 'Claude and GPT models',
      description: 'Claude and GPT models share a weekly quota.',
      buckets: [
        {
          id: 'claude-weekly',
          name: 'Claude and GPT Weekly Limit',
          window: 'weekly',
          windowDurationMins: 10080,
          usedPercent: 50,
          remainingPercent: 50,
          remainingFraction: 0.5,
          resetTime: '2026-09-10T00:00:00Z',
          resetsAt: 1789000000,
        },
      ],
    },
  ],
  windows: [
    {
      id: 'gemini-5h',
      name: 'Gemini 5h Limit',
      window: '5h',
      windowDurationMins: 300,
      usedPercent: 15,
      remainingPercent: 85,
      remainingFraction: 0.85,
      resetTime: '2026-09-03T11:00:00Z',
      resetsAt: 1788433200,
    },
    {
      id: 'gemini-weekly',
      name: 'Gemini Weekly Limit',
      window: 'weekly',
      windowDurationMins: 10080,
      usedPercent: 63,
      remainingPercent: 37,
      remainingFraction: 0.37,
      resetTime: '2026-09-10T00:00:00Z',
      resetsAt: 1789000000,
    },
  ],
  error: null,
}

async function flush() {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('token usage layout', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
      constructor(private callback: ResizeObserverCallback) {}
      observe() { this.callback([{ contentRect: { width: 640 } } as ResizeObserverEntry], this as unknown as ResizeObserver) }
      disconnect() {}
    })
    document.documentElement.lang = 'zh'
    container = document.createElement('div')
    document.body.append(container)
    mocks.ready.mockReset()
    mocks.request.mockReset()
    mocks.request.mockImplementation(async (method: string, params?: any) => {
      if (method === 'usage.getSettings') return settings
      if (method === 'usage.snapshot') return snapshot
      if (method === 'usage.getCodexQuota') return quota
      if (method === 'usage.getAgyQuota') return agyQuota
      if (method === 'usage.testAgyQuota') return agyQuota
      if (method === 'usage.testCodexQuota') return quota
      if (method === 'usage.saveFilters') return { ...settings, ...params }
      throw new Error(`unexpected method: ${method}`)
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.documentElement.lang = ''
    container.remove()
  })

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
    expect(heatmap.querySelector('[aria-label="所选范围用量汇总"]')?.children).toHaveLength(5)
    expect(mocks.request).toHaveBeenCalledWith('usage.getCodexQuota', { force: false })

    const cacheAxisLabels = Array.from(container.querySelectorAll('.weekly-chart .chart-axis-label')).filter((_, index) => index % 2 === 1).map(label => label.textContent)
    expect(cacheAxisLabels).toEqual(['85%', '79%', '73%', '66%', '60%'])
    expect(Array.from(container.querySelectorAll('.cache-point-label')).map(label => label.textContent)).toEqual(['72.0%', '75.0%'])
    expect(container.querySelector('.chart-legend')?.textContent).toContain('gpt-5.6-sol1.2K')
    expect(container.querySelector('.chart-legend')?.textContent).toContain('gpt-5.6-mini1K')
    expect(container.querySelector('.chart-legend')?.textContent).not.toContain('模型')
    expect(container.querySelector('.chart-legend')?.textContent).toContain('缓存率')
    expect(filterBar.querySelectorAll('.agent-icon').length).toBe(5)
    expect(container.querySelector('.weekly-card h2')?.textContent).toBe('最近 7 天')
    expect(container.querySelectorAll('.weekly-chart .chart-axis-title')).toHaveLength(0)
    expect(container.querySelectorAll('.model-pie-slice')).toHaveLength(2)
    expect(container.querySelector('.model-card .model-table')).toBeNull()
    expect(container.querySelector('.model-pie-legend')?.textContent).toContain('gpt-5.6-mini1.05K')
    expect(container.querySelector('.model-pie-legend')?.textContent).not.toContain('Codex')
    expect(container.querySelector('.model-pie-legend')?.textContent).not.toContain('本机')
    expect(container.querySelector('.weekly-card')?.textContent).not.toContain('按模型堆叠 Token 与缓存读取率')
    expect(container.querySelector('.weekly-chart')?.getAttribute('viewBox')).toBe('0 0 640 300')
    expect(container.querySelectorAll('.token-segment')).toHaveLength(2)
    expect(container.querySelector('.token-segment')?.getAttribute('data-tooltip')).toContain('Token')
    expect(container.querySelector('.token-segment')?.getAttribute('rx')).toBe('5')
    expect(container.querySelector('.model-key-0')).not.toBeNull()
    expect(container.querySelector('.token-segment.model-0')).not.toBeNull()

    const quotaWindowText = container.querySelector<HTMLElement>('.quota-window span')!.textContent
    expect(quotaWindowText).toBe('剩余 68%')
    expect(quotaWindowText).not.toContain('已用')
    expect(container.querySelector('.quota-credits')?.textContent).toContain('不可用')
    expect(container.querySelector('.quota-credits')?.getAttribute('data-has-credits')).toBe('false')

    const quotaFill = container.querySelector<HTMLElement>('.quota-track i')!
    expect(quotaFill.style.width).toBe('68%')
    const quotaRule = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8').match(/\.quota-track i \{[^}]+\}/)?.[0]
    expect(quotaRule).not.toContain('margin-left: auto')

    const quotaResets = container.querySelector<HTMLElement>('.quota-resets')!
    expect(quotaResets.textContent).toContain('重置卡')
    expect(quotaResets.textContent).toContain('1 张可用')
    expect(quotaResets.textContent).toContain('赠送重置卡')
    expect(quotaResets.textContent).not.toContain('系统补偿额度')
    expect(quotaResets.textContent).not.toContain('获得：')
    expect(quotaResets.textContent).not.toContain('到期：')
    expect(quotaResets.textContent).toMatch(/\d{2}\/\d{2}-\d{2}\/\d{2},\s*\d{2}:\d{2}\s*(AM|PM)/)

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

    // Test filter persistence on chip toggle
    mocks.request.mockClear()
    const codexChip = Array.from(filterBar.querySelectorAll<HTMLButtonElement>('.filter-chip')).find(b => b.textContent?.includes('Codex'))!
    await act(async () => {
      codexChip.click()
      await flush()
    })
    expect(mocks.request).toHaveBeenCalledWith('usage.saveFilters', expect.objectContaining({
      agents: ['claude', 'pi', 'zcode', 'agy'],
      sources: ['local'],
    }))

    await act(async () => root.unmount())
  })

  it('keeps session refresh settings inside the settings dialog', async () => {
    const root = createRoot(container)
    await act(async () => {
      root.render(<App />)
      await flush()
      await flush()
    })

    expect(container.querySelector('.usage-header .auto-refresh-control')).toBeNull()
    const settingsButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('设置'))
    expect(settingsButton).not.toBeNull()
    await act(async () => {
      settingsButton?.click()
      await flush()
    })
    const sessionRefresh = container.querySelector<HTMLSelectElement>('dialog[aria-label="设置"] .session-refresh-settings select')
    expect(sessionRefresh).not.toBeNull()
    expect(sessionRefresh?.value).toBe('300')
    await act(async () => root.unmount())
  })

  it('restores persisted agent and source filter selections from settings', async () => {
    const customSettings = {
      ...settings,
      selectedAgents: ['claude'],
      selectedSources: ['local'],
    }
    mocks.request.mockImplementation(async (method: string, params?: any) => {
      if (method === 'usage.getSettings') return customSettings
      if (method === 'usage.snapshot') return snapshot
      if (method === 'usage.getCodexQuota') return quota
      if (method === 'usage.getAgyQuota') return agyQuota
      if (method === 'usage.saveFilters') return { ...customSettings, ...params }
      throw new Error(`unexpected method: ${method}`)
    })

    const root = createRoot(container)
    await act(async () => {
      root.render(<App />)
      await flush()
      await flush()
    })

    const filterBar = container.querySelector('.filter-bar')!
    const activeChips = Array.from(filterBar.querySelectorAll('.filter-chip.active')).map(c => c.textContent?.trim())
    expect(activeChips).toContain('Claude Code')
    expect(activeChips).not.toContain('Codex')

    await act(async () => root.unmount())
  })

  it('formats credit balance to keep exactly 1 decimal place', () => {
    expect(formatCreditBalance('$12.50')).toBe('$12.5')
    expect(formatCreditBalance('$12.5')).toBe('$12.5')
    expect(formatCreditBalance('$12')).toBe('$12.0')
    expect(formatCreditBalance('15.260 USD')).toBe('15.3 USD')
    expect(formatCreditBalance('¥100.89')).toBe('¥100.9')
    expect(formatCreditBalance(null, 'zh')).toBe('不可用')
    expect(formatCreditBalance(null, 'en')).toBe('Unavailable')
    expect(formatCreditBalance('不限', 'zh')).toBe('不限')
  })

  it('displays Codex balance formatted to 1 decimal place when credits exist', async () => {
    const quotaWithBalance = {
      ...quota,
      credits: {
        balance: '$12.50',
        hasCredits: true,
        unlimited: false,
      },
    }
    mocks.request.mockImplementation(async (method: string, _params?: any) => {
      if (method === 'usage.getSettings') return settings
      if (method === 'usage.snapshot') return snapshot
      if (method === 'usage.getCodexQuota') return quotaWithBalance
      if (method === 'usage.getAgyQuota') return agyQuota
      throw new Error(`unexpected method: ${method}`)
    })

    const root = createRoot(container)
    await act(async () => {
      root.render(<App />)
      await flush()
      await flush()
    })

    const balanceEl = container.querySelector('.quota-credits strong')
    expect(balanceEl?.textContent).toBe('$12.5')
    expect(balanceEl?.textContent).not.toBe('$12.50')

    await act(async () => root.unmount())
  })

  it('switches between Codex and Antigravity quota cards via carousel paging', async () => {
    const root = createRoot(container)
    await act(async () => {
      root.render(<App />)
      await flush()
      await flush()
    })

    // Initially only ONE quota card is displayed and it is Codex
    const quotaCards = container.querySelectorAll('.quota-card')
    expect(quotaCards).toHaveLength(1)
    expect(container.querySelector('.quota-card h2')?.textContent).toBe('Codex 限额')
    expect(container.querySelector('.quota-page-badge')?.textContent).toBe('1/2')
    const dots = container.querySelectorAll('.quota-dot')
    expect(dots).toHaveLength(2)
    expect(dots[0]?.classList.contains('active')).toBe(true)
    expect(dots[1]?.classList.contains('active')).toBe(false)

    // Click next button to flip to Antigravity
    const nextBtn = container.querySelector<HTMLButtonElement>('.quota-nav-btn[aria-label="下一个限额卡片"]')!
    expect(nextBtn).not.toBeNull()
    await act(async () => {
      nextBtn.click()
      await flush()
    })

    // Still only ONE quota card is displayed, now Antigravity
    expect(container.querySelectorAll('.quota-card')).toHaveLength(1)
    expect(container.querySelector('.quota-card h2')?.textContent).toBe('Antigravity 限额')
    expect(container.querySelector('.quota-card p')?.textContent).toBe('本机 · AI Pro')
    expect(container.querySelector('.quota-page-badge')?.textContent).toBe('2/2')
    expect(dots[0]?.classList.contains('active')).toBe(false)
    expect(dots[1]?.classList.contains('active')).toBe(true)

    // Verify both Gemini and Claude & GPT model groups are displayed together on one page
    const groups = container.querySelectorAll('.quota-agy-group')
    expect(groups).toHaveLength(2)
    expect(groups[0]?.querySelector('.quota-agy-group-header')?.textContent).toBe('Gemini 模型')
    expect(groups[1]?.querySelector('.quota-agy-group-header')?.textContent).toBe('Claude 与 GPT 模型')

    // Verify concise 5h and 7d limit bars in AGY card
    const windows = container.querySelectorAll('.quota-window')
    expect(windows).toHaveLength(3)
    // Gemini 5h limit
    expect(windows[0]?.textContent).toContain('5h')
    expect(windows[0]?.textContent).toContain('剩余 85%')
    expect(windows[0]?.querySelector<HTMLElement>('.quota-track i')?.style.width).toBe('85%')
    // Gemini weekly limit (7d)
    expect(windows[1]?.textContent).toContain('7d')
    expect(windows[1]?.textContent).toContain('剩余 37%')
    expect(windows[1]?.querySelector<HTMLElement>('.quota-track i')?.style.width).toBe('37%')
    // Claude weekly limit (7d)
    expect(windows[2]?.textContent).toContain('7d')
    expect(windows[2]?.textContent).toContain('剩余 50%')
    expect(windows[2]?.querySelector<HTMLElement>('.quota-track i')?.style.width).toBe('50%')

    // Plan tier card should be removed from AGY card
    expect(container.querySelector('.quota-card .quota-credits')).toBeNull()

    // Test refreshing AGY quota
    mocks.request.mockClear()
    const agyRefreshBtn = container.querySelector<HTMLButtonElement>('.quota-card .panel-action')!
    await act(async () => {
      agyRefreshBtn.click()
      await flush()
    })
    expect(mocks.request).toHaveBeenCalledWith('usage.getAgyQuota', { force: true })

    // Click on dot 0 to flip back to Codex
    await act(async () => {
      (dots[0] as HTMLButtonElement).click()
      await flush()
    })
    expect(container.querySelector('.quota-card h2')?.textContent).toBe('Codex 限额')
    expect(container.querySelector('.quota-page-badge')?.textContent).toBe('1/2')

    await act(async () => root.unmount())
  })

  it('supports Antigravity quota settings and test query in settings dialog', async () => {
    const root = createRoot(container)
    await act(async () => {
      root.render(<App />)
      await flush()
      await flush()
    })

    const settingsButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('设置'))!
    await act(async () => {
      settingsButton.click()
      await flush()
    })

    const agySection = container.querySelector('.agy-quota-settings')
    expect(agySection).not.toBeNull()
    expect(agySection?.textContent).toContain('Antigravity 限额查询')

    // Click test AGY quota button
    mocks.request.mockClear()
    const testAgyBtn = Array.from(agySection!.querySelectorAll('button')).find(b => b.textContent?.includes('测试 Antigravity 限额'))!
    expect(testAgyBtn).not.toBeNull()
    await act(async () => {
      testAgyBtn.click()
      await flush()
    })
    expect(mocks.request).toHaveBeenCalledWith('usage.testAgyQuota', expect.anything())

    await act(async () => root.unmount())
  })

  it('formats reset card period to mm/dd-mm/dd, hour:min AM/PM on one line', () => {
    const formatted = formatCardPeriod(1788500000, 1789500000, 'zh')
    expect(formatted).toMatch(/^\d{2}\/\d{2}-\d{2}\/\d{2},\s*\d{2}:\d{2}\s*(AM|PM)$/)
    expect(formatCardPeriod(null, null, 'zh')).toBe('永久有效')
    expect(formatCardPeriod(null, null, 'en')).toBe('Permanent')
  })

  it('switches between multiple reset cards using carousel navigation and occupies only one card space', async () => {
    const quotaWithMultipleCredits = {
      ...quota,
      resetCredits: {
        availableCount: 2,
        credits: [
          {
            id: 'credit-1',
            title: '重置卡 A',
            grantedAt: 1788500000,
            expiresAt: 1789500000,
            status: 'available',
          },
          {
            id: 'credit-2',
            title: '重置卡 B',
            grantedAt: 1788600000,
            expiresAt: 1789600000,
            status: 'available',
          },
        ],
      },
    }
    mocks.request.mockImplementation(async (method: string, _params?: any) => {
      if (method === 'usage.getSettings') return settings
      if (method === 'usage.snapshot') return snapshot
      if (method === 'usage.getCodexQuota') return quotaWithMultipleCredits
      if (method === 'usage.getAgyQuota') return agyQuota
      throw new Error(`unexpected method: ${method}`)
    })

    const root = createRoot(container)
    await act(async () => {
      root.render(<App />)
      await flush()
      await flush()
    })

    const quotaResets = container.querySelector<HTMLElement>('.quota-resets')!
    expect(quotaResets).not.toBeNull()
    expect(quotaResets.textContent).toContain('2 张可用')

    // Only ONE card is rendered in the DOM
    const resetItems = container.querySelectorAll('.quota-reset-item')
    expect(resetItems).toHaveLength(1)
    expect(resetItems[0]?.textContent).toContain('重置卡 A')
    expect(resetItems[0]?.textContent).not.toContain('重置卡 B')

    // Carousel nav exists with page badge 1/2
    const nav = quotaResets.querySelector('.quota-carousel-nav')!
    expect(nav).not.toBeNull()
    const pageBadge = nav.querySelector('.quota-page-badge')!
    expect(pageBadge.textContent).toBe('1/2')

    // Click next button
    const nextBtn = nav.querySelector<HTMLButtonElement>('.quota-nav-btn[aria-label="下一张重置卡"]')!
    expect(nextBtn).not.toBeNull()
    await act(async () => {
      nextBtn.click()
      await flush()
    })

    // Still only ONE card rendered, now showing Card B
    expect(container.querySelectorAll('.quota-reset-item')).toHaveLength(1)
    expect(container.querySelector('.quota-reset-item')?.textContent).toContain('重置卡 B')
    expect(container.querySelector('.quota-reset-item')?.textContent).not.toContain('重置卡 A')
    expect(pageBadge.textContent).toBe('2/2')

    // Click prev button
    const prevBtn = nav.querySelector<HTMLButtonElement>('.quota-nav-btn[aria-label="上一张重置卡"]')!
    expect(prevBtn).not.toBeNull()
    await act(async () => {
      prevBtn.click()
      await flush()
    })

    expect(container.querySelectorAll('.quota-reset-item')).toHaveLength(1)
    expect(container.querySelector('.quota-reset-item')?.textContent).toContain('重置卡 A')
    expect(pageBadge.textContent).toBe('1/2')

    await act(async () => root.unmount())
  })
})
