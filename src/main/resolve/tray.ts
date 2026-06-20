import { existsSync } from 'fs'
import { extname } from 'path'
import { app, clipboard, ipcMain, Menu, nativeImage, shell, Tray } from 'electron'
import { t } from 'i18next'
import {
  changeCurrentProfile,
  getAppConfig,
  getControledMihomoConfig,
  getProfileConfig,
  patchAppConfig,
  patchControledMihomoConfig
} from '../config'
import { DEFAULT_MIHOMO_PORTS } from '../../shared/appConfig'
import icoIcon from '../../../resources/icon.ico?asset'
import icoIconBlue from '../../../resources/icon_blue.ico?asset'
import icoIconRed from '../../../resources/icon_red.ico?asset'
import icoIconGreen from '../../../resources/icon_green.ico?asset'
import pngIcon from '../../../resources/icon.png?asset'
import pngIconBlue from '../../../resources/icon_blue.png?asset'
import pngIconRed from '../../../resources/icon_red.png?asset'
import pngIconGreen from '../../../resources/icon_green.png?asset'
import templateIcon from '../../../resources/iconTemplate.png?asset'
import {
  mihomoChangeProxy,
  mihomoCloseAllConnections,
  mihomoGroupDelay,
  mihomoGroups,
  patchMihomoConfig,
  getTrayIconStatus,
  calculateTrayIconStatus
} from '../core/mihomoApi'
import { mainWindow, showMainWindow, triggerMainWindow } from '../window'
import { dataDir, logDir, mihomoCoreDir, mihomoWorkDir } from '../utils/dirs'
import { triggerSysProxy } from '../sys/sysproxy'
import {
  quitWithoutCore,
  checkMihomoCorePermissions,
  requestTunPermissions,
  restartAsAdmin
} from '../core/manager'
import { trayLogger } from '../utils/logger'
import { floatingWindow, triggerFloatingWindow } from './floatingWindow'

export let tray: Tray | null = null
let trayMenu: Menu | null = null
// macOS 流量显示状态，避免异步读取配置导致的时序问题
let macTrafficIconEnabled = false
type TrayIconStatus = 'white' | 'blue' | 'green' | 'red'
type TrayImage = Electron.NativeImage | string
const customTrayIconSize = 16
const customTrayIconScaleFactors = [1, 1.25, 1.5, 2, 2.5, 3]

