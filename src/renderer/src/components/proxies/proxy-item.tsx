import { Avatar, Button, Card, CardBody } from '@heroui/react'
import { getImageDataURL, mihomoUnfixedProxy } from '@renderer/utils/ipc'
import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { FaMapPin } from 'react-icons/fa6'
import { useTranslation } from 'react-i18next'
import { KeyedMutator } from 'swr'

interface Props {
  mutateProxies: KeyedMutator<IMihomoMixedGroup[]>
  onProxyDelay: (proxy: IMihomoProxy | IMihomoGroup, url?: string) => Promise<IMihomoDelay>
  proxyDisplayMode: 'simple' | 'full'
  proxy: IMihomoProxy | IMihomoGroup
  group: IMihomoMixedGroup
  onSelect: (group: string, proxy: string) => void
  selected: boolean
  isGroupTesting?: boolean
}

function delayColor(delay: number): 'primary' | 'success' | 'warning' | 'danger' {
  if (delay === -1) return 'primary'
  if (delay === 0) return 'danger'
  if (delay < 500) return 'success'
  return 'warning'
}

const ProxyItemBase: React.FC<Props> = (props) => {
  const { t } = useTranslation()
  const {
    mutateProxies,
    proxyDisplayMode,
    group,
    proxy,
    selected,
    onSelect,
    onProxyDelay,
    isGroupTesting = false
  } = props

  const delay = useMemo(() => {
    if (proxy.history.length > 0) {
      return proxy.history[proxy.history.length - 1].delay
    }
    return -1
  }, [proxy.history])

  const [loading, setLoading] = useState(false)

  const isLoading = loading || isGroupTesting

  const delayText = useMemo(() => {
    if (delay === -1) return t('proxies.delay.test')
    if (delay === 0) return t('proxies.delay.timeout')
    return delay.toString()
  }, [delay, t])

  const onDelay = useCallback((): void => {
    setLoading(true)
    onProxyDelay(proxy, group.testUrl).finally(() => {
      mutateProxies()
      setLoading(false)
    })
  }, [proxy, group.testUrl, onProxyDelay, mutateProxies])

  const fixed = useMemo(() => group.fixed && group.fixed === proxy.name, [group.fixed, proxy.name])

  // 展开组时，成员中的子策略组也应该显示自己的图标，
  // 复用组标题卡片（pages/proxies.tsx renderGroupContent）的加载与 localStorage 缓存逻辑。
  const icon = 'icon' in proxy && typeof proxy.icon === 'string' ? proxy.icon : undefined
  const [iconSrc, setIconSrc] = useState<string>()

  useEffect(() => {
    if (!icon || !icon.startsWith('http')) {
      setIconSrc(icon)
      return undefined
    }
    const cached = localStorage.getItem(icon)
    if (cached) {
      setIconSrc(cached)
      return undefined
    }
    let cancelled = false
    getImageDataURL(icon)
      .then((dataURL) => {
        localStorage.setItem(icon, dataURL)
        if (!cancelled) setIconSrc(dataURL)
      })
      .catch(() => {})
    return (): void => {
      cancelled = true
    }
  }, [icon])

  return (
    <Card
      as="div"
      onPress={() => onSelect(group.name, proxy.name)}
      isPressable
      fullWidth
      shadow="sm"
      className={`${
        fixed
          ? 'bg-secondary/30 border-r-2 border-r-secondary border-l-2 border-l-secondary'
          : selected
            ? 'bg-primary/30 border-r-2 border-r-primary border-l-2 border-l-primary'
            : 'bg-content2'
      }`}
      radius="sm"
    >
      <CardBody className="p-1">
        {proxyDisplayMode === 'full' ? (
          <div className="flex flex-col gap-1">
            <div className="flex justify-between items-center pl-1">
              <div className="flex min-w-0 items-center">
                {iconSrc && (
                  <Avatar
                    className="bg-transparent mr-2 shrink-0"
                    size="sm"
                    radius="sm"
                    src={iconSrc}
                  />
                )}
                <div className="text-ellipsis overflow-hidden whitespace-nowrap">
                  <div className="flag-emoji inline" title={proxy.name}>
                    {proxy.name}
                  </div>
                </div>
              </div>
              {fixed && (
                <Button
                  isIconOnly
                  title={t('proxies.unpin')}
                  color="danger"
                  onPress={async () => {
                    await mihomoUnfixedProxy(group.name)
                    mutateProxies()
                  }}
                  variant="light"
                  className="h-5 p-0 text-sm"
                >
                  <FaMapPin className="text-md le" />
                </Button>
              )}
            </div>
            <div className="flex justify-between items-center pl-1">
              <div className="flex gap-1 items-center">
                <div className="text-foreground-400 text-xs bg-default-100 px-1 rounded-md">
                  {proxy.type}
                </div>
                {['tfo', 'udp', 'xudp', 'mptcp', 'smux'].map(
                  (protocol) =>
                    proxy[protocol as keyof IMihomoProxy] && (
                      <div
                        key={protocol}
                        className="text-foreground-400 text-xs bg-default-100 px-1 rounded-md"
                      >
                        {protocol}
                      </div>
                    )
                )}
              </div>
              <Button
                isIconOnly
                title={proxy.type}
                isLoading={isLoading}
                color={delayColor(delay)}
                onPress={onDelay}
                variant="light"
                className="h-full text-sm ml-auto -mt-0.5 px-2 relative w-min whitespace-nowrap"
              >
                <div className="w-full h-full flex items-center justify-end">{delayText}</div>
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-between items-center pl-1">
            <div className="flex min-w-0 items-center">
              {iconSrc && (
                <Avatar
                  className="bg-transparent mr-2 shrink-0"
                  size="sm"
                  radius="sm"
                  src={iconSrc}
                />
              )}
              <div className="text-ellipsis overflow-hidden whitespace-nowrap">
                <div className="flag-emoji inline" title={proxy.name}>
                  {proxy.name}
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              {fixed && (
                <Button
                  isIconOnly
                  title={t('proxies.unpin')}
                  color="danger"
                  onPress={async () => {
                    await mihomoUnfixedProxy(group.name)
                    mutateProxies()
                  }}
                  variant="light"
                  className="h-5 p-0 text-sm"
                >
                  <FaMapPin className="text-md le" />
                </Button>
              )}
              <Button
                isIconOnly
                title={proxy.type}
                isLoading={isLoading}
                color={delayColor(delay)}
                onPress={onDelay}
                variant="light"
                className="h-full text-sm px-2 relative w-min whitespace-nowrap"
              >
                <div className="w-full h-full flex items-center justify-end">{delayText}</div>
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

const ProxyItem = React.memo(ProxyItemBase, (prevProps, nextProps) => {
  // 必要时重新渲染
  return (
    prevProps.proxy.name === nextProps.proxy.name &&
    prevProps.proxy.history === nextProps.proxy.history &&
    prevProps.selected === nextProps.selected &&
    prevProps.proxyDisplayMode === nextProps.proxyDisplayMode &&
    prevProps.group.fixed === nextProps.group.fixed &&
    prevProps.isGroupTesting === nextProps.isGroupTesting
  )
})

ProxyItem.displayName = 'ProxyItem'

export default ProxyItem
