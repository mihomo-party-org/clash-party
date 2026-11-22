import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem
} from '@heroui/react'
import React from 'react'
import { calcTraffic } from '@renderer/utils/calc'
import dayjs from '@renderer/utils/dayjs'
import { BiCopy } from 'react-icons/bi'
import { IoAdd } from 'react-icons/io5'
import { useTranslation } from 'react-i18next'
import { useActiveProfile } from '@renderer/hooks/use-active-profile'
import { getLocalRulesEditor } from '@renderer/utils/ipc'
import SettingItem from '../base/base-setting-item'
import type { LocalRuleEditor } from '../../../../shared/local-config'
import RuleEditorModal from '../rules/rule-editor-modal'

interface Props {
  connection: IMihomoConnectionDetail
  onClose: () => void
}

const CopyableSettingItem: React.FC<{
  title: string
  value: string | string[]
  displayName?: string
  prefix?: string[]
}> = ({ title, value, displayName, prefix = [] }) => {
  const { t } = useTranslation()
  const { isLocalActive } = useActiveProfile()
  const [ruleEditor, setRuleEditor] = React.useState<LocalRuleEditor>()
  const [ruleValue, setRuleValue] = React.useState<string>()
  const getSubDomains = (domain: string): string[] =>
    domain.split('.').length <= 2
      ? [domain]
      : domain
          .split('.')
          .map((_, i, parts) => parts.slice(i).join('.'))
          .slice(0, -1)
  const isIPv6 = (ip: string) => ip.includes(':')

  const menuItems = [
    { key: 'raw', text: displayName || (Array.isArray(value) ? value.join(', ') : value) },
    ...(Array.isArray(value)
      ? value
          .map((v, i) => {
            const p = prefix[i]
            if (!p || !v) return null

            if (p === 'DOMAIN-SUFFIX') {
              return getSubDomains(v).map((subV) => ({
                key: `${p},${subV}`,
                text: `${p},${subV}`
              }))
            }

            if (p === 'IP-ASN' || p === 'SRC-IP-ASN') {
              return {
                key: `${p},${v.split(' ')[0]}`,
                text: `${p},${v.split(' ')[0]}`
              }
            }

            const suffix =
              p === 'IP-CIDR' || p === 'SRC-IP-CIDR' ? (isIPv6(v) ? '/128' : '/32') : ''
            return {
              key: `${p},${v}${suffix}`,
              text: `${p},${v}${suffix}`
            }
          })
          .filter(Boolean)
          .flat()
      : prefix
          .map((p) => {
            const v = value as string
            if (p === 'DOMAIN-SUFFIX') {
              return getSubDomains(v).map((subV) => ({
                key: `${p},${subV}`,
                text: `${p},${subV}`
              }))
            }

            if (p === 'IP-ASN' || p === 'SRC-IP-ASN') {
              return {
                key: `${p},${v.split(' ')[0]}`,
                text: `${p},${v.split(' ')[0]}`
              }
            }

            const suffix =
              p === 'IP-CIDR' || p === 'SRC-IP-CIDR' ? (isIPv6(v) ? '/128' : '/32') : ''
            return {
              key: `${p},${v}${suffix}`,
              text: `${p},${v}${suffix}`
            }
          })
          .flat())
  ]
  const validMenuItems = menuItems.filter(
    (item): item is { key: string; text: string } => item !== null
  )
  const ruleMenuItems = validMenuItems.filter(({ key }) => key !== 'raw')

  const openRuleEditor = async (key: string): Promise<void> => {
    try {
      setRuleEditor(await getLocalRulesEditor())
      setRuleValue(`${key},DIRECT`)
    } catch (error) {
      console.error('[Connections] failed to load local rules', error)
    }
  }

  return (
    <>
      <SettingItem
        title={
          <span className="inline-flex h-full w-[88px] shrink-0 items-center whitespace-nowrap">
            {title}
          </span>
        }
        actions={
          <>
            <Dropdown>
              <DropdownTrigger>
                <Button
                  title={t('connections.detail.copyRule')}
                  isIconOnly
                  size="sm"
                  variant="light"
                  className="h-8 w-8 min-w-8 p-0"
                >
                  <BiCopy className="text-lg" />
                </Button>
              </DropdownTrigger>
              <DropdownMenu
                onAction={(key) => {
                  void navigator.clipboard.writeText(
                    key === 'raw'
                      ? Array.isArray(value)
                        ? value.join(', ')
                        : value
                      : (key as string)
                  )
                }}
              >
                {validMenuItems.map(({ key, text }) => (
                  <DropdownItem key={key}>{text}</DropdownItem>
                ))}
              </DropdownMenu>
            </Dropdown>
            {isLocalActive && ruleMenuItems.length > 0 && (
              <Dropdown>
                <DropdownTrigger>
                  <Button
                    title={t('connections.detail.addRule')}
                    isIconOnly
                    size="sm"
                    variant="light"
                    className="h-8 w-8 min-w-8 p-0"
                  >
                    <IoAdd className="text-lg" />
                  </Button>
                </DropdownTrigger>
                <DropdownMenu onAction={(key) => void openRuleEditor(String(key))}>
                  {ruleMenuItems.map(({ key, text }) => (
                    <DropdownItem key={key}>{text}</DropdownItem>
                  ))}
                </DropdownMenu>
              </Dropdown>
            )}
          </>
        }
      >
        <span
          className="min-w-0 flex-1 truncate text-right"
          title={displayName || (Array.isArray(value) ? value.join(', ') : value)}
        >
          {displayName || (Array.isArray(value) ? value.join(', ') : value)}
        </span>
      </SettingItem>
      {ruleEditor && ruleValue && (
        <RuleEditorModal
          index={null}
          insertAt={0}
          initialValue={ruleValue}
          data={ruleEditor}
          onClose={() => {
            setRuleEditor(undefined)
            setRuleValue(undefined)
          }}
          onSaved={() => undefined}
        />
      )}
    </>
  )
}

