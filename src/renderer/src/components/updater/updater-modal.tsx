import {
  Button,
  Code,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader
} from '@heroui/react'
import { toast } from '@renderer/components/base/toast'
import ReactMarkdown from 'react-markdown'
import React, { useState } from 'react'
import { downloadAndInstallUpdate } from '@renderer/utils/ipc'
import { useTranslation } from 'react-i18next'

interface Props {
  version: string
  changelog: string
  onClose: () => void
}

const UpdaterModal: React.FC<Props> = (props) => {
  const { version, changelog, onClose } = props
  const [downloading, setDownloading] = useState(false)
  const { t } = useTranslation()

  const onUpdate = async (): Promise<void> => {
    try {
      await downloadAndInstallUpdate(version)
    } catch (e) {
      toast.error(String(e))
    }
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
      <ModalContent className="h-full w-[calc(100%-100px)]">
        <ModalHeader className="flex justify-between app-drag">
          <div>{t('common.updater.versionReady', { version })}</div>
          <Button
            color="primary"
            size="sm"
            className="flex app-nodrag"
            onPress={() => {
              open(`https://github.com/mihomo-party-org/mihomo-party/releases/tag/v${version}`)
            }}
          >
            {t('common.updater.goToDownload')}
          </Button>
        </ModalHeader>
        <ModalBody className="h-full">
          <div className="markdown-body select-text">
            <ReactMarkdown
              components={{
                a: ({ ...props }) => <a target="_blank" className="text-primary" {...props} />,
                code: ({ children }) => <Code size="sm">{children}</Code>,
                h3: ({ ...props }) => <h3 className="text-lg font-bold" {...props} />,
                li: ({ children }) => <li className="list-disc list-inside">{children}</li>
              }}
            >
              {changelog}
            </ReactMarkdown>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="light" onPress={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            color="primary"
            isLoading={downloading}
            onPress={async () => {
              try {
                setDownloading(true)
                await onUpdate()
                onClose()
              } catch (e) {
                toast.error(String(e))
              } finally {
                setDownloading(false)
              }
            }}
          >
            {t('common.updater.update')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default UpdaterModal
