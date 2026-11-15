import { Button, Card, CardBody, CardFooter } from '@heroui/react'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'
import BorderSwitch from '@renderer/components/base/border-switch'
import { TbDeviceIpadHorizontalBolt } from 'react-icons/tb'
import { useLocation } from 'react-router-dom'
import { triggerProxy, updateTrayIconImmediate } from '@renderer/utils/ipc'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import React from 'react'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useTranslation } from 'react-i18next'
import SiderItem from './sider-item'

interface Props {
  iconOnly?: boolean
  expanded?: boolean
}

const TunSwitcher: React.FC<Props> = (props) => {
  const { t } = useTranslation()
  const { iconOnly, expanded } = props
  const location = useLocation()
  const match = location.pathname.includes('/tun') || false
  const { appConfig } = useAppConfig()
  const { tunCardStatus = 'col-span-1', disableAnimations = false, proxyRunning = false } = appConfig || {}
  const sysProxyEnabled = appConfig?.sysProxy?.enable ?? false
  const { controledMihomoConfig, patchControledMihomoConfig } = useControledMihomoConfig()
  const { tun } = controledMihomoConfig || {}
  const { enable } = tun || {}
  const {
    attributes,
    listeners,
    setNodeRef,
    transform: tf,
    transition,
    isDragging
  } = useSortable({
    id: 'tun'
  })
  const transform = tf ? { x: tf.x, y: tf.y, scaleX: 1, scaleY: 1 } : null
  const onChange = async (enable: boolean): Promise<void> => {
    if (!proxyRunning) {
      await patchControledMihomoConfig(
        enable ? { tun: { enable }, dns: { enable: true } } : { tun: { enable } }
      )
      window.electron.ipcRenderer.send('updateTrayMenu')
      return
    }

    updateTrayIconImmediate(sysProxyEnabled, enable)
    if (enable) {
      try {
        // 检查内核权限
        const hasPermissions = await window.electron.ipcRenderer.invoke(
          'checkMihomoCorePermissions'
        )

        if (!hasPermissions) {
          if (window.electron.process.platform === 'win32') {
            const confirmed = await window.electron.ipcRenderer.invoke('showTunPermissionDialog')
            if (confirmed) {
              try {
                const notification = new Notification(t('tun.permissions.restarting'))
                await window.electron.ipcRenderer.invoke('restartAsAdmin')
                notification.close()
                return
              } catch (error) {
                console.error('Failed to restart as admin:', error)
                await window.electron.ipcRenderer.invoke(
                  'showErrorDialog',
                  t('tun.permissions.failed'),
                  String(error)
                )
                updateTrayIconImmediate(sysProxyEnabled, false)
                return
              }
            } else {
              updateTrayIconImmediate(sysProxyEnabled, false)
              return
            }
          } else {
            // macOS/Linux下尝试自动获取权限
            try {
              await window.electron.ipcRenderer.invoke('requestTunPermissions')
            } catch (error) {
              console.warn('Permission grant failed:', error)
              await window.electron.ipcRenderer.invoke(
                'showErrorDialog',
                t('tun.permissions.failed'),
                String(error)
              )
              updateTrayIconImmediate(sysProxyEnabled, false)
              return
            }
          }
        }
      } catch (error) {
        console.warn('Permission check failed:', error)
      }

      await patchControledMihomoConfig({ tun: { enable }, dns: { enable: true } })
      if (enable) {
        const autoRunEnabled = await window.electron.ipcRenderer.invoke('checkAutoRun')
        if (autoRunEnabled) {
          await window.electron.ipcRenderer.invoke('enableAutoRun')
        }
      }
    } else {
      await patchControledMihomoConfig({ tun: { enable } })
      if (!sysProxyEnabled) {
        await triggerProxy(false)
      }
    }
    window.electron.ipcRenderer.send('updateFloatingWindow')
    window.electron.ipcRenderer.send('updateTrayMenu')
  }

  if (iconOnly) {
    return (
      <SiderItem
        className={tunCardStatus}
        title={t('sider.cards.tun')}
        route="/tun"
        icon={<TbDeviceIpadHorizontalBolt className="text-[20px]" />}
        expanded={expanded}
      >
        <BorderSwitch
          aria-label={t('sider.cards.tun')}
          isShowBorder={match && enable}
          isSelected={enable ?? false}
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
      className={`${tunCardStatus} tun-card`}
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
              <TbDeviceIpadHorizontalBolt
                className={`${match ? 'text-primary-foreground' : 'text-foreground'} text-[24px] font-bold`}
              />
            </Button>
            <BorderSwitch
              isShowBorder={match && enable}
              isSelected={enable ?? false}
              onValueChange={onChange}
            />
          </div>
        </CardBody>
        <CardFooter className="pt-1">
          <h3
            className={`text-md font-bold sider-card-title ${match ? 'text-primary-foreground' : 'text-foreground'}`}
          >
            {t('sider.cards.tun')}
          </h3>
        </CardFooter>
      </Card>
    </div>
  )
}

export default TunSwitcher
