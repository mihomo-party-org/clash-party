import { Button, Chip, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, ScrollShadow } from '@heroui/react'
import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import dayjs from '@renderer/utils/dayjs'

interface Props {
  error: IAppErrorPayload | null
  onClose: () => void
}

const AppErrorModal = ({ error, onClose }: Props): ReactElement | null => {
  const { t } = useTranslation()
  const [showDetail, setShowDetail] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setShowDetail(false)
    setCopied(false)
  }, [error?.id])

  const detail = useMemo(() => error?.detail || error?.stack || '', [error])
  const timestampText = useMemo(
    () => (error ? dayjs(error.timestamp).format('YYYY-MM-DD HH:mm:ss') : ''),
    [error]
  )

  const handleCopy = async (): Promise<void> => {
    if (!error) return
    const text = `${error.title || t('errorCenter.title')}
${error.message}
${detail || ''}`.trim()
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore clipboard errors
    }
  }

  if (!error) return null

  return (
    <Modal
      isOpen
      hideCloseButton
      placement="center"
      backdrop="blur"
      classNames={{ backdrop: 'top-[48px]' }}
    >
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1 pr-12">
          <Chip color="danger" size="sm" variant="flat">
            {t('errorCenter.title')}
          </Chip>
          <div className="text-base font-semibold leading-tight">
            {error.title || t('errorCenter.subtitle')}
          </div>
          <div className="flex items-center gap-3 text-xs text-default-500">
            <span>{timestampText}</span>
            {error.source ? (
              <span className="rounded-md bg-content2 px-2 py-1 text-[11px] uppercase tracking-wide text-default-600">
                {t(`errorCenter.source.${error.source}`, { defaultValue: error.source })}
              </span>
            ) : null}
          </div>
        </ModalHeader>
        <ModalBody className="space-y-3">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-default-700 dark:text-default-400">
            {error.message}
          </p>
          {detail ? (
            <div className="rounded-medium border border-default-200 bg-content2 px-3 py-2 dark:border-default-100">
              <div className="flex items-center justify-between text-xs text-default-500">
                <span>{t('errorCenter.details')}</span>
                <Button size="sm" variant="light" onPress={() => setShowDetail((v) => !v)}>
                  {showDetail ? t('errorCenter.hideDetails') : t('errorCenter.showDetails')}
                </Button>
              </div>
              {showDetail ? (
                <ScrollShadow className="mt-2 max-h-48 rounded-small bg-content1/60 px-2 py-1 text-[11px] font-mono leading-relaxed text-default-600 dark:text-default-400">
                  {detail}
                </ScrollShadow>
              ) : null}
            </div>
          ) : null}
        </ModalBody>
        <ModalFooter className="flex justify-end">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="light" onPress={onClose}>
              {t('errorCenter.close')}
            </Button>
            <Button size="sm" color="primary" onPress={handleCopy}>
              {copied ? t('errorCenter.copied') : t('errorCenter.copy')}
            </Button>
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default AppErrorModal
