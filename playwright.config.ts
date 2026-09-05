import { defineConfig } from '@playwright/test'
process.env.NO_PROXY = [process.env.NO_PROXY, '127.0.0.1', 'localhost'].filter(Boolean).join(',')
process.env.no_proxy = process.env.NO_PROXY
export default defineConfig({
  testDir: './tests/ui', timeout: 90_000, retries: process.env.CI ? 2 : 0, workers: process.env.CI ? 1 : 3, fullyParallel: !process.env.CI,
  reporter: [['list'], ['html', { outputFolder: 'dist/ui-report', open: 'never' }], ['./tests/ui/reporter.ts']],
  outputDir: 'dist/ui-results',
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://127.0.0.1:1420',
    browserName: 'chromium',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    launchOptions: {
      args: ['--disable-background-networking'],
    },
  },
  webServer: { command: 'pnpm design:preview', url: 'http://127.0.0.1:1420/design.html', reuseExistingServer: !process.env.CI, timeout: 60_000 },
})
