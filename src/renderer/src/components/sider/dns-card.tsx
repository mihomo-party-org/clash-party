import { Button, Card, CardBody, CardFooter } from '@heroui/react'
import { toast } from '@renderer/components/base/toast'
import BorderSwitch from '@renderer/components/base/border-switch'
import BaseConfirmModal from '@renderer/components/base/base-confirm-modal'
import { LuServer } from 'react-icons/lu'
import { useLocation } from 'react-router-dom'
import { setControlDns } from '@renderer/utils/ipc'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DEFAULT_CONTROL_DNS } from '../../../../shared/appConfig'
import SiderItem from './sider-item'

interface Props {
  iconOnly?: boolean
  expanded?: boolean
}
const DNSCard: React.FC<Props> = (props) => {
  const { t } = useTranslation()
  const { appConfig, mutateAppConfig } = useAppConfig()
  const { iconOnly, expanded } = props
  const [applying, setApplying] = useState(false)
  // 弹窗保存待确认指纹，开关以后端状态为准。
  const [confirmation, setConfirmation] = useState<string | null>(null)
  const {
    dnsCardStatus = 'col-span-1',
    controlDns = DEFAULT_CONTROL_DNS,
    disableAnimations = false
  } = appConfig || {}
  const location = useLocation()
  const match = location.pathname.includes('/dns')
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
  const apply = async (enabled: boolean, confirmed?: string): Promise<void> => {
    if (applying) return
    setApplying(true)
    try {
      const result = await setControlDns(enabled, confirmed)
      // 来源变化时保留弹窗，换用新指纹。
      setConfirmation(result.status === 'confirm-required' ? result.confirmation : null)
    } catch (e) {
      toast.error(String(e))
    } finally {
      setApplying(false)
      mutateAppConfig()
    }
  }
  const onChange = (controlDns: boolean): void => {
    void apply(controlDns)
  }

  const confirmationModal = (
    <BaseConfirmModal
      isOpen={confirmation !== null}
      title={t('dns.overrideGuard.confirmTitle')}
      content={t('dns.overrideGuard.confirmContent')}
      cancelText={t('dns.overrideGuard.keepOff')}
      confirmText={t('dns.overrideGuard.enableAnyway')}
      isLoading={applying}
      onCancel={() => {
        if (!applying) setConfirmation(null)
      }}
      onConfirm={() => {
        if (confirmation) void apply(true, confirmation)
      }}
    />
  )

  if (iconOnly) {
    return (
      <>
        <SiderItem
          className={dnsCardStatus}
          title={t('sider.cards.dns')}
          route="/dns"
          icon={<LuServer className="text-[20px]" />}
          expanded={expanded}
        >
          <BorderSwitch
            aria-label={t('sider.cards.dns')}
            isShowBorder={match && controlDns}
            isSelected={controlDns}
            isDisabled={applying}
            onValueChange={onChange}
          />
        </SiderItem>
        {confirmationModal}
      </>
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
              <LuServer
                className={`${match ? 'text-primary-foreground' : 'text-foreground'} text-[24px] font-bold`}
              />
            </Button>
            <BorderSwitch
              isShowBorder={match && controlDns}
              isSelected={controlDns}
              isDisabled={applying}
              onValueChange={onChange}
            />
          </div>
        </CardBody>
        <CardFooter className="pt-1">
          <h3
            className={`text-md font-bold sider-card-title ${match ? 'text-primary-foreground' : 'text-foreground'}`}
          >
            {t('sider.cards.dns')}
          </h3>
        </CardFooter>
      </Card>
      {confirmationModal}
    </div>
  )
}

export default DNSCard
