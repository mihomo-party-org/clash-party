import { execFileSync, execSync } from 'child_process'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { app, dialog } from 'electron'
import i18next from 'i18next'
import { initI18n } from '../shared/i18n'
import { registerIpcMainHandlers } from './utils/ipc'
import { getAppConfig, patchAppConfig } from './config'
import {
  startCore,
  checkAdminRestartForTun,
  checkHighPrivilegeCore,
  restartAsAdmin,
  initAdminStatus,
  checkAdminPrivileges,
  initCoreWatcher
} from './core/manager'
import { createTray } from './resolve/tray'
import { init, initBasic, safeShowErrorBox, startSubStoreServices } from './utils/init'
import { initShortcut } from './resolve/shortcut'
import { initProfileUpdater } from './core/profileUpdater'
import { startMonitor } from './resolve/trafficMonitor'
import { showFloatingWindow } from './resolve/floatingWindow'
import { logger, createLogger } from './utils/logger'
import { initWebdavBackupScheduler } from './resolve/backup'
import {
  createWindow,
  mainWindow,
  showMainWindow,
  triggerMainWindow,
  closeMainWindow
} from './window'
import { handleDeepLink } from './deeplink'
import {
  fixUserDataPermissions,
  setupPlatformSpecifics,
  setupAppLifecycle,
  getSystemLanguage
} from './lifecycle'
import { configurePortableUserData } from './utils/dirs'
import { repairAutoRun } from './sys/autoRun'

function getWindowsPowerShellMajorVersion(): number | null {
  const registryKeys = [
    'HKLM\\SOFTWARE\\Microsoft\\PowerShell\\3\\PowerShellEngine',
    'HKLM\\SOFTWARE\\Microsoft\\PowerShell\\1\\PowerShellEngine'
  ]

  for (const key of registryKeys) {
    try {
      const stdout = execFileSync('reg', ['query', key, '/v', 'PowerShellVersion'], {
        encoding: 'utf8',
        timeout: 800
      })
      const version = stdout.match(/PowerShellVersion\s+REG_\w+\s+([^\s]+)/)?.[1]
      const major = version ? parseInt(version.split('.')[0], 10) : NaN
      if (!isNaN(major)) return major
    } catch {
      // try next registry key
    }
  }

  return null
}

// PowerShell 版本过低必须在 app 启动前提示并退出，因此保持同步执行
if (process.platform === 'win32') {
  try {
    const major = getWindowsPowerShellMajorVersion()
    if (major !== null && major < 5) {
      const isZh = Intl.DateTimeFormat().resolvedOptions().locale?.startsWith('zh')
      const title = isZh ? '需要更新 PowerShell' : 'PowerShell Update Required'
      const message = isZh
        ? `检测到您的 PowerShell 版本为 ${major}.x，部分功能需要 PowerShell 5.1 才能正常运行。\\n\\n请访问 Microsoft 官网下载并安装 Windows Management Framework 5.1。`
        : `Detected PowerShell version ${major}.x. Some features require PowerShell 5.1.\\n\\nPlease install Windows Management Framework 5.1 from the Microsoft website.`
      execSync(
        `mshta "javascript:var sh=new ActiveXObject('WScript.Shell');sh.Popup('${message}',0,'${title}',48);close()"`,
        { timeout: 60000 }
      )
      process.exit(0)
    }
  } catch {
    // ignore
  }
}

configurePortableUserData()

const mainLogger = createLogger('Main')

// 收敛旧版本可能同时留下的计划任务和注册表启动项
void repairAutoRun().catch((error) => mainLogger.warn('Failed to repair auto-run entries', error))

export { mainWindow, showMainWindow, triggerMainWindow, closeMainWindow }

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
}

async function initApp(): Promise<void> {
  await fixUserDataPermissions()
}

initApp().catch((e) => {
  safeShowErrorBox('common.error.initFailed', `${e}`)
  app.quit()
})

setupPlatformSpecifics()

async function initHardwareAcceleration(): Promise<void> {
  try {
    await initBasic()
    const { disableHardwareAcceleration = false } = await getAppConfig()
    if (disableHardwareAcceleration) {
      app.disableHardwareAcceleration()
    }
  } catch (e) {
    mainLogger.warn('Failed to read hardware acceleration config', e)
  }
}

