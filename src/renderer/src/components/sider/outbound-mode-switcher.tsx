import { Tabs, Tab } from '@heroui/react'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'
import { useGroups } from '@renderer/hooks/use-groups'
import { mihomoCloseAllConnections, patchMihomoConfig, updateTrayIcon } from '@renderer/utils/ipc'
import { Key } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  iconOnly?: boolean
}

const OutboundModeSwitcher: React.FC<Props> = ({ iconOnly }: Props) => {
  const { t } = useTranslation()
  const { controledMihomoConfig, patchControledMihomoConfig } = useControledMihomoConfig()
  const { mutate: mutateGroups } = useGroups()
  const { appConfig } = useAppConfig()
  const { autoCloseConnection = true } = appConfig || {}
  const { mode } = controledMihomoConfig || {}

  const onChangeMode = async (mode: OutboundMode): Promise<void> => {
    await patchControledMihomoConfig({ mode })
    await patchMihomoConfig({ mode })
    if (autoCloseConnection) {
      await mihomoCloseAllConnections()
    }
    mutateGroups()
    window.electron.ipcRenderer.send('updateTrayMenu')
    await updateTrayIcon()
  }
  if (!mode) return null
  if (iconOnly) {
    return (
      <Tabs
        color="primary"
        selectedKey={mode}
        classNames={{
          tabList: 'bg-content1 shadow-medium outbound-mode-card flex-col'
        }}
        onSelectionChange={(key: Key) => onChangeMode(key as OutboundMode)}
      >
        <Tab className={`${mode === 'rule' ? 'font-bold' : ''}`} key="rule" title="R" />
        <Tab className={`${mode === 'global' ? 'font-bold' : ''}`} key="global" title="G" />
        <Tab className={`${mode === 'direct' ? 'font-bold' : ''}`} key="direct" title="D" />
      </Tabs>
    )
  }
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
      <Tab
        className={`${mode === 'rule' ? 'font-bold' : ''}`}
        key="rule"
        title={t('sider.cards.outbound.rule')}
      />
      <Tab
        className={`${mode === 'global' ? 'font-bold' : ''}`}
        key="global"
        title={t('sider.cards.outbound.global')}
      />
      <Tab
        className={`${mode === 'direct' ? 'font-bold' : ''}`}
        key="direct"
        title={t('sider.cards.outbound.direct')}
      />
    </Tabs>
  )
}

export default OutboundModeSwitcher
