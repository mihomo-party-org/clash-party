import React, { useState } from 'react'
import SettingCard from '@renderer/components/base/base-setting-card'
import { toast } from '@renderer/components/base/toast'
import SettingItem from '@renderer/components/base/base-setting-item'
import { Button, Input, Switch } from '@heroui/react'
import {
  startSubStoreFrontendServer,
  startSubStoreBackendServer,
  stopSubStoreFrontendServer,
  stopSubStoreBackendServer
} from '@renderer/utils/ipc'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import debounce from '@renderer/utils/debounce'
import { isValidCron } from 'cron-validator'
import { useTranslation } from 'react-i18next'
import { DEFAULT_USE_SUB_STORE } from '../../../../shared/appConfig'

const SubStoreConfig: React.FC = () => {
  const { t } = useTranslation()
  const { appConfig, patchAppConfig } = useAppConfig()
  const {
    useSubStore = DEFAULT_USE_SUB_STORE,
    useCustomSubStore = false,
    useProxyInSubStore = false,
    subStoreHost = '127.0.0.1',
    customSubStoreUrl,
    subStoreBackendSyncCron,
    subStoreBackendDownloadCron,
    subStoreBackendUploadCron
  } = appConfig || {}

  const [customSubStoreUrlValue, setCustomSubStoreUrlValue] = useState(customSubStoreUrl)
  const setCustomSubStoreUrl = debounce(async (v: string) => {
    await patchAppConfig({ customSubStoreUrl: v })
  }, 500)
  const [subStoreBackendSyncCronValue, setSubStoreBackendSyncCronValue] =
    useState(subStoreBackendSyncCron)
  const [subStoreBackendDownloadCronValue, setSubStoreBackendDownloadCronValue] = useState(
    subStoreBackendDownloadCron
  )
  const [subStoreBackendUploadCronValue, setSubStoreBackendUploadCronValue] =
    useState(subStoreBackendUploadCron)
  return (
    <SettingCard title={t('substore.title')}>
      <SettingItem title={t('substore.enable')} divider={useSubStore}>
        <Switch
          size="sm"
          isSelected={useSubStore}
          onValueChange={async (v) => {
            try {
              await patchAppConfig({ useSubStore: v })
              if (v) {
                await startSubStoreFrontendServer()
                await startSubStoreBackendServer()
              } else {
                await stopSubStoreFrontendServer()
                await stopSubStoreBackendServer()
              }
            } catch (e) {
              toast.error(String(e))
            }
          }}
        />
      </SettingItem>
      {useSubStore && (
        <>
          <SettingItem title={t('substore.allowLan')} divider>
            <Switch
              size="sm"
              isSelected={subStoreHost === '0.0.0.0'}
              onValueChange={async (v) => {
                try {
                  if (v) {
                    await patchAppConfig({ subStoreHost: '0.0.0.0' })
                  } else {
                    await patchAppConfig({ subStoreHost: '127.0.0.1' })
                  }
                  await startSubStoreFrontendServer()
                  await startSubStoreBackendServer()
                } catch (e) {
                  toast.error(String(e))
                }
              }}
            />
          </SettingItem>
          <SettingItem title={t('substore.useCustomBackend')} divider>
            <Switch
              size="sm"
              isSelected={useCustomSubStore}
              onValueChange={async (v) => {
                try {
                  await patchAppConfig({ useCustomSubStore: v })
                  if (v) {
                    await stopSubStoreBackendServer()
                  } else {
                    await startSubStoreBackendServer()
                  }
                } catch (e) {
                  toast.error(String(e))
                }
              }}
            />
          </SettingItem>
          {useCustomSubStore ? (
            <SettingItem title={t('substore.customBackendUrl.title')}>
              <Input
                size="sm"
                className="w-[60%]"
                value={customSubStoreUrlValue}
                placeholder={t('substore.customBackendUrl.placeholder')}
                onValueChange={(v: string) => {
                  setCustomSubStoreUrlValue(v)
                  setCustomSubStoreUrl(v)
                }}
              />
            </SettingItem>
          ) : (
            <>
              <SettingItem title={t('substore.useProxy')} divider>
                <Switch
                  size="sm"
                  isSelected={useProxyInSubStore}
                  onValueChange={async (v) => {
                    try {
                      await patchAppConfig({ useProxyInSubStore: v })
                      await startSubStoreBackendServer()
                    } catch (e) {
                      toast.error(String(e))
                    }
                  }}
                />
              </SettingItem>
              <SettingItem title={t('substore.sync.title')} divider>
                <div className="flex w-[60%] gap-2">
                  {subStoreBackendSyncCronValue !== subStoreBackendSyncCron && (
                    <Button
                      size="sm"
                      color="primary"
                      onPress={async () => {
                        if (
                          !subStoreBackendSyncCronValue ||
                          isValidCron(subStoreBackendSyncCronValue)
                        ) {
                          await patchAppConfig({
                            subStoreBackendSyncCron: subStoreBackendSyncCronValue
                          })
                          new Notification(t('common.notification.restartRequired'))
                        } else {
                          toast.warning(t('common.error.invalidCron'))
                        }
                      }}
                    >
                      {t('common.confirm')}
                    </Button>
                  )}
                  <Input
                    size="sm"
                    value={subStoreBackendSyncCronValue}
                    placeholder={t('substore.sync.placeholder')}
                    onValueChange={(v: string) => {
                      setSubStoreBackendSyncCronValue(v)
                    }}
                  />
                </div>
              </SettingItem>
              <SettingItem title={t('substore.restore.title')} divider>
                <div className="flex w-[60%] gap-2">
                  {subStoreBackendDownloadCronValue !== subStoreBackendDownloadCron && (
                    <Button
                      size="sm"
                      color="primary"
                      onPress={async () => {
                        if (
                          !subStoreBackendDownloadCronValue ||
                          isValidCron(subStoreBackendDownloadCronValue)
                        ) {
                          await patchAppConfig({
                            subStoreBackendDownloadCron: subStoreBackendDownloadCronValue
                          })
                          new Notification(t('common.notification.restartRequired'))
                        } else {
                          toast.warning(t('common.error.invalidCron'))
                        }
                      }}
                    >
                      {t('common.confirm')}
                    </Button>
                  )}
                  <Input
                    size="sm"
                    value={subStoreBackendDownloadCronValue}
                    placeholder={t('substore.restore.placeholder')}
                    onValueChange={(v: string) => {
                      setSubStoreBackendDownloadCronValue(v)
                    }}
                  />
                </div>
              </SettingItem>
              <SettingItem title={t('substore.backup.title')}>
                <div className="flex w-[60%] gap-2">
                  {subStoreBackendUploadCronValue !== subStoreBackendUploadCron && (
                    <Button
                      size="sm"
                      color="primary"
                      onPress={async () => {
                        if (
                          !subStoreBackendUploadCronValue ||
                          isValidCron(subStoreBackendUploadCronValue)
                        ) {
                          await patchAppConfig({
                            subStoreBackendUploadCron: subStoreBackendUploadCronValue
                          })
                          new Notification(t('common.notification.restartRequired'))
                        } else {
                          toast.warning(t('common.error.invalidCron'))
                        }
                      }}
                    >
                      {t('common.confirm')}
                    </Button>
                  )}
                  <Input
                    size="sm"
                    value={subStoreBackendUploadCronValue}
                    placeholder={t('substore.backup.placeholder')}
                    onValueChange={(v: string) => {
                      setSubStoreBackendUploadCronValue(v)
                    }}
                  />
                </div>
              </SettingItem>
            </>
          )}
        </>
      )}
    </SettingCard>
  )
}

export default SubStoreConfig
