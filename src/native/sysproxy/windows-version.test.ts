import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { usesLegacyWindowsBinding } = require('./windows-version.js') as {
  usesLegacyWindowsBinding: (release: string) => boolean
}

describe('usesLegacyWindowsBinding', () => {
  it.each([
    ['6.1.7601', true],
    ['6.2.9200', true],
    ['6.3.9600', true],
    ['6.0.6002', false],
    ['10.0.19045', false],
    ['10.0.26100', false]
  ])('maps Windows release %s to %s', (release, expected) => {
    expect(usesLegacyWindowsBinding(release)).toBe(expected)
  })
})
