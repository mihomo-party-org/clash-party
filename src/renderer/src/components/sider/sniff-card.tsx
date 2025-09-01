import { Button, Card, CardBody, CardFooter, Tooltip } from '@heroui/react'
import BorderSwitch from '@renderer/components/base/border-swtich'
import { RiScan2Fill } from 'react-icons/ri'
import { useLocation, useNavigate } from 'react-router-dom'
import { restartCore } from '@renderer/utils/ipc'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import React from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  iconOnly?: boolean
}
const SniffCard: React.FC<Props> = (props) => {
  const { t } = useTranslation()
  const { appConfig, patchAppConfig } = useAppConfig()
  const { iconOnly } = props
  const { sniffCardStatus = 'col-span-1', controlSniff = true, disableAnimations = false } = appConfig || {}
  const location = useLocation()
  const navigate = useNavigate()
  const match = location.pathname.includes('/sniffer')
  const { patchControledMihomoConfig } = useControledMihomoConfig()
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
      await patchControledMihomoConfig({})
      await restartCore()
    } catch (e) {
      alert(e)
    }
  }

  if (iconOnly) {
    return (
      <div className={`${sniffCardStatus} flex justify-center`}>
        <Tooltip content={t('sider.cards.sniff')} placement="right">
          <Button
            size="sm"
            isIconOnly
            color={match ? 'primary' : 'default'}
            variant={match ? 'solid' : 'light'}
            onPress={() => {
              navigate('/sniffer')
            }}
          >
            <RiScan2Fill className="text-[20px]" />
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
      className={`${sniffCardStatus} sniff-card`}
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
            className={`text-md font-bold ${match ? 'text-primary-foreground' : 'text-foreground'}`}
          >
            {t('sider.cards.sniff')}
          </h3>
        </CardFooter>
      </Card>
    </div>
  )
}

export default SniffCard
