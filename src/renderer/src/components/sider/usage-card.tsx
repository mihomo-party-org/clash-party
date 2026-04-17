import { Button, Card, CardBody, CardFooter, Progress, Tooltip } from '@heroui/react'
import { mihomoProxyProviders } from '@renderer/utils/ipc'
import { useLocation, useNavigate } from 'react-router-dom'
import { calcTraffic, calcPercent } from '@renderer/utils/calc'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import React, { useMemo } from 'react'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { MdOutlineDataUsage } from 'react-icons/md'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'
import dayjs from '@renderer/utils/dayjs'

interface Props {
  iconOnly?: boolean
}

const UsageCard: React.FC<Props> = (props) => {
  const { iconOnly } = props
  const { t } = useTranslation()
  const { appConfig } = useAppConfig()
  const { usageCardStatus = 'col-span-2', disableAnimations = false } = appConfig || {}
  const location = useLocation()
  const navigate = useNavigate()
  const match = location.pathname.includes('/traffic')

  const { data } = useSWR('mihomoProxyProviders', mihomoProxyProviders)

  const providers = useMemo(() => {
    if (!data?.providers) return []
    return Object.values(data.providers).filter(
      (p) => p.vehicleType !== 'Compatible' && p.subscriptionInfo && p.subscriptionInfo.Total > 0
    )
  }, [data])

  const {
    attributes,
    listeners,
    setNodeRef,
    transform: tf,
    transition,
    isDragging
  } = useSortable({ id: 'usage' })

  const transform = tf ? { x: tf.x, y: tf.y, scaleX: 1, scaleY: 1 } : null

  if (iconOnly) {
    return (
      <div className={`${usageCardStatus} flex justify-center`}>
        <Tooltip content={t('sider.cards.traffic')} placement="right">
          <Button
            size="sm"
            isIconOnly
            color={match ? 'primary' : 'default'}
            variant={match ? 'solid' : 'light'}
            onPress={() => navigate('/traffic')}
          >
            <MdOutlineDataUsage className="text-[20px]" />
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
      className={`${usageCardStatus} usage-card`}
    >
      {usageCardStatus === 'col-span-2' ? (
        <Card
          fullWidth
          ref={setNodeRef}
          {...attributes}
          {...listeners}
          className={`${match ? 'bg-primary' : 'hover:bg-primary/30'} ${disableAnimations ? '' : `motion-reduce:transition-transform-background ${isDragging ? 'scale-[0.95] tap-highlight-transparent' : ''}`}`}
        >
          <CardBody className="pb-1 pt-0 px-0">
            <div className="flex justify-between">
              <Button
                isIconOnly
                className="bg-transparent pointer-events-none"
                variant="flat"
                color="default"
              >
                <MdOutlineDataUsage
                  className={`${match ? 'text-primary-foreground' : 'text-foreground'} text-[24px]`}
                />
              </Button>
              <div className={`p-2 w-full ${match ? 'text-primary-foreground' : 'text-foreground'}`}>
                {providers.length === 0 ? (
                  <div className="text-xs text-foreground-400 leading-[32px]">—</div>
                ) : (
                  providers.map((provider) => {
                    const { Upload = 0, Download = 0, Total = 0, Expire } =
                      provider.subscriptionInfo ?? {}
                    const used = Upload + Download
                    const percent = calcPercent(Upload, Download, Total)
                    const isExpired = Expire ? dayjs.unix(Expire).isBefore(dayjs()) : false
                    const progressColor =
                      isExpired
                        ? 'danger'
                        : percent >= 90
                          ? 'danger'
                          : percent >= 70
                            ? 'warning'
                            : 'primary'

                    return (
                      <div key={provider.name} className="mb-2 last:mb-0">
                        <div className="flex justify-between text-xs mb-0.5">
                          <span className="font-medium text-ellipsis whitespace-nowrap overflow-hidden max-w-[55%]">
                            {provider.name}
                          </span>
                          <span className="shrink-0">
                            {calcTraffic(used)}&nbsp;/&nbsp;{calcTraffic(Total)}
                          </span>
                        </div>
                        <Progress
                          size="sm"
                          value={percent}
                          color={progressColor}
                          classNames={{
                            track: match ? 'bg-primary-foreground/30' : undefined
                          }}
                        />
                        <div className="text-right text-xs mt-0.5 opacity-70">
                          {Expire
                            ? (isExpired ? '⚠ ' : '') + dayjs.unix(Expire).format('YYYY-MM-DD')
                            : t('sider.cards.neverExpire')}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </CardBody>
          <CardFooter className="pt-1">
            <h3
              className={`text-md font-bold sider-card-title ${match ? 'text-primary-foreground' : 'text-foreground'}`}
            >
              {t('sider.cards.traffic')}
            </h3>
          </CardFooter>
        </Card>
      ) : (
        <Card
          fullWidth
          ref={setNodeRef}
          {...attributes}
          {...listeners}
          className={`${match ? 'bg-primary' : 'hover:bg-primary/30'} ${disableAnimations ? '' : `motion-reduce:transition-transform-background ${isDragging ? 'scale-[0.95] tap-highlight-transparent' : ''}`}`}
        >
          <CardBody className="pb-1 pt-0 px-0">
            <div className="flex justify-between">
              <Button
                isIconOnly
                className="bg-transparent pointer-events-none"
                variant="flat"
                color="default"
              >
                <MdOutlineDataUsage
                  className={`${match ? 'text-primary-foreground' : 'text-foreground'} text-[24px] font-bold`}
                />
              </Button>
            </div>
          </CardBody>
          <CardFooter className="pt-1">
            <h3
              className={`text-md font-bold text-ellipsis whitespace-nowrap overflow-hidden ${match ? 'text-primary-foreground' : 'text-foreground'}`}
            >
              {t('sider.cards.traffic')}
            </h3>
          </CardFooter>
        </Card>
      )}
    </div>
  )
}

export default UsageCard
