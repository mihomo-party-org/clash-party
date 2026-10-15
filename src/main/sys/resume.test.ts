import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { recoverAfterResume } from './resume'

const mocks = vi.hoisted(() => ({
  networkInterfaces: vi.fn(),
  isOnline: vi.fn(),
  onResume: vi.fn(),
  getAppConfig: vi.fn(),
  getControledMihomoConfig: vi.fn(),
  hasCoreProcess: vi.fn(),
  restartCore: vi.fn(),
  mihomoVersion: vi.fn(),
  patchMihomoConfig: vi.fn(),
  mihomoHotReloadConfig: vi.fn(),
  triggerSysProxy: vi.fn(),
  warn: vi.fn(),
  info: vi.fn()
}))

vi.mock('os', () => ({ default: { networkInterfaces: mocks.networkInterfaces } }))
vi.mock('electron', () => ({
  net: { isOnline: mocks.isOnline },
  powerMonitor: { on: mocks.onResume }
}))
vi.mock('../config', () => ({
  getAppConfig: mocks.getAppConfig,
  getControledMihomoConfig: mocks.getControledMihomoConfig
}))
vi.mock('../core/manager', () => ({
  hasCoreProcess: mocks.hasCoreProcess,
  restartCore: mocks.restartCore
}))
vi.mock('../core/mihomoApi', () => ({
  mihomoVersion: mocks.mihomoVersion,
  patchMihomoConfig: mocks.patchMihomoConfig,
  mihomoHotReloadConfig: mocks.mihomoHotReloadConfig
}))
vi.mock('../../shared/appConfig', () => ({ getDefaultMihomoTunDevice: () => 'Mihomo' }))
vi.mock('../utils/logger', () => ({
  createLogger: () => ({ warn: mocks.warn, info: mocks.info })
}))
vi.mock('./sysproxy', () => ({ triggerSysProxy: mocks.triggerSysProxy }))

const savedTun = {
  enable: true,
  device: 'Mihomo',
  stack: 'mixed',
  'auto-route': true,
  'auto-detect-interface': true,
  'dns-hijack': ['any:53'],
  'route-exclude-address': ['10.0.0.0/8', '192.168.0.0/16'],
  mtu: 1500
}

describe('recoverAfterResume', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mocks.isOnline.mockReturnValue(true)
    mocks.networkInterfaces.mockReturnValue({})
    mocks.hasCoreProcess.mockReturnValue(true)
    mocks.mihomoVersion.mockResolvedValue({ version: 'test' })
    mocks.getControledMihomoConfig.mockResolvedValue({ tun: savedTun })
    mocks.getAppConfig.mockResolvedValue({ sysProxy: { enable: true } })
    mocks.patchMihomoConfig.mockResolvedValue(undefined)
    mocks.mihomoHotReloadConfig.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function recover(): Promise<void> {
    const recovery = recoverAfterResume()
    await vi.runAllTimersAsync()
    await recovery
  }

  it('restores the complete TUN configuration when the device disappears', async () => {
    let runtimeTun: Record<string, unknown> = { ...savedTun }
    mocks.patchMihomoConfig.mockImplementation(async ({ tun }) => {
      // The core constructs a new TUN configuration from the PATCH object;
      // omitted routing and DNS fields do not inherit their previous values.
      runtimeTun = { device: '', 'auto-route': false, 'dns-hijack': null, ...tun }
    })
    mocks.mihomoHotReloadConfig.mockImplementation(async () => {
      runtimeTun = { ...savedTun }
    })

    await recover()

    expect(runtimeTun).toEqual(savedTun)
    expect(mocks.patchMihomoConfig).toHaveBeenCalledTimes(1)
    expect(mocks.patchMihomoConfig).toHaveBeenCalledWith({ tun: { enable: false } })
    expect(mocks.mihomoHotReloadConfig).toHaveBeenCalledTimes(1)
    expect(mocks.patchMihomoConfig.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.mihomoHotReloadConfig.mock.invocationCallOrder[0]
    )
    expect(mocks.triggerSysProxy).toHaveBeenCalledWith(true)
  })

  it('reloads the full configuration when the TUN device still exists', async () => {
    mocks.networkInterfaces.mockReturnValue({ Mihomo: [] })

    await recover()

    expect(mocks.patchMihomoConfig).not.toHaveBeenCalled()
    expect(mocks.mihomoHotReloadConfig).toHaveBeenCalledTimes(1)
  })

  it('does not enable TUN when it is disabled in the saved configuration', async () => {
    mocks.getControledMihomoConfig.mockResolvedValue({ tun: { ...savedTun, enable: false } })

    await recover()

    expect(mocks.patchMihomoConfig).not.toHaveBeenCalled()
    expect(mocks.mihomoHotReloadConfig).not.toHaveBeenCalled()
  })

  it('restarts an unreachable core', async () => {
    mocks.hasCoreProcess.mockReturnValue(false)

    await recover()

    expect(mocks.restartCore).toHaveBeenCalledTimes(1)
    expect(mocks.patchMihomoConfig).not.toHaveBeenCalled()
  })
})
