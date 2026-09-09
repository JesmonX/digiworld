import { test, expect } from '@playwright/test'
import { THEMES } from '../../packages/design-system/themes'
import { gotoWithRetry } from './nav'

for (const theme of THEMES) for (const [width, height] of [[900, 600], [1280, 800], [1600, 1000]]) {
  test(`${theme.id} ${width}x${height}`, async ({ page }, info) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setViewportSize({ width, height })
    await page.addInitScript(({ id }) => {
      if (window !== window.top) return
      localStorage.setItem('digiworld.theme.v2', id)
      localStorage.setItem('digiworld.locale.v1', 'zh')
    }, { id: theme.id })
    await gotoWithRetry(page, '/design.html')
    await expect(page.locator('.home-dashboard')).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: info.outputPath('home.png') })
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await expect(page.getByRole('heading', { name: '界面字体', exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath('settings.png') })
    const hostFont = await page.locator('.dw-button.primary').first().evaluate(el => getComputedStyle(el).fontSize).catch(() => '')
    for (const [label, selector, navLabel] of [['键盘热力图', '.keyboard-card', '键盘热力图'], ['Agent Overview', '.weekly-card', 'Agent 概览'], ['邮件助手', '.message-list', '邮件助手'], ['Git Actions', '.runs', 'Git 工作流'], ['Servers', '.devices', '服务器监控'], ['日历与 Todo', '.agenda', '日历与待办'], ['MarkPad', '.markpad-editor', 'MarkPad']] as const) {
      await page.getByRole('button', { name: navLabel, exact: true }).click()
      const frame = page.frameLocator('iframe')
      await expect(frame.locator(selector)).toBeVisible()
      await frame.locator('body').evaluate(() => document.fonts.ready)
      expect(await frame.locator('html').evaluate(el => getComputedStyle(el).colorScheme)).toBe(theme.scheme)
      expect(await frame.locator('html').evaluate(el => getComputedStyle(el).fontSize)).toBe('14px')
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
    el.contentWindow!.postMessage({ source: 'digiworld-host', pluginId: 'io.github.jesmonx.digiworld.mail-assistant', kind: 'theme', payload: { 'color-scheme': 'dark' } }, '*')
  })
  await expect(frame.locator('body')).toHaveAttribute('data-test-state', 'preserved')
  await expect(frame.locator('.detail-head')).toBeVisible()
  expect(await frame.locator('html').evaluate(el => getComputedStyle(el).colorScheme)).toBe('dark')
})

