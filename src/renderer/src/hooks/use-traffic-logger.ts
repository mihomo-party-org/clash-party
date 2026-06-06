import { useEffect, useRef } from 'react'
import { db, type DataUsageLog } from '@renderer/utils/db'

const FLUSH_DELAY_MS = 5000
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000

interface TrafficSnapshot {
  upload: number
  download: number
}

export function useTrafficLogger(enabled = true): void {
  const connectionLastDataRef = useRef(new Map<string, TrafficSnapshot>())
  const logBufferRef = useRef<DataUsageLog[]>([])
  const flushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastTotalsRef = useRef({ upload: 0, download: 0 })
  const enabledRef = useRef(enabled)
  const runIdRef = useRef(0)
  enabledRef.current = enabled

  useEffect(() => {
    const clearFlushTimer = (): void => {
      if (flushTimeoutRef.current) {
        clearTimeout(flushTimeoutRef.current)
        flushTimeoutRef.current = null
      }
    }

    const resetRuntimeState = (): void => {
      clearFlushTimer()
      connectionLastDataRef.current.clear()
      logBufferRef.current = []
      lastTotalsRef.current = { upload: 0, download: 0 }
    }

    const isCurrentRun = (runId: number): boolean =>
      enabledRef.current && runIdRef.current === runId

    if (!enabled) {
      runIdRef.current += 1
      resetRuntimeState()
      return
    }

    runIdRef.current += 1
    const runId = runIdRef.current
    const enabledAt = Date.now()
    resetRuntimeState()

    const flushLogs = async (): Promise<void> => {
      if (!isCurrentRun(runId)) {
        logBufferRef.current = []
        return
      }

      const toFlush = logBufferRef.current
      if (toFlush.length === 0) return
      logBufferRef.current = []

      try {
        await db.open()
        if (!isCurrentRun(runId)) return
        await db.addLogs(toFlush)
        if (!isCurrentRun(runId)) return
        await db.cleanup(Date.now() - RETENTION_MS)
      } catch (e) {
        console.error('[TrafficLogger] flush failed', e)
      }
    }

    const scheduleFlush = (): void => {
      if (!isCurrentRun(runId)) return
      if (flushTimeoutRef.current) return
      flushTimeoutRef.current = setTimeout(async () => {
        flushTimeoutRef.current = null
        if (!isCurrentRun(runId)) {
          logBufferRef.current = []
          return
        }
        await flushLogs()
      }, FLUSH_DELAY_MS)
    }

    const shouldLogInitialSnapshot = (conn: IMihomoConnectionDetail): boolean => {
      const startAt = Date.parse(conn.start)
      return Number.isFinite(startAt) && startAt >= enabledAt
    }

    const handler = (_e: unknown, ...args: unknown[]): void => {
      if (!isCurrentRun(runId)) return

      const info = args[0] as IMihomoConnectionsInfo | undefined
      if (!info) return

      const uploadTotal = info.uploadTotal || 0
      const downloadTotal = info.downloadTotal || 0

      // Detect service restart (totals decreased)
      if (
        uploadTotal < lastTotalsRef.current.upload ||
        downloadTotal < lastTotalsRef.current.download
      ) {
        connectionLastDataRef.current.clear()
        logBufferRef.current = []
      }
      lastTotalsRef.current = { upload: uploadTotal, download: downloadTotal }

      const connections = info.connections ?? []
      if (connections.length === 0) {
        connectionLastDataRef.current.clear()
        return
      }

      const now = Date.now()
      let hasDeltas = false
      const activeConnectionIds = new Set<string>()

      for (const conn of connections) {
        activeConnectionIds.add(conn.id)

        const currentUpload = conn.upload || 0
        const currentDownload = conn.download || 0
        const last = connectionLastDataRef.current.get(conn.id)

        connectionLastDataRef.current.set(conn.id, {
          upload: currentUpload,
          download: currentDownload
        })

        const uploadDelta = last
          ? Math.max(0, currentUpload - last.upload)
          : shouldLogInitialSnapshot(conn)
            ? currentUpload
            : 0
        const downloadDelta = last
          ? Math.max(0, currentDownload - last.download)
          : shouldLogInitialSnapshot(conn)
            ? currentDownload
            : 0

        if (uploadDelta === 0 && downloadDelta === 0) continue

        hasDeltas = true
        logBufferRef.current.push({
          timestamp: now,
          sourceIP: conn.metadata.sourceIP || 'Inner',
          host: conn.metadata.host || conn.metadata.destinationIP || 'Unknown',
          process: conn.metadata.process || 'Unknown',
          outbound: conn.chains?.[0] || 'DIRECT',
          upload: uploadDelta,
          download: downloadDelta
        })
      }

      for (const id of connectionLastDataRef.current.keys()) {
        if (!activeConnectionIds.has(id)) {
          connectionLastDataRef.current.delete(id)
        }
      }

      if (hasDeltas) scheduleFlush()
    }

    window.electron.ipcRenderer.on('mihomoConnections', handler)

    return (): void => {
      window.electron.ipcRenderer.removeListener('mihomoConnections', handler)
      runIdRef.current += 1
      resetRuntimeState()
    }
  }, [enabled])
}
