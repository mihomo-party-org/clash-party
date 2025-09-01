import React, { useEffect, useState } from 'react'
import SettingCard from '../base/base-setting-card'
import SettingItem from '../base/base-setting-item'
import { Button, Input, Select, SelectItem, Switch, Tab, Tabs, Tooltip } from '@heroui/react'
import { BiCopy, BiSolidFileImport } from 'react-icons/bi'
import useSWR from 'swr'
import {
  applyTheme,
  checkAutoRun,
  closeFloatingWindow,
  closeTrayIcon,
  copyEnv,
  disableAutoRun,
  enableAutoRun,
  fetchThemes,
  getFilePath,
  importThemes,
  relaunchApp,
  resolveThemes,
  showFloatingWindow,
  showTrayIcon,
  startMonitor,
  updateTrayIcon,
  writeTheme
} from '@renderer/utils/ipc'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import debounce from '@renderer/utils/debounce'
import { platform } from '@renderer/utils/init'
import { useTheme } from 'next-themes'
import { IoIosHelpCircle, IoMdCloudDownload } from 'react-icons/io'
import { MdEditDocument } from 'react-icons/md'
import CSSEditorModal from './css-editor-modal'
import { useTranslation } from 'react-i18next'
import BaseConfirmModal from '../base/base-confirm-modal'

