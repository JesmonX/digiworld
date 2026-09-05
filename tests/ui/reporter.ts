import type { FullConfig, FullResult, Reporter, Suite } from '@playwright/test/reporter'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
export default class DesignReporter implements Reporter {
  private complete = false
  onBegin(_config: FullConfig, suite: Suite) {
    const titles = new Set(suite.allTests().map(test => test.title))
    this.complete = ['catppuccin-latte', 'catppuccin-mocha', 'rose-pine-dawn', 'rose-pine-moon'].every(theme => [100, 110, 125].every(scale => ['900x600', '1280x800', '1600x1000'].every(size => titles.has(`${theme} ${scale}% ${size}`)))) && ['plugin empty states', 'plugin error states', 'live theme and typography update preserves plugin document and UI state', 'shared controls retain keyboard focus and modal focus containment'].every(title => titles.has(title))
  }
  async onEnd(result: FullResult) {
    const plugins: Record<string, string> = {}
    for (const name of ['keyboard-heatmap', 'agent-token-heatmap', 'mail-assistant', 'github-actions', 'server-monitor', 'calendar-todo']) plugins[name] = createHash('sha256').update(await readFile(`plugins/${name}/ui/dist/index.html`)).digest('hex')
    await mkdir('dist', { recursive: true })
    await writeFile('dist/ui-validation.json', JSON.stringify({ status: result.status === 'passed' && !this.complete ? 'partial' : result.status, plugins, environment: 'Chromium with synthetic data; native WebView acceptance is separate', generatedAt: new Date().toISOString() }, null, 2))
  }
}
