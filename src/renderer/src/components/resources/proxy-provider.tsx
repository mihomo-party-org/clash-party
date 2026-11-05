import {
  mihomoProxyProviders,
  mihomoUpdateProxyProviders,
  getRuntimeConfig
} from '@renderer/utils/ipc'
import { Fragment, useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { Button, Chip, Input } from '@heroui/react'
import { toast } from '@renderer/components/base/toast'
import { IoMdRefresh } from 'react-icons/io'
import { CgLoadbarDoc } from 'react-icons/cg'
import { MdEditDocument, MdQrCode2 } from 'react-icons/md'
import dayjs from '@renderer/utils/dayjs'
import { calcTraffic } from '@renderer/utils/calc'
import { getHash } from '@renderer/utils/hash'
import { useTranslation } from 'react-i18next'
import { useActiveProfile } from '@renderer/hooks/use-active-profile'
import { useGroups } from '@renderer/hooks/use-groups'
import { includesIgnoreCase } from '@renderer/utils/includes'
import { FaPlus } from 'react-icons/fa6'
import ProviderModal from '../local/provider-modal'
import SettingItem from '../base/base-setting-item'
import SettingCard from '../base/base-setting-card'
import QrCodeModal from '../profiles/qr-code-modal'
import Viewer from './viewer'
/* eslint-disable react/prop-types */
const ProxyProvider: React.FC<{ editing?: boolean }> = ({ editing: editingProp }) => {
  const { t } = useTranslation()
  const { isLocalActive: localMode } = useActiveProfile()
  const { mutate: mutateGroups } = useGroups()
  const editing = !!editingProp && localMode
  const [showDetails, setShowDetails] = useState({
    show: false,
    path: '',
    type: '',
    title: '',
    privderType: ''
  })
  const [qrCode, setQrCode] = useState<{ name: string; url: string } | null>(null)
  const [editorName, setEditorName] = useState<string | undefined>()
  const [editorOpen, setEditorOpen] = useState(false)
  useEffect(() => {
    if (!editing) {
      setEditorOpen(false)
      setEditorName(undefined)
    }
  }, [editing])
  useEffect(() => {
    if (showDetails.title) {
      const fetchProviderPath = async (name: string): Promise<void> => {
        try {
          const providers = await getRuntimeConfig()
          const provider = providers['proxy-providers'][name]
          if (provider) {
            setShowDetails((prev) => ({
              ...prev,
              show: true,
              path: provider?.path || `proxies/${getHash(provider?.url)}`
            }))
          }
        } catch {
          setShowDetails((prev) => ({ ...prev, path: '' }))
        }
      }
      fetchProviderPath(showDetails.title)
    }
  }, [showDetails.title])

  const { data, mutate } = useSWR('mihomoProxyProviders', mihomoProxyProviders)
  const [filter, setFilter] = useState('')
  const providers = useMemo(() => {
    if (!data || !data.providers) return []
    return Object.values(data.providers)
      .filter((provider) => provider.vehicleType !== 'Compatible')
      .sort((a, b) => {
        const order = { File: 1, Inline: 2, HTTP: 3 }
        return (order[a.vehicleType] || 4) - (order[b.vehicleType] || 4)
      })
  }, [data])
  const filteredProviders = useMemo(
    () => providers.filter((provider) => !filter || includesIgnoreCase(provider.name, filter)),
    [filter, providers]
  )
  const [updating, setUpdating] = useState(Array(providers.length).fill(false))

  const onUpdate = async (name: string, index: number): Promise<void> => {
    setUpdating((prev) => {
      prev[index] = true
      return [...prev]
    })
    try {
      await mihomoUpdateProxyProviders(name)
      mutate()
    } catch (e) {
      toast.error(String(e))
    } finally {
      setUpdating((prev) => {
        prev[index] = false
        return [...prev]
      })
    }
  }

  const updateProviders = async (targets: IMihomoProxyProvider[]): Promise<void> => {
    await Promise.all(
      targets.map((provider) => onUpdate(provider.name, providers.indexOf(provider)))
    )
    // 代理组的节点列表来自 provider，只刷新这里的话代理组页面要等 30s 轮询才看到新节点（#638、#1153）
    mutateGroups()
  }

  if (!providers.length && !localMode) {
    return null
  }

  const onShowQrCode = async (name: string): Promise<void> => {
    try {
      const config = await getRuntimeConfig()
      const provider = config?.['proxy-providers']?.[name]
      if (provider?.url) {
        setQrCode({ name, url: provider.url })
      }
    } catch {
      // Ignore providers that are no longer present in the runtime config.
    }
  }

  return (
    <SettingCard>
      {editorOpen && (
        <ProviderModal
          kind="proxy-providers"
          name={editorName}
          onClose={() => setEditorOpen(false)}
          onSaved={() => mutate()}
        />
      )}
      {qrCode && (
        <QrCodeModal title={qrCode.name} url={qrCode.url} onClose={() => setQrCode(null)} />
      )}
      {showDetails.show && (
        <Viewer
          path={showDetails.path}
          type={showDetails.type}
          title={showDetails.title}
          privderType={showDetails.privderType}
          onClose={() =>
            setShowDetails({ show: false, path: '', type: '', title: '', privderType: '' })
          }
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-divider pb-2">
        <h4 className="min-w-0 wrap-break-word text-md">{t('resources.proxyProviders.title')}</h4>
        <div className="flex min-w-0 items-center gap-2">
          <Input
            size="sm"
            className="w-28 sm:w-40"
            value={filter}
            placeholder={t('resources.proxyProviders.filter')}
            isClearable
            onValueChange={setFilter}
          />
          {editing && (
            <>
              <Button
                size="sm"
                variant="flat"
                startContent={<FaPlus />}
                onPress={() => {
                  setEditorName(undefined)
                  setEditorOpen(true)
                }}
              >
                添加
              </Button>
              <Button
                size="sm"
                variant="flat"
                startContent={<MdEditDocument />}
                isDisabled={!filteredProviders.length}
                onPress={() => {
                  setEditorName(filteredProviders[0]?.name)
                  setEditorOpen(true)
                }}
              >
                编辑
              </Button>
            </>
          )}
          <Button
            size="sm"
            color="primary"
            isDisabled={!filteredProviders.length}
            onPress={() => updateProviders(filteredProviders)}
          >
            {t('resources.proxyProviders.updateAll')}
          </Button>
        </div>
      </div>
      {filteredProviders.map((provider) => {
        const index = providers.indexOf(provider)
        return (
          <Fragment key={provider.name}>
            <SettingItem
              title={provider.name}
              actions={
                <Chip className="ml-2" size="sm">
                  {provider.proxies?.length || 0}
                </Chip>
              }
              divider={!provider.subscriptionInfo && index !== providers.length - 1}
            >
              <div className="flex h-8 leading-8 text-foreground-500">
                <div>{dayjs(provider.updatedAt).fromNow()}</div>
                {provider.vehicleType === 'HTTP' && (
                  <Button
                    isIconOnly
                    title={t('profiles.qrCode.show')}
                    className="ml-2"
                    size="sm"
                    onPress={() => onShowQrCode(provider.name)}
                  >
                    <MdQrCode2 className="text-lg" />
                  </Button>
                )}
                <Button
                  isIconOnly
                  title={
                    provider.vehicleType === 'File'
                      ? t('common.editor.edit')
                      : t('common.viewer.view')
                  }
                  className="ml-2"
                  size="sm"
                  onPress={() => {
                    if (editing) {
                      setEditorName(provider.name)
                      setEditorOpen(true)
                    } else {
                      setShowDetails({
                        show: false,
                        privderType: 'proxy-providers',
                        path: provider.name,
                        type: provider.vehicleType,
                        title: provider.name
                      })
                    }
                  }}
                >
                  {provider.vehicleType === 'File' ? (
                    <MdEditDocument className={`text-lg`} />
                  ) : (
                    <CgLoadbarDoc className={`text-lg`} />
                  )}
                </Button>
                <Button
                  isIconOnly
                  title={t('common.updater.update')}
                  className="ml-2"
                  size="sm"
                  onPress={() => updateProviders([provider])}
                >
                  <IoMdRefresh className={`text-lg ${updating[index] ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </SettingItem>
            {!localMode && provider.subscriptionInfo && (
              <SettingItem
                divider={index !== providers.length - 1}
                title={
                  <div className="text-foreground-500">
                    {`${calcTraffic(
                      provider.subscriptionInfo.Upload + provider.subscriptionInfo.Download
                    )} / ${calcTraffic(provider.subscriptionInfo.Total)}`}
                  </div>
                }
              >
                <div className="h-8 leading-8 text-foreground-500">
                  {provider.subscriptionInfo.Expire
                    ? new Date(provider.subscriptionInfo.Expire * 1000).toLocaleDateString()
                    : t('profiles.neverExpire')}
                </div>
              </SettingItem>
            )}
          </Fragment>
        )
      })}
      {!filteredProviders.length && (
        <div className="py-6 text-center text-sm text-foreground/50">{t('traffic.noData')}</div>
      )}
    </SettingCard>
  )
}

export default ProxyProvider
