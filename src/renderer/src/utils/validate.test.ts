import { describe, expect, it } from 'vitest'
import { geoipValidator } from './validate'

describe('geoipValidator', () => {
  it('accepts named GeoIP categories', () => {
    expect(geoipValidator('CN')).toBe(true)
    expect(geoipValidator('PRIVATE')).toBe(true)
    expect(geoipValidator('PRIVATE IP')).toBe(false)
  })
})
