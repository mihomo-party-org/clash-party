import { Button, Input, Select, SelectItem, Switch, Tab, Tabs, Tooltip } from '@heroui/react'
import { toast } from '@renderer/components/base/toast'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { platform } from '@renderer/utils/init'
import { copyEnv } from '@renderer/utils/ipc'
import { useTranslation } from 'react-i18next'
import { BiCopy } from 'react-icons/bi'
import { IoIosHelpCircle } from 'react-icons/io'
import SettingCard from '../base/base-setting-card'
import SettingItem from '../base/base-setting-item'

const AdvancedSettings: React.FC = () => {
  const { t } = useTranslation()
  const { appConfig, patchAppConfig } = useAppConfig()
  const {
    autoQuitWithoutCore = false,
    autoQuitWithoutCoreDelay = 60,
    autoQuitWithoutCoreMode = 'core',
    envType = [platform === 'win32' ? 'powershell' : 'bash'],
    disableAppLog = false
  } = appConfig || {}

  return (
    <SettingCard title={t('settings.advanced')}>
      <SettingItem
        title={t('settings.autoQuitWithoutCore')}
        actions={
          <Tooltip content={t('settings.autoQuitWithoutCoreTooltip')}>
            <Button isIconOnly size="sm" variant="light">
              <IoIosHelpCircle className="text-lg" />
            </Button>
          </Tooltip>
        }
        divider
      >
        <Switch
          size="sm"
          isSelected={autoQuitWithoutCore}
          onValueChange={(v) => {
            patchAppConfig({ autoQuitWithoutCore: v })
          }}
        />
      </SettingItem>
      {autoQuitWithoutCore && (
        <>
          <SettingItem title={t('settings.autoQuitWithoutCoreMode')} divider>
            <Tabs
              size="sm"
              color="primary"
              selectedKey={autoQuitWithoutCoreMode}
              onSelectionChange={async (key) => {
                const mode = key as 'core' | 'tray'
                await patchAppConfig({ autoQuitWithoutCoreMode: mode })
                if (mode === 'core' && autoQuitWithoutCoreDelay < 5) {
                  await patchAppConfig({ autoQuitWithoutCoreDelay: 5 })
                }
              }}
            >
              <Tab key="core" title={t('settings.autoQuitWithoutCoreModeCore')} />
              <Tab key="tray" title={t('settings.autoQuitWithoutCoreModeTray')} />
            </Tabs>
          </SettingItem>
          <SettingItem title={t('settings.autoQuitWithoutCoreDelay')} divider>
            <div className="flex items-center gap-2">
              <Input
                size="sm"
                className="w-25"
                type="number"
                value={autoQuitWithoutCoreDelay.toString()}
                onValueChange={async (v: string) => {
                  const num = parseInt(v)
                  if (!isNaN(num)) {
                    await patchAppConfig({ autoQuitWithoutCoreDelay: num })
                  }
                }}
                onBlur={async (e) => {
                  const minDelay = autoQuitWithoutCoreMode === 'core' ? 5 : 0
                  let num = parseInt(e.target.value)
                  if (isNaN(num)) num = minDelay
                  if (num < minDelay) num = minDelay
                  await patchAppConfig({ autoQuitWithoutCoreDelay: num })
                }}
              />
              <span className="text-default-500">{t('common.seconds')}</span>
            </div>
          </SettingItem>
        </>
      )}
      <SettingItem
        title={t('settings.envType')}
        actions={envType.map((type) => (
          <Button
            key={type}
            title={type}
            isIconOnly
            size="sm"
            variant="light"
            onPress={() => copyEnv(type)}
          >
            <BiCopy className="text-lg" />
          </Button>
        ))}
        divider
      >
        <Select
          classNames={{ trigger: 'data-[hover=true]:bg-default-200' }}
          className="w-37.5"
          size="sm"
          selectionMode="multiple"
          selectedKeys={new Set(envType)}
          aria-label={t('settings.envType')}
          disallowEmptySelection={true}
          onSelectionChange={async (v) => {
            try {
              await patchAppConfig({
                envType: Array.from(v) as ('bash' | 'cmd' | 'powershell' | 'fish' | 'nushell')[]
              })
            } catch (e) {
              toast.error(String(e))
            }
          }}
        >
          <SelectItem key="bash">Bash</SelectItem>
          <SelectItem key="cmd">CMD</SelectItem>
          <SelectItem key="powershell">PowerShell</SelectItem>
          <SelectItem key="fish">Fish</SelectItem>
          <SelectItem key="nushell">Nushell</SelectItem>
        </Select>
      </SettingItem>
      <SettingItem title={t('settings.disableAppLog')}>
        <Switch
          size="sm"
          isSelected={disableAppLog}
          onValueChange={async (v) => {
            await patchAppConfig({ disableAppLog: v })
          }}
        />
      </SettingItem>
    </SettingCard>
  )
}

export default AdvancedSettings
