import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inspectCss, inspectCode } from './check-ui.mjs'
test('rejects light-only CSS and fonts while allowing semantic visualizations', () => {
  assert.ok(inspectCss('a { color: #fff; font-size: 11px; color-scheme: light }').length >= 3)
  assert.ok(inspectCss('@font-face { font-family: Plugin; src: url(x.woff2) }').length)
  assert.deepEqual(inspectCss('a { color: var(--dw-text); font-size: var(--dw-type-body); border-radius: var(--dw-radius-sm); width: 42px }'), [])
})
test('checks inline typography and SVG palette literals', () => {
  assert.ok(inspectCode('const x = <svg fill="#ffffff" style={{ fontSize: 10 }} />').length >= 2)
  assert.deepEqual(inspectCode('const x = <svg fill="var(--dw-chart-1)" style={{ width: 100 }} />'), [])
})
