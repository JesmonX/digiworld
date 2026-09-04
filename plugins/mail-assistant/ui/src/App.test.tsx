// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
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

const account = {
  id: 'mail-1', provider: 'custom', label: '工作邮箱', email: 'me@example.com',
  username: 'me@example.com', host: 'imap.example.com', port: 993,
  hasCredential: true, syncPhase: 'error', indexed: 0, total: 0,
  baselineComplete: false, lastError: 'IMAP 认证失败，请更新授权码',
  nextSyncAt: '2026-09-04T12:05:00Z',
}

function page(subject = '') {
  return {
    items: subject ? [{
      id: subject === '新结果' ? 2 : 1, accountId: 'mail-1', accountLabel: '工作邮箱',
      subject, sender: 'sender@example.com', receivedAt: '2026-09-04T12:00:00Z',
      snippet: subject, serverSeen: false, locallyViewed: false, size: 10, hasBody: true,
    }] : [],
  }
}

async function flush() {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('mail assistant status and search', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    mocks.ready.mockReset()
    mocks.request.mockReset()
    mocks.request.mockImplementation(async (method: string) => {
      if (method === 'mail.sync.status') return { accounts: [account], syncingAccountIds: [] }
      if (method === 'mail.settings.get') return { pollMinutes: 10 }
      if (method === 'mail.messages.list') return page()
      throw new Error(`unexpected method: ${method}`)
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    container.remove()
  })

  it('shows the persisted account sync error instead of an unlabeled icon', async () => {
    const root = createRoot(container)
    await act(async () => { root.render(<App />); await flush(); await flush() })

    expect(container.textContent).toContain('IMAP 认证失败，请更新授权码')
    expect(container.querySelector('[aria-label="同步失败"]')?.getAttribute('title')).toBe('IMAP 认证失败，请更新授权码')
    await act(async () => root.unmount())
  })

  it('ignores an older search response that arrives after the latest query', async () => {
    const root = createRoot(container)
    await act(async () => { root.render(<App />); await flush(); await flush() })

    let resolveOld!: (value: ReturnType<typeof page>) => void
    const oldResponse = new Promise<ReturnType<typeof page>>(resolve => { resolveOld = resolve })
    mocks.request.mockImplementation(async (method: string, payload?: { query?: string }) => {
      if (method === 'mail.sync.status') return { accounts: [account], syncingAccountIds: [] }
      if (method === 'mail.settings.get') return { pollMinutes: 10 }
      if (method === 'mail.messages.list' && payload?.query === '旧查询') return oldResponse
      if (method === 'mail.messages.list' && payload?.query === '新查询') return page('新结果')
      if (method === 'mail.messages.list') return page()
      throw new Error(`unexpected method: ${method}`)
    })

    vi.useFakeTimers()
    const input = container.querySelector<HTMLInputElement>('input[aria-label="搜索邮件"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '旧查询')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await vi.advanceTimersByTimeAsync(180)
    })
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '新查询')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await vi.advanceTimersByTimeAsync(180)
    })
    expect(container.textContent).toContain('新结果')

    await act(async () => { resolveOld(page('旧结果')); await Promise.resolve() })
    expect(container.textContent).toContain('新结果')
    expect(container.textContent).not.toContain('旧结果')
    await act(async () => root.unmount())
  })
})
