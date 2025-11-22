import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Input,
  Switch
} from '@heroui/react'
import React, { useState } from 'react'
import SettingItem from '../base/base-setting-item'
import { restartCore } from '@renderer/utils/ipc'
import { useTranslation } from 'react-i18next'

interface Props {
  item: IOverrideItem
  updateOverrideItem: (item: IOverrideItem) => Promise<void>
  onClose: () => void
}
const EditInfoModal: React.FC<Props> = (props) => {
  const { item, updateOverrideItem, onClose } = props
  const [values, setValues] = useState(item)
  const { t } = useTranslation()

  const onSave = async (): Promise<void> => {
    await updateOverrideItem(values)
    await restartCore()
    onClose()
  }

  return (
    <Modal
      backdrop="blur"
      classNames={{ backdrop: 'top-[48px]' }}
      hideCloseButton
      isOpen={true}
      onOpenChange={onClose}
      scrollBehavior="inside"
    >
      <ModalContent>
        <ModalHeader className="flex app-drag">{t('override.editInfo.title')}</ModalHeader>
        <ModalBody>
          <SettingItem title={t('override.editInfo.name')}>
            <Input
              size="sm"
              className="w-[200px]"
              value={values.name}
              onValueChange={(v) => {
                setValues({ ...values, name: v })
              }}
            />
          </SettingItem>
          {values.type === 'remote' && (
            <>
              <SettingItem title={t('override.editInfo.url')}>
                <Input
                  size="sm"
                  className="w-[200px]"
                  value={values.url}
                  onValueChange={(v) => {
                    setValues({ ...values, url: v })
                  }}
                />
              </SettingItem>
              <SettingItem title={t('override.editInfo.authToken')}>
                <Input
                  size="sm"
                  type="password"
                  className="w-[200px]"
                  value={values.authToken ?? ''}
                  onValueChange={(v) => {
                    setValues({ ...values, authToken: v || undefined })
                  }}
                  placeholder={t('override.editInfo.authTokenPlaceholder')}
                />
              </SettingItem>
            </>
          )}
          <SettingItem title={t('override.editInfo.global')}>
            <Switch
              size="sm"
              isSelected={values.global}
              onValueChange={(v) => {
                setValues({ ...values, global: v })
              }}
            />
          </SettingItem>
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="light" onPress={onClose}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" color="primary" onPress={onSave}>
            {t('common.save')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default EditInfoModal
