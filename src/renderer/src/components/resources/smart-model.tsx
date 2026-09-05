import { Button, Chip, Select, SelectItem } from '@heroui/react'
import { toast } from '@renderer/components/base/toast'
import SettingCard from '@renderer/components/base/base-setting-card'
import SettingItem from '@renderer/components/base/base-setting-item'
import { downloadSmartModel, getSmartModelStatus, restartCore } from '@renderer/utils/ipc'
import { calcTraffic } from '@renderer/utils/calc'
import dayjs from '@renderer/utils/dayjs'
import { useState } from 'react'
import useSWR from 'swr'
import { useTranslation } from 'react-i18next'

// 只用于在界面上标出体积，不参与下载结果的校验：作者更新模型时体积会变，
// 拿它当校验条件会把新模型判成损坏。
const VARIANT_SIZES: Record<SmartModelVariant, number> = {
  standard: 9345218,
  middle: 18357364,
  large: 26787747
}

const STATE_COLORS = {
  ready: 'success',
  missing: 'default',
  damaged: 'danger'
} as const

const STATE_LABELS = {
  ready: 'resources.smartModel.stateReady',
  missing: 'resources.smartModel.stateMissing',
  damaged: 'resources.smartModel.stateDamaged'
} as const

const STATE_TIPS = {
  missing: 'resources.smartModel.tipMissing',
  damaged: 'resources.smartModel.tipDamaged'
} as const

const VARIANT_LABELS = {
  standard: 'resources.smartModel.variantStandard',
  middle: 'resources.smartModel.variantMiddle',
  large: 'resources.smartModel.variantLarge'
} as const

const SmartModel: React.FC = () => {
  const { t } = useTranslation()
  const { data: status, mutate } = useSWR('getSmartModelStatus', getSmartModelStatus)
  const [variant, setVariant] = useState<SmartModelVariant>('standard')
  const [downloading, setDownloading] = useState(false)

  const state = status?.state ?? 'missing'

  const download = async (): Promise<void> => {
    setDownloading(true)
    try {
      const next = await downloadSmartModel(variant)
      await mutate(next, { revalidate: false })
    } catch (e) {
      toast.error(String(e))
      return
    } finally {
      setDownloading(false)
    }
    // 内核只在启动时加载模型，不重启的话新模型一直不会生效
    try {
      await restartCore()
    } catch {
      // 内核没在运行时不需要重启，下次启动自然会读到新模型
    }
    toast.success(t('resources.smartModel.downloadSuccess'))
  }

  return (
    <SettingCard>
      <SettingItem title={t('resources.smartModel.title')} divider>
        <div className="flex items-center gap-2">
          {state === 'ready' && status && (
            <span className="text-foreground-500">
              {calcTraffic(status.size)}
              {status.modified ? ` · ${dayjs(status.modified).fromNow()}` : ''}
            </span>
          )}
          <Chip size="sm" variant="flat" color={STATE_COLORS[state]}>
            {t(STATE_LABELS[state])}
          </Chip>
        </div>
      </SettingItem>
      {state !== 'ready' && (
        <div className="select-text mb-2 text-sm text-foreground-500">{t(STATE_TIPS[state])}</div>
      )}
      <SettingItem title={t('resources.smartModel.variant')}>
        <div className="flex items-center gap-2">
          <Select
            className="w-50"
            size="sm"
            aria-label={t('resources.smartModel.variant')}
            selectedKeys={new Set([variant])}
            disallowEmptySelection
            onSelectionChange={(v) => setVariant(v.currentKey as SmartModelVariant)}
          >
            {(['standard', 'middle', 'large'] as const).map((key) => (
              <SelectItem key={key} textValue={t(VARIANT_LABELS[key])}>
                {`${t(VARIANT_LABELS[key])} · ${calcTraffic(VARIANT_SIZES[key])}`}
              </SelectItem>
            ))}
          </Select>
          <Button size="sm" color="primary" isLoading={downloading} onPress={download}>
            {t('resources.smartModel.download')}
          </Button>
        </div>
      </SettingItem>
    </SettingCard>
  )
}

export default SmartModel
