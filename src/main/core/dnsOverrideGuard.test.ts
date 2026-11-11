import { beforeEach, describe, expect, it, vi } from 'vitest'
import { confirmLocalSwitchDns, localSwitchNeedsDnsConfirm } from './dnsOverrideGuard'

const mocks = vi.hoisted(() => ({
  getAppConfig: vi.fn(),
  getProfile: vi.fn(),
  getProfileConfig: vi.fn(),
  showMessageBox: vi.fn()
}))

vi.mock('electron', () => ({ dialog: { showMessageBox: mocks.showMessageBox } }))
vi.mock('../config', () => ({
  getAppConfig: mocks.getAppConfig,
  getProfile: mocks.getProfile,
  getProfileConfig: mocks.getProfileConfig,
  syncAppConfigAfterApply: vi.fn()
}))
vi.mock('../window', () => ({ mainWindow: undefined }))
vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}))

const items = [
  { id: 'sub', type: 'remote', name: 'Sub' },
  { id: 'local', type: 'local', name: 'Local' },
  { id: 'plugin', type: 'local', name: 'Plugin', pluginId: 'p' }
]
const customDns = { dns: { 'proxy-server-nameserver': ['https://1.1.1.1/dns-query'] } }

describe('localSwitchNeedsDnsConfirm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAppConfig.mockResolvedValue({})
    mocks.getProfileConfig.mockResolvedValue({ current: 'sub', items })
    mocks.getProfile.mockResolvedValue(customDns)
  })

  it('asks when switching from a subscription with custom DNS to the local profile', async () => {
    await expect(localSwitchNeedsDnsConfirm('local')).resolves.toBe(true)
    expect(mocks.getProfile).toHaveBeenCalledWith('sub')
  })

  it('does not ask when the current subscription has no guarded DNS fields', async () => {
    mocks.getProfile.mockResolvedValue({ dns: { enable: true, nameserver: ['223.5.5.5'] } })
    await expect(localSwitchNeedsDnsConfirm('local')).resolves.toBe(false)
  })

  it('only guards switches into a local profile', async () => {
    mocks.getProfileConfig.mockResolvedValue({ current: 'local', items })
    await expect(localSwitchNeedsDnsConfirm('sub')).resolves.toBe(false)
    await expect(localSwitchNeedsDnsConfirm('plugin')).resolves.toBe(false)
    expect(mocks.getProfile).not.toHaveBeenCalled()
  })

  it('checks plugin profiles like subscriptions', async () => {
    mocks.getProfileConfig.mockResolvedValue({ current: 'plugin', items })
    await expect(localSwitchNeedsDnsConfirm('local')).resolves.toBe(true)
  })

  it('respects the disabled DNS override guard', async () => {
    mocks.getAppConfig.mockResolvedValue({ disableDnsOverrideGuard: true })
    await expect(localSwitchNeedsDnsConfirm('local')).resolves.toBe(false)
  })

  it('does not ask without a current profile or when it is already current', async () => {
    mocks.getProfileConfig.mockResolvedValue({ items })
    await expect(localSwitchNeedsDnsConfirm('local')).resolves.toBe(false)
    mocks.getProfileConfig.mockResolvedValue({ current: 'local', items })
    await expect(localSwitchNeedsDnsConfirm('local')).resolves.toBe(false)
  })

  it('lets the switch through when the current profile cannot be read', async () => {
    mocks.getProfile.mockRejectedValue(new Error('broken'))
    await expect(localSwitchNeedsDnsConfirm('local')).resolves.toBe(false)
  })
})

describe('confirmLocalSwitchDns', () => {
  it('switches only when the second button is chosen', async () => {
    mocks.showMessageBox.mockResolvedValueOnce({ response: 1 })
    await expect(confirmLocalSwitchDns()).resolves.toBe(true)
    mocks.showMessageBox.mockResolvedValueOnce({ response: 0 })
    await expect(confirmLocalSwitchDns()).resolves.toBe(false)
    expect(mocks.showMessageBox.mock.calls[0][0]).toMatchObject({ defaultId: 0, cancelId: 0 })
  })
})
