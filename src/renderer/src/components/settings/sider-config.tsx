import SettingCard from '@renderer/components/base/base-setting-card'
import SettingItem from '@renderer/components/base/base-setting-item'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { Radio, RadioGroup } from '@heroui/react'
import { useTranslation } from 'react-i18next'
import type { FC } from 'react'

const titleMap: Record<string, string> = {
  sysproxyCardStatus: 'sider.cards.systemProxy',
  tunCardStatus: 'sider.cards.tun',
  profileCardStatus: 'sider.cards.profiles',
  proxyCardStatus: 'sider.cards.proxies',
  ruleCardStatus: 'sider.cards.rules',
  resourceCardStatus: 'sider.cards.resources',
  overrideCardStatus: 'sider.cards.override',
  connectionCardStatus: 'sider.cards.connections',
  mihomoCoreCardStatus: 'sider.cards.core',
  dnsCardStatus: 'sider.cards.dns',
  sniffCardStatus: 'sider.cards.sniff',
  logCardStatus: 'sider.cards.logs',
  substoreCardStatus: 'sider.cards.substore',
  networkCardStatus: 'sider.cards.network',
  usageCardStatus: 'sider.cards.traffic'
}

const sizeMap: Record<string, string> = {
  'col-span-2': 'sider.size.large',
  'col-span-1': 'sider.size.small',
  hidden: 'sider.size.hidden'
}

const SiderConfig: FC = () => {
  const { t } = useTranslation()
  const { appConfig, patchAppConfig } = useAppConfig()

  const cardStatus = {
    sysproxyCardStatus: appConfig?.sysproxyCardStatus || 'col-span-1',
    tunCardStatus: appConfig?.tunCardStatus || 'col-span-1',
    profileCardStatus: appConfig?.profileCardStatus || 'col-span-2',
    proxyCardStatus: appConfig?.proxyCardStatus || 'col-span-1',
    ruleCardStatus: appConfig?.ruleCardStatus || 'col-span-1',
    resourceCardStatus: appConfig?.resourceCardStatus || 'col-span-1',
    overrideCardStatus: appConfig?.overrideCardStatus || 'col-span-1',
    connectionCardStatus: appConfig?.connectionCardStatus || 'col-span-2',
    mihomoCoreCardStatus: appConfig?.mihomoCoreCardStatus || 'col-span-2',
    dnsCardStatus: appConfig?.dnsCardStatus || 'col-span-1',
    sniffCardStatus: appConfig?.sniffCardStatus || 'col-span-1',
    logCardStatus: appConfig?.logCardStatus || 'col-span-1',
    substoreCardStatus: appConfig?.substoreCardStatus || 'col-span-1',
    networkCardStatus: appConfig?.networkCardStatus || 'col-span-1',
    usageCardStatus: appConfig?.usageCardStatus || 'col-span-1'
  }

  return (
    <SettingCard title={t('sider.title')}>
      {Object.entries(cardStatus).map(([key, value]) => (
        <SettingItem key={key} title={t(titleMap[key])}>
          <RadioGroup
            orientation="horizontal"
            value={value}
            onValueChange={(v: string) => {
              if (v === 'col-span-1' || v === 'col-span-2' || v === 'hidden') {
                patchAppConfig({ [key]: v })
              }
            }}
          >
            {Object.entries(sizeMap).map(([size, label]) => (
              <Radio key={size} value={size}>
                {t(label)}
              </Radio>
            ))}
          </RadioGroup>
        </SettingItem>
      ))}
    </SettingCard>
  )
}

export default SiderConfig
