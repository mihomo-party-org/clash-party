import { EventEmitter } from 'events'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  app: null as unknown as EventEmitter & {
    exit: ReturnType<typeof vi.fn>
    whenReady: () => Promise<void>
  },
  powerMonitor: null as unknown as EventEmitter,
  windows: [] as { options: Record<string, unknown>; window: EventEmitter }[],
  disableSysProxySync: vi.fn(),
  stopCoreForExit: vi.fn(),
  closeTrafficUsage: vi.fn()
}))

vi.mock('electron', async () => {
  const { EventEmitter } = await import('events')
  h.app = Object.assign(new EventEmitter(), {
    exit: vi.fn(),
    whenReady: (): Promise<void> => Promise.resolve()
  })
  h.powerMonitor = new EventEmitter()
  class BaseWindow extends EventEmitter {
    constructor(options: Record<string, unknown>) {
      super()
      h.windows.push({ options, window: this })
    }
  }
  return { app: h.app, powerMonitor: h.powerMonitor, BaseWindow }
})
vi.mock('./core/manager', () => ({
  stopCoreForExit: h.stopCoreForExit,
  cleanupCoreWatcher: vi.fn()
}))
vi.mock('./core/admin', () => ({ primeAdminPrivilegesCache: vi.fn() }))
vi.mock('./sys/sysproxy', () => ({
  triggerSysProxy: vi.fn(() => Promise.resolve()),
  disableSysProxySync: h.disableSysProxySync
}))
vi.mock('./traffic/recorder', () => ({ closeTrafficUsage: h.closeTrafficUsage }))
vi.mock('./utils/dirs', () => ({ exePath: () => 'C:\\Clash Party\\Clash Party.exe' }))
vi.mock('./window', () => ({ saveMainWindowState: vi.fn() }))

const originalPlatform = process.platform

async function setup(platform: NodeJS.Platform): Promise<void> {
  Object.defineProperty(process, 'platform', { value: platform })
  const { setupAppLifecycle } = await import('./lifecycle')
  setupAppLifecycle()
  // Let app.whenReady() resolve.
  await new Promise((resolve) => setImmediate(resolve))
}

beforeEach(() => {
  vi.resetModules()
  h.windows.length = 0
  h.disableSysProxySync.mockReset()
  h.stopCoreForExit.mockReset().mockResolvedValue(undefined)
  h.closeTrafficUsage.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  h.app?.removeAllListeners()
  h.app?.exit.mockReset()
  h.powerMonitor?.removeAllListeners()
  Object.defineProperty(process, 'platform', { value: originalPlatform })
})

describe('Windows session end', () => {
  it('keeps a hidden window so shutdown is noticed even with no other window open', async () => {
    // Lightweight tray mode destroys the main window; with the floating window off,
    // no BrowserWindow exists to receive session-end.
    await setup('win32')

    expect(h.windows).toHaveLength(1)
    expect(h.windows[0].options).toMatchObject({
      show: false,
      skipTaskbar: true,
      focusable: false
    })

    h.windows[0].window.emit('session-end')
    // Windows may end the process as soon as the handler returns, so the proxy has to be
    // turned off synchronously.
    expect(h.disableSysProxySync).toHaveBeenCalledTimes(1)

    await vi.waitFor(() => expect(h.app.exit).toHaveBeenCalled())
    expect(h.stopCoreForExit).toHaveBeenCalledTimes(1)
  })

  it('cleans up once when both a BrowserWindow and the hidden window get session-end', async () => {
    await setup('win32')
    const browserWindow = new EventEmitter()
    h.app.emit('browser-window-created', {}, browserWindow)

    browserWindow.emit('session-end')
    h.windows[0].window.emit('session-end')

    expect(h.disableSysProxySync).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(h.app.exit).toHaveBeenCalled())
    expect(h.stopCoreForExit).toHaveBeenCalledTimes(1)
  })

  it.each(['darwin', 'linux'] as const)(
    'does not create the hidden window on %s',
    async (platform) => {
      await setup(platform)
      expect(h.windows).toHaveLength(0)
    }
  )
})
