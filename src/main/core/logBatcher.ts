const FLUSH_INTERVAL_MS = 100
const MAX_PENDING_LOGS = 100
const MAX_LOG_LENGTH = 16 * 1024

// Bound both IPC frequency and work per batch. A broken core can emit tens of
// thousands of errors a second; a bounded renderer cache alone cannot protect
// the main thread or Chromium's IPC queue from that stream.
export function createLogBatcher(send: (logs: IMihomoLogInfo[]) => void): {
  push: (data: string) => void
  dispose: () => void
} {
  let pending: IMihomoLogInfo[] = []
  let dropped = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  const flush = (): void => {
    timer = undefined
    const batch = pending
    pending = []
    if (dropped > 0) {
      batch.push({
        type: 'warning',
        payload: `[Clash Party] ${dropped} logs omitted from the live view due to excessive log volume.`
      })
      dropped = 0
    }
    if (batch.length > 0) send(batch)
  }

  return {
    push(data): void {
      if (disposed) return
      if (!timer) timer = setTimeout(flush, FLUSH_INTERVAL_MS)
      // Drop before parsing so a flood cannot monopolize the main thread.
      if (pending.length >= MAX_PENDING_LOGS || data.length > MAX_LOG_LENGTH) {
        dropped++
        return
      }
      try {
        const log = JSON.parse(data) as IMihomoLogInfo | null
        if (log && typeof log.type === 'string' && typeof log.payload === 'string') {
          pending.push(log)
        }
      } catch {
        // Ignore malformed core messages, as the unbatched stream did.
      }
    },
    dispose(): void {
      disposed = true
      if (timer) clearTimeout(timer)
      timer = undefined
      pending = []
      dropped = 0
    }
  }
}
