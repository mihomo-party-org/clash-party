import { Button, Divider, Input, Switch } from '@heroui/react'
import BasePage from '@renderer/components/base/base-page'
import { showErrorSync } from '@renderer/utils/error-display'
import SettingCard from '@renderer/components/base/base-setting-card'
import SettingItem from '@renderer/components/base/base-setting-item'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { mihomoHotReloadConfig } from '@renderer/utils/ipc'
import React, { ReactNode, useState } from 'react'
import { MdDeleteForever } from 'react-icons/md'
import { useTranslation } from 'react-i18next'
import { DEFAULT_CONTROL_SNIFF, DEFAULT_MIHOMO_SNIFFER_CONFIG } from '../../../shared/appConfig'

const Sniffer: React.FC = () => {
  const { t } = useTranslation()
  const { controledMihomoConfig, patchControledMihomoConfig } = useControledMihomoConfig()
  const { appConfig } = useAppConfig()
  const { controlSniff = DEFAULT_CONTROL_SNIFF } = appConfig || {}
  const { sniffer } = controledMihomoConfig || {}
  const {
    enable = DEFAULT_MIHOMO_SNIFFER_CONFIG.enable,
    'parse-pure-ip': parsePureIP = DEFAULT_MIHOMO_SNIFFER_CONFIG['parse-pure-ip'],
    'force-dns-mapping': forceDNSMapping = DEFAULT_MIHOMO_SNIFFER_CONFIG['force-dns-mapping'],
    'override-destination': overrideDestination = DEFAULT_MIHOMO_SNIFFER_CONFIG[
      'override-destination'
    ],
    // QUIC 仅用于设置页编辑（含 keyof 类型推导），不属于默认下发配置
    sniff = { ...DEFAULT_MIHOMO_SNIFFER_CONFIG.sniff, QUIC: { ports: [] } },
    'skip-domain': skipDomain = DEFAULT_MIHOMO_SNIFFER_CONFIG['skip-domain'],
    'force-domain': forceDomain = [],
    'skip-dst-address': skipDstAddress = DEFAULT_MIHOMO_SNIFFER_CONFIG['skip-dst-address'],
    'skip-src-address': skipSrcAddress = []
  } = sniffer || {}
  const [changed, setChanged] = useState(false)
  const [values, originSetValues] = useState({
    enable,
    parsePureIP,
    forceDNSMapping,
    overrideDestination,
    sniff,
    skipDomain,
    forceDomain,
    skipDstAddress,
    skipSrcAddress
  })
  const setValues = (v: typeof values): void => {
    originSetValues(v)
    setChanged(true)
  }

  const onSave = async (patch: Partial<IMihomoConfig>): Promise<void> => {
    try {
      setChanged(false)
      await patchControledMihomoConfig(patch)

      if (controlSniff) {
        await mihomoHotReloadConfig()
      }
    } catch (e) {
      showErrorSync(e, t('common.error.snifferConfigSaveFailed'))
    }
  }

  const handleSniffPortChange = (protocol: keyof typeof sniff, value: string): void => {
    setValues({
      ...values,
      sniff: {
        ...values.sniff,
        [protocol]: {
          ...values.sniff[protocol],
          ports: value.split(',').map((port) => port.trim())
        }
      }
    })
  }
  const handleListChange = (type: string, value: string, index: number): void => {
    const list = [...values[type]]
    if (value.trim()) {
      if (index < list.length) {
        list[index] = value
      } else {
        list.push(value)
      }
    } else {
      list.splice(index, 1)
    }
    setValues({ ...values, [type]: list })
  }
  const renderListInputs = (type: string, placeholder: string): ReactNode => {
    const currentItems = values[type]
    const showNewLine = currentItems.every((item: string) => item.trim() !== '')

    return [...currentItems, ...(showNewLine ? [''] : [])].map((item, index) => (
      <div key={index} className="mt-2 flex">
        <Input
          fullWidth
          size="sm"
          placeholder={placeholder}
          value={typeof item === 'string' ? item : item.domain}
          onValueChange={(v) => handleListChange(type, v, index)}
        />
        {index < values[type].length && (
          <Button
            className="ml-2"
            size="sm"
            variant="flat"
            color="warning"
            onPress={() => handleListChange(type, '', index)}
          >
            <MdDeleteForever className="text-lg" />
          </Button>
        )}
      </div>
    ))
  }

  return (
    <BasePage
      title={t('sniffer.title')}
      header={
        changed && (
          <Button
            size="sm"
            className="app-nodrag"
            color="primary"
            onPress={() =>
              onSave({
                sniffer: {
                  enable: values.enable,
                  'parse-pure-ip': values.parsePureIP,
                  'force-dns-mapping': values.forceDNSMapping,
                  'override-destination': values.overrideDestination,
                  sniff: values.sniff,
                  'skip-domain': values.skipDomain,
                  'force-domain': values.forceDomain,
                  'skip-dst-address': values.skipDstAddress,
                  'skip-src-address': values.skipSrcAddress
                }
              })
            }
          >
            {controlSniff ? t('common.save') : t('sniffer.saveOnly')}
          </Button>
        )
      }
    >
      <SettingCard>
        <SettingItem title={t('sniffer.enable')} divider>
          <Switch
            size="sm"
            isSelected={values.enable}
            onValueChange={(v) => {
              setValues({ ...values, enable: v })
            }}
          />
        </SettingItem>
        <SettingItem title={t('sniffer.overrideDestination')} divider>
          <Switch
            size="sm"
            isSelected={values.overrideDestination}
            onValueChange={(v) => {
              setValues({
                ...values,
                overrideDestination: v,
                sniff: {
                  ...values.sniff,
                  HTTP: {
                    ...values.sniff.HTTP,
                    'override-destination': v,
                    ports: values.sniff.HTTP?.ports || [80, 443]
                  }
                }
              })
            }}
          />
        </SettingItem>
        <SettingItem title={t('sniffer.forceDNSMapping')} divider>
          <Switch
            size="sm"
            isSelected={values.forceDNSMapping}
            onValueChange={(v) => {
              setValues({ ...values, forceDNSMapping: v })
            }}
          />
        </SettingItem>
        <SettingItem title={t('sniffer.parsePureIP')} divider>
          <Switch
            size="sm"
            isSelected={values.parsePureIP}
            onValueChange={(v) => {
              setValues({ ...values, parsePureIP: v })
            }}
          />
        </SettingItem>
        <SettingItem title={t('sniffer.sniff.title')} divider>
          <Input
            size="sm"
            className="w-[50%]"
            placeholder={t('sniffer.sniff.ports.placeholder')}
            value={values.sniff.HTTP?.ports.join(',')}
            onValueChange={(v) => handleSniffPortChange('HTTP', v)}
          />
        </SettingItem>
        <SettingItem title={t('sniffer.sniff.tls')} divider>
          <Input
            size="sm"
            className="w-[50%]"
            placeholder={t('sniffer.sniff.ports.placeholder')}
            value={values.sniff.TLS?.ports.join(',')}
            onValueChange={(v) => handleSniffPortChange('TLS', v)}
          />
        </SettingItem>
        <SettingItem title={t('sniffer.sniff.quic')} divider>
          <Input
            size="sm"
            className="w-[50%]"
            placeholder={t('sniffer.sniff.ports.placeholder')}
            value={values.sniff.QUIC?.ports.join(',')}
            onValueChange={(v) => handleSniffPortChange('QUIC', v)}
          />
        </SettingItem>
        <div className="flex flex-col items-stretch">
          <h3>{t('sniffer.skipDomain.title')}</h3>
          {renderListInputs('skipDomain', t('sniffer.skipDomain.placeholder'))}
        </div>
        <Divider className="my-2" />
        <div className="flex flex-col items-stretch">
          <h3 className="mb-2">{t('sniffer.forceDomain.title')}</h3>
          {renderListInputs('forceDomain', t('sniffer.forceDomain.placeholder'))}
        </div>
        <Divider className="my-2" />
        <div className="flex flex-col items-stretch">
          <h3 className="mb-2">{t('sniffer.skipDstAddress.title')}</h3>
          {renderListInputs('skipDstAddress', t('sniffer.skipDstAddress.placeholder'))}
        </div>
        <Divider className="my-2" />
        <div className="flex flex-col items-stretch">
          <h3 className="mb-2">{t('sniffer.skipSrcAddress.title')}</h3>
          {renderListInputs('skipSrcAddress', t('sniffer.skipSrcAddress.placeholder'))}
        </div>
      </SettingCard>
    </BasePage>
  )
}

export default Sniffer
