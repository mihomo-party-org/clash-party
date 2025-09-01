import { Button, Card, CardBody, CardFooter, Tooltip } from '@heroui/react'
import { calcTraffic } from '@renderer/utils/calc'
import { mihomoVersion, restartCore } from '@renderer/utils/ipc'
import React, { useEffect, useState } from 'react'
import { IoMdRefresh } from 'react-icons/io'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useLocation, useNavigate } from 'react-router-dom'
import PubSub from 'pubsub-js'
import useSWR from 'swr'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { LuCpu } from 'react-icons/lu'
import { useTranslation } from 'react-i18next'

interface Props {
  iconOnly?: boolean
}

const MihomoCoreCard: React.FC<Props> = (props) => {
  const { appConfig } = useAppConfig()
  const { iconOnly } = props
  const { mihomoCoreCardStatus = 'col-span-2', disableAnimations = false } = appConfig || {}
  const { data: version, mutate } = useSWR('mihomoVersion', mihomoVersion)
  const location = useLocation()
  const navigate = useNavigate()
  const match = location.pathname.includes('/mihomo')
  const {
    attributes,
    listeners,
    setNodeRef,
    transform: tf,
    transition,
    isDragging
  } = useSortable({
    id: 'mihomo'
  })
  const transform = tf ? { x: tf.x, y: tf.y, scaleX: 1, scaleY: 1 } : null
  const [mem, setMem] = useState(0)
  const { t } = useTranslation()

  useEffect(() => {
    const token = PubSub.subscribe('mihomo-core-changed', () => {
      mutate()
    })
    window.electron.ipcRenderer.on('mihomoMemory', (_e, info: IMihomoMemoryInfo) => {
      setMem(info.inuse)
    })
    return (): void => {
      PubSub.unsubscribe(token)
      window.electron.ipcRenderer.removeAllListeners('mihomoMemory')
    }
  }, [])

  if (iconOnly) {
    return (
      <div className={`${mihomoCoreCardStatus} flex justify-center`}>
        <Tooltip content={t('sider.cards.core')} placement="right">
          <Button
            size="sm"
            isIconOnly
            color={match ? 'primary' : 'default'}
            variant={match ? 'solid' : 'light'}
            onPress={() => {
              navigate('/mihomo')
            }}
          >
            <LuCpu className="text-[20px]" />
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
      className={`${mihomoCoreCardStatus} mihomo-core-card`}
    >
      {mihomoCoreCardStatus === 'col-span-2' ? (
        <Card
          fullWidth
          ref={setNodeRef}
          {...attributes}
          {...listeners}
          className={`${match ? 'bg-primary' : 'hover:bg-primary/30'} ${isDragging ? `${disableAnimations ? '' : 'scale-[0.95] tap-highlight-transparent'}` : ''}`}
        >
          <CardBody>
            <div
              ref={setNodeRef}
              {...attributes}
              {...listeners}
              className="flex justify-between h-[32px]"
            >
              <h3
                className={`text-md font-bold leading-[32px] ${match ? 'text-primary-foreground' : 'text-foreground'} `}
              >
                {version?.version ?? '-'}
              </h3>

              <Button
                isIconOnly
                size="sm"
                variant="light"
                color="default"
                onPress={async () => {
                  try {
                    await restartCore()
                  } catch (e) {
                    alert(e)
                  } finally {
                    mutate()
                  }
                }}
              >
                <IoMdRefresh
                  className={`${match ? 'text-primary-foreground' : 'text-foreground'} text-[24px]`}
                />
              </Button>
            </div>
          </CardBody>
          <CardFooter className="pt-1">
            <div
              className={`flex justify-between w-full text-md font-bold ${match ? 'text-primary-foreground' : 'text-foreground'}`}
            >
              <h4>{t('sider.cards.core')}</h4>
              <h4>{calcTraffic(mem)}</h4>
            </div>
          </CardFooter>
        </Card>
      ) : (
        <Card
          fullWidth
          ref={setNodeRef}
          {...attributes}
          {...listeners}
          className={`${match ? 'bg-primary' : 'hover:bg-primary/30'} ${isDragging ? `${disableAnimations ? '' : 'scale-[0.95] tap-highlight-transparent'}` : ''}`}
        >
          <CardBody className="pb-1 pt-0 px-0">
            <div className="flex justify-between">
              <Button
                isIconOnly
                className="bg-transparent pointer-events-none"
                variant="flat"
                color="default"
              >
                <LuCpu
                  color="default"
                  className={`${match ? 'text-primary-foreground' : 'text-foreground'} text-[24px] font-bold`}
                />
              </Button>
            </div>
          </CardBody>
          <CardFooter className="pt-1">
            <h3
              className={`text-md font-bold ${match ? 'text-primary-foreground' : 'text-foreground'}`}
            >
              {t('sider.cards.core')}
            </h3>
          </CardFooter>
        </Card>
      )}
    </div>
  )
}

export default MihomoCoreCard