for (const state of ['empty', 'error']) test(`plugin ${state} states`, async ({ page }) => {
  await gotoWithRetry(page, `/design.html?state=${state}`)
  for (const label of ['键盘热力图', 'Agent 概览', '邮件助手', 'Git 工作流', '服务器监控', '日历与待办', 'MarkPad']) {
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

test('built-in plugin names switch language and search accepts either translation', async ({ page }) => {
  await gotoWithRetry(page, '/design.html')
  await expect(page.getByRole('button', { name: 'Agent 概览', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '切换语言', exact: true }).click()
  for (const name of ['Keyboard Heatmap', 'Agent Overview', 'Mail Assistant', 'Git Actions', 'Server Monitor', 'Calendar & Todo']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
  }
  await page.getByRole('button', { name: 'Plugins Store', exact: true }).click()
  const search = page.getByRole('textbox', { name: 'Search plugins', exact: true })
  await search.fill('服务器监控')
  await expect(page.getByRole('heading', { name: 'Server Monitor', exact: true })).toBeVisible()
  await expect(page.locator('.catalog-card')).toHaveCount(1)
})

test('disabled plugin actions menu stays above the plugin content', async ({ page }) => {
  await gotoWithRetry(page, '/design.html?state=disabled')
  await page.getByRole('button', { name: '服务器监控', exact: true }).click()
  await expect(page.getByRole('heading', { name: '已停用' })).toBeVisible()
  await page.getByRole('button', { name: '更多插件操作' }).click()
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: '移除插件' })).toBeVisible()
  const menuLayer = await menu.evaluate(element => {
    const rect = element.getBoundingClientRect()
    const point = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return point?.closest('[role="menu"]') === element
  })
  expect(menuLayer).toBe(true)
})

test('servers plugin layout switching, GPU metrics and disk device display', async ({ page }) => {
  await gotoWithRetry(page, '/design.html')
  await page.getByRole('button', { name: '服务器监控', exact: true }).click()
  const frame = page.frameLocator('iframe')
  await expect(frame.locator('.devices')).toBeVisible()

  // Clean GPU name and power display
  await expect(frame.getByText('L40', { exact: false })).toBeVisible()
  await expect(frame.getByText('RTX 4090', { exact: false })).toBeVisible()
  await expect(frame.getByText('180W', { exact: false })).toBeVisible()
  await expect(frame.getByText('29.3 GB / 45.0 GB (65%)', { exact: false })).toBeVisible()
  await expect(frame.locator('.gpu-grid .metric').first().locator('.dw-progress-track')).toHaveAttribute('aria-valuenow', '65')

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

  await frame.getByRole('button', { name: '设备设置' }).click()
  const gpuMemorySelect = frame.getByRole('combobox', { name: 'GPU 显存显示' })
  await expect(gpuMemorySelect).toHaveValue('both')
  for (const mode of ['percent', 'value', 'both']) {
    await gpuMemorySelect.selectOption(mode)
    await expect(gpuMemorySelect).toHaveValue(mode)
  }
  await expect(frame.getByText('GPU 显示温度', { exact: true })).toBeVisible()
  await expect(frame.getByText('显示 GPU 负载百分比', { exact: true })).toBeVisible()
  const gpuUtilization = frame.getByRole('checkbox', { name: '显示 GPU 负载百分比' })
  await expect(gpuUtilization).toBeChecked()
  await gpuUtilization.uncheck()
  await expect(gpuUtilization).not.toBeChecked()
  await gpuUtilization.check()
  await expect(gpuMemorySelect).toBeVisible()
})

test('calendar plugin filters past events, displays month calendar and supports date selection', async ({ page }) => {
  await gotoWithRetry(page, '/design.html')
  await page.getByRole('button', { name: '日历与待办', exact: true }).click()
  const frame = page.frameLocator('iframe')
  await expect(frame.locator('.agenda')).toBeVisible()
  await expect(frame.locator('.month-card')).toBeVisible()

  // Past event should be filtered out
  await expect(frame.getByText('昨日总结')).not.toBeVisible()

  // Today events should be visible
  await expect(frame.getByText('产品评审')).toBeVisible()
  await expect(frame.getByText('架构讨论')).toBeVisible()
  await expect(frame.getByText('检查 Preview 构建')).toBeVisible()
  await expect(frame.getByText('整理无日期任务')).toBeVisible()
  await expect(frame.getByText('待安排')).toBeVisible()

  // Month calendar dots should exist
  await expect(frame.locator('.event-dot').first()).toBeVisible()
  await expect(frame.locator('.todo-dot').first()).toBeVisible()

  // Date selection interaction
  const futureKey = await frame.locator('body').evaluate(() => {
    const date = new Date(); date.setDate(date.getDate() + 2)
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
  })
  const futureDay = frame.getByRole('button', { name: new RegExp(futureKey) })
  await expect(futureDay).toBeVisible()
  await futureDay.click()
  await expect(frame.getByText('后续同步')).toBeVisible()
  await expect(frame.getByText('产品评审')).not.toBeVisible()
  await expect(frame.getByText('待安排')).not.toBeVisible()
  await expect(frame.locator('input[type="date"]')).toHaveValue(futureKey)

  // Event creation editor
  await frame.getByRole('button', { name: '新建日程' }).first().click()
  await expect(frame.locator('.editor')).toBeVisible()
  await expect(frame.getByRole('heading', { name: '新建事件' })).toBeVisible()
  await expect(frame.locator('input[type="datetime-local"]')).toHaveCount(2)
  await frame.getByRole('button', { name: '取消' }).click()
  await expect(frame.locator('.editor')).not.toBeVisible()
})

test('calendar unknown permissions remain editable and explain server-side confirmation', async ({ page }) => {
  await gotoWithRetry(page, '/design.html?state=permissions')
  await page.getByRole('button', { name: '日历与待办', exact: true }).click()
  const frame = page.frameLocator('iframe')
  await frame.getByRole('button', { name: /产品评审/ }).click()
  await expect(frame.getByText(/权限待确认/)).toBeVisible()
  await expect(frame.getByRole('button', { name: '保存', exact: true })).toBeEnabled()
  await expect(frame.getByRole('button', { name: '删除', exact: true })).toBeEnabled()
})

test('mail narrow layout gives the reader the full content pane and a return path', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 })
  await gotoWithRetry(page, '/design.html')
  await page.getByRole('button', { name: '邮件助手', exact: true }).click()
  const frame = page.frameLocator('iframe')
  await frame.locator('.mail-row').first().click()
  await expect(frame.getByText(/正文 1799\/1799/)).toBeVisible()
  await expect(frame.locator('.detail')).toBeVisible()
  await expect(frame.locator('.message-list')).toBeHidden()
  await expect(frame.getByRole('button', { name: '返回邮件列表' })).toBeVisible()
  await frame.getByRole('button', { name: '返回邮件列表' }).click()
  await expect(frame.locator('.message-list')).toBeVisible()
})

