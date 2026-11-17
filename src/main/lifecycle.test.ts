import { EventEmitter } from 'events'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  app: null as unknown as EventEmitter & {
    exit: ReturnType<typeof vi.fn>
    disableHardwareAcceleration: ReturnType<typeof vi.fn>
    whenReady: () => Promise<void>
  },
  configPath: '',
  powerMonitor: null as unknown as EventEmitter,
  windows: [] as { options: Record<string, unknown>; window: EventEmitter }[],
  legacyElectron: false,
  disableSysProxySync: vi.fn(),
  stopCoreForExit: vi.fn(),
  closeTrafficUsage: vi.fn()
}))

vi.mock('electron', async () => {
  const { EventEmitter } = await import('events')
  h.app = Object.assign(new EventEmitter(), {
    exit: vi.fn(),
    disableHardwareAcceleration: vi.fn(),
    whenReady: (): Promise<void> => Promise.resolve()
  })
  h.powerMonitor = new EventEmitter()
  class BaseWindow extends EventEmitter {
    constructor(options: Record<string, unknown>) {
      super()
      h.windows.push({ options, window: this })
    }
  }
  // Electron 22, used for the Windows 7 build, has no BaseWindow.
  return {
    app: h.app,
    powerMonitor: h.powerMonitor,
    get BaseWindow() {
      return h.legacyElectron ? undefined : BaseWindow
    }
  }
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
vi.mock('./utils/dirs', () => ({
  exePath: () => 'C:\\Clash Party\\Clash Party.exe',
  appConfigPath: () => h.configPath
}))
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
  h.legacyElectron = false
  h.disableSysProxySync.mockReset()
  h.stopCoreForExit.mockReset().mockResolvedValue(undefined)
  h.closeTrafficUsage.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  h.app?.removeAllListeners()
  h.app?.exit.mockReset()
  h.app?.disableHardwareAcceleration.mockReset()
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

  it('still handles BrowserWindow session-end on an Electron without BaseWindow', async () => {
    h.legacyElectron = true
    await setup('win32')
    expect(h.windows).toHaveLength(0)

    const browserWindow = new EventEmitter()
    h.app.emit('browser-window-created', {}, browserWindow)
    browserWindow.emit('session-end')
    expect(h.disableSysProxySync).toHaveBeenCalledTimes(1)
  })

  it.each(['darwin', 'linux'] as const)(
    'does not create the hidden window on %s',
    async (platform) => {
      await setup(platform)
      expect(h.windows).toHaveLength(0)
    }
  )
})

describe('hardware acceleration setting', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'lifecycle-test-'))
    h.configPath = path.join(dir, 'config.yaml')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('turns hardware acceleration off before the function returns', async () => {
    writeFileSync(h.configPath, 'language: en-US\ndisableHardwareAcceleration: true\n')
    const { applyHardwareAccelerationConfig } = await import('./lifecycle')

    // Electron only accepts the call before `ready`, so it must not wait for anything.
    const result: unknown = applyHardwareAccelerationConfig()

    expect(result).toBeUndefined()
    expect(h.app.disableHardwareAcceleration).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['the switch is off', 'disableHardwareAcceleration: false\n'],
    ['the key is missing', 'language: en-US\n'],
    ['the file is empty', '']
  ])('leaves hardware acceleration on when %s', async (_name, content) => {
    writeFileSync(h.configPath, content)
    const { applyHardwareAccelerationConfig } = await import('./lifecycle')

    applyHardwareAccelerationConfig()

    expect(h.app.disableHardwareAcceleration).not.toHaveBeenCalled()
  })

  it('does nothing on first launch, when there is no config file yet', async () => {
    const { applyHardwareAccelerationConfig } = await import('./lifecycle')

    expect(() => applyHardwareAccelerationConfig()).not.toThrow()
    expect(h.app.disableHardwareAcceleration).not.toHaveBeenCalled()
  })

  it('reports a config file that cannot be parsed', async () => {
    writeFileSync(h.configPath, 'disableHardwareAcceleration: [true\n')
    const { applyHardwareAccelerationConfig } = await import('./lifecycle')

    expect(() => applyHardwareAccelerationConfig()).toThrow()
    expect(h.app.disableHardwareAcceleration).not.toHaveBeenCalled()
  })
})
