import { Modal, ModalContent, ModalHeader, ModalBody } from '@heroui/react'
import { QRCodeSVG } from 'qrcode.react'
import { useTranslation } from 'react-i18next'

interface Props {
  url: string
  onClose: () => void
}

const QrCodeModal: React.FC<Props> = ({ url, onClose }) => {
  const { t } = useTranslation()

  return (
    <Modal isOpen onOpenChange={(open) => !open && onClose()} size="xs">
      <ModalContent>
        <ModalHeader>{t('profiles.qrCode.title')}</ModalHeader>
        <ModalBody className="flex items-center pb-6">
          <QRCodeSVG value={url} size={220} level="M" />
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}

export default QrCodeModal
