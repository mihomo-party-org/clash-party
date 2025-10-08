import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcMainHandlers } from './utils/ipc'
import windowStateKeeper from 'electron-window-state'
import { app, shell, BrowserWindow, Menu, dialog, Notification, powerMonitor } from 'electron'
import { addProfileItem, getAppConfig, patchAppConfig } from './config'
import { quitWithoutCore, startCore, stopCore, checkAdminRestartForTun, checkHighPrivilegeCore, restartAsAdmin, initAdminStatus } from './core/manager'
import { triggerSysProxy } from './sys/sysproxy'
import icon from '../../resources/icon.png?asset'
import { createTray, hideDockIcon, showDockIcon } from './resolve/tray'
import { init, initBasic } from './utils/init'
import { join } from 'path'
import { initShortcut } from './resolve/shortcut'
import { spawn, exec } from 'child_process'
import { promisify } from 'util'
import { stat } from 'fs/promises'
import { initProfileUpdater } from './core/profileUpdater'
import { existsSync } from 'fs'
import { exePath } from './utils/dirs'
import { startMonitor } from './resolve/trafficMonitor'
import { showFloatingWindow } from './resolve/floatingWindow'
import { initI18n } from '../shared/i18n'
import i18next from 'i18next'
import { logger } from './utils/logger'
import { initWebdavBackupScheduler } from './resolve/backup'

// 错误处理
function showSafeErrorBox(titleKey: string, message: string): void {
  let title: string
  try {
    title = i18next.t(titleKey)
    if (!title || title === titleKey) throw new Error('Translation not ready')
  } catch {
    const isZh = app.getLocale().startsWith('zh')
    const fallbacks: Record<string, { zh: string; en: string }> = {
      'common.error.initFailed': { zh: '应用初始化失败', en: 'Application initialization failed' },
      'mihomo.error.coreStartFailed': { zh: '内核启动出错', en: 'Core start failed' },
      'profiles.error.importFailed': { zh: '配置导入失败', en: 'Profile import failed' },
      'common.error.adminRequired': { zh: '需要管理员权限', en: 'Administrator privileges required' }
    }
    title = fallbacks[titleKey] ? (isZh ? fallbacks[titleKey].zh : fallbacks[titleKey].en) : (isZh ? '错误' : 'Error')
  }
  dialog.showErrorBox(title, message)
}

async function fixUserDataPermissions(): Promise<void> {
  if (process.platform !== 'darwin') return

  const userDataPath = app.getPath('userData')
  if (!existsSync(userDataPath)) return

  try {
    const stats = await stat(userDataPath)
    const currentUid = process.getuid?.() || 0

    if (stats.uid === 0 && currentUid !== 0) {
      const execPromise = promisify(exec)
      const username = process.env.USER || process.env.LOGNAME
      if (username) {
        await execPromise(`chown -R "${username}:staff" "${userDataPath}"`)
        await execPromise(`chmod -R u+rwX "${userDataPath}"`)
      }
    }
  } catch {
    // ignore
  }
}

let quitTimeout: NodeJS.Timeout | null = null
export let mainWindow: BrowserWindow | null = null


async function initApp(): Promise<void> {
  await fixUserDataPermissions()
}

initApp()
  .then(() => {
    const gotTheLock = app.requestSingleInstanceLock()

    if (!gotTheLock) {
      app.quit()
    }
  })
  .catch(() => {
    // ignore permission fix errors
    const gotTheLock = app.requestSingleInstanceLock()

    if (!gotTheLock) {
      app.quit()
    }
  })

export function customRelaunch(): void {
  const script = `while kill -0 ${process.pid} 2>/dev/null; do
  sleep 0.1
done
${process.argv.join(' ')} & disown
exit
`
  spawn('sh', ['-c', `"${script}"`], {
    shell: true,
    detached: true,
    stdio: 'ignore'
  })
}

if (process.platform === 'linux') {
  app.relaunch = customRelaunch
}

if (process.platform === 'win32' && !exePath().startsWith('C')) {
  // https://github.com/electron/electron/issues/43278
  // https://github.com/electron/electron/issues/36698
  app.commandLine.appendSwitch('in-process-gpu')
}