export const buildContextMenu = async (): Promise<Menu> => {
  // 添加调试日志
  await trayLogger.debug('Current translation for tray.showWindow', t('tray.showWindow'))
  await trayLogger.debug(
    'Current translation for tray.hideFloatingWindow',
    t('tray.hideFloatingWindow')
  )
  await trayLogger.debug(
    'Current translation for tray.showFloatingWindow',
    t('tray.showFloatingWindow')
  )

  const { mode, tun } = await getControledMihomoConfig()
  const {
    sysProxy,
    envType = process.platform === 'win32' ? ['powershell'] : ['bash'],
    autoCloseConnection,
    proxyInTray = true,
    showCurrentProxyInTray = false,
    trayProxyGroupStyle = 'default',
    triggerSysProxyShortcut = '',
    showFloatingWindowShortcut = '',
    showWindowShortcut = '',
    triggerTunShortcut = '',
    ruleModeShortcut = '',
    globalModeShortcut = '',
    directModeShortcut = '',
    quitWithoutCoreShortcut = '',
    restartAppShortcut = ''
  } = await getAppConfig()
  let groupsMenu: Electron.MenuItemConstructorOptions[] = []
  if (proxyInTray && process.platform !== 'linux') {
    try {
      const groups = await mihomoGroups()
      const groupItems: Electron.MenuItemConstructorOptions[] = groups.map((group) => {
        const groupLabel = showCurrentProxyInTray ? `${group.name} | ${group.now}` : group.name

        return {
          id: group.name,
          label: groupLabel,
          type: 'submenu' as const,
          submenu: [
            {
              id: `${group.name}-delay-test`,
              label: t('tray.delayTest'),
              type: 'normal' as const,
              click: async (): Promise<void> => {
                try {
                  await mihomoGroupDelay(group.name, group.testUrl)
                  mainWindow?.webContents.send('groupsUpdated')
                } catch (error) {
                  await trayLogger.error(`Failed to test proxy group delay: ${group.name}`, error)
                }
              }
            },
            { type: 'separator' as const },
            ...group.all.map((proxy) => {
              const delay = proxy.history.length
                ? proxy.history[proxy.history.length - 1].delay
                : -1
              let displayDelay = `(${delay}ms)`
              if (delay === -1) {
                displayDelay = ''
              }
              if (delay === 0) {
                displayDelay = '(Timeout)'
              }
              return {
                id: proxy.name,
                label: `${proxy.name}   ${displayDelay}`,
                type: 'radio' as const,
                checked: proxy.name === group.now,
                click: async (): Promise<void> => {
                  await mihomoChangeProxy(group.name, proxy.name)
                  if (autoCloseConnection) {
                    await mihomoCloseAllConnections()
                  }
                }
              }
            })
          ]
        }
      })

      if (trayProxyGroupStyle === 'submenu') {
        groupsMenu = [
          { type: 'separator' },
          {
            id: 'proxy-groups',
            label: t('tray.proxyGroups'),
            type: 'submenu',
            submenu: groupItems
          }
        ]
      } else {
        groupsMenu = groupItems
        groupsMenu.unshift({ type: 'separator' })
      }
    } catch {
      // ignore
      // 避免出错时无法创建托盘菜单
    }
  }
  const { current, items = [] } = await getProfileConfig()

  const contextMenu = [
    {
      id: 'show',
      accelerator: showWindowShortcut,
      label: t('tray.showWindow'),
      type: 'normal',
      click: (): void => {
        showMainWindow()
      }
    },
    {
      id: 'show-floating',
      accelerator: showFloatingWindowShortcut,
      label: floatingWindow?.isVisible()
        ? t('tray.hideFloatingWindow')
        : t('tray.showFloatingWindow'),
      type: 'normal',
      click: async (): Promise<void> => {
        await triggerFloatingWindow()
      }
    },
    {
      id: 'rule',
      label: t('tray.ruleMode'),
      accelerator: ruleModeShortcut,
      type: 'radio',
      checked: mode === 'rule',
      click: async (): Promise<void> => {
        await patchControledMihomoConfig({ mode: 'rule' })
        await patchMihomoConfig({ mode: 'rule' })
        mainWindow?.webContents.send('controledMihomoConfigUpdated')
        mainWindow?.webContents.send('groupsUpdated')
        ipcMain.emit('updateTrayMenu')
        await updateTrayIcon()
      }
    },
    {
      id: 'global',
      label: t('tray.globalMode'),
      accelerator: globalModeShortcut,
      type: 'radio',
      checked: mode === 'global',
      click: async (): Promise<void> => {
        await patchControledMihomoConfig({ mode: 'global' })
        await patchMihomoConfig({ mode: 'global' })
        mainWindow?.webContents.send('controledMihomoConfigUpdated')
        mainWindow?.webContents.send('groupsUpdated')
        ipcMain.emit('updateTrayMenu')
        await updateTrayIcon()
      }
    },
    {
      id: 'direct',
      label: t('tray.directMode'),
      accelerator: directModeShortcut,
      type: 'radio',
      checked: mode === 'direct',
      click: async (): Promise<void> => {
        await patchControledMihomoConfig({ mode: 'direct' })
        await patchMihomoConfig({ mode: 'direct' })
        mainWindow?.webContents.send('controledMihomoConfigUpdated')
        mainWindow?.webContents.send('groupsUpdated')
        ipcMain.emit('updateTrayMenu')
        await updateTrayIcon()
      }
    },
    { type: 'separator' },
    {
      type: 'checkbox',
      label: t('tray.systemProxy'),
      accelerator: triggerSysProxyShortcut,
      checked: sysProxy.enable,
      click: async (item): Promise<void> => {
        const enable = item.checked
        try {
          await triggerSysProxy(enable)
          await patchAppConfig({ sysProxy: { enable } })
          mainWindow?.webContents.send('appConfigUpdated')
          floatingWindow?.webContents.send('appConfigUpdated')
        } catch {
          // ignore
        } finally {
          ipcMain.emit('updateTrayMenu')
          await updateTrayIcon()
        }
      }
    },
    {
      type: 'checkbox',
      label: t('tray.tun'),
      accelerator: triggerTunShortcut,
      checked: tun?.enable ?? false,
      click: async (item): Promise<void> => {
        const enable = item.checked
        try {
          if (enable) {
            // 检查权限
            try {
              const hasPermissions = await checkMihomoCorePermissions()

              if (!hasPermissions) {
                if (process.platform === 'win32') {
                  try {
                    await restartAsAdmin()
                    return
                  } catch (error) {
                    await trayLogger.error('Failed to restart as admin from tray', error)
                    item.checked = false
                    ipcMain.emit('updateTrayMenu')
                    return
                  }
                } else {
                  try {
                    await requestTunPermissions()
                  } catch (error) {
                    await trayLogger.error('Failed to grant TUN permissions from tray', error)
                    item.checked = false
                    ipcMain.emit('updateTrayMenu')
                    return
                  }
                }
              }
            } catch (error) {
              await trayLogger.warn('Permission check failed in tray', error)
              item.checked = false
              ipcMain.emit('updateTrayMenu')
              return
            }

            await patchControledMihomoConfig({ tun: { enable }, dns: { enable: true } })
          } else {
            await patchControledMihomoConfig({ tun: { enable } })
          }
          mainWindow?.webContents.send('controledMihomoConfigUpdated')
          floatingWindow?.webContents.send('controledMihomoConfigUpdated')
        } catch {
          // ignore
        } finally {
          ipcMain.emit('updateTrayMenu')
          await updateTrayIcon()
        }
      }
    },
    ...groupsMenu,
    { type: 'separator' },
    {
      type: 'submenu',
      label: t('tray.profiles'),
      submenu: items.map((item) => {
        return {
          type: 'radio',
          label: item.name,
          checked: item.id === current,
          click: async (): Promise<void> => {
            if (item.id === current) return
            await changeCurrentProfile(item.id)
            mainWindow?.webContents.send('profileConfigUpdated')
            ipcMain.emit('updateTrayMenu')
            await updateTrayIcon()
          }
        }
      })
    },
    { type: 'separator' },
    {
      type: 'submenu',
      label: t('tray.openDirectories.title'),
      submenu: [
        {
          type: 'normal',
          label: t('tray.openDirectories.appDir'),
          click: (): Promise<string> => shell.openPath(dataDir())
        },
        {
          type: 'normal',
          label: t('tray.openDirectories.workDir'),
          click: (): Promise<string> => shell.openPath(mihomoWorkDir())
        },
        {
          type: 'normal',
          label: t('tray.openDirectories.coreDir'),
          click: (): Promise<string> => shell.openPath(mihomoCoreDir())
        },
        {
          type: 'normal',
          label: t('tray.openDirectories.logDir'),
          click: (): Promise<string> => shell.openPath(logDir())
        }
      ]
    },
    envType.length > 1
      ? {
          type: 'submenu',
          label: t('tray.copyEnv'),
          submenu: envType.map((type) => {
            return {
              id: type,
              label: type,
              type: 'normal',
              click: async (): Promise<void> => {
                await copyEnv(type)
              }
            }
          })
        }
      : {
          id: 'copyenv',
          label: t('tray.copyEnv'),
          type: 'normal',
          click: async (): Promise<void> => {
            await copyEnv(envType[0])
          }
        },
    { type: 'separator' },
    {
      id: 'quitWithoutCore',
      label: t('actions.lightMode.button'),
      type: 'normal',
      accelerator: quitWithoutCoreShortcut,
      click: quitWithoutCore
    },
    {
      id: 'restart',
      label: t('actions.restartApp'),
      type: 'normal',
      accelerator: restartAppShortcut,
      click: (): void => {
        app.relaunch()
        app.quit()
      }
    },
    {
      id: 'quit',
      label: t('actions.quit.button'),
      type: 'normal',
      accelerator: 'CommandOrControl+Q',
      click: (): void => app.quit()
    }
  ] as Electron.MenuItemConstructorOptions[]
  return Menu.buildFromTemplate(contextMenu)
}

