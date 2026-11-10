import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const CORE_DIR = '/Applications/Clash Party.app/Contents/Resources/sidecar'

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  stat: vi.fn(),
  getAppConfig: vi.fn()
}))

vi.mock('child_process', () => ({ execFile: mocks.execFile, exec: vi.fn() }))
vi.mock('fs/promises', () => ({ stat: mocks.stat }))
vi.mock('electron', () => ({ app: { exit: vi.fn() }, dialog: {}, ipcMain: { emit: vi.fn() } }))
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
