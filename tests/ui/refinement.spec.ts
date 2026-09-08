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
    await page.getByRole('button', { name: '日历与待办', exact: true }).click()
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
  await page.getByRole('button', { name: 'Agent 概览', exact: true }).click()
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

test('heatmap focus ring scales at the scroll edges and respects reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 })
  await gotoWithRetry(page, '/design.html')
  await page.getByRole('button', { name: 'Agent 概览', exact: true }).click()
  const frame = page.frameLocator('iframe')
  const cells = frame.locator('.calendar-grid i:not(.blank)')
  const blankCells = frame.locator('.calendar-grid i.blank[data-tooltip]')
  await expect(cells).not.toHaveCount(0)
  await expect(blankCells).toHaveCount(0)

  for (const cell of [cells.first(), cells.last()]) {
    await cell.focus()
    await page.waitForTimeout(220)
    const state = await cell.evaluate(element => {
      const wrap = element.closest('.calendar-wrap')!.getBoundingClientRect()
      const box = element.getBoundingClientRect()
      const ring = getComputedStyle(element, '::after')
      return { inside: box.left >= wrap.left && box.right <= wrap.right, transform: getComputedStyle(element).transform, ringOpacity: ring.opacity, ringColor: ring.borderColor }
    })
    expect(state.inside).toBe(true)
    expect(state.transform).not.toBe('none')
    expect(state.ringOpacity).toBe('1')
    expect(state.ringColor).not.toBe('rgba(0, 0, 0, 0)')
  }

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await cells.first().focus()
  expect(await cells.first().evaluate(element => getComputedStyle(element).transform)).toBe('none')
  expect(await cells.first().evaluate(element => getComputedStyle(element, '::after').animationName)).toBe('none')
  expect(await cells.first().evaluate(element => getComputedStyle(element, '::after').opacity)).toBe('1')
})

test('weekly chart labels retain their rendered size at all supported widths', async ({ page }) => {
  await gotoWithRetry(page, '/design.html')
  await page.getByRole('button', { name: 'Agent 概览', exact: true }).click()
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

test('weekly chart tooltips omit dates while axes and accessible labels retain them', async ({ page }) => {
  await gotoWithRetry(page, '/design.html')
  await page.getByRole('button', { name: 'Agent 概览', exact: true }).click()
  const frame = page.frameLocator('iframe')
  const tooltip = frame.getByRole('tooltip')
  const group = frame.locator('.weekly-chart g[data-tooltip]').first()
  await group.focus()
  await expect(tooltip).toBeVisible()
  await expect(tooltip).not.toContainText(/2026-\d\d-\d\d/)
  await expect(group).toHaveAttribute('aria-label', /2026-\d\d-\d\d/)

  const segment = frame.locator('.weekly-chart rect.token-segment[data-tooltip]').first()
  await segment.hover()
  await expect(tooltip).toBeVisible()
  await expect(tooltip).not.toContainText(/2026-\d\d-\d\d/)
  const cachePoint = frame.locator('.weekly-chart circle.cache-point[data-tooltip]').first()
  await cachePoint.hover()
  await expect(tooltip).toBeVisible()
  await expect(tooltip).not.toContainText(/2026-\d\d-\d\d/)
})

test('quota card keeps one outer size while Codex and AGY content changes', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 })
  await gotoWithRetry(page, '/design.html')
  await page.getByRole('button', { name: 'Agent 概览', exact: true }).click()
  const frame = page.frameLocator('iframe')
  const card = frame.locator('.quota-card')
  const codex = await card.boundingBox()
  await frame.getByRole('button', { name: '下一个限额卡片', exact: true }).click()
  const agy = await card.boundingBox()
  expect(codex).not.toBeNull()
  expect(agy).not.toBeNull()
  expect(Math.abs(codex!.width - agy!.width)).toBeLessThanOrEqual(1)
  expect(Math.abs(codex!.height - agy!.height)).toBeLessThanOrEqual(1)
  await expect(frame.locator('.quota-pane[aria-hidden="true"]')).toHaveAttribute('inert', '')
})

