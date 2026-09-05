import { test, expect } from '@playwright/test'
import { THEMES } from '../../packages/design-system/themes'
import { gotoWithRetry } from './nav'

for (const theme of THEMES) for (const scale of [100, 110, 125]) for (const [width, height] of [[900, 600], [1280, 800], [1600, 1000]]) {
  test(`${theme.id} ${scale}% ${width}x${height}`, async ({ page }, info) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setViewportSize({ width, height })
    await page.addInitScript(({ id, scale }) => {
      if (window !== window.top) return
      localStorage.setItem('digiworld.theme.v2', id)
      localStorage.setItem('digiworld.text-scale.v1', String(scale))
    }, { id: theme.id, scale })
    await gotoWithRetry(page, '/design.html')
    await expect(page.locator('.home-dashboard')).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: info.outputPath('home.png') })
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await expect(page.getByRole('button', { name: `${scale}%`, exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.screenshot({ path: info.outputPath('settings.png') })
    const hostFont = await page.locator('.dw-button.primary').first().evaluate(el => getComputedStyle(el).fontSize).catch(() => '')
    for (const [label, selector] of [['键盘热力图', '.keyboard-card'], ['Agent Overview', '.weekly-card'], ['邮件助手', '.message-list'], ['Git Actions', '.runs'], ['Servers', '.devices'], ['日历与 Todo', '.agenda']]) {
      await page.getByRole('button', { name: label, exact: true }).click()
      const frame = page.frameLocator('iframe')
      await expect(frame.locator(selector)).toBeVisible()
      await frame.locator('body').evaluate(() => document.fonts.ready)
      expect(await frame.locator('html').evaluate(el => getComputedStyle(el).colorScheme)).toBe(theme.scheme)
      expect(await frame.locator('html').evaluate(el => getComputedStyle(el).fontSize)).toBe(`${14 * scale / 100}px`)
      if (label === '邮件助手') await frame.locator('.mail-row').first().click()
      expect(await frame.locator('body').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
      await page.screenshot({ path: info.outputPath(`${label}.png`) })
      if (label === 'Agent Overview' && hostFont) expect(await frame.locator('.primary').first().evaluate(el => getComputedStyle(el).fontSize)).toBe(hostFont)
    }
    expect(errors).toEqual([])
  })
}

test('live theme and typography update preserves plugin document and UI state', async ({ page }) => {
  await gotoWithRetry(page, '/design.html')
  await page.getByRole('button', { name: '邮件助手', exact: true }).click()
  const frame = page.frameLocator('iframe')
  await frame.locator('.mail-row').first().click()
  await frame.locator('body').evaluate(el => el.dataset.testState = 'preserved')
  await page.locator('iframe').evaluate((el: HTMLIFrameElement) => {
    el.contentWindow!.postMessage({ source: 'digiworld-host', pluginId: 'io.github.jesmonx.digiworld.mail-assistant', kind: 'theme', payload: { 'color-scheme': 'dark', 'text-scale': '1.25' } }, '*')
  })
  await expect(frame.locator('body')).toHaveAttribute('data-test-state', 'preserved')
  await expect(frame.locator('.detail-head')).toBeVisible()
  expect(await frame.locator('html').evaluate(el => getComputedStyle(el).fontSize)).toBe('17.5px')
})

for (const state of ['empty', 'error']) test(`plugin ${state} states`, async ({ page }) => {
  await gotoWithRetry(page, `/design.html?state=${state}`)
  for (const label of ['键盘热力图', 'Agent Overview', '邮件助手', 'Git Actions', 'Servers', '日历与 Todo']) {
    await page.getByRole('button', { name: label, exact: true }).click()
    await expect(page.frameLocator('iframe').locator('#root')).not.toBeEmpty()
    if (state === 'error') await expect(page.frameLocator('iframe').getByText('演示：暂时无法加载，请重试', { exact: false }).first()).toBeVisible()
  }
})

test('shared controls retain keyboard focus and modal focus containment', async ({ page }) => {
  await gotoWithRetry(page, '/design.html?gallery&theme=catppuccin-mocha')
  await page.getByRole('button', { name: '打开对话框' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByRole('button', { name: '打开对话框' })).toBeFocused()
})

test('servers plugin layout switching, GPU metrics and disk device display', async ({ page }) => {
  await gotoWithRetry(page, '/design.html')
  await page.getByRole('button', { name: 'Servers', exact: true }).click()
  const frame = page.frameLocator('iframe')
  await expect(frame.locator('.devices')).toBeVisible()

  // Clean GPU name and power display
  await expect(frame.getByText('L40', { exact: false })).toBeVisible()
  await expect(frame.getByText('RTX 4090', { exact: false })).toBeVisible()
  await expect(frame.getByText('180W', { exact: false })).toBeVisible()

  // Disk device display
  await expect(frame.getByText('/dev/nvme0n1p2', { exact: false })).toBeVisible()

  // Layout mode switcher
  const layoutSelect = frame.locator('select[aria-label="排布方式"]')
  await expect(layoutSelect).toBeVisible()

  for (const mode of ['compact', 'double', 'single', 'auto'] as const) {
    await layoutSelect.selectOption(mode)
    await expect(frame.locator('.devices')).toHaveClass(new RegExp(`layout-${mode}`))
    const noOverflow = await frame.locator('body').evaluate(el => el.scrollWidth <= el.clientWidth + 1)
    expect(noOverflow).toBe(true)
  }
})

test('calendar plugin filters past events, displays month calendar and supports date selection', async ({ page }) => {
  await gotoWithRetry(page, '/design.html')
  await page.getByRole('button', { name: '日历与 Todo', exact: true }).click()
  const frame = page.frameLocator('iframe')
  await expect(frame.locator('.agenda')).toBeVisible()
  await expect(frame.locator('.month-card')).toBeVisible()

  // Past event should be filtered out
  await expect(frame.getByText('昨日总结')).not.toBeVisible()

  // Today events should be visible
  await expect(frame.getByText('产品评审')).toBeVisible()
  await expect(frame.getByText('架构讨论')).toBeVisible()

  // Month calendar dots should exist
  await expect(frame.locator('.event-dot').first()).toBeVisible()

  // Date selection interaction
  const day7Btn = frame.getByRole('button', { name: /2026-09-07/ })
  await expect(day7Btn).toBeVisible()
  await day7Btn.click()
  await expect(frame.getByText('周一同步')).toBeVisible()

  // Event creation editor
  await frame.getByRole('button', { name: '新建日程' }).first().click()
  await expect(frame.locator('.editor')).toBeVisible()
  await expect(frame.getByRole('heading', { name: '新建事件' })).toBeVisible()
  await frame.getByRole('button', { name: '取消' }).click()
  await expect(frame.locator('.editor')).not.toBeVisible()
})

test('agent overview auto-refresh interval selector', async ({ page }) => {
  await gotoWithRetry(page, '/design.html')
  await page.getByRole('button', { name: 'Agent Overview', exact: true }).click()
  const frame = page.frameLocator('iframe')
  await expect(frame.locator('.weekly-card')).toBeVisible()

  const refreshSelect = frame.locator('.auto-refresh-control select')
  await expect(refreshSelect).toBeVisible()
  // Fixture has 300 seconds default
  await expect(refreshSelect).toHaveValue('300')

  // Switch to 1 minute
  await refreshSelect.selectOption('60')
  await expect(refreshSelect).toHaveValue('60')
})