const ConnectionDetailModal: React.FC<Props> = (props) => {
  const { connection, onClose } = props
  const { t } = useTranslation()

  return (
    <Modal
      backdrop="blur"
      classNames={{ backdrop: 'top-[48px]' }}
      size="xl"
      hideCloseButton
      isOpen={true}
      onOpenChange={onClose}
      scrollBehavior="inside"
    >
      <ModalContent className="flag-emoji break-all">
        <ModalHeader className="flex app-drag">{t('connections.detail.title')}</ModalHeader>
        <ModalBody>
          <SettingItem title={t('connections.detail.establishTime')}>
            {dayjs(connection.start).fromNow()}
          </SettingItem>
          <SettingItem title={t('connections.detail.rule')}>
            {connection.rule}
            {connection.rulePayload ? `(${connection.rulePayload})` : ''}
          </SettingItem>
          <SettingItem title={t('connections.detail.proxyChain')}>
            {[...connection.chains].reverse().join('>>')}
          </SettingItem>
          <SettingItem title={t('connections.uploadSpeed')}>
            {calcTraffic(connection.uploadSpeed || 0)}/s
          </SettingItem>
          <SettingItem title={t('connections.downloadSpeed')}>
            {calcTraffic(connection.downloadSpeed || 0)}/s
          </SettingItem>
          <SettingItem title={t('connections.uploadAmount')}>
            {calcTraffic(connection.upload)}
          </SettingItem>
          <SettingItem title={t('connections.downloadAmount')}>
            {calcTraffic(connection.download)}
          </SettingItem>
          <CopyableSettingItem
            title={t('connections.detail.connectionType')}
            value={[connection.metadata.type, connection.metadata.network]}
            displayName={`${connection.metadata.type}(${connection.metadata.network})`}
            prefix={['IN-TYPE', 'NETWORK']}
          />
          {connection.metadata.host && (
            <CopyableSettingItem
              title={t('connections.detail.host')}
              value={connection.metadata.host}
              prefix={['DOMAIN', 'DOMAIN-SUFFIX']}
            />
          )}
          {connection.metadata.sniffHost && (
            <CopyableSettingItem
              title={t('connections.detail.sniffHost')}
              value={connection.metadata.sniffHost}
              prefix={['DOMAIN', 'DOMAIN-SUFFIX']}
            />
          )}
          {connection.metadata.process && (
            <CopyableSettingItem
              title={t('connections.detail.processName')}
              value={[
                connection.metadata.process,
                ...(connection.metadata.uid ? [connection.metadata.uid.toString()] : [])
              ]}
              displayName={`${connection.metadata.process}${connection.metadata.uid ? `(${connection.metadata.uid})` : ''}`}
              prefix={['PROCESS-NAME', ...(connection.metadata.uid ? ['UID'] : [])]}
            />
          )}
          {connection.metadata.processPath && (
            <CopyableSettingItem
              title={t('connections.detail.processPath')}
              value={connection.metadata.processPath}
              prefix={['PROCESS-PATH']}
            />
          )}
          {connection.metadata.sourceIP && (
            <CopyableSettingItem
              title={t('connections.detail.sourceIP')}
              value={connection.metadata.sourceIP}
              prefix={['SRC-IP-CIDR']}
            />
          )}
          {connection.metadata.sourceGeoIP && connection.metadata.sourceGeoIP.length > 0 && (
            <CopyableSettingItem
              title={t('connections.detail.sourceGeoIP')}
              value={connection.metadata.sourceGeoIP}
              prefix={['SRC-GEOIP']}
            />
          )}
          {connection.metadata.sourceIPASN && (
            <CopyableSettingItem
              title={t('connections.detail.sourceASN')}
              value={connection.metadata.sourceIPASN}
              prefix={['SRC-IP-ASN']}
            />
          )}
          {connection.metadata.destinationIP && (
            <CopyableSettingItem
              title={t('connections.detail.destinationIP')}
              value={connection.metadata.destinationIP}
              prefix={['IP-CIDR']}
            />
          )}
          {connection.metadata.destinationGeoIP &&
            connection.metadata.destinationGeoIP.length > 0 && (
              <CopyableSettingItem
                title={t('connections.detail.destinationGeoIP')}
                value={connection.metadata.destinationGeoIP}
                prefix={['GEOIP']}
              />
            )}
          {connection.metadata.destinationIPASN && (
            <CopyableSettingItem
              title={t('connections.detail.destinationASN')}
              value={connection.metadata.destinationIPASN}
              prefix={['IP-ASN']}
            />
          )}
          {connection.metadata.sourcePort && (
            <CopyableSettingItem
              title={t('connections.detail.sourcePort')}
              value={connection.metadata.sourcePort}
              prefix={['SRC-PORT']}
            />
          )}
          {connection.metadata.destinationPort && (
            <CopyableSettingItem
              title={t('connections.detail.destinationPort')}
              value={connection.metadata.destinationPort}
              prefix={['DST-PORT']}
            />
          )}
          {connection.metadata.inboundIP && (
            <CopyableSettingItem
              title={t('connections.detail.inboundIP')}
              value={connection.metadata.inboundIP}
              prefix={['SRC-IP-CIDR']}
            />
          )}
          {connection.metadata.inboundPort && (
            <CopyableSettingItem
              title={t('connections.detail.inboundPort')}
              value={connection.metadata.inboundPort}
              prefix={['IN-PORT']}
            />
          )}
          {connection.metadata.inboundName && (
            <CopyableSettingItem
              title={t('connections.detail.inboundName')}
              value={connection.metadata.inboundName}
              prefix={['IN-NAME']}
            />
          )}
          {connection.metadata.inboundUser && (
            <CopyableSettingItem
              title={t('connections.detail.inboundUser')}
              value={connection.metadata.inboundUser}
              prefix={['IN-USER']}
            />
          )}

          <CopyableSettingItem
            title={t('connections.detail.dscp')}
            value={connection.metadata.dscp.toString()}
            prefix={['DSCP']}
          />

          {connection.metadata.remoteDestination && (
            <SettingItem title={t('connections.detail.remoteDestination')}>
              {connection.metadata.remoteDestination}
            </SettingItem>
          )}
          {connection.metadata.dnsMode && (
            <SettingItem title={t('connections.detail.dnsMode')}>
              {connection.metadata.dnsMode}
            </SettingItem>
          )}
          {connection.metadata.specialProxy && (
            <SettingItem title={t('connections.detail.specialProxy')}>
              {connection.metadata.specialProxy}
            </SettingItem>
          )}
          {connection.metadata.specialRules && (
            <SettingItem title={t('connections.detail.specialRules')}>
              {connection.metadata.specialRules}
            </SettingItem>
          )}
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="light" onPress={onClose}>
            {t('connections.detail.close')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default ConnectionDetailModal