test('agent accent tooltips remain themed and readable across schemes and modes', async ({ page }) => {
  for (const theme of THEMES) for (const scheme of COLOR_SCHEMES) {
    await page.addInitScript(({ theme, scheme }) => {
      localStorage.setItem('digiworld.theme.v2', theme)
      localStorage.setItem('digiworld.color-scheme.v1', scheme)
    }, { theme: theme.id, scheme: scheme.id })
    await gotoWithRetry(page, '/design.html')
    await page.getByRole('button', { name: 'Agent 概览', exact: true }).click()
    const frame = page.frameLocator('iframe')
    const target = frame.locator('.weekly-chart g[data-tooltip]').first()
    await target.focus()
    const colors = await frame.getByRole('tooltip').evaluate(element => {
      const parse = (value: string) => {
        const match = value.match(/rgba?\(([^)]+)\)/)
        if (!match) return null
        const channels = match[1]!.split(',').map(channel => Number.parseFloat(channel.trim()))
        return channels.slice(0, 3).map(channel => channel / 255)
      }
      const luminance = (value: string) => {
        const rgb = parse(value)
        if (!rgb) return 0
        return rgb.map((channel, index) => (channel <= .03928 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index]!).reduce((sum, value) => sum + value, 0)
      }
      const foreground = getComputedStyle(element).color
      const background = getComputedStyle(element).backgroundColor
      const light = luminance(foreground)
      const dark = luminance(background)
      return { variant: element.getAttribute('data-variant'), contrast: (Math.max(light, dark) + .05) / (Math.min(light, dark) + .05) }
    })
    expect(colors.variant).toBe('accent')
    expect(colors.contrast).toBeGreaterThanOrEqual(4.5)
  }
})

test('server dialog contains focus and returns it; GPU information is not truncated', async ({ page }) => {
  await gotoWithRetry(page, '/design.html')
  await page.getByRole('button', { name: '服务器监控', exact: true }).click()
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

test('keyboard data uses one Tab stop and hover-only key feedback', async ({ page }) => {
  await gotoWithRetry(page, '/design.html')
  await page.getByRole('button', { name: '键盘热力图', exact: true }).click()
  const frame = page.frameLocator('iframe')
  await expect(frame.locator('.key[tabindex="0"]')).toHaveCount(1)
  const key = frame.locator('.key[aria-label*="Backspace"]')
  await expect(key).not.toHaveAttribute('data-tooltip')
  await expect(key).not.toHaveAttribute('data-tooltip-pointer-only')
  await expect(key).not.toHaveAttribute('title')
  await expect(key).toHaveAttribute('aria-label', /Backspace/)
  await key.focus()
  await expect(frame.getByRole('tooltip')).toBeHidden()
  await expect(key).not.toHaveAttribute('aria-describedby', /dw-tooltip/)
  await key.hover()
  await expect(frame.getByRole('tooltip')).toBeHidden()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await key.evaluate(element => (element as HTMLElement).blur())
  await key.hover()
  expect(await key.evaluate(el => getComputedStyle(el).transform)).not.toBe('none')
  await key.click()
  await expect(key).not.toHaveClass(/is-pressing/)
  await key.focus()
  await expect(key).not.toHaveClass(/is-pressing/)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await key.evaluate(element => (element as HTMLElement).blur())
  await key.hover()
  expect(await key.evaluate(el => getComputedStyle(el).transform)).toBe('none')
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

test('keyboard counts stay readable on every dark color scheme', async ({ page }) => {
  for (const scheme of COLOR_SCHEMES) {
    await page.addInitScript(schemeId => {
      localStorage.setItem('digiworld.theme.v2', 'dark')
      localStorage.setItem('digiworld.color-scheme.v1', schemeId)
    }, scheme.id)
    await gotoWithRetry(page, '/design.html')
    await page.getByRole('button', { name: '键盘热力图', exact: true }).click()
    const frame = page.frameLocator('iframe')
    await expect(frame.locator('.keyboard-board')).toBeVisible()
    await expect(frame.locator('.key.has-count small').first()).toBeVisible()
    const readable = await frame.locator('.key.has-count small').evaluateAll(nodes => {
      const parse = (value: string) => value.match(/rgba?\(([^)]+)\)/)?.[1]?.split(',').map(channel => Number.parseFloat(channel.trim()) / 255).slice(0, 3) ?? []
      const luminance = (value: string) => parse(value).map((channel, index) => (channel <= .03928 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index]!).reduce((sum, item) => sum + item, 0)
      return nodes.map(node => {
        const style = getComputedStyle(node)
        const contrast = (Math.max(luminance(style.color), luminance(style.backgroundColor)) + .05) / (Math.min(luminance(style.color), luminance(style.backgroundColor)) + .05)
        return { color: style.color, contrast }
      })
    })
    expect(readable.length).toBeGreaterThan(0)
    expect(readable.every(item => item.color !== 'rgb(0, 0, 0)' && item.contrast >= 4.5)).toBe(true)
  }
})

for (const theme of THEMES) for (const scheme of COLOR_SCHEMES) test(`actual controls use ${theme.id} ${scheme.id} colors`, async ({ page }) => {
  await page.addInitScript(({ theme, scheme }) => {
    localStorage.setItem('digiworld.theme.v2', theme)
    localStorage.setItem('digiworld.color-scheme.v1', scheme)
  }, { theme: theme.id, scheme: scheme.id })
  await gotoWithRetry(page, '/design.html')
  const expected = await page.locator('.app-window').evaluate(el => getComputedStyle(el).getPropertyValue('--dw-accent-secondary').trim())
  await page.getByRole('button', { name: '服务器监控', exact: true }).click()
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
  await page.getByRole('button', { name: 'Git 工作流', exact: true }).click()
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