// 运行内核检测
async function checkHighPrivilegeCoreEarly(): Promise<void> {
  if (process.platform !== 'win32') {
    return
  }

  try {
    await initBasic()

    const { checkAdminPrivileges } = await import('./core/manager')
    const isCurrentAppAdmin = await checkAdminPrivileges()

    if (isCurrentAppAdmin) {
      console.log('Current app is running as administrator, skipping privilege check')
      return
    }

    const hasHighPrivilegeCore = await checkHighPrivilegeCore()
    if (hasHighPrivilegeCore) {
      try {
        const appConfig = await getAppConfig()
        const language = appConfig.language || (app.getLocale().startsWith('zh') ? 'zh-CN' : 'en-US')
        await initI18n({ lng: language })
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
          // Windows 平台重启应用获取管理员权限
          await restartAsAdmin(false)
          process.exit(0)
        } catch (error) {
          showSafeErrorBox('common.error.adminRequired', `${error}`)
          process.exit(1)
        }
      } else {
        process.exit(0)
      }
    }
  } catch (e) {
    console.error('Failed to check high privilege core:', e)
  }
}

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

app.on('before-quit', async (e) => {
  e.preventDefault()
  triggerSysProxy(false)
  await stopCore()
  app.exit()
})

powerMonitor.on('shutdown', async () => {
  triggerSysProxy(false)
  await stopCore()
  app.exit()
})

// 获取系统语言
function getSystemLanguage(): 'zh-CN' | 'en-US' {
  const locale = app.getLocale()
  return locale.startsWith('zh') ? 'zh-CN' : 'en-US'
}

// 硬件加速设置
async function initHardwareAcceleration(): Promise<void> {
  try {
    await initBasic()
    const { disableHardwareAcceleration = false } = await getAppConfig()
    if (disableHardwareAcceleration) {
      app.disableHardwareAcceleration()
    }
  } catch (e) {
    console.warn('Failed to read hardware acceleration config:', e)
  }
}

initHardwareAcceleration()

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('party.mihomo.app')

  await initBasic()

  await checkHighPrivilegeCoreEarly()

  await initAdminStatus()

  try {
    await init()

    const appConfig = await getAppConfig()
    // 如果配置中没有语言设置，则使用系统语言
    if (!appConfig.language) {
      const systemLanguage = getSystemLanguage()
      await patchAppConfig({ language: systemLanguage })
      appConfig.language = systemLanguage
    }
    await initI18n({ lng: appConfig.language })
  } catch (e) {
    showSafeErrorBox('common.error.initFailed', `${e}`)
    app.quit()
  }

  try {
    const [startPromise] = await startCore()
    startPromise.then(async () => {
    await initProfileUpdater()
    await initWebdavBackupScheduler() // 初始化WebDAV定时备份任务
      // 上次是否为了开启 TUN 而重启
      await checkAdminRestartForTun()
    })
  } catch (e) {
    showSafeErrorBox('mihomo.error.coreStartFailed', `${e}`)
  }
  try {
    await startMonitor()
  } catch {
    // ignore
  }

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })
  const { showFloatingWindow: showFloating = false, disableTray = false } = await getAppConfig()
  registerIpcMainHandlers()
  await createWindow()
  if (showFloating) {
    try {
      await showFloatingWindow()
    } catch (error) {
      await logger.error('Failed to create floating window on startup', error)
    }
  }
  if (!disableTray) {
    await createTray()
  }
  await initShortcut()
  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    showMainWindow()
  })
})

async function handleDeepLink(url: string): Promise<void> {
  if (!url.startsWith('clash://') && !url.startsWith('mihomo://')) return

  const urlObj = new URL(url)
  switch (urlObj.host) {
    case 'install-config': {
      try {
        const profileUrl = urlObj.searchParams.get('url')
        const profileName = urlObj.searchParams.get('name')
        if (!profileUrl) {
          throw new Error(i18next.t('profiles.error.urlParamMissing'))
        }
        await addProfileItem({
          type: 'remote',
          name: profileName ?? undefined,
          url: profileUrl
        })
        mainWindow?.webContents.send('profileConfigUpdated')
        new Notification({ title: i18next.t('profiles.notification.importSuccess') }).show()
        break
      } catch (e) {
        showSafeErrorBox('profiles.error.importFailed', `${url}\n${e}`)
      }
    }
  }
}

