import { useEffect, useRef } from 'react'
import { legacyTrafficUsageDatabase } from '@renderer/utils/legacy-traffic-db'
import { importTrafficUsage } from '@renderer/utils/ipc'
import {
  TRAFFIC_USAGE_FLUSH_THRESHOLD,
  TrafficUsageAccumulator
} from '../../../shared/trafficUsage'

const FLUSH_DELAY_MS = 5000

export function useTrafficLogger(enabled = true): void {
  const accumulatorRef = useRef(new TrafficUsageAccumulator())

  useEffect(() => {
    if (__LEGACY_BUILD__) return
    void legacyTrafficUsageDatabase
      .migrateToBackend(importTrafficUsage)
      .catch((error) => console.error('[TrafficLogger] migration failed', error))
  }, [])

  useEffect(() => {
    const accumulator = accumulatorRef.current
    const active = __LEGACY_BUILD__ && enabled
    accumulator.setEnabled(active)
    if (!active) return

    let disposed = false
    let flushTimer: ReturnType<typeof setTimeout> | null = null
    let inFlight: Promise<void> | null = null

    const clearFlushTimer = (): void => {
      if (!flushTimer) return
      clearTimeout(flushTimer)
      flushTimer = null
    }

    const scheduleFlush = (delay = FLUSH_DELAY_MS): void => {
      if (disposed || flushTimer) return
      flushTimer = setTimeout(() => {
        flushTimer = null
        void flush()
      }, delay)
    }

    const flush = async (): Promise<void> => {
      if (disposed || inFlight) return inFlight ?? Promise.resolve()
      const records = accumulator.takePending()
      if (records.length === 0) return

      let failed = false
      inFlight = legacyTrafficUsageDatabase
        .upsert(records)
        .catch((error) => {
          failed = true
          if (!disposed) accumulator.merge(records)
          console.error('[TrafficLogger] flush failed', error)
        })
        .finally(() => {
          inFlight = null
          if (!disposed && accumulator.pendingSize > 0) {
            scheduleFlush(
              !failed && accumulator.pendingSize >= TRAFFIC_USAGE_FLUSH_THRESHOLD
                ? 0
                : FLUSH_DELAY_MS
            )
          }
        })
      return inFlight
    }

    const handler = (_event: unknown, ...args: unknown[]): void => {
      const info = args[0] as IMihomoConnectionsInfo | undefined
      if (!info) return
      if (accumulator.addSnapshot(info)) void flush()
      else if (accumulator.pendingSize > 0) scheduleFlush()
    }

    void legacyTrafficUsageDatabase
      .migrateLegacyLogs()
      .catch((error) => console.error('[TrafficLogger] migration failed', error))
    const unsubscribe = window.electron.ipcRenderer.on('mihomoConnections', handler)

    return (): void => {
      disposed = true
      clearFlushTimer()
      unsubscribe()
      accumulator.setEnabled(false)
    }
  }, [enabled])
}
