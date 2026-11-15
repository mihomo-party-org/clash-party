import { Button, Input, Tab, Tabs } from '@heroui/react'
import BasePage from '@renderer/components/base/base-page'
import { showErrorSync } from '@renderer/utils/error-display'
import SettingCard from '@renderer/components/base/base-setting-card'
import SettingItem from '@renderer/components/base/base-setting-item'
import PacEditorModal from '@renderer/components/sysproxy/pac-editor-modal'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { platform } from '@renderer/utils/init'
import { openUWPTool, triggerSysProxy } from '@renderer/utils/ipc'
import { sysProxyBypassValidator } from '@renderer/utils/validate'
import React, { Key, useState } from 'react'
import { MdDeleteForever } from 'react-icons/md'
import { useTranslation } from 'react-i18next'

const defaultPacScript = `
function FindProxyForURL(url, host) {
  return "PROXY 127.0.0.1:%mixed-port%; SOCKS5 127.0.0.1:%mixed-port%; DIRECT;";
}
`

const Sysproxy: React.FC = () => {
  const defaultBypass: string[] =
    platform === 'linux'
      ? ['localhost', '127.0.0.1', '192.168.0.0/16', '10.0.0.0/8', '172.16.0.0/12', '::1']
      : platform === 'darwin'
        ? [
            '127.0.0.1',
            '192.168.0.0/16',
            '10.0.0.0/8',
            '172.16.0.0/12',
            'localhost',
            '*.local',
            '*.crashlytics.com',
            '<local>'
          ]
        : [
            'localhost',
            '127.*',
            '192.168.*',
            '10.*',
            '172.16.*',
            '172.17.*',
            '172.18.*',
            '172.19.*',
            '172.20.*',
            '172.21.*',
            '172.22.*',
            '172.23.*',
            '172.24.*',
            '172.25.*',
            '172.26.*',
            '172.27.*',
            '172.28.*',
            '172.29.*',
            '172.30.*',
            '172.31.*',
            '<local>'
          ]

  const { t } = useTranslation()
  const { appConfig, patchAppConfig } = useAppConfig()
  const { sysProxy, proxyRunning = false } = appConfig || ({ sysProxy: { enable: false } } as IAppConfig)
  const [changed, setChanged] = useState(false)
  const [values, originSetValues] = useState({
    enable: sysProxy.enable,
    host: sysProxy.host ?? '',
    bypass: sysProxy.bypass ?? defaultBypass,
    mode: sysProxy.mode ?? 'manual',
    pacScript: sysProxy.pacScript ?? defaultPacScript
  })

  const setValues = (v: typeof values): void => {
    originSetValues(v)
    setChanged(true)
  }

  const normalizedBypass = values.bypass.map((entry) => entry.trim()).filter(Boolean)
  const hasInvalidBypass = normalizedBypass.some(
    (entry) => !sysProxyBypassValidator(entry, platform)
  )
  const bypassInputs = hasInvalidBypass ? values.bypass : [...values.bypass, '']
  const bypassExample = platform === 'win32' ? '127.*' : '192.168.0.0/16'
  const getBypassError = (entry: string): string | undefined => {
    const trimmedEntry = entry.trim()
    if (trimmedEntry === '' || sysProxyBypassValidator(trimmedEntry, platform)) return undefined
    return t(
      platform === 'win32' ? 'sysproxy.bypass.invalid.windows' : 'sysproxy.bypass.invalid.unix'
    )
  }

  const [openPacEditor, setOpenPacEditor] = useState(false)

  const handleBypassChange = (value: string, index: number): void => {
    const newBypass = [...values.bypass]
    if (index === newBypass.length) {
      if (value.trim() !== '') {
        newBypass.push(value)
      }
    } else {
      if (value.trim() === '') {
        newBypass.splice(index, 1)
      } else {
        newBypass[index] = value
      }
    }
    setValues({ ...values, bypass: newBypass })
  }

  const onSave = async (): Promise<void> => {
    setChanged(false)

    // 保存当前的开关状态，以便在失败时恢复
    const previousState = values.enable
    const sysProxyPatch: ISysProxyConfig = { ...values }
    if (hasInvalidBypass) {
      // 存在非法条目时不覆盖已保存的绕过列表，其它系统代理设置照常保存
      delete sysProxyPatch.bypass
    } else {
      sysProxyPatch.bypass = normalizedBypass
    }

    try {
      await patchAppConfig({ sysProxy: sysProxyPatch })
      if (proxyRunning) {
        await triggerSysProxy(true)
      }

      await patchAppConfig({ sysProxy: { enable: true } })
    } catch (e) {
      setValues({ ...values, enable: previousState })
      setChanged(true)
      showErrorSync(e, t('common.error.sysproxySetupFailed'))

      await patchAppConfig({ sysProxy: { enable: false } })
    }
  }

  return (
    <BasePage
      title={t('sysproxy.title')}
      header={
        changed && (
          <Button color="primary" className="app-nodrag" size="sm" onPress={onSave}>
            {t('common.save')}
          </Button>
        )
      }
    >
      {openPacEditor && (
        <PacEditorModal
          script={values.pacScript || defaultPacScript}
          onCancel={() => setOpenPacEditor(false)}
          onConfirm={(script: string) => {
            setValues({ ...values, pacScript: script })
            setOpenPacEditor(false)
          }}
        />
      )}
      <SettingCard className="sysproxy-settings">
        <SettingItem title={t('sysproxy.host.title')} divider>
          <Input
            size="sm"
            className="w-[50%]"
            value={values.host}
            placeholder={t('sysproxy.host.placeholder')}
            onValueChange={(v) => {
              setValues({ ...values, host: v })
            }}
          />
        </SettingItem>
        <SettingItem title={t('sysproxy.mode.title')} divider>
          <Tabs
            size="sm"
            color="primary"
            selectedKey={values.mode}
            onSelectionChange={(key: Key) => setValues({ ...values, mode: key as SysProxyMode })}
          >
            <Tab key="manual" title={t('sysproxy.mode.manual')} />
            <Tab key="auto" title={t('sysproxy.mode.pac')} />
          </Tabs>
        </SettingItem>
        {platform === 'win32' && (
          <SettingItem title={t('sysproxy.uwp.title')} divider>
            <Button
              size="sm"
              onPress={async () => {
                await openUWPTool()
              }}
            >
              {t('sysproxy.uwp.open')}
            </Button>
          </SettingItem>
        )}

        {values.mode === 'auto' && (
          <SettingItem title={t('sysproxy.mode.title')}>
            <Button size="sm" onPress={() => setOpenPacEditor(true)} variant="bordered">
              {t('sysproxy.pac.edit')}
            </Button>
          </SettingItem>
        )}
        {values.mode === 'manual' && (
          <>
            <SettingItem title={t('sysproxy.bypass.addDefault')} divider>
              <Button
                size="sm"
                onPress={() => {
                  setValues({ ...values, bypass: defaultBypass.concat(values.bypass) })
                }}
              >
                {t('sysproxy.bypass.addDefault')}
              </Button>
            </SettingItem>
            <div className="flex flex-col items-stretch">
              <h3 className="mb-2">{t('sysproxy.bypass.title')}</h3>
              {bypassInputs.map((domain, index) => (
                <div key={index} className="mb-2 flex">
                  <Input
                    fullWidth
                    size="sm"
                    placeholder={t('sysproxy.bypass.placeholder', { example: bypassExample })}
                    value={domain}
                    isInvalid={Boolean(getBypassError(domain))}
                    errorMessage={getBypassError(domain)}
                    onValueChange={(v) => handleBypassChange(v, index)}
                  />
                  {index < values.bypass.length && (
                    <Button
                      className="ml-2"
                      size="sm"
                      variant="flat"
                      color="warning"
                      onPress={() => handleBypassChange('', index)}
                    >
                      <MdDeleteForever className="text-lg" />
                    </Button>
                  )}
                </div>
              ))}
              {hasInvalidBypass && (
                <div className="px-1 text-xs text-danger">{t('sysproxy.bypass.notSaved')}</div>
              )}
            </div>
          </>
        )}
      </SettingCard>
    </BasePage>
  )
}

export default Sysproxy
