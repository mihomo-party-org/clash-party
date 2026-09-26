import { windowsDefaultIcon, darwinDefaultIcon, otherDevicesIcon } from '../assets/default-icons'

// Presentation only: fallback images must not turn failed lookups into cached successes.
export function connectionFallbackIcon(platform: NodeJS.Platform, processPath?: string): string {
  if (!processPath) return otherDevicesIcon
  return platform === 'win32' ? windowsDefaultIcon : darwinDefaultIcon
}
