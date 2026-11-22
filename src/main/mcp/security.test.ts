import { describe, expect, it } from 'vitest'
import { hasValidBearerToken, isLoopbackAddress, isTrustedLocalRequest } from './security'

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

  it('requires an exact local Host and rejects browser origins including null', () => {
    for (const host of ['127.0.0.1:28765', 'localhost:28765', '[::1]:28765']) {
      expect(isTrustedLocalRequest({ host }, 28765)).toBe(true)
      for (const origin of ['null', 'https://evil.example', 'http://127.0.0.1:28765', '']) {
        expect(isTrustedLocalRequest({ host, origin }, 28765)).toBe(false)
      }
    }
    for (const host of [
      undefined,
      '127.0.0.1',
      '127.0.0.1:1234',
      'attacker.test:28765',
      '127.0.0.1.attacker.test:28765'
    ]) {
      expect(isTrustedLocalRequest({ host }, 28765)).toBe(false)
    }
  })
})
