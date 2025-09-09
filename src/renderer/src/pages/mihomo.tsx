import { Button, Divider, Input, Select, SelectItem, Switch, Tooltip, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure, Spinner, Chip } from '@heroui/react'
import BasePage from '@renderer/components/base/base-page'
import SettingCard from '@renderer/components/base/base-setting-card'
import SettingItem from '@renderer/components/base/base-setting-item'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'
import { platform } from '@renderer/utils/init'
import { FaNetworkWired } from 'react-icons/fa'
import { IoMdCloudDownload, IoMdInformationCircleOutline, IoMdRefresh } from 'react-icons/io'
import PubSub from 'pubsub-js'
import {
  mihomoUpgrade,
  restartCore,
  startSubStoreBackendServer,
  triggerSysProxy,
  showDetailedError,
  fetchMihomoTags,
  installSpecificMihomoCore,
  clearMihomoVersionCache
} from '@renderer/utils/ipc'
import React, { useState, useEffect } from 'react'
import InterfaceModal from '@renderer/components/mihomo/interface-modal'
import { MdDeleteForever } from 'react-icons/md'
import { useTranslation } from 'react-i18next'

const CoreMap = {
  mihomo: 'mihomo.stableVersion',
  'mihomo-alpha': 'mihomo.alphaVersion',
  'mihomo-smart': 'mihomo.smartVersion',
  'mihomo-specific': 'mihomo.specificVersion'
}

