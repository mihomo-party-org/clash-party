import { useEffect, useRef } from 'react'
import { db, type DataUsageLog } from '@renderer/utils/db'

export function useTrafficLogger(): void {
  const connectionLastDataRef = useRef(new Map<string, { upload: number; download: number }>())
  const logBufferRef = useRef<DataUsageLog[]>([])
  const flushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastTotalsRef = useRef({ upload: 0, download: 0 })

  useEffect(() => {
    const flushLogs = async (): Promise<void> => {
      if (logBufferRef.current.length === 0) return
      const toFlush = [...logBufferRef.current]
      logBufferRef.current = []
      try {
        await db.addLogs(toFlush)
        await db.cleanup(Date.now() - 30 * 24 * 60 * 60 * 1000)
      } catch (e) {
        console.error('[TrafficLogger] flush failed', e)
      }
    }

    const scheduleFlush = (): void => {
      if (flushTimeoutRef.current) return
      flushTimeoutRef.current = setTimeout(async () => {
        await flushLogs()
        flushTimeoutRef.current = null
      }, 5000)
    }

    const handler = (_e: unknown, ...args: unknown[]): void => {
      const info = args[0] as IMihomoConnectionsInfo
      if (!info.connections?.length) return

      const uploadTotal = info.uploadTotal || 0
      const downloadTotal = info.downloadTotal || 0

      // Detect service restart (totals decreased)
      if (
        uploadTotal < lastTotalsRef.current.upload ||
        downloadTotal < lastTotalsRef.current.download
      ) {
        connectionLastDataRef.current.clear()
        logBufferRef.current = []
        db.clearAll().catch(console.error)
      }
      lastTotalsRef.current = { upload: uploadTotal, download: downloadTotal }

      const now = Date.now()
      let hasDeltas = false

      for (const conn of info.connections) {
        const currentUpload = conn.upload || 0
        const currentDownload = conn.download || 0
        const last = connectionLastDataRef.current.get(conn.id)

        let uploadDelta: number
        let downloadDelta: number

        if (last) {
          uploadDelta = Math.max(0, currentUpload - last.upload)
          downloadDelta = Math.max(0, currentDownload - last.download)
        } else {
          uploadDelta = currentUpload
          downloadDelta = currentDownload
        }

        connectionLastDataRef.current.set(conn.id, { upload: currentUpload, download: currentDownload })

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

      if (hasDeltas) scheduleFlush()
    }

    window.electron.ipcRenderer.on('mihomoConnections', handler)

    return (): void => {
      window.electron.ipcRenderer.removeListener('mihomoConnections', handler)
      if (flushTimeoutRef.current) {
        clearTimeout(flushTimeoutRef.current)
        flushTimeoutRef.current = null
      }
      flushLogs()
    }
  }, [])
}
