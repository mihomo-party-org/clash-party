import BasePage from '@renderer/components/base/base-page'
import GeoData from '@renderer/components/resources/geo-data'
import SmartModel from '@renderer/components/resources/smart-model'
import ProxyProvider from '@renderer/components/resources/proxy-provider'
import RuleProvider from '@renderer/components/resources/rule-provider'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useTranslation } from 'react-i18next'

const Resources: React.FC = () => {
  const { t } = useTranslation()
  const { appConfig } = useAppConfig()
  const { core = 'mihomo' } = appConfig || {}

  return (
    <BasePage title={t('sider.cards.resources')}>
      {core === 'mihomo-smart' && <SmartModel />}
      <GeoData />
      <ProxyProvider />
      <RuleProvider />
    </BasePage>
  )
}

export default Resources
