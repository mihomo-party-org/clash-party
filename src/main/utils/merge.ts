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

export function deepMerge<T extends object>(target: T, other: Partial<T>, isOverride?: boolean): T {
  for (const key in other) {
    if (isObject(other[key])) {
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
      Object.assign(target, { [key]: other[key] })
    }
  }
  return target as T
}
