import { expect, it } from 'vitest'
import { windowsDefaultIcon, darwinDefaultIcon, otherDevicesIcon } from '../assets/default-icons'
import { connectionFallbackIcon } from './connection-icon'

it.each(['win32', 'darwin', 'linux'] as const)(
  'uses the original device fallback without a process path on %s',
  (platform) => {
    expect(connectionFallbackIcon(platform)).toBe(otherDevicesIcon)
    expect(connectionFallbackIcon(platform, '')).toBe(otherDevicesIcon)
  }
)

it.each([
  ['win32', windowsDefaultIcon],
  ['darwin', darwinDefaultIcon],
  ['linux', darwinDefaultIcon]
] as const)('uses the original process fallback on %s', (platform, expected) => {
  expect(connectionFallbackIcon(platform, 'process')).toBe(expected)
})
