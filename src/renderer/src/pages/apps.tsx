import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Virtuoso } from 'react-virtuoso'
import { Avatar, Input, Switch, Card, CardBody } from '@heroui/react'
import { MdApps, MdSearch, MdWarning } from 'react-icons/md'
import { IoLogoApple } from 'react-icons/io5'
import BasePage from '@renderer/components/base/base-page'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'
import {
  patchAppConfig,
  mihomoHotReloadConfig,
  getIconDataURL,
  getAppName
} from '@renderer/utils/ipc'
import { calcTraffic } from '@renderer/utils/calc'
import { getIconFromCache, saveIconToCache } from '@renderer/utils/icon-cache'
import { cropAndPadTransparent } from '@renderer/utils/image'
import { platform } from '@renderer/utils/init'

interface AppGroup {
  processName: string
  processPath: string
  connections: IMihomoConnectionDetail[]
  upload: number
  download: number
  uploadSpeed: number
  downloadSpeed: number
}

const Apps: React.FC = () => {
  const { t } = useTranslation()
  const { appConfig } = useAppConfig()
  const { controledMihomoConfig } = useControledMihomoConfig()
  const [appGroups, setAppGroups] = useState<AppGroup[]>([])
  const [proxyRules, setProxyRules] = useState<IAppProxyRule[]>([])
  const [filter, setFilter] = useState('')
  const [iconMap, setIconMap] = useState<Record<string, string>>({})
  const [appNameCache, setAppNameCache] = useState<Record<string, string>>({})
  const iconProcessingRef = useRef<Set<string>>(new Set())
  const appNameProcessingRef = useRef<Set<string>>(new Set())

  const findProcessMode = controledMihomoConfig?.['find-process-mode'] || 'strict'
  const mode = controledMihomoConfig?.mode || 'rule'

  // Load proxy rules from config
  useEffect(() => {
    if (appConfig?.appProxyRules) {
      setProxyRules(appConfig.appProxyRules)
    }
  }, [appConfig?.appProxyRules])

  // Listen to mihomoConnections
  useEffect(() => {
    const handler = (_e: unknown, ...args: unknown[]): void => {
      const info = args[0] as IMihomoConnectionsInfo
      if (!info.connections) return

      const groupMap = new Map<string, AppGroup>()
      for (const conn of info.connections) {
        const processName = conn.metadata.process || 'Unknown'
        const processPath = conn.metadata.processPath || ''
        const key = processName

        if (!groupMap.has(key)) {
          groupMap.set(key, {
            processName,
            processPath,
            connections: [],
            upload: 0,
            download: 0,
            uploadSpeed: 0,
            downloadSpeed: 0
          })
        }
        const group = groupMap.get(key)
        if (!group) return
        group.connections.push(conn)
        group.upload += conn.upload
        group.download += conn.download
        group.uploadSpeed += conn.uploadSpeed || 0
        group.downloadSpeed += conn.downloadSpeed || 0
      }

      const groups = Array.from(groupMap.values()).sort(
        (a, b) => b.download + b.upload - (a.download + a.upload)
      )
      setAppGroups(groups)
    }

    window.electron.ipcRenderer.on('mihomoConnections', handler)
    return () => {
      window.electron.ipcRenderer.removeListener('mihomoConnections', handler)
    }
  }, [])

  // Load icons
  useEffect(() => {
    if (findProcessMode === 'off') return
    const queue: string[] = []
    for (const group of appGroups) {
      if (!group.processPath) continue
      if (iconMap[group.processPath]) continue
      if (getIconFromCache(group.processPath)) continue
      if (!queue.includes(group.processPath)) {
        queue.push(group.processPath)
      }
    }
    if (queue.length === 0) return

    const processQueue = (): void => {
      const path = queue.shift()
      if (!path) return
      if (iconProcessingRef.current.has(path)) {
        if (queue.length > 0) setTimeout(processQueue, 50)
        return
      }
      iconProcessingRef.current.add(path)
      getIconDataURL(path)
        .then((dataUrl) => {
          if (platform !== 'darwin' && dataUrl) {
            return cropAndPadTransparent(dataUrl)
          }
          return dataUrl
        })
        .then((dataUrl) => {
          if (dataUrl) {
            saveIconToCache(path, dataUrl)
            setIconMap((prev) => ({ ...prev, [path]: dataUrl }))
          }
        })
        .catch(() => {})
        .finally(() => {
          iconProcessingRef.current.delete(path)
          if (queue.length > 0) setTimeout(processQueue, 50)
        })
    }
    setTimeout(processQueue, 10)
  }, [appGroups, iconMap, findProcessMode])

  // Load app names
  useEffect(() => {
    if (platform !== 'darwin') return
    const queue: string[] = []
    for (const group of appGroups) {
      if (!group.processPath) continue
      if (appNameCache[group.processPath]) continue
      if (!queue.includes(group.processPath)) {
        queue.push(group.processPath)
      }
    }
    if (queue.length === 0) return

    const processQueue = (): void => {
      const path = queue.shift()
      if (!path) return
      if (appNameProcessingRef.current.has(path)) {
        if (queue.length > 0) setTimeout(processQueue, 100)
        return
      }
      appNameProcessingRef.current.add(path)
      getAppName(path)
        .then((name) => {
          if (name) {
            setAppNameCache((prev) => ({ ...prev, [path]: name }))
          }
        })
        .catch(() => {})
        .finally(() => {
          appNameProcessingRef.current.delete(path)
          if (queue.length > 0) setTimeout(processQueue, 100)
        })
    }
    setTimeout(processQueue, 10)
  }, [appGroups, appNameCache])

  // Toggle app proxy
  const handleToggle = useCallback(
    async (processName: string, processPath: string, enabled: boolean) => {
      let newRules: IAppProxyRule[]
      const existing = proxyRules.find((r) => r.processName === processName)
      if (existing) {
        newRules = proxyRules.map((r) => (r.processName === processName ? { ...r, enabled } : r))
      } else {
        newRules = [...proxyRules, { processName, processPath, enabled }]
      }
      setProxyRules(newRules)
      try {
        await patchAppConfig({ appProxyRules: newRules })
        await mihomoHotReloadConfig()
      } catch {
        setProxyRules(proxyRules)
      }
    },
    [proxyRules]
  )

  // Filter
  const filteredGroups = useMemo(() => {
    if (!filter) return appGroups
    const lowerFilter = filter.toLowerCase()
    return appGroups.filter(
      (g) =>
        g.processName.toLowerCase().includes(lowerFilter) ||
        (appNameCache[g.processPath] || '').toLowerCase().includes(lowerFilter)
    )
  }, [appGroups, filter, appNameCache])

  const isProcessOff = findProcessMode === 'off'
  const isNotRuleMode = mode !== 'rule'

  return (
    <BasePage title={t('apps.title')}>
      {/* Warning banners */}
      {isProcessOff && (
        <div className="mx-2 mt-2 flex items-center gap-2 rounded-lg bg-warning-100 p-3 text-sm text-warning-700 dark:bg-warning-900/30 dark:text-warning-400">
          <MdWarning className="text-lg flex-shrink-0" />
          <span>{t('apps.warning.noProcess')}</span>
        </div>
      )}
      {isNotRuleMode && (
        <div className="mx-2 mt-2 flex items-center gap-2 rounded-lg bg-warning-100 p-3 text-sm text-warning-700 dark:bg-warning-900/30 dark:text-warning-400">
          <MdWarning className="text-lg flex-shrink-0" />
          <span>{t('apps.warning.noRuleMode')}</span>
        </div>
      )}

      <div className="px-2 pt-2">
        <Input
          size="sm"
          placeholder={t('apps.search')}
          value={filter}
          onValueChange={setFilter}
          startContent={<MdSearch className="text-foreground/50" />}
        />
      </div>

      {filteredGroups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-foreground/50">
          <MdApps className="text-5xl mb-2" />
          <span>{t('apps.noApps')}</span>
        </div>
      ) : (
        <div className="h-[calc(100vh-180px)]">
          <Virtuoso
            data={filteredGroups}
            itemContent={(_, group) => {
              const rule = proxyRules.find((r) => r.processName === group.processName)
              const isEnabled = rule ? rule.enabled : true
              const isUnknown = group.processName === 'Unknown'
              const iconUrl =
                findProcessMode !== 'off' && group.processPath
                  ? iconMap[group.processPath] || getIconFromCache(group.processPath) || ''
                  : ''
              const displayName =
                group.processPath && appNameCache[group.processPath]
                  ? appNameCache[group.processPath]
                  : group.processName

              return (
                <Card className="m-2" radius="sm">
                  <CardBody className="flex flex-row items-center gap-3 px-3 py-2">
                    <Avatar
                      src={iconUrl}
                      icon={iconUrl ? undefined : <IoLogoApple />}
                      className="flex-shrink-0"
                      size="sm"
                      radius="sm"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{displayName}</span>
                        <span className="text-xs text-foreground/50 flex-shrink-0">
                          {group.connections.length} {t('apps.connections')}
                        </span>
                      </div>
                      <div className="text-xs text-foreground/50 flex gap-2">
                        <span>↑ {calcTraffic(group.uploadSpeed)}/s</span>
                        <span>↓ {calcTraffic(group.downloadSpeed)}/s</span>
                        <span>↑ {calcTraffic(group.upload)}</span>
                        <span>↓ {calcTraffic(group.download)}</span>
                      </div>
                    </div>
                    <Switch
                      size="sm"
                      isSelected={isEnabled}
                      isDisabled={isUnknown || isProcessOff}
                      onValueChange={(val) =>
                        handleToggle(group.processName, group.processPath, val)
                      }
                      color={isEnabled ? 'primary' : 'danger'}
                    />
                  </CardBody>
                </Card>
              )
            }}
          />
        </div>
      )}
    </BasePage>
  )
}

export default Apps