export async function createTray(): Promise<void> {
  const { useDockIcon = true, swapTrayClick = false } = await getAppConfig()
  if (process.platform === 'linux') {
    tray = new Tray(pngIcon)
    trayMenu = await buildContextMenu()
    tray.setContextMenu(trayMenu)
  }
  if (process.platform === 'darwin') {
    const icon = nativeImage.createFromPath(templateIcon).resize({ height: 16 })
    icon.setTemplateImage(true)
    tray = new Tray(icon)
  }
  if (process.platform === 'win32') {
    tray = new Tray(icoIcon)
  }
  await updateTrayToolTip()
  tray?.setIgnoreDoubleClickEvents(true)

  await updateTrayIcon()

  if (process.platform === 'darwin') {
    if (!useDockIcon) {
      hideDockIcon()
    }
    // 移除旧监听器防止累积
    ipcMain.removeAllListeners('trayIconUpdate')
    ipcMain.on('trayIconUpdate', async (_, png: string, enabled: boolean) => {
      macTrafficIconEnabled = enabled
      const { customTrayIcon = '' } = await getAppConfig()
      const customIcon = createCustomTrayImage(customTrayIcon)
      if (customIcon) {
        tray?.setImage(customIcon)
        await updateTrayToolTip(undefined, undefined, true)
        return
      }
      const image = nativeImage.createFromDataURL(png).resize({ height: 16 })
      image.setTemplateImage(true)
      tray?.setImage(image)
      await updateTrayToolTip(undefined, undefined, false)
    })
    // macOS 默认行为：左键显示窗口，右键显示菜单
    tray?.addListener('click', async () => {
      if (swapTrayClick) {
        await updateTrayMenu()
      } else {
        triggerMainWindow()
      }
    })
    tray?.addListener('right-click', async () => {
      if (swapTrayClick) {
        triggerMainWindow()
      } else {
        await updateTrayMenu()
      }
    })
  }
  if (process.platform === 'win32') {
    tray?.addListener('click', async () => {
      if (swapTrayClick) {
        await updateTrayMenu()
      } else {
        triggerMainWindow()
      }
    })
    tray?.addListener('right-click', async () => {
      if (swapTrayClick) {
        triggerMainWindow()
      } else {
        await updateTrayMenu()
      }
    })
  }
  if (process.platform === 'linux') {
    tray?.addListener('click', async () => {
      if (swapTrayClick) {
        await updateTrayMenu()
      } else {
        triggerMainWindow()
      }
    })
    // 移除旧监听器防止累积
    ipcMain.removeAllListeners('updateTrayMenu')
    ipcMain.on('updateTrayMenu', async () => {
      await updateTrayMenu()
    })
  }
}

