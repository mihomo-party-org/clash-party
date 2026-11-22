import React, { useEffect, useRef, useState } from 'react'
import { Button, Input, Switch, Tooltip } from '@heroui/react'
import { IoIosHelpCircle } from 'react-icons/io'
import { toast } from '@renderer/components/base/toast'
import SettingItem from '@renderer/components/base/base-setting-item'
import SettingCard from '@renderer/components/base/base-setting-card'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useTranslation } from 'react-i18next'
import { importMcpAgent, patchAppConfig as saveAppConfig } from '@renderer/utils/ipc'
import { mcpAgents, type McpAgent } from '../../../../shared/mcp-agents'

const agentNames: Record<McpAgent, string> = {
  cursor: 'Cursor',
  vscode: 'VS Code',
  'claude-code': 'Claude Code',
  codex: 'Codex'
}

const McpConfig: React.FC = () => {
  const { t } = useTranslation()
  const { appConfig, patchAppConfig, mutateAppConfig } = useAppConfig()
  const {
    mcpEnabled = false,
    mcpAllowWrites = false,
    mcpAutoApprove = false,
    mcpPort = 28765,
    mcpToken = ''
  } = appConfig || {}
  const [port, setPort] = useState(String(mcpPort))
  const [token, setToken] = useState(mcpToken)
  const [importing, setImporting] = useState<McpAgent>()
  const pendingSave = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    setPort(String(mcpPort))
  }, [mcpPort])
  useEffect(() => setToken(mcpToken), [mcpToken])

  const normalizedPort = (): number => {
    const value = Number(port)
    return Number.isInteger(value) && value >= 1024 && value <= 65535 ? value : 28765
  }

  const saveConnection = (patch: Partial<IAppConfig>): Promise<void> => {
    const task = pendingSave.current.catch(() => {}).then(() => saveAppConfig(patch))
    pendingSave.current = task
    return task.finally(() => mutateAppConfig())
  }

  const importAgent = async (agent: McpAgent): Promise<void> => {
    if (importing) return
    setImporting(agent)
    try {
      // Save edits even if the button was pressed immediately after editing a field.
      await saveConnection({ mcpPort: normalizedPort(), mcpToken: token.trim() })
      const result = await importMcpAgent(agent)
      if (result.status === 'error') {
        toast.error(t(`settings.mcp.importError.${result.code}`))
      } else if (result.status !== 'cancelled') {
        toast.success(t(`settings.mcp.importResult.${result.status}`, { agent: agentNames[agent] }))
      }
    } catch {
      toast.error(t('settings.mcp.importError.saveFailed'))
    } finally {
      setImporting(undefined)
    }
  }

  return (
    <SettingCard title={t('settings.mcp.title')}>
      <SettingItem title={t('settings.mcp.enabled')} divider>
        <Switch
          size="sm"
          isDisabled={!!importing}
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
      <SettingItem title={t('settings.mcp.allowWrites')} divider>
        <Switch
          size="sm"
          isDisabled={!!importing}
          isSelected={mcpAllowWrites}
          onValueChange={async (value) => {
            try {
              await patchAppConfig({ mcpAllowWrites: value })
            } catch (error) {
              toast.error(String(error))
            }
          }}
        />
      </SettingItem>
      <SettingItem
        title={t('settings.mcp.autoApprove')}
        actions={
          <Tooltip content={t('settings.mcp.autoApproveHint')}>
            <Button
              isIconOnly
              size="sm"
              variant="light"
              aria-label={t('settings.mcp.autoApproveHint')}
            >
              <IoIosHelpCircle className="text-lg" />
            </Button>
          </Tooltip>
        }
        divider
      >
        <Switch
          size="sm"
          aria-label={t('settings.mcp.autoApprove')}
          isDisabled={!mcpEnabled || !mcpAllowWrites || !!importing}
          isSelected={mcpAutoApprove}
          onValueChange={async (value) => {
            try {
              await patchAppConfig({ mcpAutoApprove: value })
            } catch (error) {
              toast.error(String(error))
            }
          }}
        />
      </SettingItem>
      <SettingItem title={t('settings.mcp.port')} divider>
        <Input
          size="sm"
          isDisabled={!!importing}
          className="w-30"
          type="number"
          min={1024}
          max={65535}
          value={port}
          onValueChange={setPort}
          onBlur={async () => {
            const value = normalizedPort()
            setPort(String(value))
            try {
              await saveConnection({ mcpPort: value })
            } catch {
              toast.error(t('settings.mcp.importError.saveFailed'))
            }
          }}
        />
      </SettingItem>
      <SettingItem title={t('settings.mcp.token')} divider>
        <Input
          size="sm"
          isDisabled={!!importing}
          className="w-70"
          type="password"
          value={token}
          placeholder={t('settings.mcp.tokenPlaceholder')}
          onValueChange={setToken}
          onBlur={async () => {
            try {
              await saveConnection({ mcpToken: token.trim() })
            } catch {
              toast.error(t('settings.mcp.importError.saveFailed'))
            }
          }}
        />
      </SettingItem>
      <div className="flex flex-col gap-2">
        <h4 className="text-sm">{t('settings.mcp.importTitle')}</h4>
        <div className="flex flex-wrap gap-2">
          {mcpAgents.map((agent) => (
            <Button
              key={agent}
              size="sm"
              variant="flat"
              isDisabled={!mcpEnabled || !!importing}
              isLoading={importing === agent}
              onPress={() => void importAgent(agent)}
            >
              {agentNames[agent]}
            </Button>
          ))}
        </div>
        <p className="text-xs text-foreground-500">{t('settings.mcp.importHint')}</p>
      </div>
    </SettingCard>
  )
}

export default McpConfig
