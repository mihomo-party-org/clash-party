import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  getAppConfig: vi.fn(),
  patchAppConfig: vi.fn(),
  post: vi.fn(),
  isOnline: vi.fn()
}))

vi.mock('child_process', () => ({ exec: mocks.exec }))
vi.mock('electron', () => ({ net: { isOnline: mocks.isOnline } }))
vi.mock('axios', () => ({ default: { post: mocks.post } }))
vi.mock('../config', () => ({
  getAppConfig: mocks.getAppConfig,
  patchAppConfig: mocks.patchAppConfig
}))

function mockNetworkSetup(dns: string): void {
  mocks.exec.mockImplementation(
    (command: string, callback: (error: null, result: { stdout: string }) => void) => {
      if (command === 'route -n get default') {
        callback(null, { stdout: '   interface: en0\n' })
        return
      }
      if (command === 'networksetup -listnetworkserviceorder') {
        callback(null, { stdout: '(1) Wi-Fi\nDevice: en0\n' })
        return
      }
      if (command === 'networksetup -getdnsservers "Wi-Fi"') {
        callback(null, { stdout: dns })
        return
      }
      throw new Error(`Unexpected command: ${command}`)
    }
  )
}

describe('macOS DNS protection', () => {
  const originalPlatform = process.platform

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    mocks.isOnline.mockReturnValue(true)
    mocks.post.mockResolvedValue({})
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
  })

  it('reapplies public DNS when a stale origin marker remains after shutdown', async () => {
    mockNetworkSetup("There aren't any DNS Servers set on Wi-Fi.\n")
    mocks.getAppConfig.mockResolvedValue({ originDNS: 'Empty' })
    const { setPublicDNS } = await import('./dns')

    await setPublicDNS()

    expect(mocks.post).toHaveBeenCalledWith(
      'http://localhost/dns',
      { service: 'Wi-Fi', dns: '223.5.5.5' },
      { socketPath: '/tmp/mihomo-party-helper.sock' }
    )
    expect(mocks.patchAppConfig).not.toHaveBeenCalled()
  })

  it('does not rewrite DNS when the system already has the protected resolver', async () => {
    mockNetworkSetup('223.5.5.5\n')
    mocks.getAppConfig.mockResolvedValue({ originDNS: 'Empty' })
    const { setPublicDNS } = await import('./dns')

    await setPublicDNS()

    expect(mocks.post).not.toHaveBeenCalled()
    expect(mocks.patchAppConfig).not.toHaveBeenCalled()
  })
})
