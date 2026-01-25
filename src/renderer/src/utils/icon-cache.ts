const ICON_CACHE_MAX_SIZE = 500
const ICON_CACHE_KEY_PREFIX = 'icon_'
const ICON_CACHE_INDEX_KEY = 'icon_cache_index'

export function saveIconToCache(path: string, dataURL: string): void {
  try {
    const indexStr = localStorage.getItem(ICON_CACHE_INDEX_KEY)
    const index: string[] = indexStr ? JSON.parse(indexStr) : []

    const existingIdx = index.indexOf(path)
    if (existingIdx !== -1) {
      index.splice(existingIdx, 1)
    }
    index.push(path)

    while (index.length > ICON_CACHE_MAX_SIZE) {
      const oldestPath = index.shift()
      if (oldestPath) {
        localStorage.removeItem(ICON_CACHE_KEY_PREFIX + oldestPath)
      }
    }

    localStorage.setItem(ICON_CACHE_KEY_PREFIX + path, dataURL)
    localStorage.setItem(ICON_CACHE_INDEX_KEY, JSON.stringify(index))
  } catch {
    clearHalfIconCache()
    try {
      localStorage.setItem(ICON_CACHE_KEY_PREFIX + path, dataURL)
      const indexStr = localStorage.getItem(ICON_CACHE_INDEX_KEY)
      const index: string[] = indexStr ? JSON.parse(indexStr) : []
      const existingIdx = index.indexOf(path)
      if (existingIdx !== -1) {
        index.splice(existingIdx, 1)
      }
      index.push(path)
      localStorage.setItem(ICON_CACHE_INDEX_KEY, JSON.stringify(index))
    } catch {
      // ignore
    }
  }
}

export function getIconFromCache(path: string): string | null {
  try {
    const dataURL = localStorage.getItem(ICON_CACHE_KEY_PREFIX + path)
    if (dataURL) {
      const indexStr = localStorage.getItem(ICON_CACHE_INDEX_KEY)
      if (indexStr) {
        const index: string[] = JSON.parse(indexStr)
        const existingIdx = index.indexOf(path)
        if (existingIdx !== -1) {
          index.splice(existingIdx, 1)
          index.push(path)
          localStorage.setItem(ICON_CACHE_INDEX_KEY, JSON.stringify(index))
        }
      }
    }
    return dataURL
  } catch {
    return null
  }
}

function clearHalfIconCache(): void {
  try {
    const indexStr = localStorage.getItem(ICON_CACHE_INDEX_KEY)
    if (!indexStr) return

    const index: string[] = JSON.parse(indexStr)
    const halfLength = Math.floor(index.length / 2)
    const toRemove = index.splice(0, halfLength)

    toRemove.forEach((path) => {
      localStorage.removeItem(ICON_CACHE_KEY_PREFIX + path)
    })

    localStorage.setItem(ICON_CACHE_INDEX_KEY, JSON.stringify(index))
  } catch {
    // ignore
  }
}
