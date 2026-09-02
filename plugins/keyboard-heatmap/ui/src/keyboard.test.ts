import { describe, expect, it } from 'vitest'
import { alphaRows, functionRow, navRows, numpadKeys } from './keyboard'

describe('104-key layout', () => {
  it('contains every required physical key position', () => {
    const ids = [...functionRow, ...alphaRows.flat(), ...navRows.flat(), ...numpadKeys].map(key => key.id)
    expect(ids).toContain('Space')
    expect(ids).toContain('ControlLeft')
    expect(ids).toContain('ControlRight')
    expect(ids).toContain('NumpadEnter')
    expect(ids).toHaveLength(104)
    expect(new Set(ids).size).toBe(104)
  })

  it('renders tall numpad keys as single physical keys', () => {
    expect(numpadKeys.filter(key => key.id === 'NumpadAdd')).toHaveLength(1)
    expect(numpadKeys.find(key => key.id === 'NumpadAdd')?.rowSpan).toBe(2)
    expect(numpadKeys.filter(key => key.id === 'NumpadEnter')).toHaveLength(1)
    expect(numpadKeys.find(key => key.id === 'NumpadEnter')?.rowSpan).toBe(2)
  })
})
