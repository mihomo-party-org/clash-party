import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Checkbox,
  Tooltip
} from '@heroui/react'
import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@renderer/components/base/toast'
import { previewPlugin, installPlugin } from '@renderer/utils/ipc'
import { useAppConfig } from '@renderer/hooks/use-app-config'

interface Props {
  onClose: () => void
  initialFile?: File // dropped file: auto-load + preview on open
  initialData?: IPluginFilePayload // associated file: already read by the main process
}

const MAX_CPX_BYTES = 10 * 1024 * 1024 // guard against a huge mis-dropped file freezing the renderer

function abToBase64(buf: ArrayBuffer): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(buf).toString('base64')
  }
  let binary = ''
  const bytes = new Uint8Array(buf)
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode.apply(null, chunk as unknown as number[])
  }
  return btoa(binary)
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

const PluginInstallModal: React.FC<Props> = ({ onClose, initialFile, initialData }) => {
  const { t } = useTranslation()

  const { appConfig, patchAppConfig } = useAppConfig()
  const pluginUseProxy = appConfig?.pluginUseProxy ?? false
  const fileInput = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [fileB64, setFileB64] = useState('')
  const [preview, setPreview] = useState<IPluginDescriptorPreview | null>(null)
  const [busy, setBusy] = useState(false)

  // file -> base64, or null if rejected/unreadable (toasts here)
  const loadFile = async (f: File): Promise<string | null> => {
    if (f.size > MAX_CPX_BYTES) {
      toast.error(t('plugins.fileTooLarge'))
      return null
    }
    try {
      const b64 = abToBase64(await f.arrayBuffer())
      setFileName(f.name)
      setFileB64(b64)
      setPreview(null)
      return b64
    } catch {
      toast.error(t('plugins.previewFailed'))
      return null
    }
  }

  // preview by explicit b64 (state may not be flushed yet)
  const previewB64 = async (b64: string): Promise<void> => {
    setBusy(true)
    try {
      setPreview(await previewPlugin(b64))
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      toast.error(msg.includes('v1') ? t('plugins.outdatedFile') : t('plugins.previewFailed'))
    } finally {
      setBusy(false)
    }
  }

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const f = e.target.files?.[0]
    if (!f) return
    await loadFile(f)
  }

  const doPreview = async (): Promise<void> => {
    await previewB64(fileB64)
  }

  useEffect(() => {
    if (initialData) {
      setFileName(initialData.name)
      setFileB64(initialData.fileBytesB64)
      previewB64(initialData.fileBytesB64)
      return
    }
    if (!initialFile) return
    loadFile(initialFile).then((b64) => {
      if (b64) previewB64(b64)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const doInstall = async (): Promise<void> => {
    setBusy(true)
    try {
      await installPlugin(fileB64)
      toast.success(t('plugins.installed'))
      onClose()
    } catch {
      toast.error(t('plugins.installFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      backdrop="blur"
      classNames={{ backdrop: 'top-[48px]' }}
      isOpen
      hideCloseButton
      onOpenChange={(open) => !open && onClose()}
      size="md"
    >
      <ModalContent>
        <ModalHeader>{preview ? t('plugins.confirmTitle') : t('plugins.title')}</ModalHeader>
        <ModalBody>
          {!preview ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium">{t('plugins.import')}</span>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".cpx"
                  className="hidden"
                  onChange={onPickFile}
                />
                <Button
                  variant="flat"
                  size="sm"
                  isDisabled={busy}
                  onPress={() => fileInput.current?.click()}
                >
                  {fileName || t('plugins.chooseFile')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2 text-sm">
              <div>
                {t('plugins.provider')}: <b>{preview.name}</b>
              </div>
              {preview.site && (
                <div>
                  {t('plugins.site')}: {preview.site}
                </div>
              )}
              <div>
                {t('plugins.loginUrl')}: <b>{hostOf(preview.loginUrl)}</b>
              </div>
              <div className="mt-2 text-warning">{t('plugins.installNotice')}</div>
            </div>
          )}
        </ModalBody>
        <ModalFooter className="flex items-center justify-between">
          <Tooltip content={t('plugins.useProxyWarning')} placement="bottom">
            <Checkbox
              size="sm"
              isSelected={pluginUseProxy}
              onValueChange={(v) => patchAppConfig({ pluginUseProxy: v })}
            >
              {t('plugins.useProxy')}
            </Checkbox>
          </Tooltip>
          <div className="flex items-center gap-2">
            <Button variant="light" onPress={onClose}>
              {t('plugins.cancel')}
            </Button>
            {!preview ? (
              <Button color="primary" isLoading={busy} isDisabled={!fileB64} onPress={doPreview}>
                {t('plugins.next')}
              </Button>
            ) : (
              <Button color="primary" isLoading={busy} onPress={doInstall}>
                {t('plugins.install')}
              </Button>
            )}
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default PluginInstallModal
