import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const CORE_DIR = '/Applications/Clash Party.app/Contents/Resources/sidecar'

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  stat: vi.fn(),
  getAppConfig: vi.fn(),
  appExit: vi.fn(),
  disableSysProxySync: vi.fn()
}))

vi.mock('child_process', () => ({ execFile: mocks.execFile, exec: vi.fn() }))
vi.mock('fs/promises', () => ({ stat: mocks.stat }))
vi.mock('electron', () => ({
  app: { exit: mocks.appExit },
  dialog: {},
  ipcMain: { emit: vi.fn() }
}))
vi.mock('../sys/sysproxy', () => ({ disableSysProxySync: mocks.disableSysProxySync }))
vi.mock('../config', () => ({
  getAppConfig: mocks.getAppConfig,
  getControledMihomoConfig: vi.fn(),
  patchControledMihomoConfig: vi.fn()
}))
vi.mock('../utils/dirs', () => ({
  mihomoCoreDir: () => CORE_DIR,
  mihomoCorePath: (core: string) => `${CORE_DIR}/${core}`
}))
vi.mock('../utils/logger', () => ({
  managerLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))
vi.mock('../sys/autoRun', () => ({ checkAutoRun: vi.fn(), enableAutoRun: vi.fn() }))
vi.mock('../../shared/i18n', () => ({ default: { t: (key: string) => key } }))
vi.mock('./admin', () => ({ checkAdminPrivileges: vi.fn() }))

const originalPlatform = process.platform

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform })
}

beforeEach(() => {
  vi.resetModules()
  mocks.execFile.mockReset()
  mocks.stat.mockReset()
  mocks.getAppConfig.mockReset().mockResolvedValue({ core: 'mihomo' })
  mocks.appExit.mockReset()
  mocks.disableSysProxySync.mockReset()
})

afterEach(() => {
  setPlatform(originalPlatform)
})

describe('grantTunPermissions', () => {
  beforeEach(() => {
    mocks.execFile.mockImplementation((_file, _args, cb) => cb(null, { stdout: '', stderr: '' }))
  })

  it('does not run chown again when the core is already setuid root', async () => {
    // The PKG installer leaves the core like this; chown inside the app bundle then fails
    // with "Operation not permitted" even as root.
    setPlatform('darwin')
    mocks.stat.mockResolvedValue({ mode: 0o104755, uid: 0 })
    const { grantTunPermissions } = await import('./permissions')

    await expect(grantTunPermissions()).resolves.toBeUndefined()
    expect(mocks.stat).toHaveBeenCalledWith(`${CORE_DIR}/mihomo`)
    expect(mocks.execFile).not.toHaveBeenCalled()
  })

  it('still asks for permission when the core is not setuid', async () => {
    setPlatform('darwin')
    mocks.stat.mockResolvedValue({ mode: 0o100755, uid: 0 })
    const { grantTunPermissions } = await import('./permissions')

    await grantTunPermissions()
    expect(mocks.execFile).toHaveBeenCalledTimes(1)
    expect(mocks.execFile.mock.calls[0][0]).toBe('osascript')
  })

  it('still asks for permission when the core cannot be read', async () => {
    setPlatform('darwin')
    mocks.stat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    const { grantTunPermissions } = await import('./permissions')

    await grantTunPermissions()
    expect(mocks.execFile.mock.calls[0][0]).toBe('osascript')
  })

  it('still runs pkexec on Linux when the core is setuid but not owned by root', async () => {
    setPlatform('linux')
    mocks.stat.mockResolvedValue({ mode: 0o104755, uid: 1000 })
    const { grantTunPermissions } = await import('./permissions')

    await grantTunPermissions()
    expect(mocks.execFile.mock.calls.map((call) => call[0])).toEqual(['pkexec', 'pkexec'])
  })

  it('skips pkexec on Linux when the core is already setuid root', async () => {
    setPlatform('linux')
    mocks.stat.mockResolvedValue({ mode: 0o104755, uid: 0 })
    const { grantTunPermissions } = await import('./permissions')

    await grantTunPermissions()
    expect(mocks.execFile).not.toHaveBeenCalled()
  })
})

