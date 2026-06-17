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

export async function createWindow(): Promise<void> {
  const {
    useWindowFrame = false,
    silentStart = false,
    autoQuitWithoutCore = false,
    autoQuitWithoutCoreDelay = 60
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
    autoQuitWithoutCoreDelay
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
}

function setupWindowEvents(window: BrowserWindow, config: WindowConfig): void {
  const { silentStart, autoQuitWithoutCore, autoQuitWithoutCoreDelay } = config

  window.on('ready-to-show', () => {
    if (autoQuitWithoutCore && !window.isVisible()) {
      scheduleQuitWithoutCore(autoQuitWithoutCoreDelay)
    }

    // 开发模式下始终显示窗口
    if (!silentStart || is.dev) {
      clearQuitTimeout()
      window.show()
      window.focusOnWebView()
    }
  })

  window.webContents.on('did-fail-load', () => {
    window.webContents.reload()
  })

  window.on('show', () => {
    showDockIcon()
  })

  window.on('close', async (event) => {
    event.preventDefault()
    window.hide()

    const {
      autoQuitWithoutCore = false,
      autoQuitWithoutCoreDelay = 60,
      useDockIcon = true
    } = await getAppConfig()

    if (!useDockIcon) {
      hideDockIcon()
    }

    if (autoQuitWithoutCore) {
      scheduleQuitWithoutCore(autoQuitWithoutCoreDelay)
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

function scheduleQuitWithoutCore(delaySeconds: number): void {
  clearQuitTimeout()
  quitTimeout = setTimeout(async () => {
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
  if (!mainWindow) return

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
  if (mainWindow) {
    clearQuitTimeout()
    mainWindow.show()
    mainWindow.focusOnWebView()
  }
}

export function closeMainWindow(): void {
  mainWindow?.close()
}
