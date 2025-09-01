import { Button, Card, CardBody, CardFooter, Tooltip } from '@heroui/react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import SubStoreIcon from '../base/substore-icon'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import React from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  iconOnly?: boolean
}

const SubStoreCard: React.FC<Props> = (props) => {
  const { t } = useTranslation()
  const { appConfig } = useAppConfig()
  const { iconOnly } = props
  const { substoreCardStatus = 'col-span-1', useSubStore = true, disableAnimations = false } = appConfig || {}
  const location = useLocation()
  const navigate = useNavigate()
  const match = location.pathname.includes('/substore')
  const {
    attributes,
    listeners,
    setNodeRef,
    transform: tf,
    transition,
    isDragging
  } = useSortable({
    id: 'substore'
  })
  const transform = tf ? { x: tf.x, y: tf.y, scaleX: 1, scaleY: 1 } : null

  if (iconOnly) {
    return (
      <div className={`${substoreCardStatus} ${!useSubStore ? 'hidden' : ''} flex justify-center`}>
        <Tooltip content={t('sider.cards.substore')} placement="right">
          <Button
            size="sm"
            isIconOnly
            color={match ? 'primary' : 'default'}
            variant={match ? 'solid' : 'light'}
            onPress={() => {
              navigate('/substore')
            }}
          >
            <SubStoreIcon className="text-[20px]" />
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
      className={`${substoreCardStatus} ${!useSubStore ? 'hidden' : ''} substore-card`}
    >
      <Card
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        fullWidth
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
              <SubStoreIcon
                className={`${match ? 'text-primary-foreground' : 'text-foreground'} text-[24px] font-bold`}
              />
            </Button>
          </div>
        </CardBody>
        <CardFooter className="pt-1">
          <h3
            className={`text-md font-bold ${match ? 'text-primary-foreground' : 'text-foreground'}`}
          >
            {t('sider.cards.substore')}
          </h3>
        </CardFooter>
      </Card>
    </div>
  )
}

export default SubStoreCard
