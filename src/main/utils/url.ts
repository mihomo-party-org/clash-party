export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false

  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}
