import React, { useEffect, useState } from 'react'
import { Input, Switch } from '@heroui/react'
import { toast } from '@renderer/components/base/toast'
import SettingItem from '@renderer/components/base/base-setting-item'
import SettingCard from '@renderer/components/base/base-setting-card'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useTranslation } from 'react-i18next'

const McpConfig: React.FC = () => {
  const { t } = useTranslation()
  const { appConfig, patchAppConfig } = useAppConfig()
  const { mcpEnabled = false, mcpPort = 28765, mcpToken = '' } = appConfig || {}
  const [port, setPort] = useState(String(mcpPort))
  const [token, setToken] = useState(mcpToken)

  useEffect(() => {
    setPort(String(mcpPort))
    setToken(mcpToken)
  }, [mcpPort, mcpToken])

  return (
    <SettingCard title={t('settings.mcp.title')}>
      <SettingItem title={t('settings.mcp.enabled')} divider>
        <Switch
          size="sm"
          isSelected={mcpEnabled}
          onValueChange={async (value) => {
            try {
              await patchAppConfig({ mcpEnabled: value })
            } catch (error) {
              toast.error(String(error))
            }
          }}
        />
      </SettingItem>
      <SettingItem title={t('settings.mcp.port')} divider>
        <Input
          size="sm"
          className="w-30"
          type="number"
          min={1024}
          max={65535}
          value={port}
          onValueChange={setPort}
          onBlur={async () => {
            const parsed = Number.parseInt(port, 10)
            const value = Number.isInteger(parsed) ? Math.min(65535, Math.max(1024, parsed)) : 28765
            setPort(String(value))
            try {
              await patchAppConfig({ mcpPort: value })
            } catch (error) {
              toast.error(String(error))
            }
          }}
        />
      </SettingItem>
      <SettingItem title={t('settings.mcp.token')}>
        <Input
          size="sm"
          className="w-70"
          type="password"
          value={token}
          placeholder={t('settings.mcp.tokenPlaceholder')}
          onValueChange={setToken}
          onBlur={async () => {
            try {
              await patchAppConfig({ mcpToken: token.trim() })
            } catch (error) {
              toast.error(String(error))
            }
          }}
        />
      </SettingItem>
    </SettingCard>
  )
}

export default McpConfig
