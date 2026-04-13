import { Button, Card, CardBody, CardFooter, Chip, Tooltip } from '@heroui/react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { LuGroup } from 'react-icons/lu'
import { useLocation, useNavigate } from 'react-router-dom'
import { useGroups } from '@renderer/hooks/use-groups'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import React, { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { mihomoProxyDelay } from '@renderer/utils/ipc'

interface Props {
  iconOnly?: boolean
}

const ProxyCard: React.FC<Props> = (props) => {
  const { t } = useTranslation()
  const { appConfig } = useAppConfig()
  const { iconOnly } = props
  const { proxyCardStatus = 'col-span-1', disableAnimations = false } = appConfig || {}
  const isSmall = proxyCardStatus === 'col-span-1'
  const location = useLocation()
  const navigate = useNavigate()
  const match = location.pathname.includes('/proxies')
  const { groups = [], mutate } = useGroups()
  const firstGroup = groups.find((g) => g.type === 'Selector') ?? groups[0]
  const selectedProxy = firstGroup?.now

  // Read latency from live group data so right-panel tests auto-reflect here
  const selectedProxyData = firstGroup?.all?.find((p) => p.name === selectedProxy)
  const liveLatency =
    selectedProxyData?.history && selectedProxyData.history.length > 0
      ? selectedProxyData.history[selectedProxyData.history.length - 1].delay
      : null

  const [testing, setTesting] = useState(false)
  const [testFailed, setTestFailed] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const prevProxyRef = useRef<string | undefined>(undefined)

  const runTest = async (proxyName: string): Promise<void> => {
    if (!proxyName || testing) return
    setTesting(true)
    try {
      await mihomoProxyDelay(proxyName, appConfig?.delayTestUrl)
      setTestFailed(false)
      await mutate()
    } catch {
      setTestFailed(true)
    } finally {
      setTesting(false)
    }
  }

  // Test on mount
  useEffect(() => {
    if (selectedProxy) {
      runTest(selectedProxy)
    }
  }, [])

  // Test whenever selected proxy changes
  useEffect(() => {
    if (!selectedProxy) return
    if (prevProxyRef.current !== selectedProxy) {
      prevProxyRef.current = selectedProxy
      setTestFailed(false)
      runTest(selectedProxy)
    }
  }, [selectedProxy])

  // Auto-test every 10 minutes, resets when proxy changes
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      if (selectedProxy) runTest(selectedProxy)
    }, 600_000)
    return (): void => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [selectedProxy])

  // Derive display value from live data; fall back to failed states
  const latency =
    liveLatency !== null && liveLatency > 0
      ? liveLatency
      : testFailed
        ? -1
        : null

  const latencyColor =
    latency === -1
      ? 'text-red-500'
      : latency === null
        ? match
          ? 'text-primary-foreground/60'
          : 'text-foreground/40'
        : latency < 200
          ? 'text-green-400'
          : latency < 500
            ? 'text-yellow-400'
            : 'text-red-400'

  const latencyDisplay = testing
    ? '…'
    : latency === -1
      ? 'Timeout'
      : latency !== null
        ? `${latency} ms`
        : null

  const {
    attributes,
    listeners,
    setNodeRef,
    transform: tf,
    transition,
    isDragging
  } = useSortable({
    id: 'proxy'
  })
  const transform = tf ? { x: tf.x, y: tf.y, scaleX: 1, scaleY: 1 } : null

  if (iconOnly) {
    return (
      <div className={`${proxyCardStatus} flex justify-center`}>
        <Tooltip content={t('proxies.card.title')} placement="right">
          <Button
            size="sm"
            isIconOnly
            color={match ? 'primary' : 'default'}
            variant={match ? 'solid' : 'light'}
            onPress={() => {
              navigate('/proxies')
            }}
          >
            <LuGroup className="text-[20px]" />
          </Button>
        </Tooltip>
      </div>
    )
  }

  return (
    <div
      style={{
        position: 'relative',
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 'calc(infinity)' : undefined
      }}
      className={`${proxyCardStatus} proxy-card h-full`}
    >
      <Card
        fullWidth
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        className={`h-full ${match ? 'bg-primary' : 'hover:bg-primary/30'} ${disableAnimations ? '' : `motion-reduce:transition-transform-background ${isDragging ? 'scale-[0.95] tap-highlight-transparent' : ''}`}`}
      >
        <CardBody className="pb-1 pt-0 px-0 flex-none">
          <div className="flex justify-between">
            <Button
              isIconOnly
              className="bg-transparent pointer-events-none"
              variant="flat"
              color="default"
            >
              <LuGroup
                className={`${match ? 'text-primary-foreground' : 'text-foreground'} text-[24px] font-bold`}
              />
            </Button>
            <Chip
              classNames={
                match
                  ? {
                      base: 'border-primary-foreground',
                      content: 'text-primary-foreground'
                    }
                  : {
                      base: 'border-primary',
                      content: 'text-primary'
                    }
              }
              size="sm"
              variant="bordered"
              className="mr-2 mt-2"
            >
              {groups.length}
            </Chip>
          </div>
        </CardBody>
        <CardFooter className="pt-1 flex flex-col items-start gap-0.5 flex-1 justify-end">
          {isSmall ? (
            <>
              <p
                className={`text-sm font-semibold truncate w-full ${match ? 'text-primary-foreground' : 'text-primary'}`}
              >
                {selectedProxy ?? t('proxies.card.title')}
              </p>
              {latencyDisplay !== null && (
                <div
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (selectedProxy) runTest(selectedProxy)
                  }}
                  className={`text-xs font-mono cursor-pointer select-none ${latencyColor} ${testing ? 'opacity-50' : 'hover:opacity-80'}`}
                >
                  {latencyDisplay}
                </div>
              )}
            </>
          ) : (
            <>
              <h3
                className={`text-md font-bold sider-card-title ${match ? 'text-primary-foreground' : 'text-foreground'}`}
              >
                {t('proxies.card.title')}
              </h3>
              {selectedProxy && (
                <div className="flex items-center justify-between w-full gap-1">
                  <p
                    className={`text-sm font-semibold truncate flex-1 min-w-0 ${match ? 'text-primary-foreground' : 'text-primary'}`}
                  >
                    {selectedProxy}
                  </p>
                  {latencyDisplay !== null && (
                    <div
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        runTest(selectedProxy)
                      }}
                      className={`text-xs font-mono shrink-0 cursor-pointer select-none ${latencyColor} ${testing ? 'opacity-50' : 'hover:opacity-80'}`}
                    >
                      {latencyDisplay}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </CardFooter>
      </Card>
    </div>
  )
}

export default ProxyCard
