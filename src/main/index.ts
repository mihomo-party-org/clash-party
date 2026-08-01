import { execFile } from 'child_process'
import { promisify } from 'util'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { app, dialog, ipcMain } from 'electron'
import i18next from 'i18next'
import { initI18n } from '../shared/i18n'
import { registerIpcMainHandlers } from './utils/ipc'
import { getAppConfig, patchAppConfig } from './config'
import {
  beginCoreInitialization,
  completeCoreInitialization,
  startCoreForStartup,
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
  markInitialRendererReady,
  showMainWindow,
  triggerMainWindow,
  closeMainWindow
} from './window'
import { findDeepLink, handleDeepLink } from './deeplink'
import { findPluginFile, readPluginFile } from './resolve/plugin/file'
import {
  fixUserDataPermissions,
  setupPlatformSpecifics,
  setupAppLifecycle,
  getSystemLanguage
} from './lifecycle'
import { configureAppPaths } from './utils/dirs'

async function getWindowsPowerShellMajorVersion(): Promise<number | null> {
  // 仅 PS 3.0+ 写入 \3\ 键（\1\ 键恒为 2.0，不可用）。
  try {
    const { stdout } = await promisify(execFile)(
      'reg',
      [
        'query',
        'HKLM\\SOFTWARE\\Microsoft\\PowerShell\\3\\PowerShellEngine',
        '/v',
        'PowerShellVersion'
      ],
      { encoding: 'utf8', timeout: 5000, windowsHide: true }
    )
    const version = stdout.match(/PowerShellVersion\s+REG_\w+\s+([^\s]+)/)?.[1]
    const major = version ? parseInt(version.split('.')[0], 10) : NaN
    return isNaN(major) ? null : major
  } catch (error) {
    // 退出码 1 = 键不存在（Win7 仅 PS 2.0）；超时被杀或其他异常视为未知，不阻断。
    const err = error as { killed?: boolean; code?: number | string }
    return !err.killed && err.code === 1 ? 2 : null
  }
}

// 尽早并行检查，但不再阻塞 Electron 初始化和首窗创建。
const windowsPowerShellVersionPromise =
  process.platform === 'win32' ? getWindowsPowerShellMajorVersion() : Promise.resolve(null)

async function ensureSupportedWindowsPowerShell(): Promise<boolean> {
  const major = await windowsPowerShellVersionPromise
  if (major === null || major >= 5) return true

  const isZh = Intl.DateTimeFormat().resolvedOptions().locale?.startsWith('zh')
  await dialog.showMessageBox({
    type: 'warning',
    title: isZh ? '需要更新 PowerShell' : 'PowerShell Update Required',
    message: isZh
      ? `检测到您的 PowerShell 版本为 ${major}.x，部分功能需要 PowerShell 5.1 才能正常运行。\n\n请访问 Microsoft 官网下载并安装 Windows Management Framework 5.1。`
      : `Detected PowerShell version ${major}.x. Some features require PowerShell 5.1.\n\nPlease install Windows Management Framework 5.1 from the Microsoft website.`
  })
  app.quit()
  return false
}

configureAppPaths()

const mainLogger = createLogger('Main')

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

type LaunchTarget = { type: 'deep-link' | 'plugin-file'; value: string }

let launchTargetsReady = false
let pendingLaunchTargets: LaunchTarget[] = []
let launchTargetChain = Promise.resolve()

function queueLaunchTarget(target: LaunchTarget): void {
  if (!launchTargetsReady) {
    const duplicate = pendingLaunchTargets.some(
      (pending) => pending.type === target.type && pending.value === target.value
    )
    if (!duplicate) pendingLaunchTargets.push(target)
    return
  }

  launchTargetChain = launchTargetChain
    .then(async () => {
      if (target.type === 'deep-link') {
        showMainWindow()
        await handleDeepLink(target.value)
        return
      }

      try {
        await createWindow()
        const window = mainWindow
        if (!window || window.isDestroyed()) throw new Error('Main window is unavailable')
        const rendererReady =
          window.webContents.isLoadingMainFrame() || window.webContents.getURL() === ''
            ? new Promise<void>((resolve) => window.webContents.once('did-finish-load', resolve))
            : Promise.resolve()
        showMainWindow()
        const payload = await readPluginFile(target.value)
        await rendererReady
        window.webContents.send('openPluginFile', payload)
      } catch (e) {
        safeShowErrorBox('plugins.previewFailed', `${e}`)
      }
    })
    .catch((e) => safeShowErrorBox('common.error.default', `${e}`))
}

interface RendererFirstContentWaiter {
  promise: Promise<void>
  startTimeout: () => void
  dispose: () => void
}

