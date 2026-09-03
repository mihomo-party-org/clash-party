import { describe, it, expect, beforeEach, vi } from 'vitest'

// getCurrentSSID() shells out, so the SSID is steered by mocking exec's output.
// Tests run as win32 (netsh) because that path is a single deterministic call.
const mocks = vi.hoisted(() => ({
  getAppConfig: vi.fn(),
  getControledMihomoConfig: vi.fn(),
  patchAppConfig: vi.fn(),
  patchControledMihomoConfig: vi.fn(),
  patchMihomoConfig: vi.fn(),
  ssid: { value: '' }
}))

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  exec: (_cmd: string, cb: (e: unknown, r: { stdout: string }) => void) => {
    cb(null, { stdout: `    SSID                   : ${mocks.ssid.value}\r\n` })
  }
}))
vi.mock('../config', () => ({
  getAppConfig: mocks.getAppConfig,
  getControledMihomoConfig: mocks.getControledMihomoConfig,
  patchAppConfig: mocks.patchAppConfig,
  patchControledMihomoConfig: mocks.patchControledMihomoConfig
}))
vi.mock('../config/profile', () => ({
  changeCurrentProfile: vi.fn(),
  getProfileConfig: vi.fn(async () => ({ current: 'a', items: [] }))
}))
vi.mock('../core/mihomoApi', () => ({ patchMihomoConfig: mocks.patchMihomoConfig }))
vi.mock('../core/manager', () => ({ getDefaultDevice: vi.fn() }))
vi.mock('../resolve/tray', () => ({ updateTrayIcon: vi.fn() }))
vi.mock('../window', () => ({ mainWindow: null }))
vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))
vi.mock('electron', () => ({ ipcMain: { emit: vi.fn() }, net: { isOnline: () => true } }))

describe('SSID pause handling', () => {
  const realPlatform = process.platform

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    mocks.getControledMihomoConfig.mockResolvedValue({ mode: 'global' })
    mocks.getAppConfig.mockResolvedValue({
      pauseSSID: ['home', 'office'],
      disableDnsOnPauseSSID: true,
      controlDns: true,
      ssidProfileMap: {},
      ssidProfileRestore: false
    })
  })

  const restorePlatform = (): void => {
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true })
  }

  it('restores the mode the user had, not a hardcoded rule', async () => {
    const { checkSSIDForTest } = await import('./ssid')
    mocks.ssid.value = 'home'
    await checkSSIDForTest()
    mocks.ssid.value = 'cafe'
    await checkSSIDForTest()
    restorePlatform()

    const modes = mocks.patchControledMihomoConfig.mock.calls.map((c) => c[0].mode)
    expect(modes[0]).toBe('direct')
    expect(modes[modes.length - 1]).toBe('global')
    expect(modes).not.toContain('rule')
  })

  it('does not overwrite the DNS backup when moving between two paused SSIDs', async () => {
    const { checkSSIDForTest } = await import('./ssid')
    mocks.ssid.value = 'home'
    await checkSSIDForTest()
    mocks.ssid.value = 'office'
    await checkSSIDForTest()
    restorePlatform()

    const backups = mocks.patchAppConfig.mock.calls
      .map((c) => c[0])
      .filter((p) => 'controlDnsBeforePause' in p)
    expect(backups).toHaveLength(1)
    expect(backups[0].controlDnsBeforePause).toBe(true)
  })
})
