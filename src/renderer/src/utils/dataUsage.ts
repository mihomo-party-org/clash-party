import { db } from '@renderer/utils/db'

export type DataUsageType = 'sourceIP' | 'host' | 'outbound' | 'process'

export interface AggregatedData {
  label: string
  upload: number
  download: number
  total: number
  count: number
}

export async function getAggregatedData(
  type: DataUsageType,
  startTime: number,
  endTime: number
): Promise<AggregatedData[]> {
  const logs = await db.query(startTime, endTime)
  const map = new Map<string, AggregatedData>()

  for (const log of logs) {
    const label =
      type === 'sourceIP'
        ? log.sourceIP
        : type === 'host'
          ? log.host
          : type === 'outbound'
            ? log.outbound
            : log.process

    const existing = map.get(label)
    if (existing) {
      existing.upload += log.upload
      existing.download += log.download
      existing.total += log.upload + log.download
      existing.count += 1
    } else {
      map.set(label, {
        label,
        upload: log.upload,
        download: log.download,
        total: log.upload + log.download,
        count: 1
      })
    }
  }

  return Array.from(map.values()).sort((a, b) => b.total - a.total)
}

export async function getSubStatsByHost(
  dimension: Exclude<DataUsageType, 'host'>,
  label: string,
  startTime: number,
  endTime: number
): Promise<AggregatedData[]> {
  const logs = await db.query(startTime, endTime)
  const filtered = logs.filter((log) =>
    dimension === 'sourceIP'
      ? log.sourceIP === label
      : dimension === 'outbound'
        ? log.outbound === label
        : log.process === label
  )

  const map = new Map<string, AggregatedData>()
  for (const log of filtered) {
    const existing = map.get(log.host)
    if (existing) {
      existing.upload += log.upload
      existing.download += log.download
      existing.total += log.upload + log.download
      existing.count += 1
    } else {
      map.set(log.host, {
        label: log.host,
        upload: log.upload,
        download: log.download,
        total: log.upload + log.download,
        count: 1
      })
    }
  }

  return Array.from(map.values()).sort((a, b) => b.total - a.total)
}

export async function getDevicesByHost(
  host: string,
  startTime: number,
  endTime: number
): Promise<AggregatedData[]> {
  const logs = await db.query(startTime, endTime)
  const filtered = logs.filter((log) => log.host === host)

  const map = new Map<string, AggregatedData>()
  for (const log of filtered) {
    const existing = map.get(log.sourceIP)
    if (existing) {
      existing.upload += log.upload
      existing.download += log.download
      existing.total += log.upload + log.download
      existing.count += 1
    } else {
      map.set(log.sourceIP, {
        label: log.sourceIP,
        upload: log.upload,
        download: log.download,
        total: log.upload + log.download,
        count: 1
      })
    }
  }

  return Array.from(map.values()).sort((a, b) => b.total - a.total)
}

export async function getProxyStatsByHost(
  dimension: DataUsageType,
  parentLabel: string,
  host: string,
  startTime: number,
  endTime: number
): Promise<AggregatedData[]> {
  const logs = await db.query(startTime, endTime)
  const filtered = logs.filter((log) => {
    if (log.host !== host) return false
    return dimension === 'sourceIP'
      ? log.sourceIP === parentLabel
      : dimension === 'process'
        ? log.process === parentLabel
        : log.outbound === parentLabel
  })

  const map = new Map<string, AggregatedData>()
  for (const log of filtered) {
    const existing = map.get(log.outbound)
    if (existing) {
      existing.upload += log.upload
      existing.download += log.download
      existing.total += log.upload + log.download
      existing.count += 1
    } else {
      map.set(log.outbound, {
        label: log.outbound,
        upload: log.upload,
        download: log.download,
        total: log.upload + log.download,
        count: 1
      })
    }
  }

  return Array.from(map.values()).sort((a, b) => b.total - a.total)
}

export async function getDevicesByProxyAndHost(
  proxy: string,
  host: string,
  startTime: number,
  endTime: number
): Promise<AggregatedData[]> {
  const logs = await db.query(startTime, endTime)
  const filtered = logs.filter((log) => log.outbound === proxy && log.host === host)

  const map = new Map<string, AggregatedData>()
  for (const log of filtered) {
    const existing = map.get(log.sourceIP)
    if (existing) {
      existing.upload += log.upload
      existing.download += log.download
      existing.total += log.upload + log.download
      existing.count += 1
    } else {
      map.set(log.sourceIP, {
        label: log.sourceIP,
        upload: log.upload,
        download: log.download,
        total: log.upload + log.download,
        count: 1
      })
    }
  }

  return Array.from(map.values()).sort((a, b) => b.total - a.total)
}

export async function getTrafficTrend(
  startTime: number,
  endTime: number,
  bucketSizeMs: number
): Promise<{ timestamp: number; upload: number; download: number }[]> {
  const logs = await db.query(startTime, endTime)
  const buckets = new Map<number, { upload: number; download: number }>()

  for (let t = startTime; t <= endTime; t += bucketSizeMs) {
    buckets.set(Math.floor(t / bucketSizeMs) * bucketSizeMs, { upload: 0, download: 0 })
  }

  for (const log of logs) {
    const key = Math.floor(log.timestamp / bucketSizeMs) * bucketSizeMs
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.upload += log.upload
      bucket.download += log.download
    }
  }

  return Array.from(buckets.entries())
    .map(([timestamp, data]) => ({ timestamp, ...data }))
    .sort((a, b) => a.timestamp - b.timestamp)
}
