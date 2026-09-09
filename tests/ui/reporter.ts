import type { FullConfig, FullResult, Reporter, Suite } from '@playwright/test/reporter'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
export default class DesignReporter implements Reporter {
  private complete = false
  onBegin(_config: FullConfig, suite: Suite) {
    const titles = new Set(suite.allTests().map(test => test.title))
    this.complete = ['light', 'dark'].every(theme => ['900x600', '1280x800', '1600x1000'].every(size => titles.has(`${theme} ${size}`)) && ['classic'].every(scheme => titles.has(`${theme} ${scheme} readable semantic pairs`))) && ['MarkPad edits, autosaves, searches across dates and confirms deletion', 'plugin empty states', 'plugin error states', 'live theme and typography update preserves plugin document and UI state', 'shared controls retain keyboard focus and modal focus containment', 'plugin template needs no private styling across themes and narrow layouts', 'host rail and content do not overlap and plugin page owns vertical scrolling'].every(title => titles.has(title))
  }
  async onEnd(result: FullResult) {
    const plugins: Record<string, string> = {}
    for (const name of ['keyboard-heatmap', 'agent-token-heatmap', 'mail-assistant', 'github-actions', 'server-monitor', 'calendar-todo', 'markpad']) plugins[name] = createHash('sha256').update(await readFile(`plugins/${name}/ui/dist/index.html`)).digest('hex')
    await mkdir('dist', { recursive: true })
    await writeFile('dist/ui-validation.json', JSON.stringify({ status: result.status === 'passed' && !this.complete ? 'partial' : result.status, plugins, environment: 'Chromium with synthetic data; native WebView acceptance is separate', generatedAt: new Date().toISOString() }, null, 2))
  }
}
