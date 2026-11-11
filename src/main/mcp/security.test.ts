import { describe, expect, it } from 'vitest'
import { hasValidBearerToken, isLoopbackAddress } from './security'

describe('MCP security helpers', () => {
  it('accepts loopback addresses only', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('::1')).toBe(true)
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('192.168.1.10')).toBe(false)
    expect(isLoopbackAddress(undefined)).toBe(false)
  })

  it('compares bearer tokens without accepting missing or incorrect credentials', () => {
    expect(hasValidBearerToken('Bearer secret', 'secret')).toBe(true)
    expect(hasValidBearerToken('bearer secret', 'secret')).toBe(true)
    expect(hasValidBearerToken('Bearer wrong', 'secret')).toBe(false)
    expect(hasValidBearerToken(undefined, 'secret')).toBe(false)
  })
})
