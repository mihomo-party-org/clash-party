import React, { useState } from 'react'
import SettingCard from '../base/base-setting-card'
import SettingItem from '../base/base-setting-item'
import { Button, Input, Select, SelectItem } from '@heroui/react'
import { listWebdavBackups, webdavBackup, reinitWebdavBackupScheduler } from '@renderer/utils/ipc'
import WebdavRestoreModal from './webdav-restore-modal'
import debounce from '@renderer/utils/debounce'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useTranslation } from 'react-i18next'
import { isValidCron } from 'cron-validator'

const WebdavConfig: React.FC = () => {
  const { t } = useTranslation()
  const { appConfig, patchAppConfig } = useAppConfig()
  const {
    webdavUrl,
    webdavUsername,
    webdavPassword,
    webdavDir = 'clash-party',
    webdavMaxBackups = 0,
    webdavBackupCron
  } = appConfig || {}
  const [backuping, setBackuping] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [filenames, setFilenames] = useState<string[]>([])
  const [restoreOpen, setRestoreOpen] = useState(false)

  const [webdav, setWebdav] = useState({
    webdavUrl,
    webdavUsername,
    webdavPassword,
    webdavDir,
    webdavMaxBackups,
    webdavBackupCron
  })
  const setWebdavDebounce = debounce(
    ({ webdavUrl, webdavUsername, webdavPassword, webdavDir, webdavMaxBackups, webdavBackupCron }) => {
      patchAppConfig({ webdavUrl, webdavUsername, webdavPassword, webdavDir, webdavMaxBackups, webdavBackupCron })
    },
    500
  )
  const handleBackup = async (): Promise<void> => {
    setBackuping(true)
    try {
      await webdavBackup()
      new window.Notification(t('webdav.notification.backupSuccess.title'), {
        body: t('webdav.notification.backupSuccess.body')
      })
    } catch (e) {
      alert(e)
    } finally {
      setBackuping(false)
    }
  }

  const handleRestore = async (): Promise<void> => {
    try {
      setRestoring(true)
      const filenames = await listWebdavBackups()
      setFilenames(filenames)
      setRestoreOpen(true)
    } catch (e) {
      alert(t('common.error.getBackupListFailed', { error: e }))
    } finally {
      setRestoring(false)
    }
  }
  return (
    <>
      {restoreOpen && (
        <WebdavRestoreModal filenames={filenames} onClose={() => setRestoreOpen(false)} />
      )}
      <SettingCard title={t('webdav.title')}>
        <SettingItem title={t('webdav.url')} divider>
          <Input
            size="sm"
            className="w-[60%]"
            value={webdav.webdavUrl}
            onValueChange={(v) => {
              setWebdav({ ...webdav, webdavUrl: v })
              setWebdavDebounce({ ...webdav, webdavUrl: v })
            }}
          />
        </SettingItem>
        <SettingItem title={t('webdav.dir')} divider>
          <Input
            size="sm"
            className="w-[60%]"
            value={webdav.webdavDir}
            onValueChange={(v) => {
              setWebdav({ ...webdav, webdavDir: v })
              setWebdavDebounce({ ...webdav, webdavDir: v })
            }}
          />
        </SettingItem>
        <SettingItem title={t('webdav.username')} divider>
          <Input
            size="sm"
            className="w-[60%]"
            value={webdav.webdavUsername}
            onValueChange={(v) => {
              setWebdav({ ...webdav, webdavUsername: v })
              setWebdavDebounce({ ...webdav, webdavUsername: v })
            }}
          />
        </SettingItem>
        <SettingItem title={t('webdav.password')} divider>
          <Input
            size="sm"
            className="w-[60%]"
            type="password"
            value={webdav.webdavPassword}
            onValueChange={(v) => {
              setWebdav({ ...webdav, webdavPassword: v })
              setWebdavDebounce({ ...webdav, webdavPassword: v })
            }}
          />
        </SettingItem>
        <SettingItem title={t('webdav.maxBackups')} divider>
          <Select
            classNames={{ trigger: 'data-[hover=true]:bg-default-200' }}
            className="w-[150px]"
            size="sm"
            selectedKeys={new Set([webdav.webdavMaxBackups.toString()])}
            aria-label={t('webdav.maxBackups')}
            onSelectionChange={(v) => {
              const value = Number.parseInt(Array.from(v)[0] as string, 10)
              setWebdav({ ...webdav, webdavMaxBackups: value })
              setWebdavDebounce({ ...webdav, webdavMaxBackups: value })
            }}
          >
            <SelectItem key="0">{t('webdav.noLimit')}</SelectItem>
            <SelectItem key="1">1</SelectItem>
            <SelectItem key="3">3</SelectItem>
            <SelectItem key="5">5</SelectItem>
            <SelectItem key="10">10</SelectItem>
            <SelectItem key="15">15</SelectItem>
            <SelectItem key="20">20</SelectItem>
          </Select>
        </SettingItem>
        <SettingItem title={t('webdav.backup.cron.title')} divider>
          <div className="flex w-[60%] gap-2">
            {webdavBackupCron !== webdav.webdavBackupCron && (
            <Button
                size="sm"
                color="primary"
                onPress={async () => {
                  if (!webdav.webdavBackupCron || isValidCron(webdav.webdavBackupCron)) {
                    try {
                      await patchAppConfig({ webdavBackupCron: webdav.webdavBackupCron })
                      // 立即重新初始化调度器
                      await reinitWebdavBackupScheduler()
                      new Notification(t('webdav.notification.cronUpdated'))
                    } catch (error) {
                      console.error('Failed to update cron schedule:', error)
                      new Notification(t('webdav.notification.cronUpdateFailed'))
                    }
                  } else {
                    alert(t('common.error.invalidCron'))
                  }
                }}
              >
                {t('common.confirm')}
              </Button>
            )}
            <Input
              size="sm"
              value={webdav.webdavBackupCron}
              placeholder={t('webdav.backup.cron.placeholder')}
              onValueChange={(v) => {
                setWebdav({ ...webdav, webdavBackupCron: v })
              }}
            />
            
          </div>
        </SettingItem>
        <div className="flex justify0between">
          <Button isLoading={backuping} fullWidth size="sm" className="mr-1" onPress={handleBackup}>
            {t('webdav.backup')}
          </Button>
          <Button
            isLoading={restoring}
            fullWidth
            size="sm"
            className="ml-1"
            onPress={handleRestore}
          >
            {t('webdav.restore.title')}
          </Button>
        </div>
      </SettingCard>
    </>
  )
}

export default WebdavConfig
