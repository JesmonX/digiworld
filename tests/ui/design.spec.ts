import { test, expect } from '@playwright/test'
import { THEMES } from '../../packages/design-system/themes'

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
    await page.goto('/design.html')
    await expect(page.locator('.app-window')).toBeVisible()
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
  await page.goto('/design.html')
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
  await page.goto(`/design.html?state=${state}`)
  for (const label of ['键盘热力图', 'Agent Overview', '邮件助手', 'Git Actions', 'Servers', '日历与 Todo']) {
    await page.getByRole('button', { name: label, exact: true }).click()
    await expect(page.frameLocator('iframe').locator('#root')).not.toBeEmpty()
    if (state === 'error') await expect(page.frameLocator('iframe').getByText('演示：暂时无法加载，请重试', { exact: false }).first()).toBeVisible()
  }
})

test('shared controls retain keyboard focus and modal focus containment', async ({ page }) => {
  await page.goto('/design.html?gallery&theme=catppuccin-mocha')
  await page.getByRole('button', { name: '打开对话框' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByRole('button', { name: '打开对话框' })).toBeFocused()
})