test('actions shows running state as localized status', async ({ page }) => {
  await gotoWithRetry(page, '/design.html')
  await page.getByRole('button', { name: 'Git 工作流', exact: true }).click()
  const frame = page.frameLocator('iframe')
  await expect(frame.locator('.run-status').first()).toHaveText('运行中')
  await expect(frame.getByText('开始于', { exact: false }).first()).toBeVisible()
  await expect(frame.locator('.run-progress')).toHaveCount(2)
  await expect(frame.getByText('流程进度', { exact: true }).first()).toBeVisible()
  await expect(frame.locator('.run').first().locator('.run-progress-head strong')).toHaveText('1/2')
  await expect(frame.locator('.run').first().locator('.run-progress-track')).toHaveAttribute('aria-valuenow', '50')
  await expect(frame.locator('.run').first().getByText('当前步骤：Build', { exact: true })).toBeVisible()
  await frame.getByRole('button', { name: '展开 Job 与步骤' }).first().click()
  const activeJob = frame.locator('.run').first().locator('details.job-detail')
  await expect(activeJob).not.toHaveAttribute('open', '')
  await expect(activeJob.getByText('Windows build', { exact: true })).toBeVisible()
  await activeJob.locator('summary').click()
  await expect(activeJob.getByText('Checkout', { exact: true })).toBeVisible()
  const historicalRun = frame.locator('.run').nth(1)
  await historicalRun.getByRole('button', { name: '展开 Job 与步骤' }).click()
  await expect(historicalRun.getByText('Linux test', { exact: true })).toBeVisible()
  const job = historicalRun.locator('details.job-detail')
  await expect(job).not.toHaveAttribute('open', '')
  await job.locator('summary').click()
  await expect(job.getByText('Test', { exact: true })).toBeVisible()
})

test('agent overview auto-refresh interval selector', async ({ page }) => {
  await gotoWithRetry(page, '/design.html')
  await page.getByRole('button', { name: 'Agent 概览', exact: true }).click()
  const frame = page.frameLocator('iframe')
  await expect(frame.locator('.weekly-card')).toBeVisible()
  await expect(frame.getByText('Credits balance', { exact: true })).toBeVisible()
  await expect(frame.getByText('$12.5', { exact: true })).toBeVisible()

  const settingsButton = frame.getByRole('button', { name: '设置', exact: true })
  await settingsButton.click()
  const refreshSelect = frame.locator('.session-refresh-settings select')
  await expect(refreshSelect).toBeVisible()
  // Fixture has 300 seconds default
  await expect(refreshSelect).toHaveValue('300')

  // Switch to 1 minute
  await refreshSelect.selectOption('60')
  await expect(refreshSelect).toHaveValue('60')
})
