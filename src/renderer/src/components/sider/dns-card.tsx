import { Button, Card, CardBody, CardFooter, Tooltip } from '@heroui/react'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'
import BorderSwitch from '@renderer/components/base/border-swtich'
import { LuServer } from 'react-icons/lu'
import { useLocation, useNavigate } from 'react-router-dom'
import { restartCore } from '@renderer/utils/ipc'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import React from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  iconOnly?: boolean
}
const DNSCard: React.FC<Props> = (props) => {
  const { t } = useTranslation()
  const { appConfig, patchAppConfig } = useAppConfig()
  const { iconOnly } = props
  const { dnsCardStatus = 'col-span-1', controlDns = true, disableAnimations = false } = appConfig || {}
  const location = useLocation()
  const navigate = useNavigate()
  const match = location.pathname.includes('/dns')
  const { patchControledMihomoConfig } = useControledMihomoConfig()
  const {
    attributes,
    listeners,
    setNodeRef,
    transform: tf,
    transition,
    isDragging
  } = useSortable({
    id: 'dns'
  })
  const transform = tf ? { x: tf.x, y: tf.y, scaleX: 1, scaleY: 1 } : null
  const onChange = async (controlDns: boolean): Promise<void> => {
    try {
      await patchAppConfig({ controlDns })
      await patchControledMihomoConfig({})
      await restartCore()
    } catch (e) {
      alert(e)
    }
  }

  if (iconOnly) {
    return (
      <div className={`${dnsCardStatus} flex justify-center`}>
        <Tooltip content={t('sider.cards.dns')} placement="right">
          <Button
            size="sm"
            isIconOnly
            color={match ? 'primary' : 'default'}
            variant={match ? 'solid' : 'light'}
            onPress={() => {
              navigate('/dns')
            }}
          >
            <LuServer className="text-[20px]" />
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
      className={`${dnsCardStatus} dns-card`}
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
              <LuServer
                className={`${match ? 'text-primary-foreground' : 'text-foreground'} text-[24px] font-bold`}
              />
            </Button>
            <BorderSwitch
              isShowBorder={match && controlDns}
              isSelected={controlDns}
              isDisabled={false}
              onValueChange={onChange}
            />
          </div>
        </CardBody>
        <CardFooter className="pt-1">
          <h3
            className={`text-md font-bold ${match ? 'text-primary-foreground' : 'text-foreground'}`}
          >
            {t('sider.cards.dns')}
          </h3>
        </CardFooter>
      </Card>
    </div>
  )
}

export default DNSCard
