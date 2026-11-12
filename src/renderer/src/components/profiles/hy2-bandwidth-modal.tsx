import React, { useEffect, useState } from 'react'
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Card,
  CardBody,
  Chip,
  Input,
  Progress
} from '@heroui/react'
import { useTranslation } from 'react-i18next'
import {
  takeHy2BandwidthPrompt,
  resolveHy2BandwidthPrompt,
  runHy2Speedtest,
  abortHy2Speedtest
} from '@renderer/utils/ipc'

export const Hy2BandwidthModal: React.FC = () => {
  const { t } = useTranslation()
  const [prompt, setPrompt] = useState<IHy2BandwidthPrompt | null>(null)
  const [downValue, setDownValue] = useState('')
  const [upValue, setUpValue] = useState('')
  const [isTesting, setIsTesting] = useState(false)
  const [progress, setProgress] = useState<IHy2SpeedtestProgress | null>(null)
  const [testResult, setTestResult] = useState<IHy2SpeedtestResult | null>(null)
  const [speedtestError, setSpeedtestError] = useState<string | null>(null)

  useEffect(() => {
    takeHy2BandwidthPrompt().then((p) => {
      if (p) {
        setupPrompt(p)
      }
    })

    const unsubPrompt = window.electron.ipcRenderer.on(
      'hy2BandwidthPrompt',
      (_event, newPrompt: unknown) => {
        if (newPrompt && typeof newPrompt === 'object') {
          setupPrompt(newPrompt as IHy2BandwidthPrompt)
        }
      }
    )

    const unsubProgress = window.electron.ipcRenderer.on(
      'hy2BandwidthSpeedtestProgress',
      (_event, prog: unknown) => {
        if (prog && typeof prog === 'object') {
          setProgress(prog as IHy2SpeedtestProgress)
        }
      }
    )

    return () => {
      unsubPrompt()
      unsubProgress()
    }
  }, [])

  const setupPrompt = (p: IHy2BandwidthPrompt) => {
    setPrompt(p)
    setIsTesting(false)
    setProgress(null)
    setTestResult(null)
    setSpeedtestError(null)

    if (p.savedPolicy?.mode === 'brutal') {
      setDownValue(p.savedPolicy.downMbps ? String(p.savedPolicy.downMbps) : '')
      setUpValue(p.savedPolicy.upMbps ? String(p.savedPolicy.upMbps) : '')
    } else if (p.savedPolicy?.mode === 'bbr') {
      setDownValue('')
      setUpValue('')
    } else {
      setDownValue(p.firstDownMbps ? String(p.firstDownMbps) : '')
      setUpValue(p.firstUpMbps ? String(p.firstUpMbps) : '')
    }
  }

  const handleClearBbr = () => {
    setDownValue('')
    setUpValue('')
  }

  const handleToggleSpeedtest = async () => {
    if (isTesting) {
      await abortHy2Speedtest()
      setIsTesting(false)
      return
    }

    setIsTesting(true)
    setSpeedtestError(null)
    setProgress(null)
    setTestResult(null)

    try {
      const res = await runHy2Speedtest()
      setIsTesting(false)
      if (res.ok) {
        setTestResult(res)
        if (res.recommendedDownMbps) {
          setDownValue(String(res.recommendedDownMbps))
        }
        if (res.recommendedUpMbps) {
          setUpValue(String(res.recommendedUpMbps))
        }
      } else if (res.error && res.error !== 'aborted') {
        setSpeedtestError(res.error)
      }
    } catch (e) {
      setIsTesting(false)
      setSpeedtestError(String(e))
    }
  }

  const downNum = parseInt(downValue.trim(), 10)
  const upNum = parseInt(upValue.trim(), 10)
  const hasDown = Number.isFinite(downNum) && downNum > 0
  const hasUp = Number.isFinite(upNum) && upNum > 0
  const isBbrMode = !hasDown && !hasUp

  const handleKeep = async () => {
    if (!prompt) return
    const policy: IHy2BandwidthPolicy = { mode: 'keep' }
    await resolveHy2BandwidthPrompt(prompt.promptId, policy)
    if (isTesting) {
      await abortHy2Speedtest()
    }
    setPrompt(null)
  }

  const handleConfirm = async () => {
    if (!prompt) return
    const policy: IHy2BandwidthPolicy = isBbrMode
      ? { mode: 'bbr' }
      : {
          mode: 'brutal',
          downMbps: hasDown ? downNum : undefined,
          upMbps: hasUp ? upNum : undefined
        }
    await resolveHy2BandwidthPrompt(prompt.promptId, policy)
    if (isTesting) {
      await abortHy2Speedtest()
    }
    setPrompt(null)
  }

  const handleClose = async () => {
    if (!prompt) return
    const fallback: IHy2BandwidthPolicy = prompt.savedPolicy ?? { mode: 'keep' }
    await resolveHy2BandwidthPrompt(prompt.promptId, fallback)
    if (isTesting) {
      await abortHy2Speedtest()
    }
    setPrompt(null)
  }

  if (!prompt) return null

  let statusText = ''
  if (isTesting && progress) {
    if (progress.phase === 'prepare') {
      statusText = t('profiles.hy2Bandwidth.speedtestPreparing')
    } else if (progress.phase === 'download') {
      statusText = t('profiles.hy2Bandwidth.speedtestTestingDown', {
        mbps: progress.currentMbps ?? progress.downMbps ?? 0,
        percent: progress.progress
      })
    } else if (progress.phase === 'upload') {
      statusText = t('profiles.hy2Bandwidth.speedtestTestingUp', {
        mbps: progress.currentMbps ?? progress.upMbps ?? 0,
        percent: progress.progress
      })
    }
  } else if (testResult) {
    statusText = t('profiles.hy2Bandwidth.speedtestDone', {
      downPeak: testResult.downPeakMbps,
      upPeak: testResult.upPeakMbps,
      down: testResult.downMbps,
      up: testResult.upMbps
    })
  }

  const ifaceInfo = testResult?.ifaceName
    ? t('profiles.hy2Bandwidth.speedtestEgress', {
        iface: testResult.ifaceName,
        ip: testResult.bindAddress || '0.0.0.0'
      })
    : progress?.ifaceName
      ? t('profiles.hy2Bandwidth.speedtestEgress', {
          iface: progress.ifaceName,
          ip: progress.bindAddress || '0.0.0.0'
        })
      : ''

  return (
    <Modal
      isOpen={Boolean(prompt)}
      onClose={handleClose}
      backdrop="blur"
      classNames={{ backdrop: 'top-[48px]' }}
      size="lg"
      placement="center"
    >
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1 pb-1">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold">{t('profiles.hy2Bandwidth.title')}</h3>
            <Chip size="sm" color="primary" variant="flat">
              {t('profiles.hy2Bandwidth.subtitle', { count: prompt.hy2Count })}
            </Chip>
          </div>
          <p className="text-xs text-foreground-400 font-normal truncate">
            {prompt.profileName}
            {prompt.names && prompt.names.length > 0
              ? ` (${t('profiles.hy2Bandwidth.nodePreview', { names: prompt.names.slice(0, 3).join(', ') })})`
              : ''}
          </p>
        </ModalHeader>

        <ModalBody className="py-3">
          <Card shadow="sm" className="border border-divider">
            <CardBody className="flex flex-col gap-3 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{t('profiles.hy2Bandwidth.cardTitle')}</span>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="flat" onPress={handleClearBbr} isDisabled={isTesting}>
                    {t('profiles.hy2Bandwidth.clearBbr')}
                  </Button>
                  <Button
                    size="sm"
                    color={isTesting ? 'danger' : 'primary'}
                    variant={isTesting ? 'flat' : 'solid'}
                    onPress={handleToggleSpeedtest}
                  >
                    {isTesting
                      ? t('profiles.hy2Bandwidth.speedtestStop')
                      : t('profiles.hy2Bandwidth.speedtest')}
                  </Button>
                </div>
              </div>

              {(isTesting || testResult || speedtestError) && (
                <div className="flex flex-col gap-1.5 p-2.5 rounded-lg bg-content2 text-xs">
                  {isTesting && progress && (
                    <Progress
                      size="sm"
                      value={progress.progress}
                      color="primary"
                      aria-label="Speedtest progress"
                    />
                  )}
                  {statusText && <div className="text-primary font-medium">{statusText}</div>}
                  {ifaceInfo && <div className="text-foreground-400">{ifaceInfo}</div>}
                  {speedtestError && (
                    <div className="text-danger">
                      {t('profiles.hy2Bandwidth.speedtestFailed', { error: speedtestError })}
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Input
                  size="sm"
                  type="number"
                  label={t('profiles.hy2Bandwidth.downBandwidth')}
                  placeholder={t('profiles.hy2Bandwidth.bbrPlaceholder')}
                  endContent={<span className="text-xs text-foreground-400">Mbps</span>}
                  value={downValue}
                  onValueChange={setDownValue}
                  isDisabled={isTesting}
                  min={1}
                />
                <Input
                  size="sm"
                  type="number"
                  label={t('profiles.hy2Bandwidth.upBandwidth')}
                  placeholder={t('profiles.hy2Bandwidth.bbrPlaceholder')}
                  endContent={<span className="text-xs text-foreground-400">Mbps</span>}
                  value={upValue}
                  onValueChange={setUpValue}
                  isDisabled={isTesting}
                  min={1}
                />
              </div>

              <div className="pt-1">
                <Chip
                  size="sm"
                  variant="flat"
                  color={isBbrMode ? 'default' : 'primary'}
                  className="max-w-full"
                >
                  {isBbrMode
                    ? t('profiles.hy2Bandwidth.modeBbr')
                    : t('profiles.hy2Bandwidth.modeBrutal', {
                        down: hasDown ? downNum : '-',
                        up: hasUp ? upNum : '-'
                      })}
                </Chip>
              </div>
            </CardBody>
          </Card>
        </ModalBody>

        <ModalFooter className="flex justify-between items-center pt-1">
          <Button size="sm" variant="light" onPress={handleKeep} isDisabled={isTesting}>
            {t('profiles.hy2Bandwidth.keepOriginal')}
          </Button>
          <Button size="sm" color="primary" onPress={handleConfirm} isDisabled={isTesting}>
            {t('profiles.hy2Bandwidth.confirmApply')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default Hy2BandwidthModal
