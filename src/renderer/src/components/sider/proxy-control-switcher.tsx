import { Button } from '@heroui/react'
import { toast } from '@renderer/components/base/toast'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { triggerProxy } from '@renderer/utils/ipc'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IoPlay, IoStop } from 'react-icons/io5'

interface Props {
  iconOnly?: boolean
  expanded?: boolean
}

const ProxyControlSwitcher: React.FC<Props> = ({ iconOnly = false, expanded = false }) => {
  const { appConfig } = useAppConfig()
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const { proxyRunning = false, disableAnimations = false } = appConfig || {}

  const actionLabel = proxyRunning
    ? t('sider.cards.proxyControl.stop')
    : t('sider.cards.proxyControl.start')

  const onToggle = async (): Promise<void> => {
    if (loading) return
    setLoading(true)
    try {
      await triggerProxy(!proxyRunning)
    } catch (e) {
      toast.error(String(e))
    } finally {
      setLoading(false)
    }
  }

  if (iconOnly) {
    return (
      <Button
        size="sm"
        color={proxyRunning ? 'primary' : 'default'}
        variant={proxyRunning ? 'solid' : 'flat'}
        isLoading={loading}
        onPress={onToggle}
        className={`h-8 w-full min-w-0 px-0 justify-start ${disableAnimations ? 'transition-none' : ''}`}
        aria-label={actionLabel}
      >
        {!loading && (
          <span className="sider-mode-icon">
            {proxyRunning ? <IoStop className="text-[15px]" /> : <IoPlay className="text-[15px]" />}
          </span>
        )}
        <span className="sider-item-label truncate text-xs font-medium" aria-hidden={!expanded}>
          {actionLabel}
        </span>
      </Button>
    )
  }

  return (
    <Button
      size="sm"
      fullWidth
      color={proxyRunning ? 'primary' : 'default'}
      variant={proxyRunning ? 'solid' : 'flat'}
      isLoading={loading}
      onPress={onToggle}
      className={`h-9 shadow-medium font-medium justify-between px-3 ${disableAnimations ? 'transition-none' : ''}`}
    >
      <span className="flex items-center gap-2 min-w-0">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${
            proxyRunning ? 'bg-primary-foreground' : 'bg-default-400'
          }`}
        />
        <span className="truncate text-xs">
          {proxyRunning
            ? t('sider.cards.proxyControl.running')
            : t('sider.cards.proxyControl.stopped')}
        </span>
      </span>
      <span className="flex items-center gap-1 shrink-0 text-xs">
        {!loading && (proxyRunning ? <IoStop className="text-sm" /> : <IoPlay className="text-sm" />)}
        <span>{actionLabel}</span>
      </span>
    </Button>
  )
}

export default ProxyControlSwitcher
