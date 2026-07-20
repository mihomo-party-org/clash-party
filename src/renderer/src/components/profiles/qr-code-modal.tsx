import { Modal, ModalContent, ModalHeader, ModalBody } from '@heroui/react'
import { QRCodeSVG } from 'qrcode.react'
import React from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  url: string
  title?: string
  onClose: () => void
}

const QrCodeModal: React.FC<Props> = (props) => {
  const { t } = useTranslation()

  return (
    <Modal isOpen onOpenChange={(open) => !open && props.onClose()} size="xs">
      <ModalContent>
        <ModalHeader>{props.title || t('profiles.qrCode.title')}</ModalHeader>
        <ModalBody className="flex items-center pb-6">
          <div className="rounded-lg bg-white p-4">
            <QRCodeSVG value={props.url} size={220} level="M" />
          </div>
          <p className="mt-2 break-all text-center text-sm text-foreground-500 select-all">
            {props.url}
          </p>
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}

export default QrCodeModal
