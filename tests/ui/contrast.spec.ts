import { test, expect } from '@playwright/test'
import { THEMES } from '../../packages/design-system/themes'
import { gotoWithRetry } from './nav'

for (const theme of THEMES) test(`${theme.id} readable semantic pairs`, async ({ page }) => {
  await gotoWithRetry(page, `/design.html?gallery&theme=${theme.id}`)
  const pairs = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d')!
    const root = document.documentElement
    const color = (token: string) => {
      const el = document.createElement('span'); el.style.color = `var(--dw-${token})`; root.append(el)
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = getComputedStyle(el).color; ctx.fillRect(0, 0, 1, 1); el.remove()
      const channels = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4)
      return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
    }
    const cases: [string, string, number][] = []
    for (const text of ['text', 'text-muted']) for (const bg of ['bg', 'surface', 'surface-subtle', 'surface-raised']) cases.push([text, bg, 4.5])
    for (const tone of ['success', 'warning', 'danger']) cases.push([tone, `${tone}-soft`, 4.5])
    cases.push(['accent-contrast', 'accent', 4.5], ['accent-strong', 'accent-soft', 4.5], ['border-strong', 'surface', 3], ['focus', 'surface', 3], ['heat-text-high', 'heat-high', 4.5])
    return cases.map(([fg, bg, min]) => { const a = color(fg), b = color(bg); return { fg, bg, min, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) } })
  })
  for (const pair of pairs) expect(pair.ratio, `${theme.id} ${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(pair.min)
})