const GeneralConfig: React.FC = () => {
  const { t, i18n } = useTranslation()
  const { data: enable = false, mutate: mutateEnable } = useSWR('checkAutoRun', checkAutoRun)
  const { appConfig, patchAppConfig } = useAppConfig()
  const [customThemes, setCustomThemes] = useState<{ key: string; label: string }[]>()
  const [openCSSEditor, setOpenCSSEditor] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [isRelaunching, setIsRelaunching] = useState(false)
  const [showHardwareAccelConfirm, setShowHardwareAccelConfirm] = useState(false)
  const [pendingHardwareAccelValue, setPendingHardwareAccelValue] = useState(false)
  const { setTheme } = useTheme()
  const {
    silentStart = false,
    useDockIcon = true,
    showTraffic = false,
    proxyInTray = true,
    disableTray = false,
    disableTrayIconColor = false,
    disableAnimations = false,
    showFloatingWindow: showFloating = false,
    spinFloatingIcon = true,
    floatingWindowCompatMode = true,
    disableHardwareAcceleration = false,
    useWindowFrame = false,
    autoQuitWithoutCore = false,
    autoQuitWithoutCoreDelay = 60,
    customTheme = 'default.css',
    envType = [platform === 'win32' ? 'powershell' : 'bash'],
    autoCheckUpdate,
    appTheme = 'system',
    language = 'zh-CN'
  } = appConfig || {}

  useEffect(() => {
    resolveThemes().then((themes) => {
      setCustomThemes(themes)
    })
  }, [])

  return (
    <>
      {openCSSEditor && (
        <CSSEditorModal
          theme={customTheme}
          onCancel={() => setOpenCSSEditor(false)}
          onConfirm={async (css: string) => {
            await writeTheme(customTheme, css)
            await applyTheme(customTheme)
            setOpenCSSEditor(false)
          }}
        />
      )}
      {showHardwareAccelConfirm && (
        <BaseConfirmModal
          isOpen={showHardwareAccelConfirm}
          title={t('settings.hardwareAcceleration.confirm.title')}
          content={t('settings.hardwareAcceleration.confirm.content')}
          onCancel={() => {
            setShowHardwareAccelConfirm(false)
            setPendingHardwareAccelValue(false)
          }}
          onConfirm={async () => {
            setShowHardwareAccelConfirm(false)
            setIsRelaunching(true)
            try {
              await patchAppConfig({ disableHardwareAcceleration: pendingHardwareAccelValue })
              await relaunchApp()
            } catch (e) {
              alert(e)
              setIsRelaunching(false)
            }
          }}
        />
      )}
      <SettingCard>
        <SettingItem title={t('settings.language')} divider>
          <Select
            classNames={{ trigger: 'data-[hover=true]:bg-default-200' }}
            className="w-[150px]"
            size="sm"
            selectedKeys={[language]}
            aria-label={t('settings.language')}
            onSelectionChange={async (v) => {
              const newLang = Array.from(v)[0] as 'zh-CN' | 'en-US' | 'ru-RU' | 'fa-IR'
              await patchAppConfig({ language: newLang })
              i18n.changeLanguage(newLang)
            }}
          >
            <SelectItem key="zh-CN">中文简体</SelectItem>
            <SelectItem key="en-US">English</SelectItem>
            <SelectItem key="ru-RU">Русский</SelectItem>
            <SelectItem key="fa-IR">فارسی</SelectItem>
          </Select>
        </SettingItem>
        <SettingItem title={t('settings.autoStart')} divider>
          <Switch
            size="sm"
            isSelected={enable}
            onValueChange={async (v) => {
              try {
                // 检查管理员权限
                const hasAdminPrivileges = await window.electron.ipcRenderer.invoke('checkAdminPrivileges')

                if (!hasAdminPrivileges) {
                  const notification = new Notification(t('settings.autoStart.permissions'))
                  notification.close()
                }

                if (v) {
                  await enableAutoRun()
                } else {
                  await disableAutoRun()
                }
              } catch (e) {
                alert(e)
              } finally {
                mutateEnable()
              }
            }}
          />
        </SettingItem>
        <SettingItem title={t('settings.autoCheckUpdate')} divider>
          <Switch
            size="sm"
            isSelected={autoCheckUpdate}
            onValueChange={(v) => {
              patchAppConfig({ autoCheckUpdate: v })
            }}
          />
        </SettingItem>
        <SettingItem title={t('settings.silentStart')} divider>
          <Switch
            size="sm"
            isSelected={silentStart}
            onValueChange={(v) => {
              patchAppConfig({ silentStart: v })
            }}
          />
        </SettingItem>
        <SettingItem
          title={t('settings.autoQuitWithoutCore')}
          actions={
            <Tooltip content={t('settings.autoQuitWithoutCoreTooltip')}>
              <Button isIconOnly size="sm" variant="light">
                <IoIosHelpCircle className="text-lg" />
              </Button>
            </Tooltip>
          }
          divider
        >
          <Switch
            size="sm"
            isSelected={autoQuitWithoutCore}
            onValueChange={(v) => {
              patchAppConfig({ autoQuitWithoutCore: v })
            }}
          />
        </SettingItem>
        {autoQuitWithoutCore && (
          <SettingItem title={t('settings.autoQuitWithoutCoreDelay')} divider>
            <div className="flex items-center gap-2">
              <Input
                size="sm"
                className="w-[100px]"
                type="number"
                value={autoQuitWithoutCoreDelay.toString()}
                onValueChange={async (v: string) => {
                  let num = parseInt(v)
                  await patchAppConfig({ autoQuitWithoutCoreDelay: num })
                }}
                onBlur={async (e) => {
                  let num = parseInt(e.target.value)
                  if (isNaN(num)) num = 5
                  if (num < 5) num = 5
                  await patchAppConfig({ autoQuitWithoutCoreDelay: num })
                }}
              />
              <span className="text-default-500">{t('common.seconds')}</span>
            </div>
          </SettingItem>
        )}
        <SettingItem
          title={t('settings.envType')}
          actions={envType.map((type) => (
            <Button
              key={type}
              title={type}
              isIconOnly
              size="sm"
              variant="light"
              onPress={() => copyEnv(type)}
            >
              <BiCopy className="text-lg" />
            </Button>
          ))}
          divider
        >
          <Select
            classNames={{ trigger: 'data-[hover=true]:bg-default-200' }}
            className="w-[150px]"
            size="sm"
            selectionMode="multiple"
            selectedKeys={new Set(envType)}
            aria-label={t('settings.envType')}
            disallowEmptySelection={true}
            onSelectionChange={async (v) => {
              try {
                await patchAppConfig({
                  envType: Array.from(v) as ('bash' | 'cmd' | 'powershell')[]
                })
              } catch (e) {
                alert(e)
              }
            }}
          >
            <SelectItem key="bash">Bash</SelectItem>
            <SelectItem key="cmd">CMD</SelectItem>
            <SelectItem key="powershell">PowerShell</SelectItem>
          </Select>
        </SettingItem>
        <SettingItem title={t('settings.showFloatingWindow')} divider>
          <Switch
            size="sm"
            isSelected={showFloating}
            onValueChange={async (v) => {
              await patchAppConfig({ showFloatingWindow: v })
              if (v) {
                showFloatingWindow()
              } else {
                closeFloatingWindow()
              }
            }}
          />
        </SettingItem>

        {showFloating && (
          <>
            <SettingItem title={t('settings.spinFloatingIcon')} divider>
              <Switch
                size="sm"
                isSelected={spinFloatingIcon}
                onValueChange={async (v) => {
                  await patchAppConfig({ spinFloatingIcon: v })
                  window.electron.ipcRenderer.send('updateFloatingWindow')
                }}
              />
            </SettingItem>
            <SettingItem
              title={t('settings.floatingWindowCompatMode')}
              divider
            >
              <div className="flex items-center gap-2">
                <Switch
                  size="sm"
                  isSelected={floatingWindowCompatMode}
                  onValueChange={async (v) => {
                    await patchAppConfig({ floatingWindowCompatMode: v })
                    closeFloatingWindow()
                    setTimeout(() => {
                      showFloatingWindow()
                    }, 100)
                  }}
                />
                <Tooltip content={t('settings.floatingWindowCompatModeTooltip')}>
                  <IoIosHelpCircle className="text-default-500 cursor-help" />
                </Tooltip>
              </div>
            </SettingItem>
          </>
        )}
          <SettingItem title={t('settings.disableTray')} divider>
            <Switch
              size="sm"
              isSelected={disableTray}
              onValueChange={async (v) => {
                await patchAppConfig({ disableTray: v })
                if (v) {
                  closeTrayIcon()
                } else {
                  showTrayIcon()
                }
              }}
            />
          </SettingItem>
          {!disableTray && (
            <SettingItem title={t('settings.disableTrayIconColor')} divider>
              <Switch
                size="sm"
                isSelected={disableTrayIconColor}
                onValueChange={async (v) => {
                  await patchAppConfig({ disableTrayIconColor: v })
                  await updateTrayIcon()
                }}
              />
            </SettingItem>
          )}
        {platform !== 'linux' && (
          <>
            <SettingItem title={t('settings.proxyInTray')} divider>
              <Switch
                size="sm"
                isSelected={proxyInTray}
                onValueChange={async (v) => {
                  await patchAppConfig({ proxyInTray: v })
                }}
              />
            </SettingItem>
            <SettingItem
              title={t('settings.showTraffic', {
                context: platform === 'win32' ? 'windows' : 'mac'
              })}
              divider
            >
              <Switch
                size="sm"
                isSelected={showTraffic}
                onValueChange={async (v) => {
                  await patchAppConfig({ showTraffic: v })
                  await startMonitor()
                }}
              />
            </SettingItem>
          </>
        )}
        {platform === 'darwin' && (
          <>
            <SettingItem title={t('settings.showDockIcon')} divider>
              <Switch
                size="sm"
                isSelected={useDockIcon}
                onValueChange={async (v) => {
                  await patchAppConfig({ useDockIcon: v })
                }}
              />
            </SettingItem>
          </>
        )}

        <SettingItem title={t('settings.useWindowFrame')} divider>
          <Switch
            size="sm"
            isSelected={useWindowFrame}
            isDisabled={isRelaunching}
            onValueChange={debounce(async (v) => {
              if (isRelaunching) return
              setIsRelaunching(true)
              try {
                await patchAppConfig({ useWindowFrame: v })
                await relaunchApp()
              } catch (e) {
                alert(e)
                setIsRelaunching(false)
              }
            }, 1000)}
          />
        </SettingItem>
        <SettingItem title={t('settings.disableAnimations')} divider>
          <Switch
            size="sm"
            isSelected={disableAnimations}
            onValueChange={async (v) => {
              await patchAppConfig({ disableAnimations: v })
            }}
          />
        </SettingItem>
        <SettingItem
          title={t('settings.disableHardwareAcceleration')}
          actions={
            <Tooltip content={t('settings.disableHardwareAccelerationTooltip')}>
              <Button isIconOnly size="sm" variant="light">
                <IoIosHelpCircle className="text-lg" />
              </Button>
            </Tooltip>
          }
          divider
        >
          <Switch
            size="sm"
            isSelected={disableHardwareAcceleration}
            isDisabled={isRelaunching}
            onValueChange={(v) => {
              if (isRelaunching) return
              setPendingHardwareAccelValue(v)
              setShowHardwareAccelConfirm(true)
            }}
          />
        </SettingItem>
        <SettingItem title={t('settings.backgroundColor')} divider>
          <Tabs
            size="sm"
            color="primary"
            selectedKey={appTheme}
            onSelectionChange={(key) => {
              setTheme(key.toString())
              patchAppConfig({ appTheme: key as AppTheme })
            }}
          >
            <Tab key="system" title={t('settings.backgroundAuto')} />
            <Tab key="dark" title={t('settings.backgroundDark')} />
            <Tab key="light" title={t('settings.backgroundLight')} />
          </Tabs>
        </SettingItem>
        <SettingItem
          title={t('settings.theme')}
          actions={
            <>
              <Button
                size="sm"
                isLoading={fetching}
                isIconOnly
                title={t('settings.fetchTheme')}
                variant="light"
                onPress={async () => {
                  setFetching(true)
                  try {
                    await fetchThemes()
                    setCustomThemes(await resolveThemes())
                  } catch (e) {
                    alert(e)
                  } finally {
                    setFetching(false)
                  }
                }}
              >
                <IoMdCloudDownload className="text-lg" />
              </Button>
              <Button
                size="sm"
                isIconOnly
                title={t('settings.importTheme')}
                variant="light"
                onPress={async () => {
                  const files = await getFilePath(['css'])
                  if (!files) return
                  try {
                    await importThemes(files)
                    setCustomThemes(await resolveThemes())
                  } catch (e) {
                    alert(e)
                  }
                }}
              >
                <BiSolidFileImport className="text-lg" />
              </Button>
              <Button
                size="sm"
                isIconOnly
                title={t('settings.editTheme')}
                variant="light"
                onPress={async () => {
                  setOpenCSSEditor(true)
                }}
              >
                <MdEditDocument className="text-lg" />
              </Button>
            </>
          }
        >
          {customThemes && (
            <Select
              classNames={{ trigger: 'data-[hover=true]:bg-default-200' }}
              className="w-[60%]"
              size="sm"
              selectedKeys={new Set([customTheme])}
              aria-label={t('settings.selectTheme')}
              disallowEmptySelection={true}
              onSelectionChange={async (v) => {
                try {
                  await patchAppConfig({ customTheme: v.currentKey as string })
                } catch (e) {
                  alert(e)
                }
              }}
            >
              {customThemes.map((theme) => (
                <SelectItem key={theme.key}>{theme.label}</SelectItem>
              ))}
            </Select>
          )}
        </SettingItem>
      </SettingCard>
    </>
  )
}

export default GeneralConfig
