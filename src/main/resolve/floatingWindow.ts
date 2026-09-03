import { join } from 'path'
import { readFileSync } from 'fs'
import { is } from '@electron-toolkit/utils'
import { app, BrowserWindow, ipcMain, screen } from 'electron'
import windowStateKeeper from 'electron-window-state'
import { getAppConfig, patchAppConfig } from '../config'
import { floatingWindowLogger } from '../utils/logger'
import { applyTheme } from './theme'
import { buildContextMenu, showTrayIcon } from './tray'

export let floatingWindow: BrowserWindow | null = null

const FLOATING_WINDOW_STATE_FILE = 'floating-window-state.json'
const FLOATING_WINDOW_WIDTH = 135
const FLOATING_WINDOW_HEIGHT = 42

function logError(message: string, error?: unknown): void {
  floatingWindowLogger.log(`FloatingWindow Error: ${message}`, error).catch(() => {})
}

// electron-window-state 只在窗口**完整**落在某个显示器内时才恢复坐标，否则整个重置为 (0, 0)。
// 悬浮窗常被拖到屏幕边缘只露出一部分，于是下次启动就跑到左上角。这里自己读一次状态文件，
// 把上次的位置夹回最近显示器的工作区，位置本来就合法时结果与原来完全一致。
function restoreFloatingWindowPosition(): { x?: number; y?: number } {
  let saved: { x?: unknown; y?: unknown }
  try {
    saved = JSON.parse(
      readFileSync(join(app.getPath('userData'), FLOATING_WINDOW_STATE_FILE), 'utf-8')
    )
  } catch {
    return {}
  }

  const { x, y } = saved
  if (!Number.isInteger(x) || !Number.isInteger(y)) return {}

  const { workArea } = screen.getDisplayMatching({
    x: x as number,
    y: y as number,
    width: FLOATING_WINDOW_WIDTH,
    height: FLOATING_WINDOW_HEIGHT
  })
  const maxX = Math.max(workArea.x, workArea.x + workArea.width - FLOATING_WINDOW_WIDTH)
  const maxY = Math.max(workArea.y, workArea.y + workArea.height - FLOATING_WINDOW_HEIGHT)

  return {
    x: Math.min(Math.max(x as number, workArea.x), maxX),
    y: Math.min(Math.max(y as number, workArea.y), maxY)
  }
}

async function createFloatingWindow(): Promise<void> {
  try {
    const restoredPosition = restoreFloatingWindowPosition()
    const floatingWindowState = windowStateKeeper({ file: FLOATING_WINDOW_STATE_FILE })
    const { customTheme = 'default.css', floatingWindowCompatMode = true } = await getAppConfig()

    const safeMode = process.env.FLOATING_SAFE_MODE === 'true'
    const useCompatMode =
      floatingWindowCompatMode || process.env.FLOATING_COMPAT_MODE === 'true' || safeMode

    const windowOptions: Electron.BrowserWindowConstructorOptions = {
      width: FLOATING_WINDOW_WIDTH,
      height: FLOATING_WINDOW_HEIGHT,
      x: restoredPosition.x,
      y: restoredPosition.y,
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
        preload: join(__dirname, '../preload/index.cjs'),
        spellcheck: false,
        sandbox: false,
        nodeIntegration: false,
        contextIsolation: true
      }
    }

    if (process.platform === 'win32') {
      windowOptions.hasShadow = !safeMode
      if (windowOptions.webPreferences) {
        windowOptions.webPreferences.offscreen = false
      }
    }

    const win = new BrowserWindow(windowOptions)
    floatingWindow = win
    floatingWindowState.manage(floatingWindow)

    // 事件监听器
    floatingWindow.webContents.on('render-process-gone', (_, details) => {
      logError('Render process gone', details.reason)
      // 只丢引用不销毁的话，屏幕上会残留一个无边框、置顶、不在任务栏且 closable: false 的幽灵窗，
      // 用户既关不掉也找不到，只能重启应用
      if (!win.isDestroyed()) {
        win.destroy()
      }
      void restoreTrayIcon()
    })

    // 窗口销毁后必须清掉引用，否则 isVisible() 之类的调用会作用在已销毁窗口上抛错；
    // 判断 win 是为了避免旧窗口的 closed 事件把新建窗口的引用清掉
    win.on('closed', () => {
      if (floatingWindow === win) {
        floatingWindow = null
      }
    })

    floatingWindow.on('ready-to-show', () => {
      applyTheme(customTheme)
      floatingWindow?.show()
      floatingWindow?.setAlwaysOnTop(true, 'screen-saver')
    })

    floatingWindow.on('moved', () => {
      if (floatingWindow) {
        floatingWindowState.saveState(floatingWindow)
      }
    })

    // IPC 监听器
    ipcMain.removeAllListeners('updateFloatingWindow')
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

// 只有在悬浮窗顶上时才允许关掉托盘图标（见 general-config.tsx）。悬浮窗一旦没了，
// 必须把托盘找回来：否则主窗口一关就再没有任何入口，用户只能去任务管理器杀进程（#2046）。
async function restoreTrayIcon(): Promise<void> {
  try {
    await showTrayIcon()
    await patchAppConfig({ disableTray: false })
  } catch (error) {
    logError('Failed to restore tray icon', error)
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
    // 这次没建起来，本次会话就没有悬浮窗可用了
    await restoreTrayIcon()
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
    ipcMain.removeAllListeners('updateFloatingWindow')
    floatingWindow.destroy()
    floatingWindow = null
  }
  await restoreTrayIcon()
}

export async function showContextMenu(): Promise<void> {
  const menu = await buildContextMenu()
  menu.popup()
}