initHardwareAcceleration()
setupAppLifecycle()

app.on('second-instance', async (_event, commandline) => {
  showMainWindow()
  const url = commandline.pop()
  if (url) {
    await handleDeepLink(url)
  }
})

app.on('open-url', async (_event, url) => {
  showMainWindow()
  await handleDeepLink(url)
})

const initPromise = (async () => {
  await initBasic()

  const adminPromise: Promise<boolean> =
    process.platform === 'win32' ? checkAdminPrivileges().catch(() => false) : Promise.resolve(true)

  const appConfigPromise = (async () => {
    try {
      const cfg = await getAppConfig()
      if (!cfg.language) {
        const systemLanguage = getSystemLanguage()
        await patchAppConfig({ language: systemLanguage })
        cfg.language = systemLanguage
      }
      await initI18n({ lng: cfg.language })
      return cfg
    } catch (e) {
      safeShowErrorBox('common.error.initFailed', `${e}`)
      app.quit()
      throw e
    }
  })()

  await adminPromise
  await initAdminStatus()

  if (process.platform === 'win32') {
    const isAdmin = await adminPromise
    if (!isAdmin) {
      try {
        const hasHighPrivilegeCore = await checkHighPrivilegeCore()
        if (hasHighPrivilegeCore) {
          try {
            await appConfigPromise
          } catch {
            await initI18n({ lng: 'zh-CN' })
          }
          const choice = dialog.showMessageBoxSync({
            type: 'warning',
            title: i18next.t('core.highPrivilege.title'),
            message: i18next.t('core.highPrivilege.message'),
            buttons: [i18next.t('common.confirm'), i18next.t('common.cancel')],
            defaultId: 0,
            cancelId: 1
          })

          if (choice === 0) {
            try {
              await restartAsAdmin(false)
              app.exit(0)
            } catch (error) {
              safeShowErrorBox('common.error.adminRequired', `${error}`)
              app.exit(1)
            }
          } else {
            app.exit(0)
          }
        }
      } catch (e) {
        mainLogger.error('Failed to check high privilege core', e)
      }
    }
  }

  return appConfigPromise
})()

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('party.mihomo.app')

  const appConfig = await initPromise

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpcMainHandlers()

  const createWindowPromise = createWindow()
  const runtimeInitPromise = init().catch((error) => {
    mainLogger.error('Failed to initialize background services', error)
  })

  let coreStarted = false
  const coreStartPromise = (async (): Promise<void> => {
    try {
      initCoreWatcher()
      const startPromises = await startCore()
      if (startPromises.length > 0) {
        startPromises[0].then(async () => {
          await Promise.allSettled([
            initProfileUpdater().catch((e) => mainLogger.warn('Failed to init profile updater', e)),
            initWebdavBackupScheduler().catch((e) =>
              mainLogger.warn('Failed to init webdav backup scheduler', e)
            ),
            checkAdminRestartForTun().catch((e) =>
              mainLogger.warn('Failed admin-restart-for-tun follow-up', e)
            )
          ])
        })
      }
      coreStarted = true
    } catch (e) {
      safeShowErrorBox('mihomo.error.coreStartFailed', `${e}`)
    }
  })()

  const monitorPromise = (async (): Promise<void> => {
    try {
      await startMonitor()
    } catch {
      // ignore
    }
  })()

  await createWindowPromise

  void startSubStoreServices().catch((e) =>
    mainLogger.warn('Failed to start sub-store services', e)
  )

  const { showFloatingWindow: showFloating = false, disableTray = false } = appConfig
  const uiTasks: Promise<void>[] = [initShortcut()]

  if (showFloating) {
    uiTasks.push(
      (async () => {
        try {
          await showFloatingWindow()
        } catch (error) {
          await logger.error('Failed to create floating window on startup', error)
        }
      })()
    )
  }

  if (!disableTray) {
    uiTasks.push(createTray())
  }

  await Promise.all(uiTasks)
  void runtimeInitPromise
  await Promise.all([coreStartPromise, monitorPromise])

  if (coreStarted) {
    mainWindow?.webContents.send('core-started')
  }

  app.on('activate', () => {
    showMainWindow()
  })
})
