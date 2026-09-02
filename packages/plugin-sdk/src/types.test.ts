import { describe, expect, it } from 'vitest'
import { MANIFEST_SCHEMA_VERSION, PROTOCOL_VERSION } from './types.js'

describe('protocol constants', () => {
  it('starts with stable version one contracts', () => {
    expect(MANIFEST_SCHEMA_VERSION).toBe(1)
    expect(PROTOCOL_VERSION).toBe(1)
  })
})
