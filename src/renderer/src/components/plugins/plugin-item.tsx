import { Card, CardBody, Chip, Button, Checkbox, Tooltip } from '@heroui/react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@renderer/components/base/toast'
import { removePlugin, loginPlugin, patchPluginItem } from '@renderer/utils/ipc'
import BaseConfirmModal from '@renderer/components/base/base-confirm-modal'
import { TbPuzzle } from 'react-icons/tb'
import { useAppConfig } from '@renderer/hooks/use-app-config'

interface Props {
  item: IPluginItem
  onChanged: () => void
}

const statusColor: Record<IPluginStatus, 'success' | 'warning' | 'primary'> = {
  active: 'success',
  'needs-login': 'primary',
  'needs-reauth': 'warning'
}

const PluginItem: React.FC<Props> = ({ item, onChanged }) => {
  const { t } = useTranslation()
  const { appConfig } = useAppConfig()
  const useProxy =
    typeof item.useProxy === 'boolean' ? item.useProxy : (appConfig?.pluginUseProxy ?? false)

  const [busy, setBusy] = useState(false)
  const [showRemove, setShowRemove] = useState(false)

  const doLogin = async (): Promise<void> => {
    setBusy(true)
    toast.info(t('plugins.loginInProgress'))
    try {
      await loginPlugin(item.id)
      toast.success(t('plugins.loginSuccess'))
    } catch {
      toast.error(t('plugins.loginFailed'))
    } finally {
      setBusy(false)
      onChanged()
    }
  }

  const handleProxyChange = async (v: boolean): Promise<void> => {
    try {
      await patchPluginItem(item.id, { useProxy: v })
      onChanged()
    } catch (e) {
      toast.error(String(e))
    }
  }

  const needsLogin = item.status === 'needs-login'
  const needsReauth = item.status === 'needs-reauth'

  return (
    <Card className="overflow-hidden">
      <CardBody className="flex flex-col gap-2 overflow-x-hidden">
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-1.5 text-primary min-w-0">
            <TbPuzzle className="text-lg flex-shrink-0" />
            <span className="font-bold text-foreground truncate">{item.name}</span>
          </div>
          <Chip size="sm" color={statusColor[item.status]} className="flex-shrink-0">
            {t(`plugins.status.${item.status}`)}
          </Chip>
        </div>
        <span className="text-xs text-foreground-500 truncate" title={item.loginUrl}>
          {item.loginUrl}
        </span>

        {needsLogin && <div className="text-xs text-primary">{t('plugins.needsLoginTip')}</div>}
        {needsReauth && <div className="text-xs text-warning">{t('plugins.reauthTip')}</div>}

        <div className="flex items-center justify-between gap-2 flex-wrap min-w-0">
          <div className="flex items-center gap-2">
            {needsLogin && (
              <Button size="sm" color="primary" isLoading={busy} onPress={doLogin}>
                {t('plugins.login')}
              </Button>
            )}
            {needsReauth && (
              <Button size="sm" color="warning" isLoading={busy} onPress={doLogin}>
                {t('plugins.relogin')}
              </Button>
            )}
            <Button size="sm" variant="flat" color="danger" onPress={() => setShowRemove(true)}>
              {t('plugins.remove')}
            </Button>
          </div>
          <Tooltip content={t('plugins.useProxyWarning')} placement="bottom">
            <Checkbox size="sm" isSelected={useProxy} onValueChange={handleProxyChange}>
              {t('plugins.useProxy')}
            </Checkbox>
          </Tooltip>
        </div>
      </CardBody>

      {showRemove && (
        <BaseConfirmModal
          isOpen={showRemove}
          title={t('plugins.remove')}
          content={t('plugins.removeConfirm')}
          onCancel={() => setShowRemove(false)}
          onConfirm={async () => {
            try {
              await removePlugin(item.id)
            } finally {
              onChanged()
            }
            setShowRemove(false)
          }}
        />
      )}
    </Card>
  )
}

export default PluginItem
