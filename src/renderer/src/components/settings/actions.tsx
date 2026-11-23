import { Button, Tooltip } from '@heroui/react'
import { toast } from '@renderer/components/base/toast'
import {
  checkUpdate,
  createHeapSnapshot,
  downloadAndInstallUpdate,
  quitApp,
  quitWithoutCore,
  resetAppConfig
} from '@renderer/utils/ipc'
import { useState } from 'react'
import { platform, version } from '@renderer/utils/init'
import { IoIosHelpCircle } from 'react-icons/io'
import { getDriver } from '@renderer/App'
import { useTranslation } from 'react-i18next'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import UpdaterModal from '../updater/updater-modal'
import SettingItem from '../base/base-setting-item'
import SettingCard from '../base/base-setting-card'
import BaseConfirmModal from '../base/base-confirm-modal'

const Actions: React.FC = () => {
  const { t } = useTranslation()
  const { appConfig } = useAppConfig()
  const [newVersion, setNewVersion] = useState('')
  const [changelog, setChangelog] = useState('')
  const [openUpdate, setOpenUpdate] = useState(false)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  return (
    <>
      {openUpdate && (
        <UpdaterModal
          onClose={() => setOpenUpdate(false)}
          version={newVersion}
          changelog={changelog}
        />
      )}
      {showResetConfirm && (
        <BaseConfirmModal
          isOpen={showResetConfirm}
          title={t('actions.reset.confirm.title')}
          content={t('actions.reset.confirm.content')}
          onCancel={() => setShowResetConfirm(false)}
          onConfirm={() => {
            resetAppConfig()
            setShowResetConfirm(false)
          }}
        />
      )}
      <SettingCard>
        <SettingItem title={t('actions.guide.title')} divider>
          <Button size="sm" onPress={() => getDriver()?.drive()}>
            {t('actions.guide.button')}
          </Button>
        </SettingItem>
        <SettingItem title={t('actions.update.title')} divider>
          <Button
            size="sm"
            isLoading={checkingUpdate}
            onPress={async () => {
              try {
                setCheckingUpdate(true)
                const version = await checkUpdate()
                if (version) {
                  const canSilentlyUpdate = platform === 'win32' || platform === 'darwin'
                  if (appConfig?.silentUpdate !== false && canSilentlyUpdate) {
                    await downloadAndInstallUpdate(version.version)
                  } else {
                    setNewVersion(version.version)
                    setChangelog(version.changelog)
                    setOpenUpdate(true)
                  }
                } else {
                  new window.Notification(t('actions.update.upToDate.title'), {
                    body: t('actions.update.upToDate.body')
                  })
                }
              } catch (e) {
                toast.error(String(e))
              } finally {
                setCheckingUpdate(false)
              }
            }}
          >
            {t('actions.update.button')}
          </Button>
        </SettingItem>
        <SettingItem
          title={t('actions.reset.title')}
          actions={
            <Tooltip content={t('actions.reset.tooltip')}>
              <Button isIconOnly size="sm" variant="light">
                <IoIosHelpCircle className="text-lg" />
              </Button>
            </Tooltip>
          }
          divider
        >
          <Button size="sm" onPress={() => setShowResetConfirm(true)}>
            {t('actions.reset.button')}
          </Button>
        </SettingItem>
        <SettingItem
          title={t('actions.heapSnapshot.title')}
          actions={
            <Tooltip content={t('actions.heapSnapshot.tooltip')}>
              <Button isIconOnly size="sm" variant="light">
                <IoIosHelpCircle className="text-lg" />
              </Button>
            </Tooltip>
          }
          divider
        >
          <Button size="sm" onPress={createHeapSnapshot}>
            {t('actions.heapSnapshot.button')}
          </Button>
        </SettingItem>
        <SettingItem
          title={t('actions.lightMode.title')}
          actions={
            <Tooltip content={t('actions.lightMode.tooltip')}>
              <Button isIconOnly size="sm" variant="light">
                <IoIosHelpCircle className="text-lg" />
              </Button>
            </Tooltip>
          }
          divider
        >
          <Button size="sm" onPress={quitWithoutCore}>
            {t('actions.lightMode.button')}
          </Button>
        </SettingItem>
        <SettingItem title={t('actions.quit.title')} divider>
          <Button size="sm" onPress={quitApp}>
            {t('actions.quit.button')}
          </Button>
        </SettingItem>
        <SettingItem title={t('actions.version.title')}>
          <div>v{version}</div>
        </SettingItem>
      </SettingCard>
    </>
  )
}

export default Actions
