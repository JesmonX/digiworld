// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { ConfigTransfer } from './ConfigTransfer'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const transferConfig = vi.hoisted(() => vi.fn())
vi.mock('../lib/api', () => ({ api: { transferConfig } }))
// Keep the actual controls while avoiding browser-only dialog APIs in jsdom.
vi.mock('@digiworld/design-system/react', async importOriginal => ({
  ...await importOriginal<typeof import('@digiworld/design-system/react')>(),
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div role="dialog">{children}</div> : null,
}))

let container: HTMLDivElement
let root: Root
beforeEach(async () => {
  transferConfig.mockReset()
  localStorage.clear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<ConfigTransfer locale="zh" />))
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })

function button(text: string) {
  return [...container.querySelectorAll('button')].find(button => button.textContent === text)!
}
async function input(index: number, value: string) {
  await act(async () => {
    const element = container.querySelectorAll('input')[index]!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

it('requires matching passwords and exports only known preferences', async () => {
  localStorage.setItem('digiworld.theme.v2', 'dark')
  localStorage.setItem('unrelated-token', 'excluded')
  transferConfig.mockResolvedValue({ preferences: {}, warnings: [] })
  await act(async () => button('导出配置').click())
  await input(0, 'test-password')
  await input(1, 'mismatch')
  expect(button('选择文件并继续').disabled).toBe(true)
  await input(1, 'test-password')
  await act(async () => button('选择文件并继续').click())
  expect(transferConfig).toHaveBeenCalledWith(false, 'test-password', { 'digiworld.theme.v2': 'dark' })
  expect(container.querySelector('input')).toBeNull()
  expect(container.textContent).toContain('加密配置已导出')
})

it('handles import cancellation and errors without changing preferences', async () => {
  localStorage.setItem('digiworld.theme.v2', 'light')
  await act(async () => button('导入配置').click())
  await input(0, 'test-password')
  transferConfig.mockResolvedValueOnce(null)
  await act(async () => button('选择文件并继续').click())
  expect(container.textContent).not.toContain('配置已导入')
  transferConfig.mockRejectedValueOnce('Incorrect password or damaged backup')
  await act(async () => button('选择文件并继续').click())
  expect(container.textContent).toContain('Incorrect password')
  expect(localStorage.getItem('digiworld.theme.v2')).toBe('light')
})

it('restores allowed preferences and displays missing credential warnings', async () => {
  transferConfig.mockResolvedValue({ preferences: { 'digiworld.theme.v2': 'dark', 'unrelated': 'no' }, warnings: ['Credential missing: mail-assistant/test'] })
  await act(async () => button('导入配置').click())
  await input(0, 'test-password')
  await act(async () => button('选择文件并继续').click())
  expect(localStorage.getItem('digiworld.theme.v2')).toBe('dark')
  expect(localStorage.getItem('unrelated')).toBeNull()
  expect(container.textContent).toContain('Credential missing')
  expect(button('刷新界面')).toBeDefined()
})
