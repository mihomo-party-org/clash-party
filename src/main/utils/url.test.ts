import { describe, expect, it } from 'vitest'
import { isHttpUrl } from './url'

describe('isHttpUrl', () => {
  it.each(['http://example.com', 'https://example.com/path?q=1', 'HTTPS://example.com'])(
    'allows web URL %s',
    (value) => {
      expect(isHttpUrl(value)).toBe(true)
    }
  )

  it.each([
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,test',
    'mailto:user@example.com',
    'sparkle://import',
    'ftp://example.com',
    '//example.com',
    '/relative',
    'https://',
    '',
    null,
    undefined,
    123,
    ['https://example.com']
  ])('rejects non-web or invalid value %j', (value) => {
    expect(isHttpUrl(value)).toBe(false)
  })
})
