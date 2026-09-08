// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { runProgress, type Run } from './App'

const run = (overrides: Partial<Run> = {}): Run => ({
  id: 1,
  repository: 'owner/repo',
  name: 'CI',
  title: 'CI',
  branch: 'main',
  sha: 'abc123',
  status: 'in_progress',
  conclusion: null,
  url: 'https://github.com/owner/repo/actions/runs/1',
  createdAt: '2026-09-08T00:00:00Z',
  jobs: [],
  ...overrides,
})

describe('runProgress', () => {
  it('keeps a terminal run at 100% while stale step details are incomplete', () => {
    const progress = runProgress(run({ status: 'completed', conclusion: 'success' }), [{
      id: 2,
      name: 'test',
      status: 'completed',
      conclusion: 'success',
      steps: [
        { name: 'Checkout', status: 'completed', conclusion: 'success' },
        { name: 'Upload', status: 'in_progress', conclusion: null },
      ],
    }], true)
    expect(progress.percent).toBe(100)
    expect(progress.current).toBeUndefined()
    expect(progress.detailsPending).toBe(true)
    expect(progress.done).toBe(1)
    expect(progress.total).toBe(2)
  })

  it('does not invent a 0/1 step when details are not loaded', () => {
    const progress = runProgress(run(), [], false)
    expect(progress).toMatchObject({ done: 0, total: 0, percent: 0, terminal: false })
  })

  it('does not label failed terminal runs as all steps successful', () => {
    const progress = runProgress(run({ status: 'completed', conclusion: 'failure' }), [{
      id: 2,
      name: 'test',
      status: 'completed',
      conclusion: 'failure',
      steps: [{ name: 'Test', status: 'completed', conclusion: 'failure' }],
    }], true)
    expect(progress.percent).toBe(100)
    expect(progress.detailsPending).toBe(false)
  })
})
