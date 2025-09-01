import { Button, Card, CardBody, CardFooter, Tooltip } from '@heroui/react'
import React from 'react'
import { MdFormatOverline } from 'react-icons/md'
import { useLocation, useNavigate } from 'react-router-dom'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useTranslation } from 'react-i18next'

interface Props {
  iconOnly?: boolean
}

const OverrideCard: React.FC<Props> = (props) => {
  const { t } = useTranslation()
  const { appConfig } = useAppConfig()
  const { iconOnly } = props
  const { overrideCardStatus = 'col-span-1', disableAnimations = false } = appConfig || {}
  const location = useLocation()
  const navigate = useNavigate()
  const match = location.pathname.includes('/override')
  const {
    attributes,
    listeners,
    setNodeRef,
    transform: tf,
    transition,
    isDragging
  } = useSortable({
    id: 'override'
  })
  const transform = tf ? { x: tf.x, y: tf.y, scaleX: 1, scaleY: 1 } : null
  if (iconOnly) {
    return (
      <div className={`${overrideCardStatus} flex justify-center`}>
        <Tooltip content={t('sider.cards.override')} placement="right">
          <Button
            size="sm"
            isIconOnly
            color={match ? 'primary' : 'default'}
            variant={match ? 'solid' : 'light'}
            onPress={() => {
              navigate('/override')
            }}
          >
            <MdFormatOverline className="text-[20px]" />
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
      className={`${overrideCardStatus} override-card`}
    >
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
              <MdFormatOverline
                color="default"
                className={`${match ? 'text-primary-foreground' : 'text-foreground'} text-[24px]`}
              />
            </Button>
          </div>
        </CardBody>
        <CardFooter className="pt-1">
          <h3
            className={`text-md font-bold ${match ? 'text-primary-foreground' : 'text-foreground'}`}
          >
            {t('sider.cards.override')}
          </h3>
        </CardFooter>
      </Card>
    </div>
  )
}

export default OverrideCard
