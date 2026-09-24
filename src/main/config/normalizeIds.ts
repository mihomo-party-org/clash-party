// Shared id normalization for config YAML that may contain legacy numeric ids.
// Mirrors normalizeOverrideIds in override.ts (#2141 / PR-A).

export function toSafeId(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.length > 0) return value
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : String(value)
  }
  if (value === Infinity) return 'Infinity'
  if (value === -Infinity) return '-Infinity'
  return fallback
}

export function makeFallbackId(): string {
  return `${Date.now().toString(16)}${Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, '0')}`
}

type IdItem = { id?: unknown }

export function normalizeIdList<T extends IdItem>(
  items: T[],
  makeFallback: () => string = makeFallbackId
): Array<T & { id: string }> {
  const result: Array<T & { id: string }> = []
  const seen = new Set<string>()
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as T
    let id = toSafeId(item.id, makeFallback())
    if (seen.has(id)) {
      let n = 2
      let candidate = `${id}-${n}`
      while (seen.has(candidate)) {
        n += 1
        candidate = `${id}-${n}`
      }
      id = candidate
    }
    seen.add(id)
    result.push({ ...item, id })
  }
  return result
}

/** Normalize item ids in a config-shaped object; keeps `current` pointing at the rewritten id. */
export function normalizeConfigIds<T extends { items?: unknown; current?: unknown }>(
  config: T,
  makeFallback: () => string = makeFallbackId
): T {
  const items = config.items
  if (!Array.isArray(items)) return config
  const firstOldToNew = new Map<string, string>()
  const normalized = normalizeIdList(
    items.filter((i): i is IdItem => !!i && typeof i === 'object') as IdItem[],
    makeFallback
  )
  let i = 0
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue
    const oldId = toSafeId((raw as IdItem).id, '')
    const newId = normalized[i]?.id
    if (oldId && newId && !firstOldToNew.has(oldId)) firstOldToNew.set(oldId, newId)
    i += 1
  }
  const next = { ...config, items: normalized } as unknown as T
  if (config.current !== undefined && config.current !== null && config.current !== '') {
    const curKey = toSafeId(config.current, '')
    if (curKey) {
      const mapped = firstOldToNew.get(curKey) ?? curKey
      ;(next as { current?: unknown }).current = mapped
    }
  }
  return next
}
