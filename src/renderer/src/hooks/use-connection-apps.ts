import { useEffect, useRef, useState } from 'react'
import { getAppInfo } from '@renderer/utils/ipc'
import { platform } from '@renderer/utils/init'

// Linux helpers need connection identity; other platforms can share by executable path.
export function connectionAppKey(connection: IMihomoConnectionDetail): string {
  const file = connection.metadata.processPath || ''
  return platform === 'linux' ? connection.id : platform === 'win32' ? file.toLowerCase() : file
}
export function useConnectionApps(
  active: IMihomoConnectionDetail[],
  closed: IMihomoConnectionDetail[],
  enabled: boolean
): Record<string, IAppInfo> {
  const latest = useRef({ active, closed })
  latest.current = { active, closed }
  const cacheRef = useRef(
    new Map<string, { info: IAppInfo; expires: number; path: string; attempts: number }>()
  )
  const [apps, setApps] = useState<Record<string, IAppInfo>>({})
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const cache = cacheRef.current
    const update = async (): Promise<void> => {
      const { active, closed } = latest.current
      const ids = new Set([...active, ...closed].map(connectionAppKey))
      let changed = false
      for (const id of cache.keys())
        if (!ids.has(id)) {
          cache.delete(id)
          changed = true
        }
      // Closed connections keep their last identity: their source port may already be reused.
      const candidates = platform === 'linux' ? active : [...active, ...closed]
      const pending = [
        ...new Map(
          candidates.map((connection) => [connectionAppKey(connection), connection])
        ).entries()
      ].filter(([key, { metadata }]) => {
        const cached = cache.get(key)
        return !cached || cached.expires < Date.now() || cached.path !== metadata.processPath
      })
      const batchSize = platform === 'linux' ? 8 : 3
      let currentActive = active
      let live = new Map(active.map((connection) => [connection.id, connection.metadata]))
      for (let i = 0; i < pending.length && !cancelled; i += batchSize) {
        if (currentActive !== latest.current.active) {
          currentActive = latest.current.active
          live = new Map(currentActive.map((connection) => [connection.id, connection.metadata]))
        }
        await Promise.all(
          pending.slice(i, i + batchSize).map(async ([id, { metadata }]) => {
            if (platform === 'linux') {
              const current = live.get(id)
              if (!current) return
              metadata = current
            }
            const info = await getAppInfo(metadata).catch(() => ({ name: '', icon: '' }))
            if (cancelled) return
            const previous = cache.get(id)
            const attempts =
              info.name && info.icon
                ? 0
                : previous?.path === metadata.processPath
                  ? previous.attempts + 1
                  : 1
            changed ||= previous?.info.name !== info.name || previous?.info.icon !== info.icon
            cache.set(id, {
              info,
              path: metadata.processPath,
              attempts,
              expires:
                Date.now() +
                (info.name && info.icon
                  ? 300_000
                  : attempts === 1
                    ? 2000
                    : attempts === 2
                      ? 30_000
                      : 300_000)
            })
          })
        )
        if (!cancelled && changed) {
          setApps(Object.fromEntries([...cache].map(([id, { info }]) => [id, info])))
          changed = false
        }
      }
      if (!cancelled) {
        if (changed) setApps(Object.fromEntries([...cache].map(([id, { info }]) => [id, info])))
        timer = setTimeout(update, 2000)
      }
    }
    void update()
    return (): void => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [enabled])
  return apps
}
