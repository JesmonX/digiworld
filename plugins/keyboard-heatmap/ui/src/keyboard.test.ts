import { describe, expect, it } from 'vitest'
import { alphaRows, functionRow, navRows, numpadRows } from './keyboard'

describe('104-key layout', () => {
  it('contains every required physical key position', () => {
    const ids = [...functionRow, ...alphaRows.flat(), ...navRows.flat(), ...numpadRows.flat()].map(key => key.id)
    expect(ids).toContain('Space')
    expect(ids).toContain('ControlLeft')
    expect(ids).toContain('ControlRight')
    expect(ids).toContain('NumpadEnter')
    expect(new Set(ids).size).toBe(104)
  })
})
