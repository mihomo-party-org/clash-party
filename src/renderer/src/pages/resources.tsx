import BasePage from '@renderer/components/base/base-page'
import GeoData from '@renderer/components/resources/geo-data'
import ProxyProvider from '@renderer/components/resources/proxy-provider'
import RuleProvider from '@renderer/components/resources/rule-provider'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useTranslation } from 'react-i18next'
import { useEffect, useState } from 'react'
import EditModeMenu from '@renderer/components/simple/edit-mode-menu'

const Resources: React.FC = () => {
  const { t } = useTranslation()
  const { appConfig } = useAppConfig()
  const simple = appConfig?.operationMode === 'simple'
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (!simple) setEditing(false)
  }, [simple])

  return (
    <BasePage
      title={t('sider.cards.resources')}
      header={simple ? <EditModeMenu enabled={editing} onChange={setEditing} /> : undefined}
    >
      <GeoData />
      <ProxyProvider />
      <RuleProvider editing={simple && editing} />
    </BasePage>
  )
}

export default Resources