export async function createWindow(): Promise<void> {
  const { useWindowFrame = false } = await getAppConfig()
  const mainWindowState = windowStateKeeper({
    defaultWidth: 800,
    defaultHeight: 600,
    file: 'window-state.json'
  })
  // https://github.com/electron/electron/issues/16521#issuecomment-582955104
  Menu.setApplicationMenu(null)
  mainWindow = new BrowserWindow({
    minWidth: 800,
    minHeight: 600,
    width: mainWindowState.width,
    height: mainWindowState.height,
    x: mainWindowState.x,
    y: mainWindowState.y,
    show: false,
    frame: useWindowFrame,
    fullscreenable: false,
    titleBarStyle: useWindowFrame ? 'default' : 'hidden',
    titleBarOverlay: useWindowFrame
      ? false
      : {
          height: 49
        },
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon: icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      spellcheck: false,
      sandbox: false,
      devTools: true
    }
  })
  mainWindowState.manage(mainWindow)
  mainWindow.on('ready-to-show', async () => {
    const {
      silentStart = false,
      autoQuitWithoutCore = false,
      autoQuitWithoutCoreDelay = 60
    } = await getAppConfig()
    if (autoQuitWithoutCore && !mainWindow?.isVisible()) {
      if (quitTimeout) {
        clearTimeout(quitTimeout)
      }
      quitTimeout = setTimeout(async () => {
        await quitWithoutCore()
      }, autoQuitWithoutCoreDelay * 1000)
    }
    if (!silentStart) {
      if (quitTimeout) {
        clearTimeout(quitTimeout)
      }
      mainWindow?.show()
      mainWindow?.focusOnWebView()
    }
  })
  mainWindow.webContents.on('did-fail-load', () => {
    mainWindow?.webContents.reload()
  })

  mainWindow.on('show', () => {
    showDockIcon()
  })

  mainWindow.on('close', async (event) => {
    event.preventDefault()
    mainWindow?.hide()
    const {
      autoQuitWithoutCore = false,
      autoQuitWithoutCoreDelay = 60,
      useDockIcon = true
    } = await getAppConfig()
    if (!useDockIcon) {
      hideDockIcon()
    }
    if (autoQuitWithoutCore) {
      if (quitTimeout) {
        clearTimeout(quitTimeout)
      }
      quitTimeout = setTimeout(async () => {
        await quitWithoutCore()
      }, autoQuitWithoutCoreDelay * 1000)
    }
  })

  mainWindow.on('resized', () => {
    if (mainWindow) mainWindowState.saveState(mainWindow)
  })

  mainWindow.on('move', () => {
    if (mainWindow) mainWindowState.saveState(mainWindow)
  })

  mainWindow.on('session-end', async () => {
    triggerSysProxy(false)
    await stopCore()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 在开发模式下自动打开 DevTools
  if (is.dev) {
    mainWindow.webContents.openDevTools()
  }

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

export function triggerMainWindow(force?: boolean): void {
  if (mainWindow) {
    getAppConfig()
    .then(({ triggerMainWindowBehavior = 'toggle' }) => {
      if (force === true || triggerMainWindowBehavior === 'toggle') {
        if (mainWindow?.isVisible()) {
          closeMainWindow()
        } else {
          showMainWindow()
        }
      } else {
        showMainWindow()
      }
    })
    .catch(showMainWindow)
  }
}

export function showMainWindow(): void {
  if (mainWindow) {
    if (quitTimeout) {
      clearTimeout(quitTimeout)
    }
    mainWindow.show()
    mainWindow.focusOnWebView()
  }
}

export function closeMainWindow(): void {
  if (mainWindow) {
    mainWindow.close()
  }
}