async function updateTrayMenu(): Promise<void> {
  trayMenu = await buildContextMenu()
  tray?.popUpContextMenu(trayMenu) // 弹出菜单
  if (process.platform === 'linux') {
    tray?.setContextMenu(trayMenu)
  }
}

export async function copyEnv(
  type: 'bash' | 'cmd' | 'powershell' | 'fish' | 'nushell'
): Promise<void> {
  const { 'mixed-port': mixedPort = DEFAULT_MIHOMO_PORTS.mixed } = await getControledMihomoConfig()
  const { sysProxy } = await getAppConfig()
  const { host } = sysProxy
  const proxyUrl = `http://${host || '127.0.0.1'}:${mixedPort}`

  switch (type) {
    case 'bash': {
      clipboard.writeText(
        `export https_proxy=${proxyUrl} http_proxy=${proxyUrl} all_proxy=${proxyUrl}`
      )
      break
    }
    case 'cmd': {
      clipboard.writeText(`set http_proxy=${proxyUrl}\r\nset https_proxy=${proxyUrl}`)
      break
    }
    case 'powershell': {
      clipboard.writeText(`$env:HTTP_PROXY="${proxyUrl}"; $env:HTTPS_PROXY="${proxyUrl}"`)
      break
    }
    case 'fish': {
      clipboard.writeText(
        `set -x http_proxy ${proxyUrl}; set -x https_proxy ${proxyUrl}; set -x all_proxy ${proxyUrl}`
      )
      break
    }
    case 'nushell': {
      clipboard.writeText(
        `$env.HTTP_PROXY = "${proxyUrl}"; $env.HTTPS_PROXY = "${proxyUrl}"; $env.ALL_PROXY = "${proxyUrl}"`
      )
      break
    }
  }
}

