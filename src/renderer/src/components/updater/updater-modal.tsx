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
import React, { useState, useEffect } from 'react'
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
  const [progress, setProgress] = useState<{
    status: 'downloading' | 'verifying'
    percent?: number
  } | null>(null)
  const { t } = useTranslation()

  useEffect(() => {
    const handler = (_e: Electron.IpcRendererEvent, ...args: unknown[]): void => {
      setProgress(args[0] as { status: 'downloading' | 'verifying'; percent?: number })
    }
    window.electron.ipcRenderer.on('updateDownloadProgress', handler)
    return () => {
      window.electron.ipcRenderer.removeListener('updateDownloadProgress', handler)
    }
  }, [])

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
        <ModalFooter className="flex-col gap-2 items-stretch">
          {downloading && progress && (
            <div className="flex flex-col gap-1">
              <div className="w-full bg-default-200 rounded-full h-1.5">
                <div
                  className="bg-primary h-1.5 rounded-full transition-all duration-300"
                  style={{
                    width: `${progress.status === 'verifying' ? 100 : (progress.percent ?? 0)}%`
                  }}
                />
              </div>
              <p className="text-xs text-foreground-400 text-center">
                {progress.status === 'verifying'
                  ? t('common.updater.verifying')
                  : `${progress.percent ?? 0}%`}
              </p>
            </div>
          )}
          <div className="flex justify-end gap-2">
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
                  await downloadAndInstallUpdate(version)
                  onClose()
                } catch (e) {
                  toast.detailedError(String(e))
                } finally {
                  setDownloading(false)
                  setProgress(null)
                }
              }}
            >
              {t('common.updater.update')}
            </Button>
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default UpdaterModal
