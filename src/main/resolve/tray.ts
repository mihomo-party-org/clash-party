import {
  changeCurrentProfile,
  getAppConfig,
  getControledMihomoConfig,
  getProfileConfig,
  patchAppConfig,
  patchControledMihomoConfig
} from '../config'
import icoIcon from '../../../resources/icon.ico?asset'
import icoIconBlue from '../../../resources/icon_blue.ico?asset'
import icoIconRed from '../../../resources/icon_red.ico?asset'
import icoIconGreen from '../../../resources/icon_green.ico?asset'
import pngIcon from '../../../resources/icon.png?asset'
import pngIconBlue from '../../../resources/icon_blue.png?asset'
import pngIconRed from '../../../resources/icon_red.png?asset'
import pngIconGreen from '../../../resources/icon_green.png?asset'
import templateIcon from '../../../resources/iconTemplate.png?asset'
import { mihomoChangeProxy, mihomoCloseAllConnections, mihomoGroups, patchMihomoConfig, getTrayIconStatus, calculateTrayIconStatus } from '../core/mihomoApi'
import { mainWindow, showMainWindow, triggerMainWindow } from '..'
import { app, clipboard, ipcMain, Menu, nativeImage, shell, Tray } from 'electron'
import { dataDir, logDir, mihomoCoreDir, mihomoWorkDir } from '../utils/dirs'
import { triggerSysProxy } from '../sys/sysproxy'
import { quitWithoutCore, restartCore, checkMihomoCorePermissions, requestTunPermissions, restartAsAdmin } from '../core/manager'
import { floatingWindow, triggerFloatingWindow } from './floatingWindow'
import { t } from 'i18next'
import { trayLogger } from '../utils/logger'

export let tray: Tray | null = null

export const buildContextMenu = async (): Promise<Menu> => {
  // 添加调试日志
  await trayLogger.debug('Current translation for tray.showWindow', t('tray.showWindow'))
  await trayLogger.debug('Current translation for tray.hideFloatingWindow', t('tray.hideFloatingWindow'))
  await trayLogger.debug('Current translation for tray.showFloatingWindow', t('tray.showFloatingWindow'))

  const { mode, tun } = await getControledMihomoConfig()
  const {
    sysProxy,
    envType = process.platform === 'win32' ? ['powershell'] : ['bash'],
    autoCloseConnection,
    proxyInTray = true,
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
      groupsMenu = groups.map((group) => {
        return {
          id: group.name,
          label: group.name,
          type: 'submenu',
          submenu: group.all.map((proxy) => {
            const delay = proxy.history.length ? proxy.history[proxy.history.length - 1].delay : -1
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
              type: 'radio',
              checked: proxy.name === group.now,
              click: async (): Promise<void> => {
                await mihomoChangeProxy(group.name, proxy.name)
                if (autoCloseConnection) {
                  await mihomoCloseAllConnections()
                }
              }
            }
          })
        }
      })
      groupsMenu.unshift({ type: 'separator' })
    } catch (e) {
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
      label: floatingWindow?.isVisible() ? t('tray.hideFloatingWindow') : t('tray.showFloatingWindow'),
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
        } catch (e) {
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
            }

            await patchControledMihomoConfig({ tun: { enable }, dns: { enable: true } })
          } else {
            await patchControledMihomoConfig({ tun: { enable } })
          }
          mainWindow?.webContents.send('controledMihomoConfigUpdated')
          floatingWindow?.webContents.send('controledMihomoConfigUpdated')
          await restartCore()
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
  const { useDockIcon = true } = await getAppConfig()
  if (process.platform === 'linux') {
    tray = new Tray(pngIcon)
    const menu = await buildContextMenu()
    tray.setContextMenu(menu)
  }
  if (process.platform === 'darwin') {
    const icon = nativeImage.createFromPath(templateIcon).resize({ height: 16 })
    icon.setTemplateImage(true)
    tray = new Tray(icon)
  }
  if (process.platform === 'win32') {
    tray = new Tray(icoIcon)
  }
  tray?.setToolTip('Clash Party')
  tray?.setIgnoreDoubleClickEvents(true)

  await updateTrayIcon()

  if (process.platform === 'darwin') {
    if (!useDockIcon) {
      hideDockIcon()
    }
    ipcMain.on('trayIconUpdate', async (_, png: string) => {
      const image = nativeImage.createFromDataURL(png).resize({ height: 16 })
      image.setTemplateImage(true)
      tray?.setImage(image)
    })
    tray?.addListener('right-click', async () => {
      triggerMainWindow()
    })
    tray?.addListener('click', async () => {
      await updateTrayMenu()
    })
  }
  if (process.platform === 'win32') {
    tray?.addListener('click', () => {
      triggerMainWindow()
    })
    tray?.addListener('right-click', async () => {
      await updateTrayMenu()
    })
  }
  if (process.platform === 'linux') {
    tray?.addListener('click', () => {
      triggerMainWindow()
    })
    ipcMain.on('updateTrayMenu', async () => {
      await updateTrayMenu()
    })
  }
}

