import { is } from '@electron-toolkit/utils'
import { BrowserWindow, ipcMain } from 'electron'
import windowStateKeeper from 'electron-window-state'
import { join } from 'path'
import { getAppConfig, patchAppConfig } from '../config'
import { applyTheme } from './theme'
import { buildContextMenu, showTrayIcon } from './tray'
import { floatingWindowLogger } from '../utils/logger'

export let floatingWindow: BrowserWindow | null = null

function logError(message: string, error?: any): void {
  floatingWindowLogger.log(`FloatingWindow Error: ${message}`, error).catch(() => {})
}

async function createFloatingWindow(): Promise<void> {
  try {
    const floatingWindowState = windowStateKeeper({ file: 'floating-window-state.json' })
    const { customTheme = 'default.css', floatingWindowCompatMode = true } = await getAppConfig()

    const safeMode = process.env.FLOATING_SAFE_MODE === 'true'
    const useCompatMode =
      floatingWindowCompatMode || process.env.FLOATING_COMPAT_MODE === 'true' || safeMode

    const windowOptions: Electron.BrowserWindowConstructorOptions = {
      width: 120,
      height: 42,
      x: floatingWindowState.x,
      y: floatingWindowState.y,
      show: false,
      frame: safeMode,
      alwaysOnTop: !safeMode,
      resizable: safeMode,
      transparent: !safeMode && !useCompatMode,
      skipTaskbar: !safeMode,
      minimizable: safeMode,
      maximizable: safeMode,
      fullscreenable: false,
      closable: safeMode,
      backgroundColor: safeMode ? '#ffffff' : useCompatMode ? '#f0f0f0' : '#00000000',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        spellcheck: false,
        sandbox: false,
        nodeIntegration: false,
        contextIsolation: true
      }
    }

    if (process.platform === 'win32') {
      windowOptions.hasShadow = !safeMode
      windowOptions.webPreferences!.offscreen = false
    }

    floatingWindow = new BrowserWindow(windowOptions)
    floatingWindowState.manage(floatingWindow)

    // 事件监听器
    floatingWindow.webContents.on('render-process-gone', (_, details) => {
      logError('Render process gone', details.reason)
      floatingWindow = null
    })

    floatingWindow.on('ready-to-show', () => {
      applyTheme(customTheme)
      floatingWindow?.show()
      floatingWindow?.setAlwaysOnTop(true, 'screen-saver')
    })

    floatingWindow.on('moved', () => {
      floatingWindow && floatingWindowState.saveState(floatingWindow)
    })

    // IPC 监听器
    ipcMain.on('updateFloatingWindow', () => {
      if (floatingWindow) {
        floatingWindow.webContents.send('controledMihomoConfigUpdated')
        floatingWindow.webContents.send('appConfigUpdated')
      }
    })

    // 加载页面
    const url =
      is.dev && process.env['ELECTRON_RENDERER_URL']
        ? `${process.env['ELECTRON_RENDERER_URL']}/floating.html`
        : join(__dirname, '../renderer/floating.html')

    is.dev ? await floatingWindow.loadURL(url) : await floatingWindow.loadFile(url)
  } catch (error) {
    logError('Failed to create floating window', error)
    floatingWindow = null
    throw error
  }
}

export async function showFloatingWindow(): Promise<void> {
  try {
    if (floatingWindow && !floatingWindow.isDestroyed()) {
      floatingWindow.show()
    } else {
      await createFloatingWindow()
    }
  } catch (error) {
    logError('Failed to show floating window', error)

    // 如果已经是兼容模式还是崩溃，自动禁用悬浮窗
    const { floatingWindowCompatMode = true } = await getAppConfig()
    if (floatingWindowCompatMode) {
      await patchAppConfig({ showFloatingWindow: false })
    } else {
      await patchAppConfig({ floatingWindowCompatMode: true })
    }
    throw error
  }
}

export async function triggerFloatingWindow(): Promise<void> {
  if (floatingWindow?.isVisible()) {
    await patchAppConfig({ showFloatingWindow: false })
    await closeFloatingWindow()
  } else {
    await patchAppConfig({ showFloatingWindow: true })
    await showFloatingWindow()
  }
}

export async function closeFloatingWindow(): Promise<void> {
  if (floatingWindow) {
    floatingWindow.close()
    floatingWindow.destroy()
    floatingWindow = null
  }
  await showTrayIcon()
  await patchAppConfig({ disableTray: false })
}

export async function showContextMenu(): Promise<void> {
  const menu = await buildContextMenu()
  menu.popup()
}
