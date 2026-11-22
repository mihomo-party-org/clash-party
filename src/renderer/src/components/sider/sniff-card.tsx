import { Button, Card, CardBody, CardFooter } from '@heroui/react'
import { toast } from '@renderer/components/base/toast'
import BorderSwitch from '@renderer/components/base/border-switch'
import { RiScan2Fill } from 'react-icons/ri'
import { useLocation } from 'react-router-dom'
import { mihomoHotReloadConfig } from '@renderer/utils/ipc'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { DEFAULT_CONTROL_SNIFF } from '../../../../shared/appConfig'
import SiderItem from './sider-item'

interface Props {
  iconOnly?: boolean
  expanded?: boolean
}
const SniffCard: React.FC<Props> = (props) => {
  const { t } = useTranslation()
  const { appConfig, patchAppConfig } = useAppConfig()
  const { iconOnly, expanded } = props
  const {
    sniffCardStatus = 'col-span-1',
    controlSniff = DEFAULT_CONTROL_SNIFF,
    disableAnimations = false
  } = appConfig || {}
  const location = useLocation()
  const match = location.pathname.includes('/sniffer')
  const {
    attributes,
    listeners,
    setNodeRef,
    transform: tf,
    transition,
    isDragging
  } = useSortable({
    id: 'sniff'
  })
  const transform = tf ? { x: tf.x, y: tf.y, scaleX: 1, scaleY: 1 } : null
  const onChange = async (controlSniff: boolean): Promise<void> => {
    try {
      await patchAppConfig({ controlSniff })
      await mihomoHotReloadConfig()
    } catch (e) {
      toast.error(String(e))
    }
  }

  if (iconOnly) {
    return (
      <SiderItem
        className={sniffCardStatus}
        title={t('sider.cards.sniff')}
        route="/sniffer"
        icon={<RiScan2Fill className="text-[20px]" />}
        expanded={expanded}
      >
        <BorderSwitch
          aria-label={t('sider.cards.sniff')}
          isShowBorder={match && controlSniff}
          isSelected={controlSniff}
          onValueChange={onChange}
        />
      </SiderItem>
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
      className={`${sniffCardStatus} sniff-card`}
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
              <RiScan2Fill
                color="default"
                className={`${match ? 'text-primary-foreground' : 'text-foreground'} text-[24px]`}
              />
            </Button>
            <BorderSwitch
              isShowBorder={match && controlSniff}
              isSelected={controlSniff}
              onValueChange={onChange}
            />
          </div>
        </CardBody>
        <CardFooter className="pt-1">
          <h3
            className={`text-md font-bold text-ellipsis whitespace-nowrap overflow-hidden ${match ? 'text-primary-foreground' : 'text-foreground'}`}
          >
            {t('sider.cards.sniff')}
          </h3>
        </CardFooter>
      </Card>
    </div>
  )
}

export default SniffCard
