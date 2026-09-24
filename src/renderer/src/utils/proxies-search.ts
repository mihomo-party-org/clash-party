const PROXIES_SEARCH_KEY = 'proxies-search-value'

function readProxiesSearch(): string[] {
  try {
    const raw = localStorage.getItem(PROXIES_SEARCH_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.map((value) => String(value ?? ''))
  } catch {
    // 损坏数据按未保存处理
  }
  return []
}

function writeProxiesSearch(values: string[]): void {
  try {
    localStorage.setItem(PROXIES_SEARCH_KEY, JSON.stringify(values))
  } catch {
    // 配额/隐私模式失败时保持内存态即可
  }
}

/** #1621：代理组搜索词跨页签/重挂载暂存 */
export function loadProxiesSearch(length: number): string[] {
  const stored = readProxiesSearch()
  if (stored.length === 0) return Array.from({ length }, () => '')
  return Array.from({ length }, (_, index) => stored[index] ?? '')
}

export function saveProxiesSearch(values: string[]): void {
  if (values.length === 0) return
  writeProxiesSearch(values)
}
