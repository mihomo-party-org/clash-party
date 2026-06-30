import { join } from 'path'
import { readFileSync, writeFileSync } from 'fs'
import { BrowserWindow, Menu, screen, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { getAppConfig } from './config'
import { quitWithoutCore, stopCore } from './core/manager'
import { triggerSysProxy } from './sys/sysproxy'
import { hideDockIcon, showDockIcon } from './resolve/tray'
import { dataDir } from './utils/dirs'
import { createLogger } from './utils/logger'

interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  isMaximized?: boolean
}

function loadWindowState(): WindowState {
  try {
    const raw = readFileSync(join(dataDir(), 'window-state.json'), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return { width: 800, height: 600 }
  }
}

function saveWindowState(window: BrowserWindow): void {
  const isMaximized = window.isMaximized()
  const state: WindowState = isMaximized
    ? { ...loadWindowState(), isMaximized: true }
    : { ...window.getContentBounds(), isMaximized: false }
  writeFileSync(join(dataDir(), 'window-state.json'), JSON.stringify(state))
}

function ensureVisibleOnScreen(state: WindowState): WindowState {
  const displays = screen.getAllDisplays()
  const visible = displays.some((d) => {
    const b = d.bounds
    return (
      state.x !== undefined &&
      state.y !== undefined &&
      state.x >= b.x &&
      state.y >= b.y &&
      state.x < b.x + b.width &&
      state.y < b.y + b.height
    )
  })
  return visible ? state : { width: state.width, height: state.height }
}

export let mainWindow: BrowserWindow | null = null
let quitTimeout: NodeJS.Timeout | null = null
let createWindowPromise: Promise<void> | null = null
const windowLogger = createLogger('window')
const MAX_RENDERER_RECOVERY_ATTEMPTS = 3
const UNRESPONSIVE_RECOVERY_DELAY_MS = 10000
type AutoQuitWithoutCoreMode = NonNullable<IAppConfig['autoQuitWithoutCoreMode']>

export async function createWindow(): Promise<void> {
  if (mainWindow && !mainWindow.isDestroyed()) return
  if (createWindowPromise) return createWindowPromise

  createWindowPromise = createWindowInternal().finally(() => {
    createWindowPromise = null
  })
  return createWindowPromise
}

async function createWindowInternal(): Promise<void> {
  const {
    useWindowFrame = false,
    silentStart = false,
    autoQuitWithoutCore = false,
    autoQuitWithoutCoreDelay = 60,
    autoQuitWithoutCoreMode = 'core'
  } = await getAppConfig()

  const savedState = ensureVisibleOnScreen(loadWindowState())

  Menu.setApplicationMenu(null)
  mainWindow = new BrowserWindow({
    minWidth: 800,
    minHeight: 600,
    width: savedState.width,
    height: savedState.height,
    x: savedState.x,
    y: savedState.y,
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
      preload: join(__dirname, '../preload/index.cjs'),
      spellcheck: false,
      sandbox: false,
      devTools: true
    }
  })

  if (savedState.isMaximized && !silentStart) {
    mainWindow.maximize()
  }

  setupWindowEvents(mainWindow, {
    silentStart,
    autoQuitWithoutCore,
    autoQuitWithoutCoreDelay,
    autoQuitWithoutCoreMode
  })

  if (is.dev) {
    mainWindow.webContents.openDevTools()
  }

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

interface WindowConfig {
  silentStart: boolean
  autoQuitWithoutCore: boolean
  autoQuitWithoutCoreDelay: number
  autoQuitWithoutCoreMode: AutoQuitWithoutCoreMode
}

function setupWindowEvents(window: BrowserWindow, config: WindowConfig): void {
  const { silentStart, autoQuitWithoutCore, autoQuitWithoutCoreDelay, autoQuitWithoutCoreMode } =
    config
  let rendererRecoveryAttempts = 0
  let unresponsiveRecoveryTimer: NodeJS.Timeout | null = null

  const clearUnresponsiveRecoveryTimer = (): void => {
    if (!unresponsiveRecoveryTimer) return
    clearTimeout(unresponsiveRecoveryTimer)
    unresponsiveRecoveryTimer = null
  }

  const reloadRenderer = (reason: string): void => {
    if (window.isDestroyed()) return
    clearUnresponsiveRecoveryTimer()
    if (rendererRecoveryAttempts >= MAX_RENDERER_RECOVERY_ATTEMPTS) {
      void windowLogger.error('Renderer recovery limit reached', reason)
      return
    }

    rendererRecoveryAttempts += 1
    void windowLogger.warn('Reloading renderer after failure', reason)
    window.webContents.reload()
  }

  window.on('ready-to-show', () => {
    rendererRecoveryAttempts = 0

    if (autoQuitWithoutCore && !window.isVisible()) {
      scheduleQuitWithoutCore(autoQuitWithoutCoreDelay, autoQuitWithoutCoreMode)
    }

    // 开发模式下始终显示窗口
    if (!silentStart || is.dev) {
      clearQuitTimeout()
      window.show()
      window.focusOnWebView()
    }
  })

  window.webContents.on('did-fail-load', () => {
    reloadRenderer('did-fail-load')
  })

  window.webContents.on('did-finish-load', () => {
    rendererRecoveryAttempts = 0
  })

  window.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return
    reloadRenderer(`render-process-gone:${details.reason}`)
  })

  window.on('unresponsive', () => {
    clearUnresponsiveRecoveryTimer()
    unresponsiveRecoveryTimer = setTimeout(() => {
      unresponsiveRecoveryTimer = null
      reloadRenderer('unresponsive')
    }, UNRESPONSIVE_RECOVERY_DELAY_MS)
  })

  window.on('responsive', clearUnresponsiveRecoveryTimer)

  window.on('show', () => {
    showDockIcon()
  })

  window.on('close', async (event) => {
    event.preventDefault()
    window.hide()

    const {
      autoQuitWithoutCore = false,
      autoQuitWithoutCoreDelay = 60,
      autoQuitWithoutCoreMode = 'core',
      useDockIcon = true
    } = await getAppConfig()

    if (!useDockIcon) {
      hideDockIcon()
    }

    if (autoQuitWithoutCore) {
      scheduleQuitWithoutCore(autoQuitWithoutCoreDelay, autoQuitWithoutCoreMode)
    }
  })

  window.on('closed', () => {
    clearUnresponsiveRecoveryTimer()
    if (mainWindow === window) {
      mainWindow = null
    }
  })

  window.on('resized', () => saveWindowState(window))
  window.on('moved', () => saveWindowState(window))
  window.on('maximize', () => saveWindowState(window))
  window.on('unmaximize', () => saveWindowState(window))

  window.on('session-end', async () => {
    await triggerSysProxy(false)
    await stopCore()
  })

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
}

function scheduleQuitWithoutCore(
  delaySeconds: number,
  mode: AutoQuitWithoutCoreMode = 'core'
): void {
  clearQuitTimeout()
  quitTimeout = setTimeout(async () => {
    if (mode === 'tray') {
      if (mainWindow && !mainWindow.isVisible()) {
        mainWindow.destroy()
        hideDockIcon()
      }
      return
    }

    await quitWithoutCore()
  }, delaySeconds * 1000)
}

export function clearQuitTimeout(): void {
  if (quitTimeout) {
    clearTimeout(quitTimeout)
    quitTimeout = null
  }
}

export function triggerMainWindow(force?: boolean): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    showMainWindow()
    return
  }

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

export function showMainWindow(): void {
  clearQuitTimeout()

  if (mainWindow && !mainWindow.isDestroyed()) {
    clearQuitTimeout()
    if (mainWindow.webContents.isCrashed()) {
      mainWindow.webContents.reload()
    }
    mainWindow.show()
    mainWindow.focusOnWebView()
    return
  }

  void createWindow().then(() => {
    clearQuitTimeout()
    mainWindow?.show()
    mainWindow?.focusOnWebView()
  })
}

export function closeMainWindow(): void {
  mainWindow?.close()
}