async function updateTrayMenu(): Promise<void> {
  const menu = await buildContextMenu()
  tray?.popUpContextMenu(menu) // 弹出菜单
  if (process.platform === 'linux') {
    tray?.setContextMenu(menu)
  }
}

export async function copyEnv(type: 'bash' | 'cmd' | 'powershell'): Promise<void> {
  const { 'mixed-port': mixedPort = 7890 } = await getControledMihomoConfig()
  const { sysProxy } = await getAppConfig()
  const { host } = sysProxy
  switch (type) {
    case 'bash': {
      clipboard.writeText(
        `export https_proxy=http://${host || '127.0.0.1'}:${mixedPort} http_proxy=http://${host || '127.0.0.1'}:${mixedPort} all_proxy=http://${host || '127.0.0.1'}:${mixedPort}`
      )
      break
    }
    case 'cmd': {
      clipboard.writeText(
        `set http_proxy=http://${host || '127.0.0.1'}:${mixedPort}\r\nset https_proxy=http://${host || '127.0.0.1'}:${mixedPort}`
      )
      break
    }
    case 'powershell': {
      clipboard.writeText(
        `$env:HTTP_PROXY="http://${host || '127.0.0.1'}:${mixedPort}"; $env:HTTPS_PROXY="http://${host || '127.0.0.1'}:${mixedPort}"`
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

const getIconPaths = () => {
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

export function updateTrayIconImmediate(sysProxyEnabled: boolean, tunEnabled: boolean): void {
  if (!tray) return

  const status = calculateTrayIconStatus(sysProxyEnabled, tunEnabled)
  const iconPaths = getIconPaths()
  
  getAppConfig().then(({ disableTrayIconColor = false }) => {
    if (!tray) return
    const iconPath = disableTrayIconColor ? iconPaths.white : iconPaths[status]
    try {
      if (process.platform === 'darwin') {
        const icon = nativeImage.createFromPath(iconPath).resize({ height: 16 })
        tray.setImage(icon)
      } else if (process.platform === 'win32') {
        tray.setImage(iconPath)
      } else if (process.platform === 'linux') {
        tray.setImage(iconPath)
      }
    } catch (error) {
      console.error('更新托盘图标失败:', error)
    }
  })
}

export async function updateTrayIcon(): Promise<void> {
  if (!tray) return

  const { disableTrayIconColor = false } = await getAppConfig()
  const status = await getTrayIconStatus()
  const iconPaths = getIconPaths()
  const iconPath = disableTrayIconColor ? iconPaths.white : iconPaths[status]

  try {
    if (process.platform === 'darwin') {
      const icon = nativeImage.createFromPath(iconPath).resize({ height: 16 })
      tray.setImage(icon)
    } else if (process.platform === 'win32') {
      tray.setImage(iconPath)
    } else if (process.platform === 'linux') {
      tray.setImage(iconPath)
    }
  } catch (error) {
    console.error('更新托盘图标失败:', error)
  }
}