import { Button, Card, CardBody, CardFooter, Tooltip } from '@heroui/react'
import { MdApps } from 'react-icons/md'
import { useLocation, useNavigate } from 'react-router-dom'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import React from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  iconOnly?: boolean
}
const AppsCard: React.FC<Props> = (props) => {
  const { t } = useTranslation()
  const { appConfig } = useAppConfig()
  const { iconOnly } = props
  const {
    appsCardStatus = 'col-span-1',
    disableAnimations = false,
    appProxyRules = []
  } = appConfig || {}
  const bypassedCount = appProxyRules.filter((r) => !r.enabled).length
  const location = useLocation()
  const navigate = useNavigate()
  const match = location.pathname.includes('/apps')
  const {
    attributes,
    listeners,
    setNodeRef,
    transform: tf,
    transition,
    isDragging
  } = useSortable({ id: 'apps' })
  const transform = tf ? { x: tf.x, y: tf.y, scaleX: 1, scaleY: 1 } : null

  if (iconOnly) {
    return (
      <div className={`${appsCardStatus} flex justify-center`}>
        <Tooltip content={t('sider.cards.apps')} placement="right">
          <Button
            size="sm"
            isIconOnly
            color={match ? 'primary' : 'default'}
            variant={match ? 'solid' : 'light'}
            onPress={() => {
              navigate('/apps')
            }}
          >
            <MdApps className="text-[20px]" />
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
      className={`${appsCardStatus} apps-card`}
    >
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
              <MdApps
                className={`${match ? 'text-primary-foreground' : 'text-foreground'} text-[24px] font-bold`}
              />
            </Button>
            {bypassedCount > 0 && (
              <span
                className={`text-xs mt-2 mr-2 ${match ? 'text-primary-foreground/70' : 'text-foreground/50'}`}
              >
                {bypassedCount} {t('apps.bypassed')}
              </span>
            )}
          </div>
        </CardBody>
        <CardFooter className="pt-1">
          <h3
            className={`text-md font-bold sider-card-title ${match ? 'text-primary-foreground' : 'text-foreground'}`}
          >
            {t('sider.cards.apps')}
          </h3>
        </CardFooter>
      </Card>
    </div>
  )
}

export default AppsCard