const Mihomo: React.FC = () => {
  const { t } = useTranslation()
  const { appConfig, patchAppConfig } = useAppConfig()
  const {
    core = 'mihomo',
    specificVersion,
    enableSmartCore = true,
    enableSmartOverride = true,
    smartCoreUseLightGBM = false,
    smartCoreCollectData = false,
    smartCoreStrategy = 'sticky-sessions',
    maxLogDays = 7,
    sysProxy,
    disableLoopbackDetector,
    disableEmbedCA,
    disableSystemCA,
    skipSafePathCheck } = appConfig || {}
  const { controledMihomoConfig, patchControledMihomoConfig } = useControledMihomoConfig()
  const {
    ipv6,
    'external-controller': externalController = '',
    secret,
    authentication = [],
    'skip-auth-prefixes': skipAuthPrefixes = ['127.0.0.1/32', '::1/128'],
    'log-level': logLevel = 'info',
    'find-process-mode': findProcessMode = 'strict',
    'allow-lan': allowLan,
    'lan-allowed-ips': lanAllowedIps = ['0.0.0.0/0', '::/0'],
    'lan-disallowed-ips': lanDisallowedIps = [],
    'unified-delay': unifiedDelay,
    'tcp-concurrent': tcpConcurrent,
    'mixed-port': mixedPort = 7890,
    'socks-port': socksPort = 7891,
    port: httpPort = 7892,
    'redir-port': redirPort = 0,
    'tproxy-port': tproxyPort = 0,
    profile = {}
  } = controledMihomoConfig || {}
  const { 'store-selected': storeSelected, 'store-fake-ip': storeFakeIp } = profile

  const [mixedPortInput, setMixedPortInput] = useState(mixedPort)
  const [socksPortInput, setSocksPortInput] = useState(socksPort)
  const [httpPortInput, setHttpPortInput] = useState(httpPort)
  const [redirPortInput, setRedirPortInput] = useState(redirPort)
  const [tproxyPortInput, setTproxyPortInput] = useState(tproxyPort)
  const [externalControllerInput, setExternalControllerInput] = useState(externalController)
  const [secretInput, setSecretInput] = useState(secret)
  const [lanAllowedIpsInput, setLanAllowedIpsInput] = useState(lanAllowedIps)
  const [lanDisallowedIpsInput, setLanDisallowedIpsInput] = useState(lanDisallowedIps)
  const [authenticationInput, setAuthenticationInput] = useState(authentication)
  const [skipAuthPrefixesInput, setSkipAuthPrefixesInput] = useState(skipAuthPrefixes)
  const [upgrading, setUpgrading] = useState(false)
  const [lanOpen, setLanOpen] = useState(false)
  const { isOpen, onOpen, onClose } = useDisclosure()
  const [tags, setTags] = useState<{name: string, zipball_url: string, tarball_url: string}[]>([])
  const [loadingTags, setLoadingTags] = useState(false)
  const [selectedTag, setSelectedTag] = useState(specificVersion || '')
  const [installing, setInstalling] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  
  const onChangeNeedRestart = async (patch: Partial<IMihomoConfig>): Promise<void> => {
    await patchControledMihomoConfig(patch)
    await restartCore()
  }

  const handleConfigChangeWithRestart = async (key: string, value: any) => {
    try {
      await patchAppConfig({ [key]: value })
      await restartCore()
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e)
      console.error('Core restart failed:', errorMessage)

      if (errorMessage.includes('配置检查失败') || errorMessage.includes('Profile Check Failed')) {
        await showDetailedError(t('mihomo.error.profileCheckFailed'), errorMessage)
      } else {
        alert(errorMessage)
      }
    } finally {
      PubSub.publish('mihomo-core-changed')
    }
  }
  
  // 获取GitHub标签列表（带缓存）
  const fetchTags = async (forceRefresh = false) => {
    setLoadingTags(true)
    try {
      const data = await fetchMihomoTags(forceRefresh)
      setTags(data)
    } catch (error) {
      console.error('Failed to fetch tags:', error)
      alert(t('mihomo.error.fetchTagsFailed'))
    } finally {
      setLoadingTags(false)
    }
  }
  
  // 安装特定版本的核心
  const installSpecificCore = async () => {
    if (!selectedTag) return
    
    setInstalling(true)
    try {
      // 下载并安装特定版本的核心
      await installSpecificMihomoCore(selectedTag)
      
      // 更新应用配置
      await patchAppConfig({ 
        core: 'mihomo-specific',
        specificVersion: selectedTag
      })
      
      // 重启核心
      await restartCore()
      
      // 关闭模态框
      onClose()
      
      // 通知用户
      new Notification(t('mihomo.coreUpgradeSuccess'))
    } catch (error) {
      console.error('Failed to install specific core:', error)
      alert(t('mihomo.error.installCoreFailed'))
    } finally {
      setInstalling(false)
    }
  }
  
  // 刷新标签列表
  const refreshTags = async () => {
    setRefreshing(true)
    try {
      // 清除缓存并强制刷新
      await clearMihomoVersionCache()
      await fetchTags(true)
    } finally {
      setRefreshing(false)
    }
  }
  
  // 打开模态框时获取标签
  const handleOpenModal = async () => {
    onOpen()
    // 先显示缓存的标签（如果有）
    if (tags.length === 0) {
      await fetchTags(false) // 使用缓存
    }
    
    // 在后台检查更新
    setTimeout(() => {
      fetchTags(true) // 强制刷新
    }, 100)
  }
  
  // 过滤标签
  const filteredTags = tags.filter(tag => 
    tag.name.toLowerCase().includes(searchTerm.toLowerCase())
  )
  
  // 当模态框打开时，确保选中当前版本
  useEffect(() => {
    if (isOpen && specificVersion) {
      setSelectedTag(specificVersion)
    }
  }, [isOpen, specificVersion])
  
  return (
    <>
      {lanOpen && <InterfaceModal onClose={() => setLanOpen(false)} />}
      <BasePage title={t('mihomo.title')}>
        {/* Smart 内核设置 */}
        <SettingCard>
          <div className={`rounded-md border p-2 transition-all duration-200 ${
            enableSmartCore
              ? 'border-blue-300 bg-blue-50/30 dark:border-blue-700 dark:bg-blue-950/20'
              : 'border-gray-300 bg-gray-50/30 dark:border-gray-600 dark:bg-gray-800/20'
          }`}>
            <SettingItem
              title={t('mihomo.enableSmartCore')}
              divider
            >
              <Switch
                size="sm"
                isSelected={enableSmartCore}
                color={enableSmartCore ? 'primary' : 'default'}
                onValueChange={async (v) => {
                  await patchAppConfig({ enableSmartCore: v })
                  if (v && core !== 'mihomo-smart') {
                    await handleConfigChangeWithRestart('core', 'mihomo-smart')
                  } else if (!v && core === 'mihomo-smart') {
                    await handleConfigChangeWithRestart('core', 'mihomo')
                  }
                }}
              />
            </SettingItem>

            {/* Smart 覆写开关 */}
            {enableSmartCore && (
              <SettingItem
                title={
                  <div className="flex items-center gap-2">
                    <span>{t('mihomo.enableSmartOverride')}</span>
                    <Tooltip
                      content={t('mihomo.smartOverrideTooltip')}
                      placement="top"
                      className="max-w-xs"
                    >
                      <IoMdInformationCircleOutline className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 cursor-help" />
                    </Tooltip>
                  </div>
                }
                divider={core === 'mihomo-smart'}
              >
                <Switch
                  size="sm"
                  isSelected={enableSmartOverride}
                  color="primary"
                  onValueChange={async (v) => {
                    await patchAppConfig({ enableSmartOverride: v })
                    await restartCore()
                  }}
                />
              </SettingItem>
            )}

            <SettingItem
              title={
                <div className="flex items-center gap-2">
                  <span>{t('mihomo.coreVersion')}</span>
                  {core === 'mihomo-specific' && specificVersion && (
                    <Chip size="sm" variant="flat" color="primary">
                      {specificVersion}
                    </Chip>
                  )}
                </div>
              }
              actions={
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    isIconOnly
                    title={t('mihomo.upgradeCore')}
                    variant="light"
                    isLoading={upgrading}
                    onPress={async () => {
                      try {
                        setUpgrading(true)
                        await mihomoUpgrade()
                        setTimeout(() => {
                          PubSub.publish('mihomo-core-changed')
                        }, 2000)
                        if (platform !== 'win32') {
                          new Notification(t('mihomo.coreAuthLost'), {
                            body: t('mihomo.coreUpgradeSuccess')
                          })
                        }
                      } catch (e) {
                        if (typeof e === 'string' && e.includes('already using latest version')) {
                          new Notification(t('mihomo.alreadyLatestVersion'))
                        } else {
                          alert(e)
                        }
                      } finally {
                        setUpgrading(false)
                      }
                    }}
                  >
                    <IoMdCloudDownload className="text-lg" />
                  </Button>
                  <Button
                    size="sm"
                    variant="light"
                    onPress={handleOpenModal}
                  >
                    {t('mihomo.selectSpecificVersion')}
                  </Button>
                </div>
              }
              divider={enableSmartCore && core === 'mihomo-smart'}
            >
              <Select
                classNames={{
                  trigger: enableSmartCore
                    ? 'data-[hover=true]:bg-blue-100 dark:data-[hover=true]:bg-blue-900/50'
                    : 'data-[hover=true]:bg-default-200'
                }}
                className="w-[150px]"
                size="sm"
                aria-label={t('mihomo.selectCoreVersion')}
                selectedKeys={new Set([
                  core
                ])}
                disallowEmptySelection={true}
                onSelectionChange={async (v) => {
                  const selectedCore = v.currentKey as 'mihomo' | 'mihomo-alpha' | 'mihomo-smart' | 'mihomo-specific'
                  // 如果切换到特定版本但没有设置specificVersion，则打开选择模态框
                  if (selectedCore === 'mihomo-specific' && !specificVersion) {
                    handleOpenModal()
                  } else {
                    handleConfigChangeWithRestart('core', selectedCore)
                  }
                }}
              >
                <SelectItem key="mihomo">{t(CoreMap['mihomo'])}</SelectItem>
                <SelectItem key="mihomo-alpha">{t(CoreMap['mihomo-alpha'])}</SelectItem>
                {enableSmartCore ? (
                  <SelectItem key="mihomo-smart">{t(CoreMap['mihomo-smart'])}</SelectItem>
                ) : null}
                <SelectItem key="mihomo-specific">{t(CoreMap['mihomo-specific'])}</SelectItem>
              </Select>
            </SettingItem>

            {/* Smart 内核配置项 */}
            {enableSmartCore && core === 'mihomo-smart' && (
              <>
                <SettingItem
                  title={
                    <div className="flex items-center gap-2">
                      <span>{t('mihomo.smartCoreUseLightGBM')}</span>
                      <Tooltip
                        content={t('mihomo.smartCoreUseLightGBMTooltip')}
                        placement="top"
                        className="max-w-xs"
                      >
                        <IoMdInformationCircleOutline className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 cursor-help" />
                      </Tooltip>
                    </div>
                  }
                  divider
                >
                  <Switch
                    size="sm"
                    color="primary"
                    isSelected={smartCoreUseLightGBM}
                    onValueChange={async (v) => {
                      await patchAppConfig({ smartCoreUseLightGBM: v })
                      await restartCore()
                    }}
                  />
                </SettingItem>

                <SettingItem
                  title={
                    <div className="flex items-center gap-2">
                      <span>{t('mihomo.smartCoreCollectData')}</span>
                      <Tooltip
                        content={t('mihomo.smartCoreCollectDataTooltip')}
                        placement="top"
                        className="max-w-xs"
                      >
                        <IoMdInformationCircleOutline className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 cursor-help" />
                      </Tooltip>
                    </div>
                  }
                  divider
                >
                  <Switch
                    size="sm"
                    color="primary"
                    isSelected={smartCoreCollectData}
                    onValueChange={async (v) => {
                      await patchAppConfig({ smartCoreCollectData: v })
                      await restartCore()
                    }}
                  />
                </SettingItem>

                <SettingItem
                  title={t('mihomo.smartCoreStrategy')}
                >
                  <Select
                    classNames={{ trigger: 'data-[hover=true]:bg-blue-100 dark:data-[hover=true]:bg-blue-900/50' }}
                    className="w-[150px]"
                    size="sm"
                    aria-label={t('mihomo.smartCoreStrategy')}
                    selectedKeys={new Set([smartCoreStrategy])}
                    disallowEmptySelection={true}
                    onSelectionChange={async (v) => {
                      const strategy = v.currentKey as 'sticky-sessions' | 'round-robin'
                      await patchAppConfig({ smartCoreStrategy: strategy })
                      await restartCore()
                    }}
                  >
                    <SelectItem key="sticky-sessions">{t('mihomo.smartCoreStrategyStickySession')}</SelectItem>
                    <SelectItem key="round-robin">{t('mihomo.smartCoreStrategyRoundRobin')}</SelectItem>
                  </Select>
                </SettingItem>
              </>
            )}
          </div>
        </SettingCard>

        {/* 常规内核设置 */}
        <SettingCard>
          <SettingItem title={t('mihomo.mixedPort')} divider>
            <div className="flex">
              {mixedPortInput !== mixedPort && (
                <Button
                  size="sm"
                  color="primary"
                  className="mr-2"
                  onPress={async () => {
                    await onChangeNeedRestart({ 'mixed-port': mixedPortInput })
                    await startSubStoreBackendServer()
                    if (sysProxy?.enable) {
                      triggerSysProxy(true)
                    }
                  }}
                >
                  {t('mihomo.confirm')}
                </Button>
              )}

              <Input
                size="sm"
                type="number"
                className="w-[100px]"
                value={mixedPortInput.toString()}
                max={65535}
                min={0}
                onValueChange={(v) => {
                  setMixedPortInput(parseInt(v))
                }}
              />
            </div>
          </SettingItem>
          <SettingItem title={t('mihomo.socksPort')} divider>
            <div className="flex">
              {socksPortInput !== socksPort && (
                <Button
                  size="sm"
                  color="primary"
                  className="mr-2"
                  onPress={() => {
                    onChangeNeedRestart({ 'socks-port': socksPortInput })
                  }}
                >
                  {t('mihomo.confirm')}
                </Button>
              )}

              <Input
                size="sm"
                type="number"
                className="w-[100px]"
                value={socksPortInput.toString()}
                max={65535}
                min={0}
                onValueChange={(v) => {
                  setSocksPortInput(parseInt(v))
                }}
              />
            </div>
          </SettingItem>
          <SettingItem title={t('mihomo.httpPort')} divider>
            <div className="flex">
              {httpPortInput !== httpPort && (
                <Button
                  size="sm"
                  color="primary"
                  className="mr-2"
                  onPress={() => {
                    onChangeNeedRestart({ port: httpPortInput })
                  }}
                >
                  {t('mihomo.confirm')}
                </Button>
              )}

              <Input
                size="sm"
                type="number"
                className="w-[100px]"
                value={httpPortInput.toString()}
                max={65535}
                min={0}
                onValueChange={(v) => {
                  setHttpPortInput(parseInt(v))
                }}
              />
            </div>
          </SettingItem>
          {platform !== 'win32' && (
            <SettingItem title={t('mihomo.redirPort')} divider>
              <div className="flex">
                {redirPortInput !== redirPort && (
                  <Button
                    size="sm"
                    color="primary"
                    className="mr-2"
                    onPress={() => {
                      onChangeNeedRestart({ 'redir-port': redirPortInput })
                    }}
                  >
                    {t('mihomo.confirm')}
                  </Button>
                )}

                <Input
                  size="sm"
                  type="number"
                  className="w-[100px]"
                  value={redirPortInput.toString()}
                  max={65535}
                  min={0}
                  onValueChange={(v) => {
                    setRedirPortInput(parseInt(v))
                  }}
                />
              </div>
            </SettingItem>
          )}
          {platform === 'linux' && (
            <SettingItem title="TProxy 端口" divider>
              <div className="flex">
                {tproxyPortInput !== tproxyPort && (
                  <Button
                    size="sm"
                    color="primary"
                    className="mr-2"
                    onPress={() => {
                      onChangeNeedRestart({ 'tproxy-port': tproxyPortInput })
                    }}
                  >
                    {t('mihomo.confirm')}
                  </Button>
                )}

                <Input
                  size="sm"
                  type="number"
                  className="w-[100px]"
                  value={tproxyPortInput.toString()}
                  max={65535}
                  min={0}
                  onValueChange={(v) => {
                    setTproxyPortInput(parseInt(v))
                  }}
                />
              </div>
            </SettingItem>
          )}
          <SettingItem title={t('mihomo.externalController')} divider>
            <div className="flex">
              {externalControllerInput !== externalController && (
                <Button
                  size="sm"
                  color="primary"
                  className="mr-2"
                  onPress={() => {
                    onChangeNeedRestart({
                      'external-controller': externalControllerInput
                    })
                  }}
                >
                  {t('mihomo.confirm')}
                </Button>
              )}

              <Input
                size="sm"
                className="w-[200px]"
                value={externalControllerInput}
                onValueChange={(v) => {
                  setExternalControllerInput(v)
                }}
              />
            </div>
          </SettingItem>
          <SettingItem title={t('mihomo.externalControllerSecret')} divider>
            <div className="flex">
              {secretInput !== secret && (
                <Button
                  size="sm"
                  color="primary"
                  className="mr-2"
                  onPress={() => {
                    onChangeNeedRestart({ secret: secretInput })
                  }}
                >
                  {t('mihomo.confirm')}
                </Button>
              )}

              <Input
                size="sm"
                type="password"
                className="w-[200px]"
                value={secretInput}
                onValueChange={(v) => {
                  setSecretInput(v)
                }}
              />
            </div>
          </SettingItem>
          <SettingItem title={t('mihomo.ipv6')} divider>
            <Switch
              size="sm"
              isSelected={ipv6}
              onValueChange={(v) => {
                onChangeNeedRestart({ ipv6: v })
              }}
            />
          </SettingItem>
          <SettingItem
            title={t('mihomo.allowLanConnection')}
            actions={
              <Button
                size="sm"
                isIconOnly
                variant="light"
                onPress={() => {
                  setLanOpen(true)
                }}
              >
                <FaNetworkWired className="text-lg" />
              </Button>
            }
            divider
          >
            <Switch
              size="sm"
              isSelected={allowLan}
              onValueChange={(v) => {
                onChangeNeedRestart({ 'allow-lan': v })
              }}
            />
          </SettingItem>
          {allowLan && (
            <>
              <SettingItem title={t('mihomo.allowedIpSegments')}>
                {lanAllowedIpsInput.join('') !== lanAllowedIps.join('') && (
                  <Button
                    size="sm"
                    color="primary"
                    onPress={() => {
                      onChangeNeedRestart({ 'lan-allowed-ips': lanAllowedIpsInput })
                    }}
                  >
                    {t('mihomo.confirm')}
                  </Button>
                )}
              </SettingItem>
              <div className="flex flex-col items-stretch mt-2">
                {[...lanAllowedIpsInput, ''].map((ipcidr, index) => {
                  return (
                    <div key={index} className="flex mb-2">
                      <Input
                        size="sm"
                        fullWidth
                        placeholder={t('mihomo.ipSegment.placeholder')}
                        value={ipcidr || ''}
                        onValueChange={(v) => {
                          if (index === lanAllowedIpsInput.length) {
                            setLanAllowedIpsInput([...lanAllowedIpsInput, v])
                          } else {
                            setLanAllowedIpsInput(
                              lanAllowedIpsInput.map((a, i) => (i === index ? v : a))
                            )
                          }
                        }}
                      />
                      {index < lanAllowedIpsInput.length && (
                        <Button
                          className="ml-2"
                          size="sm"
                          variant="flat"
                          color="warning"
                          onPress={() =>
                            setLanAllowedIpsInput(lanAllowedIpsInput.filter((_, i) => i !== index))
                          }
                        >
                          <MdDeleteForever className="text-lg" />
                        </Button>
                      )}
                    </div>
                  )
                })}
              </div>
              <Divider className="mb-2" />
              <SettingItem title={t('mihomo.disallowedIpSegments')}>
                {lanDisallowedIpsInput.join('') !== lanDisallowedIps.join('') && (
                  <Button
                    size="sm"
                    color="primary"
                    onPress={() => {
                      onChangeNeedRestart({ 'lan-disallowed-ips': lanDisallowedIpsInput })
                    }}
                  >
                    {t('mihomo.confirm')}
                  </Button>
                )}
              </SettingItem>
              <div className="flex flex-col items-stretch mt-2">
                {[...lanDisallowedIpsInput, ''].map((ipcidr, index) => {
                  return (
                    <div key={index} className="flex mb-2">
                      <Input
                        size="sm"
                        fullWidth
                        placeholder={t('mihomo.username.placeholder')}
                        value={ipcidr || ''}
                        onValueChange={(v) => {
                          if (index === lanDisallowedIpsInput.length) {
                            setLanDisallowedIpsInput([...lanDisallowedIpsInput, v])
                          } else {
                            setLanDisallowedIpsInput(
                              lanDisallowedIpsInput.map((a, i) => (i === index ? v : a))
                            )
                          }
                        }}
                      />
                      {index < lanDisallowedIpsInput.length && (
                        <Button
                          className="ml-2"
                          size="sm"
                          variant="flat"
                          color="warning"
                          onPress={() =>
                            setLanDisallowedIpsInput(
                              lanDisallowedIpsInput.filter((_, i) => i !== index)
                            )
                          }
                        >
                          <MdDeleteForever className="text-lg" />
                        </Button>
                      )}
                    </div>
                  )
                })}
              </div>
              <Divider className="mb-2" />
            </>
          )}
          <SettingItem title={t('mihomo.userVerification')}>
            {authenticationInput.join('') !== authentication.join('') && (
              <Button
                size="sm"
                color="primary"
                onPress={() => {
                  onChangeNeedRestart({ authentication: authenticationInput })
                }}
              >
                {t('mihomo.confirm')}
              </Button>
            )}
          </SettingItem>
          <div className="flex flex-col items-stretch mt-2">
            {[...authenticationInput, ''].map((auth, index) => {
              const [user, pass] = auth.split(':')
              return (
                <div key={index} className="flex mb-2">
                  <div className="flex-4">
                    <Input
                      size="sm"
                      fullWidth
                      placeholder={t('mihomo.username.placeholder')}
                      value={user || ''}
                      onValueChange={(v) => {
                        if (index === authenticationInput.length) {
                          setAuthenticationInput([...authenticationInput, `${v}:${pass || ''}`])
                        } else {
                          setAuthenticationInput(
                            authenticationInput.map((a, i) =>
                              i === index ? `${v}:${pass || ''}` : a
                            )
                          )
                        }
                      }}
                    />
                  </div>
                  <span className="mx-2">:</span>
                  <div className="flex-6 flex">
                    <Input
                      size="sm"
                      fullWidth
                      placeholder={t('mihomo.password.placeholder')}
                      value={pass || ''}
                      onValueChange={(v) => {
                        if (index === authenticationInput.length) {
                          setAuthenticationInput([...authenticationInput, `${user || ''}:${v}`])
                        } else {
                          setAuthenticationInput(
                            authenticationInput.map((a, i) =>
                              i === index ? `${user || ''}:${v}` : a
                            )
                          )
                        }
                      }}
                    />
                    {index < authenticationInput.length && (
                      <Button
                        className="ml-2"
                        size="sm"
                        variant="flat"
                        color="warning"
                        onPress={() =>
                          setAuthenticationInput(authenticationInput.filter((_, i) => i !== index))
                        }
                      >
                        <MdDeleteForever className="text-lg" />
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <Divider className="mb-2" />
          <SettingItem title={t('mihomo.skipAuthPrefixes')}>
            {skipAuthPrefixesInput.join('') !== skipAuthPrefixes.join('') && (
              <Button
                size="sm"
                color="primary"
                onPress={() => {
                  onChangeNeedRestart({ 'skip-auth-prefixes': skipAuthPrefixesInput })
                }}
              >
                {t('mihomo.confirm')}
              </Button>
            )}
          </SettingItem>
          <div className="flex flex-col items-stretch mt-2">
            {[...skipAuthPrefixesInput, ''].map((ipcidr, index) => {
              return (
                <div key={index} className="flex mb-2">
                  <Input
                    disabled={index === 0 || index === 1}
                    size="sm"
                    fullWidth
                    placeholder={t('mihomo.ipSegment.placeholder')}
                    value={ipcidr || ''}
                    onValueChange={(v) => {
                      if (index === skipAuthPrefixesInput.length) {
                        setSkipAuthPrefixesInput([...skipAuthPrefixesInput, v])
                      } else {
                        setSkipAuthPrefixesInput(
                          skipAuthPrefixesInput.map((a, i) => (i === index ? v : a))
                        )
                      }
                    }}
                  />
                  {index < skipAuthPrefixesInput.length && index !== 0 && index !== 1 && (
                    <Button
                      className="ml-2"
                      size="sm"
                      variant="flat"
                      color="warning"
                      onPress={() =>
                        setSkipAuthPrefixesInput(
                          skipAuthPrefixesInput.filter((_, i) => i !== index)
                        )
                      }
                    >
                      <MdDeleteForever className="text-lg" />
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
          <Divider className="mb-2" />
          <SettingItem title={t('mihomo.useRttDelayTest')} divider>
            <Switch
              size="sm"
              isSelected={unifiedDelay}
              onValueChange={(v) => {
                onChangeNeedRestart({ 'unified-delay': v })
              }}
            />
          </SettingItem>
          <SettingItem title={t('mihomo.tcpConcurrent')} divider>
            <Switch
              size="sm"
              isSelected={tcpConcurrent}
              onValueChange={(v) => {
                onChangeNeedRestart({ 'tcp-concurrent': v })
              }}
            />
          </SettingItem>
          <SettingItem title={t('mihomo.storeSelectedNode')} divider>
            <Switch
              size="sm"
              isSelected={storeSelected}
              onValueChange={(v) => {
                onChangeNeedRestart({ profile: { 'store-selected': v } })
              }}
            />
          </SettingItem>
          <SettingItem title={t('mihomo.storeFakeIp')} divider>
            <Switch
              size="sm"
              isSelected={storeFakeIp}
              onValueChange={(v) => {
                onChangeNeedRestart({ profile: { 'store-fake-ip': v } })
              }}
            />
          </SettingItem>
          <SettingItem title={t('mihomo.disableLoopbackDetector')} divider>
            <Switch
              size="sm"
              isSelected={disableLoopbackDetector}
              onValueChange={(v) => {
                handleConfigChangeWithRestart('disableLoopbackDetector', v)
              }}
            />
          </SettingItem>
          <SettingItem title={t('mihomo.skipSafePathCheck')} divider>
            <Switch
              size="sm"
              isSelected={skipSafePathCheck}
              onValueChange={(v) => {
                handleConfigChangeWithRestart('skipSafePathCheck', v)
              }}
            />
          </SettingItem>
          <SettingItem title={t('mihomo.disableEmbedCA')} divider>
            <Switch
              size="sm"
              isSelected={disableEmbedCA}
              onValueChange={(v) => {
                handleConfigChangeWithRestart('disableEmbedCA', v)
              }}
            />
          </SettingItem>
          <SettingItem title={t('mihomo.disableSystemCA')} divider>
            <Switch
              size="sm"
              isSelected={disableSystemCA}
              onValueChange={(v) => {
                handleConfigChangeWithRestart('disableSystemCA', v)
              }}
            />
          </SettingItem>
          <SettingItem title={t('mihomo.logRetentionDays')} divider>
            <Input
              size="sm"
              type="number"
              className="w-[100px]"
              value={maxLogDays.toString()}
              onValueChange={(v) => {
                patchAppConfig({ maxLogDays: parseInt(v) })
              }}
            />
          </SettingItem>
          <SettingItem title={t('mihomo.logLevel')} divider>
            <Select
              classNames={{ trigger: 'data-[hover=true]:bg-default-200' }}
              className="w-[100px]"
              size="sm"
              aria-label={t('mihomo.selectLogLevel')}
              selectedKeys={new Set([logLevel])}
              disallowEmptySelection={true}
              onSelectionChange={(v) => {
                onChangeNeedRestart({ 'log-level': v.currentKey as LogLevel })
              }}
            >
              <SelectItem key="silent">{t('mihomo.silent')}</SelectItem>
              <SelectItem key="error">{t('mihomo.error')}</SelectItem>
              <SelectItem key="warning">{t('mihomo.warning')}</SelectItem>
              <SelectItem key="info">{t('mihomo.info')}</SelectItem>
              <SelectItem key="debug">{t('mihomo.debug')}</SelectItem>
            </Select>
          </SettingItem>
          <SettingItem title={t('mihomo.findProcess')} divider>
            <Select
              classNames={{ trigger: 'data-[hover=true]:bg-default-200' }}
              className="w-[100px]"
              size="sm"
              aria-label={t('mihomo.selectFindProcessMode')}
              selectedKeys={new Set([findProcessMode])}
              disallowEmptySelection={true}
              onSelectionChange={(v) => {
                onChangeNeedRestart({ 'find-process-mode': v.currentKey as FindProcessMode })
              }}
            >
              <SelectItem key="strict">{t('mihomo.strict')}</SelectItem>
              <SelectItem key="off">{t('mihomo.off')}</SelectItem>
              <SelectItem key="always">{t('mihomo.always')}</SelectItem>
            </Select>
          </SettingItem>
        </SettingCard>
      </BasePage>
      {/* 自定义版本选择模态框 */}
      <Modal 
        isOpen={isOpen} 
        onClose={onClose} 
        size="5xl"
        backdrop="blur"
        classNames={{ backdrop: 'top-[48px]' }}
        hideCloseButton
        scrollBehavior="inside"
      >
        <ModalContent className="h-full w-[calc(100%-100px)]">
          <ModalHeader className="flex app-drag">{t('mihomo.selectSpecificVersion')}</ModalHeader>
          <ModalBody>
            <div className="flex flex-col gap-4">
              <div className="flex gap-2">
                <Input
                  placeholder={t('mihomo.searchVersion')}
                  value={searchTerm}
                  onValueChange={setSearchTerm}
                  className="flex-1"
                />
                <Button
                  isIconOnly
                  variant="light"
                  onPress={refreshTags}
                  isLoading={refreshing}
                  title={t('common.refresh')}
                >
                  <IoMdRefresh className="text-lg" />
                </Button>
              </div>
              {loadingTags ? (
                <div className="flex justify-center items-center h-40">
                  <Spinner size="lg" />
                </div>
              ) : (
                <div className="h-full overflow-y-auto">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {filteredTags.map((tag) => (
                      <div
                        key={tag.name}
                        className={`p-3 rounded-lg cursor-pointer transition-colors ${
                          selectedTag === tag.name
                            ? 'bg-primary/20 border-2 border-primary'
                            : 'bg-default-100 hover:bg-default-200'
                        }`}
                        onClick={() => setSelectedTag(tag.name)}
                      >
                        <div className="font-medium">{tag.name}</div>
                      </div>
                    ))}
                  </div>
                  {filteredTags.length === 0 && (
                    <div className="text-center py-8 text-default-500">
                      {t('mihomo.noVersionsFound')}
                    </div>
                  )}
                </div>
              )}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              color="primary"
              isLoading={installing}
              isDisabled={!selectedTag || installing}
              onPress={installSpecificCore}
            >
              {t('mihomo.installVersion')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}

export default Mihomo
