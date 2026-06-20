import { Button, Input, Switch, Tab, Tabs } from '@heroui/react'
import BasePage from '@renderer/components/base/base-page'
import { showErrorSync } from '@renderer/utils/error-display'
import SettingCard from '@renderer/components/base/base-setting-card'
import SettingItem from '@renderer/components/base/base-setting-item'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'
import {
  grantTunPermissions,
  mihomoHotReloadConfig,
  restartCore,
  setupFirewall
} from '@renderer/utils/ipc'
import { platform } from '@renderer/utils/init'
import React, { Key, useState } from 'react'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { MdDeleteForever } from 'react-icons/md'
import { useTranslation } from 'react-i18next'
import { DEFAULT_MIHOMO_TUN_CONFIG, getDefaultMihomoTunDevice } from '../../../shared/appConfig'

const Tun: React.FC = () => {
  const { t } = useTranslation()
  const { controledMihomoConfig, patchControledMihomoConfig } = useControledMihomoConfig()
  const { appConfig, patchAppConfig } = useAppConfig()
  const { autoSetDNS = true } = appConfig || {}
  const { tun } = controledMihomoConfig || {}
  const [loading, setLoading] = useState(false)
  const {
    device = getDefaultMihomoTunDevice(platform),
    stack = DEFAULT_MIHOMO_TUN_CONFIG.stack,
    'auto-route': autoRoute = DEFAULT_MIHOMO_TUN_CONFIG['auto-route'],
    'auto-redirect': autoRedirect = DEFAULT_MIHOMO_TUN_CONFIG['auto-redirect'],
    'auto-detect-interface': autoDetectInterface = DEFAULT_MIHOMO_TUN_CONFIG[
      'auto-detect-interface'
    ],
    'dns-hijack': dnsHijack = DEFAULT_MIHOMO_TUN_CONFIG['dns-hijack'],
    'route-exclude-address': routeExcludeAddress = DEFAULT_MIHOMO_TUN_CONFIG[
      'route-exclude-address'
    ],
    'strict-route': strictRoute = false,
    mtu = DEFAULT_MIHOMO_TUN_CONFIG.mtu
  } = tun || {}
  const [changed, setChanged] = useState(false)
  const [values, originSetValues] = useState({
    device,
    stack,
    autoRoute,
    autoRedirect,
    autoDetectInterface,
    dnsHijack,
    strictRoute,
    routeExcludeAddress,
    mtu
  })
  const setValues = (v: typeof values): void => {
    originSetValues(v)
    setChanged(true)
  }

  const handleExcludeAddressChange = (value: string, index: number): void => {
    const newExcludeAddresses = [...values.routeExcludeAddress]
    if (index === newExcludeAddresses.length) {
      if (value.trim() !== '') {
        newExcludeAddresses.push(value)
      }
    } else {
      if (value.trim() === '') {
        newExcludeAddresses.splice(index, 1)
      } else {
        newExcludeAddresses[index] = value
      }
    }
    setValues({ ...values, routeExcludeAddress: newExcludeAddresses })
  }

  const onSave = async (patch: Partial<IMihomoConfig>): Promise<void> => {
    try {
      await patchControledMihomoConfig(patch)
      await mihomoHotReloadConfig()
    } catch (e) {
      showErrorSync(e, t('common.error.configSaveFailed'))
    } finally {
      setChanged(false)
    }
  }

  return (
    <>
      <BasePage
        title={t('tun.title')}
        header={
          changed && (
            <Button
              size="sm"
              className="app-nodrag"
              color="primary"
              onPress={() =>
                onSave({
                  tun: {
                    device: values.device,
                    stack: values.stack,
                    'auto-route': values.autoRoute,
                    'auto-redirect': values.autoRedirect,
                    'auto-detect-interface': values.autoDetectInterface,
                    'dns-hijack': values.dnsHijack,
                    'strict-route': values.strictRoute,
                    'route-exclude-address': values.routeExcludeAddress,
                    mtu: values.mtu
                  }
                })
              }
            >
              {t('common.save')}
            </Button>
          )
        }
      >
        <SettingCard className="tun-settings">
          {platform === 'win32' && (
            <SettingItem title={t('tun.firewall.title')} divider>
              <Button
                size="sm"
                color="primary"
                isLoading={loading}
                onPress={async () => {
                  setLoading(true)
                  try {
                    await setupFirewall()
                    new Notification(t('tun.notifications.firewallResetSuccess'))
                    await restartCore()
                  } catch (e) {
                    showErrorSync(e, t('common.error.firewallSetupFailed'))
                  } finally {
                    setLoading(false)
                  }
                }}
              >
                {t('tun.firewall.reset')}
              </Button>
            </SettingItem>
          )}
          {platform !== 'win32' && (
            <SettingItem title={t('tun.core.title')} divider>
              <Button
                size="sm"
                color="primary"
                onPress={async () => {
                  try {
                    await grantTunPermissions()
                    new Notification(t('tun.notifications.coreAuthSuccess'))
                    await restartCore()
                  } catch (e) {
                    showErrorSync(e, t('common.error.coreAuthFailed'))
                  }
                }}
              >
                {t('tun.core.auth')}
              </Button>
            </SettingItem>
          )}
          {platform === 'darwin' && (
            <SettingItem title={t('tun.dns.autoSet')} divider>
              <Switch
                size="sm"
                isSelected={autoSetDNS}
                onValueChange={async (v) => {
                  await patchAppConfig({ autoSetDNS: v })
                }}
              />
            </SettingItem>
          )}

          <SettingItem title={t('tun.stack.title')} divider>
            <Tabs
              size="sm"
              color="primary"
              selectedKey={values.stack}
              onSelectionChange={(key: Key) => setValues({ ...values, stack: key as TunStack })}
            >
              <Tab key="gvisor" title="gVisor" />
              <Tab key="mixed" title="Mixed" />
              <Tab key="system" title="System" />
            </Tabs>
          </SettingItem>
          <SettingItem title={t('tun.device.title')} divider>
            <Input
              size="sm"
              className="w-25"
              value={values.device}
              placeholder={getDefaultMihomoTunDevice(platform)}
              onValueChange={(v) => {
                setValues({ ...values, device: v })
              }}
            />
          </SettingItem>

          <SettingItem title={t('tun.strictRoute')} divider>
            <Switch
              size="sm"
              isSelected={values.strictRoute}
              onValueChange={(v) => {
                setValues({ ...values, strictRoute: v })
              }}
            />
          </SettingItem>
          <SettingItem title={t('tun.autoRoute')} divider>
            <Switch
              size="sm"
              isSelected={values.autoRoute}
              onValueChange={(v) => {
                setValues({ ...values, autoRoute: v })
              }}
            />
          </SettingItem>
          {platform === 'linux' && (
            <SettingItem title={t('tun.autoRedirect')} divider>
              <Switch
                size="sm"
                isSelected={values.autoRedirect}
                onValueChange={(v) => {
                  setValues({ ...values, autoRedirect: v })
                }}
              />
            </SettingItem>
          )}
          <SettingItem title={t('tun.autoDetectInterface')} divider>
            <Switch
              size="sm"
              isSelected={values.autoDetectInterface}
              onValueChange={(v) => {
                setValues({ ...values, autoDetectInterface: v })
              }}
            />
          </SettingItem>
          <SettingItem title="MTU" divider>
            <Input
              size="sm"
              type="number"
              className="w-25"
              value={values.mtu.toString()}
              onValueChange={(v) => {
                const num = parseInt(v)
                setValues({ ...values, mtu: isNaN(num) ? DEFAULT_MIHOMO_TUN_CONFIG.mtu : num })
              }}
            />
          </SettingItem>
          <SettingItem title={t('tun.dnsHijack')} divider>
            <Input
              size="sm"
              className="w-[50%]"
              value={values.dnsHijack.join(',')}
              onValueChange={(v) => {
                const arr = v !== '' ? v.split(',') : []
                setValues({ ...values, dnsHijack: arr })
              }}
            />
          </SettingItem>
          <div className="flex flex-col items-stretch">
            <h3 className="mb-2">{t('tun.excludeAddress.title')}</h3>
            {[...values.routeExcludeAddress, ''].map((address, index) => (
              <div key={index} className="mb-2 flex">
                <Input
                  fullWidth
                  size="sm"
                  placeholder={t('tun.excludeAddress.placeholder')}
                  value={address}
                  onValueChange={(v) => handleExcludeAddressChange(v, index)}
                />
                {index < values.routeExcludeAddress.length && (
                  <Button
                    className="ml-2"
                    size="sm"
                    variant="flat"
                    color="warning"
                    onPress={() => handleExcludeAddressChange('', index)}
                  >
                    <MdDeleteForever className="text-lg" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </SettingCard>
      </BasePage>
    </>
  )
}

export default Tun
