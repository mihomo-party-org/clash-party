import { Button, Card, CardBody, CardFooter, Chip, Progress, Tooltip } from '@heroui/react'
import { useProfileConfig } from '@renderer/hooks/use-profile-config'
import { useLocation, useNavigate } from 'react-router-dom'
import { calcTraffic, calcPercent } from '@renderer/utils/calc'
import { CgLoadbarDoc } from 'react-icons/cg'
import { IoMdRefresh } from 'react-icons/io'
import relativeTime from 'dayjs/plugin/relativeTime'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import 'dayjs/locale/zh-cn'
import dayjs from '@renderer/utils/dayjs'
import React, { useState } from 'react'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { TiFolder } from 'react-icons/ti'
import { useTranslation } from 'react-i18next'
import ConfigViewer from './config-viewer'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

interface Props {
  iconOnly?: boolean
}

const ProfileCard: React.FC<Props> = (props) => {
  const { t } = useTranslation()
  const { appConfig, patchAppConfig } = useAppConfig()
  const { iconOnly } = props
  const {
    profileCardStatus = 'col-span-2',
    profileDisplayDate = 'expire',
    disableAnimations = false
  } = appConfig || {}
  const location = useLocation()
  const navigate = useNavigate()
  const match = location.pathname.includes('/profiles')
  const [updating, setUpdating] = useState(false)
  const [showRuntimeConfig, setShowRuntimeConfig] = useState(false)
  const { profileConfig, addProfileItem } = useProfileConfig()
  const { current, items } = profileConfig ?? {}
  
  const {
    attributes,
    listeners,
    setNodeRef,
    transform: tf,
    transition,
    isDragging
  } = useSortable({
    id: 'profile'
  })

  const transform = tf ? { x: tf.x, y: tf.y, scaleX: 1, scaleY: 1 } : null
  const info = items?.find((item) => item && item.id === current) ?? {
    id: 'default',
    type: 'local',
    name: t('sider.cards.emptyProfile')
  }

  const extra = info?.extra
  const usage = (extra?.upload ?? 0) + (extra?.download ?? 0)
  const total = extra?.total ?? 0
  const isSmall = profileCardStatus === 'col-span-1'

  if (iconOnly) {
    return (
      <div className={`${profileCardStatus} flex justify-center`}>
        <Tooltip content={t('sider.cards.profiles')} placement="right">
          <Button
            size="sm"
            isIconOnly
            color={match ? 'primary' : 'default'}
            variant={match ? 'solid' : 'light'}
            onPress={() => {
              navigate('/profiles')
            }}
          >
            <TiFolder className="text-[22px]" />
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
      className={`${profileCardStatus} profile-card`}
    >
      {showRuntimeConfig && <ConfigViewer onClose={() => setShowRuntimeConfig(false)} />}
      
      <Card
        fullWidth
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        className={`${match ? 'bg-primary' : 'hover:bg-primary/30'} ${
          disableAnimations ? '' : `motion-reduce:transition-transform-background ${
            isDragging ? 'scale-[0.95] tap-highlight-transparent' : ''
          }`
          // Final adjustment: h-[106px] to match neighbor panels exactly
        } ${isSmall ? 'h-[106px]' : 'h-[114px]'} overflow-hidden`}
      >
        <CardBody className={`${isSmall ? 'p-2 pt-1.5' : 'p-3'} pb-0 flex flex-col justify-start`}>
          <div className="flex justify-between items-center h-[32px] gap-1 flex-none">
            <h3
              title={info?.name}
              className={`text-ellipsis whitespace-nowrap overflow-hidden font-bold leading-[32px] flex-shrink ${
                isSmall ? 'text-[14px]' : 'text-[18px]'
              } ${match ? 'text-primary-foreground' : 'text-foreground'}`}
            >
              {info?.name}
            </h3>
            <div className="flex flex-none">
              <Button
                isIconOnly
                size="sm"
                variant="light"
                onPress={() => setShowRuntimeConfig(true)}
              >
                <CgLoadbarDoc
                  className={`text-[24px] ${match ? 'text-primary-foreground' : 'text-foreground'}`}
                />
              </Button>
              {info.type === 'remote' && (
                <Button
                  isIconOnly
                  size="sm"
                  disabled={updating}
                  variant="light"
                  onPress={async () => {
                    setUpdating(true)
                    await addProfileItem(info)
                    setUpdating(false)
                  }}
                >
                  <IoMdRefresh
                    className={`text-[24px] ${match ? 'text-primary-foreground' : 'text-foreground'} ${
                      updating ? 'animate-spin' : ''
                    }`}
                  />
                </Button>
              )}
            </div>
          </div>

          {!isSmall && <div className="flex-grow" />}

          {info.type === 'remote' && extra && (
            <div 
              className={`flex mb-1 flex-none ${
                isSmall 
                  ? 'flex-col items-start gap-0 mt-0.5' 
                  : 'flex-row justify-between items-end'
              } ${match ? 'text-primary-foreground' : 'text-foreground'}`}
            >
              <div className={`${isSmall ? 'order-1' : 'order-2'}`}>
                <Button
                  size="sm"
                  variant="light"
                  className={`h-[18px] p-0 m-0 min-w-0 bg-transparent ${isSmall ? 'text-[11px]' : 'text-[12px]'} ${match ? 'text-primary-foreground' : 'text-foreground'}`}
                  onPress={async () => {
                    await patchAppConfig({ profileDisplayDate: profileDisplayDate === 'expire' ? 'update' : 'expire' })
                  }}
                >
                  {profileDisplayDate === 'expire' 
                    ? (extra.expire ? dayjs.unix(extra.expire).format('YYYY-MM-DD') : t('sider.cards.neverExpire'))
                    : dayjs(info.updated).fromNow()
                  }
                </Button>
              </div>

              <div className={`${isSmall ? 'order-2' : 'order-1'}`}>
                <small className={`whitespace-nowrap font-medium ${isSmall ? 'text-[11px]' : 'text-[12px]'}`}>
                  {`${calcTraffic(usage)}/${calcTraffic(total)}`}
                </small>
              </div>
            </div>
          )}
        </CardBody>

        <CardFooter className={`${isSmall ? 'px-2 pb-1.5 pt-0' : 'px-3 pb-2 pt-0'}`}>
          {extra && (
            <Progress
              className="w-full"
              size={isSmall ? "sm" : "md"}
              aria-label={t('sider.cards.trafficUsage')}
              classNames={{ indicator: match ? 'bg-primary-foreground' : 'bg-foreground' }}
              value={calcPercent(extra?.upload, extra?.download, extra?.total)}
            />
          )}
          {info.type === 'local' && (
             <Chip
                size="sm"
                variant="bordered"
                className={`${isSmall ? 'h-[18px] text-[10px]' : ''} ${match ? 'text-primary-foreground border-primary-foreground' : 'border-primary text-primary'}`}
              >
                {t('sider.cards.local')}
              </Chip>
          )}
        </CardFooter>
      </Card>
    </div>
  )
}

export default ProfileCard
