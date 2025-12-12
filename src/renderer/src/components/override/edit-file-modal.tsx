import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button } from '@heroui/react'
import { toast } from '@renderer/components/base/toast'
import React, { useEffect, useState } from 'react'
import { BaseEditor } from '../base/base-editor'
import { getOverride, restartCore, setOverride } from '@renderer/utils/ipc'
import { useTranslation } from 'react-i18next'

interface Props {
  id: string
  language: 'javascript' | 'yaml'
  onClose: () => void
}
const EditFileModal: React.FC<Props> = (props) => {
  const { id, language, onClose } = props
  const [currData, setCurrData] = useState('')
  const { t } = useTranslation()

  const getContent = async (): Promise<void> => {
    setCurrData(await getOverride(id, language === 'javascript' ? 'js' : 'yaml'))
  }

  useEffect(() => {
    getContent()
  }, [])

  return (
    <Modal
      backdrop="blur"
      classNames={{ backdrop: 'top-[48px]' }}
      size="5xl"
      hideCloseButton
      isOpen={true}
      onOpenChange={onClose}
      scrollBehavior="inside"
    >
      <ModalContent className="h-full w-[calc(100%-100px)]">
        <ModalHeader className="flex pb-0 app-drag">
          {t('override.editFile.title', {
            type:
              language === 'javascript'
                ? t('override.editFile.script')
                : t('override.editFile.config')
          })}
        </ModalHeader>
        <ModalBody className="h-full">
          <BaseEditor
            language={language}
            value={currData}
            onChange={(value) => setCurrData(value)}
          />
        </ModalBody>
        <ModalFooter className="pt-0">
          <Button size="sm" variant="light" onPress={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            color="primary"
            onPress={async () => {
              try {
                await setOverride(id, language === 'javascript' ? 'js' : 'yaml', currData)
                await restartCore()
                onClose()
              } catch (e) {
                toast.error(String(e))
              }
            }}
          >
            {t('common.confirm')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default EditFileModal
