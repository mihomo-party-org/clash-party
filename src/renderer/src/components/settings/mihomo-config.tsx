import React, { useState } from 'react'
import { toast } from '@renderer/components/base/toast'
import { Button, Input, Select, SelectItem, Switch, Tooltip } from '@heroui/react'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import debounce from '@renderer/utils/debounce'
import {
  exportGistAgeSecretKey,
  generateGistAgeKeyPair,
  getGistUrl,
  restartCore
} from '@renderer/utils/ipc'
import { MdDeleteForever } from 'react-icons/md'
import { BiCopy, BiDownload, BiKey } from 'react-icons/bi'
import { IoIosHelpCircle } from 'react-icons/io'
import { platform, version } from '@renderer/utils/init'
import { useTranslation } from 'react-i18next'
import SettingItem from '../base/base-setting-item'
import SettingCard from '../base/base-setting-card'

const MihomoConfig: React.FC = () => {
  const { t } = useTranslation()
  const { appConfig, patchAppConfig } = useAppConfig()
  const {
    diffWorkDir = false,
    useHotReloadProfile = false,
    hotReloadProfileAutoCloseConnection = false,
    delayTestConcurrency,
    delayTestTimeout,
    githubToken = '',
    gistAgeEncrypt = false,
    gistAgeRecipient = '',
    gistAgeSecretKey = '',
    autoCloseConnection = true,
    testProfileOnStart = true,
    pauseSSID = [],
    disableDnsOnPauseSSID = false,
    delayTestUrl,
    userAgent,
    subscriptionTimeout = 30000,
    mihomoCpuPriority = 'PRIORITY_NORMAL',
    proxyCols = 'auto'
  } = appConfig || {}
  const [url, setUrl] = useState(delayTestUrl)
  const [pauseSSIDInput, setPauseSSIDInput] = useState(pauseSSID)
  const setUrlDebounce = debounce((v: string) => {
    patchAppConfig({ delayTestUrl: v })
  }, 500)
  const [ua, setUa] = useState(userAgent)
  const setUaDebounce = debounce((v: string) => {
    patchAppConfig({ userAgent: v })
  }, 500)
  const [isGeneratingGistAgeKey, setIsGeneratingGistAgeKey] = useState(false)
  const [isExportingGistAgeKey, setIsExportingGistAgeKey] = useState(false)
  const handleGenerateGistAgeKeyPair = async (): Promise<void> => {
    if (gistAgeSecretKey && !window.confirm(t('mihomo.gist.ageGenerateConfirm'))) return

    setIsGeneratingGistAgeKey(true)
    try {
      const { secretKey, recipient } = await generateGistAgeKeyPair()
      await patchAppConfig({
        gistAgeEncrypt: true,
        gistAgeRecipient: recipient,
        gistAgeSecretKey: secretKey
      })
      toast.success(t('mihomo.gist.generateKeyPairSuccess'))
    } catch (e) {
      toast.error(String(e))
    } finally {
      setIsGeneratingGistAgeKey(false)
    }
  }
  const handleExportGistAgeSecretKey = async (): Promise<void> => {
    setIsExportingGistAgeKey(true)
    try {
      const exported = await exportGistAgeSecretKey()
      if (exported) toast.success(t('mihomo.gist.exportPrivateKeySuccess'))
    } catch (e) {
      toast.error(String(e))
    } finally {
      setIsExportingGistAgeKey(false)
    }
  }
  const handleCopyGistAgeSecretKey = async (): Promise<void> => {
    if (!gistAgeSecretKey) return
    await navigator.clipboard.writeText(gistAgeSecretKey)
    toast.success(t('mihomo.gist.copyPrivateKeySuccess'))
  }
  return (
    <SettingCard>
      <SettingItem title={t('mihomo.userAgent')} divider>
        <Input
          size="sm"
          className="w-[60%]"
          value={ua}
          placeholder={t('mihomo.userAgentPlaceholder', { version })}
          onValueChange={(v) => {
            setUa(v)
            setUaDebounce(v)
          }}
        ></Input>
      </SettingItem>
      <SettingItem title={t('settings.subscriptionTimeout')} divider>
        <div className="flex items-center gap-2">
          <Input
            size="sm"
            className="w-25"
            type="number"
            value={(subscriptionTimeout / 1000)?.toString()}
            onValueChange={async (v: string) => {
              const num = parseInt(v)
              await patchAppConfig({ subscriptionTimeout: num * 1000 })
            }}
            onBlur={async (e) => {
              let num = parseInt(e.target.value)
              if (isNaN(num)) num = 30
              if (num < 30) num = 30
              await patchAppConfig({ subscriptionTimeout: num * 1000 })
            }}
          />
          <span className="text-default-500">{t('common.seconds')}</span>
        </div>
      </SettingItem>
      <SettingItem title={t('mihomo.delayTest.url')} divider>
        <Input
          size="sm"
          className="w-[60%]"
          value={url}
          placeholder={t('mihomo.delayTest.urlPlaceholder')}
          onValueChange={(v) => {
            setUrl(v)
            setUrlDebounce(v)
          }}
        ></Input>
      </SettingItem>
      <SettingItem title={t('mihomo.delayTest.concurrency')} divider>
        <Input
          type="number"
          size="sm"
          className="w-[60%]"
          value={delayTestConcurrency?.toString()}
          placeholder={t('mihomo.delayTest.concurrencyPlaceholder')}
          onValueChange={(v) => {
            patchAppConfig({ delayTestConcurrency: parseInt(v) })
          }}
        />
      </SettingItem>
      <SettingItem title={t('mihomo.delayTest.timeout')} divider>
        <Input
          type="number"
          size="sm"
          className="w-[60%]"
          value={delayTestTimeout?.toString()}
          placeholder={t('mihomo.delayTest.timeoutPlaceholder')}
          onValueChange={(v) => {
            patchAppConfig({ delayTestTimeout: parseInt(v) })
          }}
        />
      </SettingItem>
      <SettingItem
        title={t('mihomo.gist.title')}
        actions={
          <Button
            title={t('mihomo.gist.copyUrl')}
            isIconOnly
            size="sm"
            variant="light"
            onPress={async () => {
              try {
                const url = await getGistUrl()
                if (url !== '') {
                  await navigator.clipboard.writeText(`${url}/raw/clash-party.yaml`)
                }
              } catch (e) {
                toast.error(String(e))
              }
            }}
          >
            <BiCopy className="text-lg" />
          </Button>
        }
        divider
      >
        <Input
          type="password"
          size="sm"
          className="w-[60%]"
          value={githubToken}
          placeholder={t('mihomo.gist.token')}
          onValueChange={(v) => {
            patchAppConfig({ githubToken: v })
          }}
        />
      </SettingItem>
      <SettingItem
        title={t('mihomo.gist.ageEncrypt')}
        actions={
          <Tooltip content={<div className="max-w-80">{t('mihomo.gist.ageEncryptTooltip')}</div>}>
            <Button isIconOnly size="sm" variant="light">
              <IoIosHelpCircle className="text-lg" />
            </Button>
          </Tooltip>
        }
        divider
      >
        <Switch
          size="sm"
          isSelected={gistAgeEncrypt}
          onValueChange={(v) => {
            patchAppConfig({ gistAgeEncrypt: v })
          }}
        />
      </SettingItem>
      <SettingItem title={t('mihomo.gist.ageRecipient')} divider>
        <Input
          size="sm"
          className="w-[60%]"
          value={gistAgeRecipient}
          placeholder={t('mihomo.gist.ageRecipientPlaceholder')}
          isDisabled={!gistAgeEncrypt}
          onValueChange={(v) => {
            patchAppConfig({ gistAgeRecipient: v })
          }}
        />
      </SettingItem>
      <SettingItem title={t('mihomo.gist.ageKeys')} divider>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="flat"
            isLoading={isGeneratingGistAgeKey}
            startContent={<BiKey className="text-base" />}
            onPress={handleGenerateGistAgeKeyPair}
          >
            {t('mihomo.gist.generateKeyPair')}
          </Button>
          <Button
            size="sm"
            variant="flat"
            isDisabled={!gistAgeSecretKey}
            isLoading={isExportingGistAgeKey}
            startContent={<BiDownload className="text-base" />}
            onPress={handleExportGistAgeSecretKey}
          >
            {t('mihomo.gist.exportPrivateKey')}
          </Button>
          <Tooltip content={t('mihomo.gist.copyPrivateKey')}>
            <Button
              title={t('mihomo.gist.copyPrivateKey')}
              isIconOnly
              size="sm"
              variant="light"
              isDisabled={!gistAgeSecretKey}
              onPress={handleCopyGistAgeSecretKey}
            >
              <BiCopy className="text-lg" />
            </Button>
          </Tooltip>
        </div>
      </SettingItem>
      <SettingItem title={t('mihomo.proxyColumns.title')} divider>
        <Select
          classNames={{ trigger: 'data-[hover=true]:bg-default-200' }}
          className="w-37.5"
          size="sm"
          selectedKeys={new Set([proxyCols])}
          aria-label={t('mihomo.proxyColumns.title')}
          disallowEmptySelection={true}
          onSelectionChange={async (v) => {
            await patchAppConfig({ proxyCols: v.currentKey as 'auto' | '1' | '2' | '3' | '4' })
          }}
        >
          <SelectItem key="auto">{t('mihomo.proxyColumns.auto')}</SelectItem>
          <SelectItem key="1">{t('mihomo.proxyColumns.one')}</SelectItem>
          <SelectItem key="2">{t('mihomo.proxyColumns.two')}</SelectItem>
          <SelectItem key="3">{t('mihomo.proxyColumns.three')}</SelectItem>
          <SelectItem key="4">{t('mihomo.proxyColumns.four')}</SelectItem>
        </Select>
      </SettingItem>
      {platform === 'win32' && (
        <SettingItem title={t('mihomo.cpuPriority.title')} divider>
          <Select
            classNames={{ trigger: 'data-[hover=true]:bg-default-200' }}
            className="w-37.5"
            size="sm"
            selectedKeys={new Set([mihomoCpuPriority])}
            disallowEmptySelection={true}
            onSelectionChange={async (v) => {
              try {
                await patchAppConfig({
                  mihomoCpuPriority: v.currentKey as Priority
                })
                await restartCore()
              } catch (e) {
                toast.error(String(e))
              }
            }}
          >
            <SelectItem key="PRIORITY_HIGHEST">{t('mihomo.cpuPriority.realtime')}</SelectItem>
            <SelectItem key="PRIORITY_HIGH">{t('mihomo.cpuPriority.high')}</SelectItem>
            <SelectItem key="PRIORITY_ABOVE_NORMAL">
              {t('mihomo.cpuPriority.aboveNormal')}
            </SelectItem>
            <SelectItem key="PRIORITY_NORMAL">{t('mihomo.cpuPriority.normal')}</SelectItem>
            <SelectItem key="PRIORITY_BELOW_NORMAL">
              {t('mihomo.cpuPriority.belowNormal')}
            </SelectItem>
            <SelectItem key="PRIORITY_LOW">{t('mihomo.cpuPriority.low')}</SelectItem>
          </Select>
        </SettingItem>
      )}
      <SettingItem
        title={t('mihomo.workDir.title')}
        actions={
          <Tooltip content={t('mihomo.workDir.tooltip')}>
            <Button isIconOnly size="sm" variant="light">
              <IoIosHelpCircle className="text-lg" />
            </Button>
          </Tooltip>
        }
        divider
      >
        <Switch
          size="sm"
          isSelected={diffWorkDir}
          onValueChange={async (v) => {
            try {
              await patchAppConfig({ diffWorkDir: v })
              await restartCore()
            } catch (e) {
              toast.error(String(e))
            }
          }}
        />
      </SettingItem>

      <SettingItem
        title={t('mihomo.hotReloadProfile.title')}
        actions={
          <Tooltip content={t('mihomo.hotReloadProfile.tooltip')}>
            <Button isIconOnly size="sm" variant="light">
              <IoIosHelpCircle className="text-lg" />
            </Button>
          </Tooltip>
        }
        divider
      >
        <Switch
          size="sm"
          isSelected={useHotReloadProfile}
          onValueChange={(v) => {
            patchAppConfig({ useHotReloadProfile: v })
          }}
        />
      </SettingItem>

      <SettingItem
        title={t('mihomo.hotReloadProfile.autoCloseConnection')}
        actions={
          <Tooltip content={t('mihomo.hotReloadProfile.autoCloseConnectionTooltip')}>
            <Button isIconOnly size="sm" variant="light">
              <IoIosHelpCircle className="text-lg" />
            </Button>
          </Tooltip>
        }
        divider
      >
        <Switch
          size="sm"
          isDisabled={!useHotReloadProfile}
          isSelected={hotReloadProfileAutoCloseConnection}
          onValueChange={(v) => {
            patchAppConfig({ hotReloadProfileAutoCloseConnection: v })
          }}
        />
      </SettingItem>

      <SettingItem title={t('mihomo.autoCloseConnection')} divider>
        <Switch
          size="sm"
          isSelected={autoCloseConnection}
          onValueChange={(v) => {
            patchAppConfig({ autoCloseConnection: v })
          }}
        />
      </SettingItem>
      <SettingItem
        title={t('mihomo.testProfileOnStart')}
        actions={
          <Tooltip content={t('mihomo.testProfileOnStartTooltip')}>
            <Button isIconOnly size="sm" variant="light">
              <IoIosHelpCircle className="text-lg" />
            </Button>
          </Tooltip>
        }
        divider
      >
        <Switch
          size="sm"
          isSelected={testProfileOnStart}
          onValueChange={(v) => {
            patchAppConfig({ testProfileOnStart: v })
          }}
        />
      </SettingItem>
      <SettingItem title={t('mihomo.pauseSSID.title')}>
        {pauseSSIDInput.join('') !== pauseSSID.join('') && (
          <Button
            size="sm"
            color="primary"
            onPress={() => {
              patchAppConfig({ pauseSSID: pauseSSIDInput })
            }}
          >
            {t('common.confirm')}
          </Button>
        )}
      </SettingItem>
      <div className="flex flex-col items-stretch mt-2">
        {[...pauseSSIDInput, ''].map((ssid, index) => {
          return (
            <div key={index} className="flex mb-2">
              <Input
                size="sm"
                fullWidth
                placeholder="SSID"
                value={ssid || ''}
                onValueChange={(v) => {
                  if (index === pauseSSIDInput.length) {
                    setPauseSSIDInput([...pauseSSIDInput, v])
                  } else {
                    setPauseSSIDInput(pauseSSIDInput.map((a, i) => (i === index ? v : a)))
                  }
                }}
              />
              {index < pauseSSIDInput.length && (
                <Button
                  className="ml-2"
                  size="sm"
                  variant="flat"
                  color="warning"
                  onPress={() => setPauseSSIDInput(pauseSSIDInput.filter((_, i) => i !== index))}
                >
                  <MdDeleteForever className="text-lg" />
                </Button>
              )}
            </div>
          )
        })}
      </div>
      <SettingItem title={t('mihomo.disableDnsOnPauseSSID')}>
        <Switch
          size="sm"
          isSelected={disableDnsOnPauseSSID}
          onValueChange={(v) => {
            patchAppConfig({ disableDnsOnPauseSSID: v })
          }}
        />
      </SettingItem>
    </SettingCard>
  )
}

export default MihomoConfig
