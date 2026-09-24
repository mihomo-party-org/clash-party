import { Button } from '@heroui/react'
import BasePage from '@renderer/components/base/base-page'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useGroups } from '@renderer/hooks/use-groups'
import {
  ensureSubStoreServices,
  subStoreFrontendPort,
  subStorePort,
  startSubStoreFrontendServer,
  startSubStoreBackendServer,
  stopSubStoreFrontendServer,
  stopSubStoreBackendServer,
  downloadSubStore,
  getProfileConfig,
  addProfileItem,
  mihomoProxyProviders,
  mihomoUpdateProxyProviders
} from '@renderer/utils/ipc'
import React, { useEffect, useRef, useState } from 'react'
import { HiExternalLink } from 'react-icons/hi'
import { useTranslation } from 'react-i18next'
import { IoMdCloudDownload } from 'react-icons/io'

/**
 * 离开 Sub-Store 时同步派生状态（#1153）：
 * 1) 重下 substore 标记的远程订阅（走 noCache 拉取 → setProfileStr → 热重载 → groupsUpdated）
 * 2) 强制刷新全部 HTTP proxy-provider（内核缓存的 provider 节点列表，仅刷组不会更新）
 */
export async function syncSubStoreDerivedState(): Promise<void> {
  try {
    const config = await getProfileConfig()
    const substoreItems = (config?.items || []).filter(
      (item) => item.type === 'remote' && item.substore === true
    )
    for (const item of substoreItems) {
      try {
        await addProfileItem(item)
      } catch {
        // 单条失败不阻断 provider 刷新
      }
    }

    try {
      const providers = await mihomoProxyProviders()
      const httpNames = Object.values(providers?.providers || {})
        .filter((p) => p.vehicleType === 'HTTP')
        .map((p) => p.name)
      await Promise.all(
        httpNames.map((name) => mihomoUpdateProxyProviders(name).catch(() => undefined))
      )
    } catch {
      // 核心未就绪时忽略
    }
  } catch {
    // 静默：离开页面不应弹错
  }
}

const SubStore: React.FC = () => {
  const { t } = useTranslation()
  const { appConfig } = useAppConfig()
  const { useCustomSubStore, customSubStoreUrl } = appConfig || {}
  const { mutate: mutateGroups } = useGroups()
  const [backendPort, setBackendPort] = useState<number | undefined>()
  const [frontendPort, setFrontendPort] = useState<number | undefined>()
  const [isUpdating, setIsUpdating] = useState(false)
  const mountedRef = useRef(true)
  const getPort = async (ensureStarted = true): Promise<void> => {
    if (ensureStarted) {
      const ports = await ensureSubStoreServices()
      setBackendPort(ports.backendPort)
      setFrontendPort(ports.frontendPort)
      return
    }
    setBackendPort(await subStorePort())
    setFrontendPort(await subStoreFrontendPort())
  }
  useEffect(() => {
    void getPort().catch((error) => {
      new Notification(`${t('substore.updateFailed')}: ${error}`)
    })
  }, [t, useCustomSubStore])

  // #1153：仅在真正离开本页（卸载）时同步，不随语言/配置变更误触发
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      void syncSubStoreDerivedState().then(() => {
        if (mountedRef.current) return
        void mutateGroups()
      })
    }
  }, [mutateGroups])

  if (!useCustomSubStore && !backendPort) return null
  if (!frontendPort) return null
  return (
    <>
      <BasePage
        title={t('substore.title')}
        header={
          <div className="flex gap-2">
            <Button
              title={t('substore.checkUpdate')}
              isIconOnly
              size="sm"
              className="app-nodrag"
              variant="light"
              isLoading={isUpdating}
              onPress={async () => {
                try {
                  new Notification(t('substore.updating'))
                  setIsUpdating(true)
                  await downloadSubStore()
                  await stopSubStoreBackendServer()
                  await startSubStoreBackendServer()
                  await new Promise((resolve) => setTimeout(resolve, 1000))
                  setFrontendPort(0)
                  await stopSubStoreFrontendServer()
                  await startSubStoreFrontendServer()
                  await getPort(false)
                  new Notification(t('substore.updateCompleted'))
                } catch (e) {
                  new Notification(`${t('substore.updateFailed')}: ${e}`)
                } finally {
                  setIsUpdating(false)
                }
              }}
            >
              <IoMdCloudDownload className="text-lg" />
            </Button>

            <Button
              title={t('substore.openInBrowser')}
              isIconOnly
              size="sm"
              className="app-nodrag"
              variant="light"
              onPress={() => {
                open(
                  `http://127.0.0.1:${frontendPort}?api=${useCustomSubStore ? customSubStoreUrl : `http://127.0.0.1:${backendPort}`}`
                )
              }}
            >
              <HiExternalLink className="text-lg" />
            </Button>
          </div>
        }
      >
        <iframe
          className="w-full h-full"
          allow="clipboard-write; clipboard-read"
          src={`http://127.0.0.1:${frontendPort}?api=${useCustomSubStore ? customSubStoreUrl : `http://127.0.0.1:${backendPort}`}`}
        />
      </BasePage>
    </>
  )
}

export default SubStore
