import { test, expect } from '@playwright/test'
import { gotoWithRetry } from './nav'
import { THEMES, COLOR_SCHEMES } from '../../packages/design-system/themes'

test('calendar columns remain separate across widths, fonts and heavier text', async ({ page }) => {
  for (const font of ['plex', 'harmony', 'sarasa']) {
    await page.addInitScript(font => {
      localStorage.setItem('digiworld.font-theme.v1', font)
      localStorage.setItem('digiworld.font-weight.v1', '600')
    }, font)
    await gotoWithRetry(page, '/design.html')
    await page.getByRole('button', { name: '日历与 Todo', exact: true }).click()
    const frame = page.frameLocator('iframe')
    await expect(frame.locator('.month-card')).toBeVisible()
    for (const width of [900, 1040, 1100, 1280, 1600]) {
      await page.setViewportSize({ width, height: 800 })
      const geometry = await frame.locator('.month-card').evaluate(card => {
        const box = card.getBoundingClientRect()
        const aside = document.querySelector('.dw-split-aside')!.getBoundingClientRect()
        const main = document.querySelector('.dw-split-main')!.getBoundingClientRect()
        return { fits: box.right <= aside.right + 1, separate: box.right <= main.left + 1 || box.bottom <= main.top + 1 }
      })
      expect(geometry).toEqual({ fits: true, separate: true })
    }
    await expect(frame.getByRole('button', { name: '新建日程', exact: true })).toHaveCount(1)
  }
})

test('heatmap tooltip avoids clipping and supports arrows, Escape and scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 })
  await gotoWithRetry(page, '/design.html')
  await page.getByRole('button', { name: 'Agent Overview', exact: true }).click()
  const frame = page.frameLocator('iframe')
  const cells = frame.locator('.calendar-grid i[data-tooltip]')
  await cells.first().focus()
  const tip = frame.getByRole('tooltip')
  await expect(tip).toBeVisible()
  expect(await tip.evaluate(el => {
    const r = el.getBoundingClientRect()
    return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && el.matches(':popover-open')
  })).toBe(true)
  await expect(cells.first()).toHaveAttribute('aria-describedby', /dw-tooltip/)
  await page.keyboard.press('ArrowRight')
  await expect(cells.nth(1)).toBeFocused()
  await expect(frame.locator('.calendar-grid [tabindex="0"]')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(tip).toBeHidden()
  await expect(cells.nth(1)).not.toHaveAttribute('aria-describedby', /dw-tooltip/)
  await cells.last().hover()
  await expect(tip).toBeVisible()
  await frame.locator('.dw-page').evaluate(el => { el.scrollTop = 0 })
  await expect(tip).toBeHidden()
})

test('weekly chart labels retain their rendered size at all supported widths', async ({ page }) => {
  await gotoWithRetry(page, '/design.html')
  await page.getByRole('button', { name: 'Agent Overview', exact: true }).click()
  const frame = page.frameLocator('iframe')
  for (const width of [900, 1280, 1600]) {
    await page.setViewportSize({ width, height: 800 })
    await expect(frame.locator('.weekly-chart')).toBeVisible()
    await expect.poll(() => frame.locator('.weekly-chart .chart-axis-label').evaluateAll(nodes => Math.min(...nodes.map(node => {
      const el = node as SVGGraphicsElement
      return parseFloat(getComputedStyle(el).fontSize) * el.getScreenCTM()!.a
    })))).toBeGreaterThanOrEqual(11.99)
  }
})

