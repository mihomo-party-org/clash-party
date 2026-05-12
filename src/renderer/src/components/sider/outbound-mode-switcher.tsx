import { Tabs, Tab } from '@heroui/react'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'
import { useGroups } from '@renderer/hooks/use-groups'
import {
  mihomoChangeProxy,
  mihomoCloseAllConnections,
  mihomoProxies,
  patchMihomoConfig
} from '@renderer/utils/ipc'
import { Key } from 'react'
import { useTranslation } from 'react-i18next'

const OutboundModeSwitcher: React.FC = () => {
  const { t } = useTranslation()
  const { controledMihomoConfig, patchControledMihomoConfig } = useControledMihomoConfig()
  const { mutate: mutateGroups } = useGroups()
  const { appConfig } = useAppConfig()
  const { autoCloseConnection = true } = appConfig || {}
  const { mode } = controledMihomoConfig || {}

  const onChangeMode = async (mode: OutboundMode): Promise<void> => {
    await patchControledMihomoConfig({ mode })
    await patchMihomoConfig({ mode })

    // Added: 如果切换到全局模式，且 GLOBAL 组当前是 DIRECT，则自动切换到第一个可用节点
    if (mode === 'global') {
      try {
        const proxies = await mihomoProxies()
        const globalGroup = proxies.proxies['GLOBAL'] as IMihomoGroup
        if (globalGroup && globalGroup.now === 'DIRECT') {
          const firstRealNode = globalGroup.all?.find(
            (name) => name !== 'DIRECT' && name !== 'REJECT'
          )
          if (firstRealNode) {
            await mihomoChangeProxy('GLOBAL', firstRealNode)
          }
        }
      } catch (e) {
        console.error('Failed to auto switch GLOBAL proxy:', e)
      }
    }

    if (autoCloseConnection) {
      await mihomoCloseAllConnections()
    }
    mutateGroups()
    window.electron.ipcRenderer.send('updateTrayMenu')
  }
  if (!mode) return null
  return (
    <Tabs
      fullWidth
      color="primary"
      selectedKey={mode}
      classNames={{
        tabList: 'bg-content1 shadow-medium outbound-mode-card'
      }}
      onSelectionChange={(key: Key) => onChangeMode(key as OutboundMode)}
    >
      <Tab className={`${mode === 'rule' ? 'font-bold' : ''}`} key="rule" title={t('sider.cards.outbound.rule')} />
      <Tab className={`${mode === 'global' ? 'font-bold' : ''}`} key="global" title={t('sider.cards.outbound.global')} />
      <Tab className={`${mode === 'direct' ? 'font-bold' : ''}`} key="direct" title={t('sider.cards.outbound.direct')} />
    </Tabs>
  )
}

export default OutboundModeSwitcher
