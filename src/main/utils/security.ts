import path from 'path'

export const ALLOWED_CORE_NAMES = [
  'mihomo',
  'mihomo-alpha',
  'mihomo-smart',
  'mihomo-specific'
] as const

export type AllowedCoreName = (typeof ALLOWED_CORE_NAMES)[number]

export function isAllowedCoreName(core: string): core is AllowedCoreName {
  return ALLOWED_CORE_NAMES.includes(core as AllowedCoreName)
}

export function assertAllowedCoreName(core: string): asserts core is AllowedCoreName {
  if (!isAllowedCoreName(core)) {
    throw new Error(`Invalid core name: ${core}`)
  }
}

export function assertSafeId(id: string, label = 'id'): void {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid ${label}`)
  }
}

export function assertSafeFilename(name: string, label = 'filename'): void {
  if (
    !name ||
    path.isAbsolute(name) ||
    path.basename(name) !== name ||
    name === '.' ||
    name === '..'
  ) {
    throw new Error(`Invalid ${label}`)
  }
}

export function assertSafeCssFilename(name: string): void {
  assertSafeFilename(name, 'theme')
  if (!name.endsWith('.css')) {
    throw new Error('Invalid theme extension')
  }
}

export function resolveInside(root: string, target: string): string {
  const resolvedRoot = path.resolve(root)
  const resolvedTarget = path.resolve(resolvedRoot, target)
  const relativePath = path.relative(resolvedRoot, resolvedTarget)

  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Path escapes allowed directory: ${target}`)
  }

  return resolvedTarget
}