export async function showTrayIcon(): Promise<void> {
  if (!tray) {
    await createTray()
  }
}

export async function closeTrayIcon(): Promise<void> {
  if (tray) {
    tray.destroy()
  }
  tray = null
  trayMenu = null
}

export async function showDockIcon(): Promise<void> {
  if (process.platform === 'darwin' && app.dock && !app.dock.isVisible()) {
    await app.dock.show()
  }
}

export async function hideDockIcon(): Promise<void> {
  if (process.platform === 'darwin' && app.dock && app.dock.isVisible()) {
    app.dock.hide()
  }
}

const getIconPaths = (): Record<TrayIconStatus, string> => {
  if (process.platform === 'win32') {
    return {
      white: icoIcon,
      blue: icoIconBlue,
      green: icoIconGreen,
      red: icoIconRed
    }
  } else {
    return {
      white: pngIcon,
      blue: pngIconBlue,
      green: pngIconGreen,
      red: pngIconRed
    }
  }
}

function resizeTrayImageForScale(
  icon: Electron.NativeImage,
  scaleFactor: number
): Electron.NativeImage {
  const targetHeight = Math.round(customTrayIconSize * scaleFactor)

  return icon.resize({ height: targetHeight, quality: 'best' })
}

function createMultiScaleTrayImage(icon: Electron.NativeImage): Electron.NativeImage {
  const trayImage = nativeImage.createEmpty()

  for (const scaleFactor of customTrayIconScaleFactors) {
    const resizedIcon = resizeTrayImageForScale(icon, scaleFactor)
    if (resizedIcon.isEmpty()) continue

    trayImage.addRepresentation({
      scaleFactor,
      buffer: resizedIcon.toPNG()
    })
  }

  if (!trayImage.isEmpty()) return trayImage

  return resizeTrayImageForScale(icon, 1)
}

function createCustomTrayImage(customTrayIcon: string): TrayImage | null {
  if (!customTrayIcon) return null

  if (customTrayIcon.startsWith('data:image/')) {
    const icon = nativeImage.createFromDataURL(customTrayIcon)
    if (icon.isEmpty()) return null

    return createMultiScaleTrayImage(icon)
  }

  if (!existsSync(customTrayIcon)) return null

  const icon = nativeImage.createFromPath(customTrayIcon)
  if (icon.isEmpty()) return null

  const iconExt = extname(customTrayIcon).toLowerCase()
  if (process.platform === 'win32' && iconExt === '.ico') {
    return customTrayIcon
  }
  if (process.platform === 'linux') {
    return customTrayIcon
  }

  return createMultiScaleTrayImage(icon)
}

