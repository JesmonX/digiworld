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

  it('correctly displays unread only when both serverSeen and locallyViewed are false, and allows toggling', async () => {
    const root = createRoot(container)
    mocks.request.mockImplementation(async (method: string) => {
      if (method === 'mail.sync.status') return { accounts: [account], syncingAccountIds: [] }
      if (method === 'mail.settings.get') return { pollMinutes: 10 }
      if (method === 'mail.messages.list') return {
        items: [
          {
            id: 1, accountId: 'mail-1', accountLabel: '工作邮箱',
            subject: '未读邮件', sender: 'sender@example.com', receivedAt: '2026-09-04T12:00:00Z',
            snippet: '未读', serverSeen: false, locallyViewed: false, size: 10, hasBody: true,
          },
          {
            id: 2, accountId: 'mail-1', accountLabel: '工作邮箱',
            subject: '已读邮件', sender: 'sender@example.com', receivedAt: '2026-09-04T12:00:00Z',
            snippet: '已读', serverSeen: true, locallyViewed: false, size: 10, hasBody: true,
          },
        ],
      }
      if (method === 'mail.messages.get') return {
        id: 1, accountId: 'mail-1', accountLabel: '工作邮箱',
        subject: '未读邮件', sender: 'sender@example.com', receivedAt: '2026-09-04T12:00:00Z',
        snippet: '未读', serverSeen: false, locallyViewed: true, size: 10, hasBody: true,
        recipients: 'me@example.com', body: '正文内容', bodyTruncated: false, attachments: [],
      }
      if (method === 'mail.messages.mark_read') return { ok: true }
      throw new Error(`unexpected method: ${method}`)
    })
    vi.useFakeTimers()
    await act(async () => {
      root.render(<App />)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    const rows = container.querySelectorAll('.mail-row')
    expect(rows.length).toBe(2)
    const firstRow = rows[0]!
    const secondRow = rows[1]!
    expect(firstRow.classList.contains('new')).toBe(true)
    expect(secondRow.classList.contains('new')).toBe(false)

    // Click on unread message to open
    await act(async () => {
      firstRow.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
    expect(firstRow.classList.contains('new')).toBe(false)

    // Toggle button should now show '标为未读'
    const toggleBtn = container.querySelector<HTMLButtonElement>('.toggle-read')!
    expect(toggleBtn).not.toBeNull()
    expect(toggleBtn.textContent).toBe('标为未读')

    // Click toggle button to mark as unread
    await act(async () => {
      toggleBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
    expect(mocks.request).toHaveBeenCalledWith('mail.messages.mark_read', { id: 1, read: false })
    expect(toggleBtn.textContent).toBe('标为已读')
    expect(firstRow.classList.contains('new')).toBe(true)

    await act(async () => root.unmount())
  })
})