test('server dialog contains focus and returns it; GPU information is not truncated', async ({ page }) => {
  await gotoWithRetry(page, '/design.html')
  await page.getByRole('button', { name: 'Servers', exact: true }).click()
  const frame = page.frameLocator('iframe')
  const trigger = frame.getByRole('button', { name: '设备设置', exact: true })
  await trigger.click()
  const dialog = frame.getByRole('dialog')
  await expect(dialog).toBeVisible()
  for (let index = 0; index < 30; index++) {
    await page.keyboard.press('Tab')
    expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
  await expect(frame.locator('.metric .dw-progress-header')).toHaveCount(0)
  expect(await frame.locator('.metric-value').evaluateAll(nodes => nodes.every(el => el.scrollWidth <= el.clientWidth + 1))).toBe(true)
})

test('keyboard data uses one Tab stop and shared full-name tooltips', async ({ page }) => {
  await gotoWithRetry(page, '/design.html')
  await page.getByRole('button', { name: '键盘热力图', exact: true }).click()
  const frame = page.frameLocator('iframe')
  await expect(frame.locator('.key[tabindex="0"]')).toHaveCount(1)
  const key = frame.locator('.key[data-tooltip*="Backspace"]')
  await expect(key).toHaveAttribute('data-tooltip-pointer-only', 'true')
  await expect(key).toHaveAttribute('aria-label', /Backspace/)
  await key.focus()
  await expect(frame.getByRole('tooltip')).toBeHidden()
  await expect(key).not.toHaveAttribute('aria-describedby', /dw-tooltip/)
  await key.hover()
  await expect(frame.getByRole('tooltip')).toContainText('Backspace')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const box = await key.boundingBox()
  if (!box) throw new Error('keyboard key has no layout box')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await expect(key).toHaveClass(/is-pressing/)
  await page.mouse.up()
  await expect(key).not.toHaveClass(/is-pressing/)
  await page.keyboard.down('Enter')
  await expect(key).toHaveClass(/is-pressing/)
  await page.keyboard.up('Enter')
  await expect(key).not.toHaveClass(/is-pressing/)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.keyboard.down('Enter')
  await expect(key).not.toHaveClass(/is-pressing/)
  await page.keyboard.up('Enter')
  await page.keyboard.press('ArrowRight')
  await expect(key).not.toBeFocused()
})

test('keyboard layouts keep a readable key unit at 100% and 125% zoom', async ({ page }) => {
  const layouts = [
    ['full', 104],
    ['tkl', 87],
    ['75', 84],
    ['65', 68],
    ['60', 61],
  ] as const
  for (const zoom of [1, 1.25]) {
    await page.setViewportSize({ width: 900, height: 800 })
    await gotoWithRetry(page, '/design.html')
    await page.getByRole('button', { name: '键盘热力图', exact: true }).click()
    const frame = page.frameLocator('iframe')
    await frame.locator('html').evaluate((element, value) => { (element as HTMLElement).style.zoom = String(value) }, zoom)
    for (const width of [900, 1280, 1600]) {
      await page.setViewportSize({ width, height: 800 })
      for (const [index, [id, count]] of layouts.entries()) {
        await frame.locator('.layout-picker-trigger').click()
        await frame.getByRole('menuitemradio').nth(index).click()
        const board = frame.locator(`.keyboard-board.layout-${id}`)
        await expect(board).toBeVisible()
        const metrics = await board.evaluate((element, expectedCount) => {
          const keys = [...element.querySelectorAll<HTMLElement>('.key')]
          return {
            count: keys.length,
            keyUnit: parseFloat(getComputedStyle(element).getPropertyValue('--key-unit')),
            minHeight: Math.min(...keys.map(key => key.getBoundingClientRect().height)),
            expectedCount,
          }
        }, count)
        expect(metrics.count).toBe(metrics.expectedCount)
        expect(metrics.keyUnit).toBeGreaterThanOrEqual(28)
        expect(metrics.minHeight).toBeGreaterThanOrEqual(27)
      }
    }
  }
})

for (const theme of THEMES) for (const scheme of COLOR_SCHEMES) test(`actual controls use ${theme.id} ${scheme.id} colors`, async ({ page }) => {
  await page.addInitScript(({ theme, scheme }) => {
    localStorage.setItem('digiworld.theme.v2', theme)
    localStorage.setItem('digiworld.color-scheme.v1', scheme)
  }, { theme: theme.id, scheme: scheme.id })
  await gotoWithRetry(page, '/design.html')
  const expected = await page.locator('.app-window').evaluate(el => getComputedStyle(el).getPropertyValue('--dw-accent-secondary').trim())
  await page.getByRole('button', { name: 'Servers', exact: true }).click()
  const frame = page.frameLocator('iframe')
  await expect(frame.locator('.dw-progress-track > span').first()).toBeVisible()
  expect(await frame.locator('.dw-progress-track > span').first().evaluate((el, expected) => {
    const probe = document.createElement('span'); probe.style.color = expected; document.body.append(probe)
    const matches = getComputedStyle(el).backgroundColor === getComputedStyle(probe).color
    probe.remove(); return matches
  }, expected)).toBe(true)
  expect(await frame.locator('html').evaluate(el => getComputedStyle(el).getPropertyValue('--dw-focus').trim())).toBe(expected)
})

test('long action metadata remains readable through keyboard tooltips', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 })
  await gotoWithRetry(page, '/design.html?long')
  await page.getByRole('button', { name: 'Git Actions', exact: true }).click()
  const frame = page.frameLocator('iframe')
  const title = frame.locator('.run-head strong').first()
  await title.focus()
  await expect(frame.getByRole('tooltip')).toContainText('VeryLongWorkflowName')
  expect(await frame.getByRole('tooltip').evaluate(el => {
    const r = el.getBoundingClientRect()
    return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight
  })).toBe(true)
  expect(await frame.locator('body').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
})

test('settings menu stays above controls and compact labels retain readable sizes', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 })
  await gotoWithRetry(page, '/design.html')
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.locator('.theme-dropdown-trigger').click()
  expect(await page.locator('.theme-dropdown-menu').evaluate(el => {
    const r = el.getBoundingClientRect()
    return el.contains(document.elementFromPoint(r.left + 20, r.bottom - 10))
  })).toBe(true)
  await page.keyboard.press('Escape')
  await expect(page.locator('.theme-dropdown-trigger')).toBeFocused()
  expect(await page.locator('.font-options button, .scheme-options button, .nav-label').evaluateAll(nodes => nodes.every(el => parseFloat(getComputedStyle(el).fontSize) >= 14))).toBe(true)
  expect(await page.locator('.lang-code').evaluateAll(nodes => nodes.every(el => parseFloat(getComputedStyle(el).fontSize) >= 12))).toBe(true)
  await page.getByRole('button', { name: '毛玻璃说明', exact: true }).focus()
  await expect(page.getByRole('tooltip')).toBeVisible()
})
