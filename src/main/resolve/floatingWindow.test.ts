import { beforeEach, describe, expect, it, vi } from 'vitest'
import { closeFloatingWindow, recreateFloatingWindow, showFloatingWindow } from './floatingWindow'

type MockWindow = {
  destroyed: boolean
  destroy: ReturnType<typeof vi.fn>
  webContents: { on: ReturnType<typeof vi.fn> }
}

function renderProcessGoneHandler(win: MockWindow | undefined): (...args: unknown[]) => void {
  const call = win?.webContents.on.mock.calls.find(([event]) => event === 'render-process-gone')
  if (!call) throw new Error('render-process-gone handler not registered')
  return call[1] as (...args: unknown[]) => void
}

const mocks = vi.hoisted(() => {
  const windows: MockWindow[] = []
  return {
    windows,
    failCreate: { value: false },
    // 置为 true 时，新窗口的页面加载一直挂起，直到窗口被销毁才失败（和 Electron 一样）
    slowLoad: { value: false },
    getAppConfig: vi.fn(),
    patchAppConfig: vi.fn(),
    showTrayIcon: vi.fn()
  }
})

vi.mock('electron', () => {
  class BrowserWindow {
    destroyed = false
    webContents = { on: vi.fn(), send: vi.fn() }
    show = vi.fn()
    // 和 Electron 一样，destroy() 时同步触发 closed
    destroy = vi.fn(() => {
      this.destroyed = true
      for (const [event, handler] of this.on.mock.calls) {
        if (event === 'closed') handler()
      }
    })

    constructor() {
      if (mocks.failCreate.value) throw new Error('create failed')
      mocks.windows.push(this)
    }

    on = vi.fn()
    loadFile = vi.fn(() =>
      mocks.slowLoad.value
        ? new Promise<void>((_resolve, reject) => {
            const destroy = this.destroy.getMockImplementation()
            this.destroy.mockImplementation(() => {
              destroy?.()
              setImmediate(() => reject(new Error('ERR_ABORTED (-3) loading floating.html')))
            })
          })
        : Promise.resolve()
    )
    loadURL = vi.fn(async () => undefined)
    isDestroyed(): boolean {
      return this.destroyed
    }
  }
  return {
    app: { getPath: () => '/nonexistent' },
    BrowserWindow,
    ipcMain: { on: vi.fn(), removeAllListeners: vi.fn() },
    screen: { getDisplayMatching: vi.fn() }
  }
})

vi.mock('electron-window-state', () => ({
  default: () => ({ manage: vi.fn(), saveState: vi.fn() })
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('../config', () => ({
  getAppConfig: mocks.getAppConfig,
  patchAppConfig: mocks.patchAppConfig
}))
vi.mock('../utils/logger', () => ({
  floatingWindowLogger: { log: vi.fn(async () => {}) }
}))
vi.mock('./theme', () => ({ applyTheme: vi.fn() }))
vi.mock('./tray', () => ({ buildContextMenu: vi.fn(), showTrayIcon: mocks.showTrayIcon }))

describe('floating window tray restore', () => {
  beforeEach(async () => {
    mocks.failCreate.value = false
    mocks.slowLoad.value = false
    mocks.getAppConfig.mockResolvedValue({ floatingWindowCompatMode: true })
    await showFloatingWindow()
    vi.clearAllMocks()
    mocks.getAppConfig.mockResolvedValue({ floatingWindowCompatMode: true })
  })

  it('closing the floating window brings the tray back', async () => {
    await closeFloatingWindow()

    expect(mocks.showTrayIcon).toHaveBeenCalledTimes(1)
    expect(mocks.patchAppConfig).toHaveBeenCalledWith({ disableTray: false })
  })

  it('recreating the window keeps the tray disabled (#1398)', async () => {
    const previous = mocks.windows.at(-1)
    const before = mocks.windows.length

    await recreateFloatingWindow()

    expect(previous?.destroy).toHaveBeenCalledTimes(1)
    expect(mocks.windows).toHaveLength(before + 1)
    expect(mocks.showTrayIcon).not.toHaveBeenCalled()
    expect(mocks.patchAppConfig).not.toHaveBeenCalled()
  })

  it('ignores a crash event from the window it just replaced', async () => {
    await recreateFloatingWindow()
    const replaced = mocks.windows.at(-1)
    await recreateFloatingWindow()
    const current = mocks.windows.at(-1)

    renderProcessGoneHandler(replaced)({}, { reason: 'killed' })
    await new Promise((resolve) => setImmediate(resolve))

    expect(current?.destroy).not.toHaveBeenCalled()
    expect(mocks.showTrayIcon).not.toHaveBeenCalled()
    expect(mocks.patchAppConfig).not.toHaveBeenCalled()
  })

  it('still restores the tray when the current window crashes', async () => {
    await recreateFloatingWindow()
    const current = mocks.windows.at(-1)

    renderProcessGoneHandler(current)({}, { reason: 'crashed' })
    await new Promise((resolve) => setImmediate(resolve))

    expect(current?.destroy).toHaveBeenCalledTimes(1)
    expect(mocks.showTrayIcon).toHaveBeenCalledTimes(1)
    expect(mocks.patchAppConfig).toHaveBeenCalledWith({ disableTray: false })
  })

  it('keeps the new window when the replaced one fails to load afterwards', async () => {
    // Toggling the compatibility mode twice quickly: the first rebuild is still loading
    // when the second one destroys it.
    mocks.slowLoad.value = true
    const first = recreateFloatingWindow()
    await new Promise((resolve) => setImmediate(resolve))
    const loading = mocks.windows.at(-1)
    mocks.slowLoad.value = false

    await recreateFloatingWindow()
    const current = mocks.windows.at(-1)
    await expect(first).resolves.toBeUndefined()

    expect(loading?.destroy).toHaveBeenCalledTimes(1)
    expect(current).not.toBe(loading)
    expect(current?.destroy).not.toHaveBeenCalled()
    // The new window is still the floating window, so closing it reaches it.
    await closeFloatingWindow()
    expect(current?.destroy).toHaveBeenCalledTimes(1)
    expect(mocks.patchAppConfig).toHaveBeenCalledTimes(1)
    expect(mocks.patchAppConfig).toHaveBeenCalledWith({ disableTray: false })
  })

  it('restores the tray when recreating the window fails', async () => {
    mocks.failCreate.value = true

    await expect(recreateFloatingWindow()).rejects.toThrow('create failed')

    expect(mocks.showTrayIcon).toHaveBeenCalledTimes(1)
    expect(mocks.patchAppConfig).toHaveBeenCalledWith({ disableTray: false })
  })
})
