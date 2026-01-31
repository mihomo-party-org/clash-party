import React, { useState } from 'react'
import { toast } from '@renderer/components/base/toast'
import { Button, useDisclosure } from '@heroui/react'
import { exportLocalBackup, importLocalBackup, restartCore } from '@renderer/utils/ipc'
import { useTranslation } from 'react-i18next'
import SettingItem from '../base/base-setting-item'
import SettingCard from '../base/base-setting-card'
import BaseConfirmModal from '../base/base-confirm-modal'

const LocalBackupConfig: React.FC = () => {
  const { t } = useTranslation()
  const { isOpen, onOpen, onClose } = useDisclosure()
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)

  const handleExport = async (): Promise<void> => {
    setExporting(true)
    try {
      const success = await exportLocalBackup()
      if (success) {
        new window.Notification(t('localBackup.notification.exportSuccess.title'), {
          body: t('localBackup.notification.exportSuccess.body')
        })
      }
    } catch (e) {
      toast.error(String(e))
    } finally {
      setExporting(false)
    }
  }

  const handleImport = async (): Promise<void> => {
    onClose();
    setImporting(true)
    try {
      const success = await importLocalBackup()
      if (success) {
        window.electron.ipcRenderer.send('updateAppConfig')
        window.electron.ipcRenderer.send('updateTrayMenu')
        window.electron.ipcRenderer.send('appConfigUpdated')
        window.electron.ipcRenderer.send('controledMihomoConfigUpdated')
        window.electron.ipcRenderer.send('profileConfigUpdated')
        
        try {
          await restartCore()
        } catch (error) {
          console.error('Failed to restart core after import:', error)
          toast.error(t('common.error.restartCoreFailed', { error: error }))
        }
        
        new window.Notification(t('localBackup.notification.importSuccess.title'), {
          body: t('localBackup.notification.importSuccess.body')
        })
      }
    } catch (e) {
      toast.error(t('common.error.importFailed', { error: e }))
    } finally {
      setImporting(false)
    }
  }

  return (
    <>
      <BaseConfirmModal
        isOpen={isOpen}
        onCancel={onClose}
        onConfirm={handleImport}
        title={t('localBackup.import.confirm.title')}
        content={t('localBackup.import.confirm.body')}
      />
      <SettingCard title={t('localBackup.title')}>
        <SettingItem title={t('localBackup.export.title')} divider>
          <Button isLoading={exporting} size="sm" onPress={handleExport}>
            {t('localBackup.export.button')}
          </Button>
        </SettingItem>
        <SettingItem title={t('localBackup.import.title')}>
          <Button isLoading={importing} size="sm" onPress={onOpen}>
            {t('localBackup.import.button')}
          </Button>
        </SettingItem>
      </SettingCard>
    </>
  )
}

export default LocalBackupConfig
