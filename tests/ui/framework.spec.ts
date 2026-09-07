import { test, expect } from '@playwright/test'
import { THEMES } from '../../packages/design-system/themes'
import { gotoWithRetry } from './nav'

test('plugin template needs no private styling across themes and narrow layouts', async ({ page }) => {
  for (const theme of THEMES) {
    await page.setViewportSize({ width: 900, height: 600 })
    await gotoWithRetry(page, `/design.html?template&theme=${theme.id}`)
    await expect(page.locator('.dw-page')).toBeVisible()
    await expect(page.getByLabel('搜索示例')).toBeVisible()
    await page.getByRole('button', { name: '打开示例记录' }).click()
    await expect(page.getByText('示例记录详情')).toBeVisible()
    await page.getByRole('button', { name: '返回列表' }).click()
    await expect(page.getByRole('button', { name: '打开示例记录' })).toBeVisible()
    expect(await page.locator('.dw-page').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  }
})

test('host rail and content do not overlap and plugin page owns vertical scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 })
  await gotoWithRetry(page, '/design.html')
  const rail = await page.locator('.sidebar').boundingBox()
  const main = await page.locator('.main').boundingBox()
  expect(rail!.x + rail!.width).toBeLessThanOrEqual(main!.x)
  await page.getByRole('button', { name: 'Servers', exact: true }).click()
  const frame = page.frameLocator('iframe')
  await expect(frame.locator('.devices')).toBeVisible()
  const layout = await frame.locator('.dw-page').evaluate(el => ({ display: getComputedStyle(el).display, overflow: getComputedStyle(el).overflowY, height: el.clientHeight, viewport: innerHeight }))
  expect(layout.display).toBe('flex')
  expect(layout.overflow).toBe('auto')
  expect(layout.height).toBe(layout.viewport)
})

test('glass and font preferences reach plugin first paint and live updates preserve content', async ({ page }) => {
  for (const [font, glass] of [['plex', 'disabled'], ['harmony', 'enabled'], ['sarasa', 'disabled']]) {
    await page.addInitScript(({ font, glass }) => {
      if (window !== window.top) return
      localStorage.setItem('digiworld.font-theme.v1', font)
      localStorage.setItem('digiworld.glass.v1', glass)
    }, { font, glass })
    await gotoWithRetry(page, '/design.html')
    await page.getByRole('button', { name: '邮件助手', exact: true }).click()
    const frame = page.frameLocator('iframe')
    await expect(frame.locator('html')).toHaveAttribute('data-dw-glass', glass)
    const hostFont = await page.locator('.app-window').evaluate(el => getComputedStyle(el).fontFamily)
    expect(await frame.locator('html').evaluate(el => getComputedStyle(el).fontFamily)).toBe(hostFont)
    await frame.locator('.mail-row').first().click()
    await frame.locator('body').evaluate(el => el.dataset.retained = 'yes')
    await page.locator('iframe').evaluate((el: HTMLIFrameElement) => el.contentWindow!.postMessage({ source: 'digiworld-host', pluginId: 'io.github.jesmonx.digiworld.mail-assistant', kind: 'theme', payload: { glass: 'enabled', 'color-scheme': 'dark' } }, '*'))
    await expect(frame.locator('html')).toHaveAttribute('data-dw-glass', 'enabled')
    await expect(frame.locator('body')).toHaveAttribute('data-retained', 'yes')
    await expect(frame.locator('.detail-head')).toBeVisible()
  }
})

test('navigation buttons expose stable accessible name and localized status description', async ({ page }) => {
  await gotoWithRetry(page, '/design.html')
  const mailBtn = page.getByRole('button', { name: '邮件助手', exact: true })
  await expect(mailBtn).toBeVisible()
  await expect(mailBtn).toHaveAccessibleName('邮件助手')
  await expect(mailBtn).toHaveAccessibleDescription('运行中')
})
