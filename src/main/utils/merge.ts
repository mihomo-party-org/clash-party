// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isObject(item: any): boolean {
  return item && typeof item === 'object' && !Array.isArray(item)
}

function trimWrap(str: string): string {
  if (str.startsWith('<') && str.endsWith('>')) {
    return str.slice(1, -1)
  }
  return str
}

// 只有 `+<键名>` 这种显式包裹的写法才表示「把该映射条目排到最前」；
// 裸 `+xxx` 仍按原有的数组前插处理，否则 nameserver-policy 里合法的 `+.example.com` 会被误认成标记
function isPrependEntryKey(key: string): boolean {
  return key.length > 3 && key.startsWith('+<') && key.endsWith('>')
}

// 标量值的键同样可能带 `<>` 包裹或 `!`/`+` 标记，不剥离会生成字面量键（如 `+<+.abc.com>`）
function trimScalarKeyMark(key: string): string {
  if (key.endsWith('!') || key.endsWith('+')) {
    return trimWrap(key.slice(0, -1))
  }
  return trimWrap(key)
}

// 把键插到对象最前并保持其余键的相对顺序；映射类配置（如 nameserver-policy）依赖键顺序
function assignFirst(target: object, key: string, value: unknown): void {
  const rest = { ...target } as Record<string, unknown>
  delete rest[key]
  for (const k of Object.keys(target)) {
    delete (target as Record<string, unknown>)[k]
  }
  Object.assign(target, { [key]: value }, rest)
}

export function deepMerge<T extends object>(target: T, other: Partial<T>, isOverride?: boolean): T {
  for (const key in other) {
    if (isOverride && isPrependEntryKey(key)) {
      const k = trimWrap(key.slice(1))
      const current = target[k]
      let next: unknown = other[key]
      if (Array.isArray(next) && Array.isArray(current)) {
        next = [...next, ...current]
      } else if (isObject(next) && isObject(current)) {
        next = deepMerge(current as object, next as object, isOverride)
      }
      assignFirst(target, k, next)
    } else if (isObject(other[key])) {
      if (key.endsWith('!')) {
        const k = trimWrap(key.slice(0, -1))
        target[k] = other[key]
      } else {
        const k = trimWrap(key)
        if (!target[k]) Object.assign(target, { [k]: {} })
        deepMerge(target[k] as object, other[k] as object, isOverride)
      }
    } else if (Array.isArray(other[key])) {
      if (isOverride && key.startsWith('+')) {
        const k = trimWrap(key.slice(1))
        if (!target[k]) Object.assign(target, { [k]: [] })
        target[k] = [...other[key], ...(target[k] as never[])]
      } else if (isOverride && key.endsWith('+')) {
        const k = trimWrap(key.slice(0, -1))
        if (!target[k]) Object.assign(target, { [k]: [] })
        target[k] = [...(target[k] as never[]), ...other[key]]
      } else {
        const k = trimWrap(key)
        Object.assign(target, { [k]: other[key] })
      }
    } else {
      const k = isOverride ? trimScalarKeyMark(key) : key
      Object.assign(target, { [k]: other[key] })
    }
  }
  return target as T
}
