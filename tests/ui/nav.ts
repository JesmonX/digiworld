import type { Page } from '@playwright/test'

export async function gotoWithRetry(page: Page, url: string, retries = 3): Promise<void> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await page.goto(url)
      return
    } catch (err) {
      if (attempt === retries - 1 || !String(err).includes('ERR_NO_BUFFER_SPACE')) throw err
      await page.waitForTimeout(1000 * (attempt + 1))
    }
  }
}