async function updateTrayToolTip(
  sysProxyEnabled?: boolean,
  tunEnabled?: boolean,
  customIconEnabled?: boolean
): Promise<void> {
  if (!tray) return

  const [{ mode, tun }, appConfig] = await Promise.all([getControledMihomoConfig(), getAppConfig()])
  const sysProxy = sysProxyEnabled ?? appConfig.sysProxy.enable
  const tunStatus = tunEnabled ?? tun?.enable === true
  const isCustomIcon = customIconEnabled ?? Boolean(appConfig.customTrayIcon)

  const modeLabel =
    mode === 'global'
      ? t('tray.globalMode')
      : mode === 'direct'
        ? t('tray.directMode')
        : t('tray.ruleMode')
  const status = [
    `${t('tray.tooltip.mode')}: ${modeLabel}`,
    `${t('tray.systemProxy')}: ${sysProxy ? t('tray.tooltip.enabled') : t('tray.tooltip.disabled')}`,
    `${t('tray.tun')}: ${tunStatus ? t('tray.tooltip.enabled') : t('tray.tooltip.disabled')}`
  ]

  if (isCustomIcon) {
    status.push(t('tray.tooltip.customIcon'))
  }

  tray.setToolTip(['Clash Party', ...status].join('\n'))
}

function setTrayImage(iconPath: string): void {
  if (!tray) return

  if (process.platform === 'darwin') {
    const icon = nativeImage.createFromPath(iconPath).resize({ height: 16 })
    tray.setImage(icon)
  } else if (process.platform === 'win32') {
    tray.setImage(iconPath)
  } else if (process.platform === 'linux') {
    tray.setImage(iconPath)
  }
}

export function updateTrayIconImmediate(sysProxyEnabled: boolean, tunEnabled: boolean): void {
  if (!tray) return

  const status = calculateTrayIconStatus(sysProxyEnabled, tunEnabled)
  const iconPaths = getIconPaths()

  getAppConfig().then(async ({ disableTrayIconColor = false, customTrayIcon = '' }) => {
    if (!tray) return
    try {
      const customIcon = createCustomTrayImage(customTrayIcon)
      if (customIcon) {
        tray.setImage(customIcon)
        await updateTrayToolTip(sysProxyEnabled, tunEnabled, true)
        return
      }
      // macOS 流量显示开启时，由 trayIconUpdate 负责图标更新
      if (process.platform === 'darwin' && macTrafficIconEnabled) {
        await updateTrayToolTip(sysProxyEnabled, tunEnabled, false)
        return
      }
      const iconPath = disableTrayIconColor ? iconPaths.white : iconPaths[status]
      setTrayImage(iconPath)
      await updateTrayToolTip(sysProxyEnabled, tunEnabled, false)
    } catch {
      // Failed to update tray icon
    }
  })
}

export async function updateTrayIcon(): Promise<void> {
  if (!tray) return

  const { disableTrayIconColor = false, customTrayIcon = '' } = await getAppConfig()
  const status = await getTrayIconStatus()
  const iconPaths = getIconPaths()

  try {
    const customIcon = createCustomTrayImage(customTrayIcon)
    if (customIcon) {
      tray.setImage(customIcon)
      await updateTrayToolTip(undefined, undefined, true)
      return
    }
    // macOS 流量显示开启时，由 trayIconUpdate 负责图标更新
    if (process.platform === 'darwin' && macTrafficIconEnabled) {
      await updateTrayToolTip(undefined, undefined, false)
      return
    }
    const iconPath = disableTrayIconColor ? iconPaths.white : iconPaths[status]
    setTrayImage(iconPath)
    await updateTrayToolTip(undefined, undefined, false)
  } catch {
    // Failed to update tray icon
  }
}