describe('checkMihomoCorePermissions', () => {
  it('reports setuid root cores as authorized and others as not', async () => {
    setPlatform('darwin')
    const { checkMihomoCorePermissions } = await import('./permissions')

    mocks.stat.mockResolvedValueOnce({ mode: 0o104755, uid: 0 })
    expect(await checkMihomoCorePermissions()).toBe(true)
    mocks.stat.mockResolvedValueOnce({ mode: 0o100755, uid: 0 })
    expect(await checkMihomoCorePermissions()).toBe(false)
    mocks.stat.mockRejectedValueOnce(new Error('ENOENT'))
    expect(await checkMihomoCorePermissions()).toBe(false)
  })
})

describe('restartAsAdmin', () => {
  const originalArgv = process.argv

  type ExecCallback = (error: Error | null, result?: { stdout: string; stderr: string }) => void

  // `granted` decides how the user answers the UAC prompt.
  function mockElevation(granted: boolean): void {
    mocks.execFile.mockImplementation(
      (_file: string, _args: string[], _options: unknown, cb: ExecCallback) => {
        if (granted) cb(null, { stdout: '', stderr: '' })
        else cb(Object.assign(new Error('Command failed'), { code: 1 }))
      }
    )
  }

  function elevateScript(): string {
    const [file, args, options] = mocks.execFile.mock.calls[0]
    expect(file).toBe('powershell.exe')
    expect(args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-Command'])
    expect(options).toMatchObject({ windowsHide: true })
    return args[3]
  }

  function relaunchScript(): string {
    const encoded = elevateScript().match(/'-EncodedCommand', '([A-Za-z0-9+/=]+)'/)?.[1]
    expect(encoded).toBeDefined()
    return Buffer.from(encoded as string, 'base64').toString('utf16le')
  }

  async function restart(
    forTun = true
  ): Promise<{ stopCore: ReturnType<typeof vi.fn>; result: Promise<void> }> {
    const stopCore = vi.fn().mockResolvedValue(undefined)
    const permissions = await import('./permissions')
    permissions.setStopCoreBeforeAdminRestart(stopCore)
    return { stopCore, result: permissions.restartAsAdmin(forTun) }
  }

  beforeEach(() => {
    setPlatform('win32')
    process.argv = ['C:\\Clash Party\\Clash Party.exe', "--it's", '--admin-restart-for-tun']
  })

  afterEach(() => {
    process.argv = originalArgv
  })

  it('asks for admin rights while the app is still running, then stops the core and quits', async () => {
    mockElevation(true)
    const { stopCore, result } = await restart()
    await result

    // UAC is requested first; an elevated PowerShell is what relaunches the app.
    expect(elevateScript()).toContain(
      "Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden"
    )
    expect(elevateScript()).toContain('catch { exit 1 }')
    expect(stopCore).toHaveBeenCalledWith(true)
    expect(mocks.disableSysProxySync).toHaveBeenCalledTimes(1)
    expect(mocks.appExit).toHaveBeenCalledWith(0)
    const order = [
      mocks.execFile.mock.invocationCallOrder[0],
      stopCore.mock.invocationCallOrder[0],
      mocks.disableSysProxySync.mock.invocationCallOrder[0],
      mocks.appExit.mock.invocationCallOrder[0]
    ]
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('relaunches only after this process has exited, so the single-instance lock is free', async () => {
    mockElevation(true)
    const { result } = await restart()
    await result

    const relaunch = relaunchScript()
    expect(relaunch).toMatch(
      new RegExp(`^Wait-Process -Id ${process.pid} -Timeout 15 -ErrorAction SilentlyContinue; `)
    )
    expect(relaunch).toContain(
      `Start-Process -FilePath '${process.execPath}' -ArgumentList '--it''s', '--admin-restart-for-tun'`
    )
    // The relaunch runs inside the elevated PowerShell, so it must not ask for UAC again.
    expect(relaunch).not.toContain('RunAs')
  })

  it('does not add the TUN flag for a plain admin restart', async () => {
    mockElevation(true)
    const { result } = await restart(false)
    await result

    const relaunch = relaunchScript()
    expect(relaunch).toContain("-ArgumentList '--it''s'")
    expect(relaunch).not.toContain('--admin-restart-for-tun')
  })

  it('keeps the app and the core running when UAC is declined', async () => {
    mockElevation(false)
    const { stopCore, result } = await restart()

    await expect(result).rejects.toThrow('Administrator permission was not granted')
    expect(stopCore).not.toHaveBeenCalled()
    expect(mocks.disableSysProxySync).not.toHaveBeenCalled()
    expect(mocks.appExit).not.toHaveBeenCalled()
  })
})
