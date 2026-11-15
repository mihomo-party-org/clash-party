import { app, globalShortcut, ipcMain, Notification } from 'electron'
import { mainWindow, triggerMainWindow } from '../window'
import {
  getAppConfig,
  getControledMihomoConfig,
  patchAppConfig,
  patchControledMihomoConfig
} from '../config'
import { triggerSysProxy } from '../sys/sysproxy'
import { quitWithoutCore, triggerProxy } from '../core/manager'
import i18next from '../../shared/i18n'
import { floatingWindow, triggerFloatingWindow } from './floatingWindow'
import { copyEnv, updateTrayIcon } from './tray'

export async function registerShortcut(
  oldShortcut: string,
  newShortcut: string,
  action: string
): Promise<boolean> {
  if (oldShortcut !== '') {
    globalShortcut.unregister(oldShortcut)
  }
  if (newShortcut === '') {
    return true
  }
  switch (action) {
    case 'showWindowShortcut': {
      return globalShortcut.register(newShortcut, () => {
        triggerMainWindow(true)
      })
    }
    case 'showFloatingWindowShortcut': {
      return globalShortcut.register(newShortcut, async () => {
        await triggerFloatingWindow()
      })
    }
    case 'triggerSysProxyShortcut': {
      return globalShortcut.register(newShortcut, async () => {
        const {
          proxyRunning = false,
          sysProxy: { enable }
        } = await getAppConfig()
        const nextEnable = !enable
        try {
          if (proxyRunning) {
            await triggerSysProxy(nextEnable)
          }
          await patchAppConfig({ sysProxy: { enable: nextEnable } })
          new Notification({
            title: i18next.t(
              nextEnable
                ? 'common.notification.systemProxyEnabled'
                : 'common.notification.systemProxyDisabled'
            )
          }).show()
          mainWindow?.webContents.send('appConfigUpdated')
          floatingWindow?.webContents.send('appConfigUpdated')
          if (proxyRunning && !nextEnable) {
            const { tun } = await getControledMihomoConfig()
            if (!tun?.enable) {
              await triggerProxy(false)
            }
          }
        } catch {
          // ignore
        } finally {
          ipcMain.emit('updateTrayMenu')
          await updateTrayIcon()
        }
      })
    }
    case 'triggerTunShortcut': {
      return globalShortcut.register(newShortcut, async () => {
        const [{ proxyRunning = false, sysProxy }, { tun }] = await Promise.all([
          getAppConfig(),
          getControledMihomoConfig()
        ])
        const enable = tun?.enable ?? false
        const nextEnable = !enable
        try {
          if (nextEnable) {
            await patchControledMihomoConfig({ tun: { enable: nextEnable }, dns: { enable: true } })
          } else {
            await patchControledMihomoConfig({ tun: { enable: nextEnable } })
          }
          new Notification({
            title: i18next.t(
              nextEnable ? 'common.notification.tunEnabled' : 'common.notification.tunDisabled'
            )
          }).show()
          mainWindow?.webContents.send('controledMihomoConfigUpdated')
          floatingWindow?.webContents.send('controledMihomoConfigUpdated')
          if (proxyRunning && !nextEnable && !sysProxy?.enable) {
            await triggerProxy(false)
          }
        } catch {
          // ignore
        } finally {
          ipcMain.emit('updateTrayMenu')
          await updateTrayIcon()
        }
      })
    }
    case 'ruleModeShortcut': {
      return globalShortcut.register(newShortcut, async () => {
        await patchControledMihomoConfig({ mode: 'rule' })
        new Notification({
          title: i18next.t('common.notification.ruleMode')
        }).show()
        mainWindow?.webContents.send('controledMihomoConfigUpdated')
        ipcMain.emit('updateTrayMenu')
        await updateTrayIcon()
      })
    }
    case 'globalModeShortcut': {
      return globalShortcut.register(newShortcut, async () => {
        await patchControledMihomoConfig({ mode: 'global' })
        new Notification({
          title: i18next.t('common.notification.globalMode')
        }).show()
        mainWindow?.webContents.send('controledMihomoConfigUpdated')
        ipcMain.emit('updateTrayMenu')
        await updateTrayIcon()
      })
    }
    case 'directModeShortcut': {
      return globalShortcut.register(newShortcut, async () => {
        await patchControledMihomoConfig({ mode: 'direct' })
        new Notification({
          title: i18next.t('common.notification.directMode')
        }).show()
        mainWindow?.webContents.send('controledMihomoConfigUpdated')
        ipcMain.emit('updateTrayMenu')
        await updateTrayIcon()
      })
    }
    case 'quitWithoutCoreShortcut': {
      return globalShortcut.register(newShortcut, async () => {
        await quitWithoutCore()
      })
    }
    case 'restartAppShortcut': {
      return globalShortcut.register(newShortcut, () => {
        app.relaunch()
        app.quit()
      })
    }
    case 'copyEnvShortcut': {
      return globalShortcut.register(newShortcut, async () => {
        const shellType = process.platform === 'win32' ? 'powershell' : 'bash'
        await copyEnv(shellType)
        new Notification({
          title: i18next.t('common.notification.copyEnvSuccess')
        }).show()
      })
    }
  }
  throw new Error('Unknown action')
}

export async function initShortcut(): Promise<void> {
  const {
    showFloatingWindowShortcut,
    showWindowShortcut,
    triggerSysProxyShortcut,
    triggerTunShortcut,
    ruleModeShortcut,
    globalModeShortcut,
    directModeShortcut,
    quitWithoutCoreShortcut,
    restartAppShortcut,
    copyEnvShortcut
  } = await getAppConfig()
  if (showWindowShortcut) {
    try {
      await registerShortcut('', showWindowShortcut, 'showWindowShortcut')
    } catch {
      // ignore
    }
  }
  if (showFloatingWindowShortcut) {
    try {
      await registerShortcut('', showFloatingWindowShortcut, 'showFloatingWindowShortcut')
    } catch {
      // ignore
    }
  }
  if (triggerSysProxyShortcut) {
    try {
      await registerShortcut('', triggerSysProxyShortcut, 'triggerSysProxyShortcut')
    } catch {
      // ignore
    }
  }
  if (triggerTunShortcut) {
    try {
      await registerShortcut('', triggerTunShortcut, 'triggerTunShortcut')
    } catch {
      // ignore
    }
  }
  if (ruleModeShortcut) {
    try {
      await registerShortcut('', ruleModeShortcut, 'ruleModeShortcut')
    } catch {
      // ignore
    }
  }
  if (globalModeShortcut) {
    try {
      await registerShortcut('', globalModeShortcut, 'globalModeShortcut')
    } catch {
      // ignore
    }
  }
  if (directModeShortcut) {
    try {
      await registerShortcut('', directModeShortcut, 'directModeShortcut')
    } catch {
      // ignore
    }
  }
  if (quitWithoutCoreShortcut) {
    try {
      await registerShortcut('', quitWithoutCoreShortcut, 'quitWithoutCoreShortcut')
    } catch {
      // ignore
    }
  }
  if (restartAppShortcut) {
    try {
      await registerShortcut('', restartAppShortcut, 'restartAppShortcut')
    } catch {
      // ignore
    }
  }
  if (copyEnvShortcut) {
    try {
      await registerShortcut('', copyEnvShortcut, 'copyEnvShortcut')
    } catch {
      // ignore
    }
  }
}