function createRendererFirstContentWaiter(timeout = 10000): RendererFirstContentWaiter {
  let timeoutId: NodeJS.Timeout | undefined
  let settled = false
  let resolvePromise!: () => void

  const finish = (): void => {
    if (settled) return
    settled = true
    ipcMain.removeListener('rendererFirstContentReady', finish)
    if (timeoutId) clearTimeout(timeoutId)
    resolvePromise()
  }

  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve
  })
  ipcMain.once('rendererFirstContentReady', finish)

  return {
    promise,
    startTimeout: () => {
      if (!settled && !timeoutId) timeoutId = setTimeout(finish, timeout)
    },
    dispose: finish
  }
}

app.on('second-instance', (_event, commandline) => {
  const url = findDeepLink(commandline)
  if (url) {
    queueLaunchTarget({ type: 'deep-link', value: url })
    return
  }
  const pluginFile = findPluginFile(commandline)
  if (pluginFile) queueLaunchTarget({ type: 'plugin-file', value: pluginFile })
  else showMainWindow()
})

app.on('open-url', (_event, url) => {
  queueLaunchTarget({ type: 'deep-link', value: url })
})

app.on('open-file', (event, filePath) => {
  event.preventDefault()
  const pluginFile = findPluginFile([filePath])
  if (pluginFile) queueLaunchTarget({ type: 'plugin-file', value: pluginFile })
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

  return { appConfig: await appConfigPromise, adminPromise }
})()

async function ensureNoHighPrivilegeCore(isAdmin: boolean): Promise<boolean> {
  if (process.platform !== 'win32' || isAdmin) return true

  try {
    if (!(await checkHighPrivilegeCore())) return true

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
    return false
  } catch (e) {
    mainLogger.error('Failed to check high privilege core', e)
    return true
  }
}

app
  .whenReady()
  .then(async () => {
    electronApp.setAppUserModelId('party.mihomo.app')

    const { appConfig, adminPromise } = await initPromise
    beginCoreInitialization()

    // 安全检查尽早并行执行，但只用一个布尔 gate 控制核心启动。
    const startupSafetyPromise = (async (): Promise<boolean> => {
      const isAdmin = await adminPromise
      await initAdminStatus()
      if (!(await ensureSupportedWindowsPowerShell())) return false
      return ensureNoHighPrivilegeCore(isAdmin)
    })().catch((error) => {
      mainLogger.error('Startup safety checks failed', error)
      return false
    })

    const rendererFirstContentWaiter = createRendererFirstContentWaiter()

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    registerIpcMainHandlers()

    try {
      await createWindow()
    } catch (error) {
      rendererFirstContentWaiter.dispose()
      completeCoreInitialization(false)
      throw error
    }

    // loadURL/loadFile 成功后才开始兜底计时；加载重试不会提前耗尽首屏预算。
    rendererFirstContentWaiter.startTimeout()
    await rendererFirstContentWaiter.promise
    markInitialRendererReady()

    // 首窗完成加载后再启动磁盘和子进程密集型任务，避免与 renderer 抢占冷启动资源。
    const runtimeInitPromise = startupSafetyPromise
      .then(async (canContinue) => {
        if (!canContinue) return
        await init()
      })
      .catch((error) => {
        mainLogger.error('Failed to initialize background services', error)
      })

    let coreStarted = false
    const coreStartPromise = (async (): Promise<void> => {
      if (!(await startupSafetyPromise)) {
        completeCoreInitialization(false)
        return
      }

      try {
        initCoreWatcher()
        const startPromises = await startCoreForStartup()
        if (startPromises.length > 0) {
          startPromises[0].then(async () => {
            await Promise.allSettled([
              initProfileUpdater().catch((e) =>
                mainLogger.warn('Failed to init profile updater', e)
              ),
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
      } finally {
        // 安全检查通过后，即使自动启动失败，也允许用户手动重试。
        completeCoreInitialization(true)
      }
    })()

    const monitorPromise = (async (): Promise<void> => {
      try {
        if (!(await startupSafetyPromise)) return
        await startMonitor()
      } catch {
        // ignore
      }
    })()

    // macOS delivers cold-start targets through open-url/open-file; Windows/Linux put them in argv.
    if (process.platform !== 'darwin') {
      const initialDeepLink = findDeepLink(process.argv)
      if (initialDeepLink) {
        queueLaunchTarget({ type: 'deep-link', value: initialDeepLink })
      } else {
        const initialPluginFile = findPluginFile(process.argv)
        if (initialPluginFile) {
          queueLaunchTarget({ type: 'plugin-file', value: initialPluginFile })
        }
      }
    }
    launchTargetsReady = true
    const queuedLaunchTargets = pendingLaunchTargets
    pendingLaunchTargets = []
    queuedLaunchTargets.forEach(queueLaunchTarget)

    void startupSafetyPromise
      .then(async (canContinue) => {
        if (canContinue) await startSubStoreServices()
      })
      .catch((e) => mainLogger.warn('Failed to start sub-store services', e))

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
  .catch((error) => {
    mainLogger.error('Application startup failed', error)
    safeShowErrorBox('common.error.initFailed', `${error}`)
    app.quit()
  })
