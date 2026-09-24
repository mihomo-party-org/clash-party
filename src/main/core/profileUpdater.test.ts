import { describe, it, expect, beforeEach, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  auditPluginVault: vi.fn(),
  updatePluginProfile: vi.fn(),
  getAppConfig: vi.fn(),
  getProfileConfig: vi.fn(),
  getCurrentProfileItem: vi.fn(),
  getProfileItem: vi.fn(),
  addProfileItem: vi.fn()
}))

vi.mock('../config', () => ({
  getAppConfig: mocks.getAppConfig,
  getProfileConfig: mocks.getProfileConfig,
  getCurrentProfileItem: mocks.getCurrentProfileItem,
  getProfileItem: mocks.getProfileItem,
  addProfileItem: mocks.addProfileItem
}))

vi.mock('../resolve/plugin', () => ({
  auditPluginVault: mocks.auditPluginVault,
  updatePluginProfile: mocks.updatePluginProfile
}))

vi.mock('../utils/logger', () => ({
  logger: { warn: vi.fn() }
}))

// updateProfile 动态 import('../window') 会拉进 electron；CI `pnpm install --ignore-scripts`
// 没有 Electron 二进制，require('electron') 会同步 spawn install.js 下载并把测试拖到超时。
vi.mock('../window', () => ({ mainWindow: null }))
vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.0-test' },
  BrowserWindow: class {},
  Menu: { buildFromTemplate: () => ({}) },
  screen: {},
  shell: { openExternal: vi.fn() }
}))

describe('initProfileUpdater', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAppConfig.mockResolvedValue({ autoUpdateProfileOnStart: true })
    mocks.getProfileConfig.mockResolvedValue({
      current: 'default',
      items: [
        {
          id: 'profile-plugin',
          type: 'plugin',
          name: 'Demo',
          pluginId: 'plugin-id',
          autoUpdate: false,
          interval: 0
        }
      ]
    })
    mocks.getCurrentProfileItem.mockResolvedValue({
      id: 'default',
      type: 'local',
      name: 'Empty'
    })
    mocks.getProfileItem.mockResolvedValue(undefined)
  })

  it('audits plugin vault availability on startup even when auto update is disabled', async () => {
    const { initProfileUpdater } = await import('./profileUpdater')
    await initProfileUpdater()

    expect(mocks.auditPluginVault).toHaveBeenCalledWith('plugin-id')
    expect(mocks.updatePluginProfile).not.toHaveBeenCalled()
  })

  it('skips remote profile updates on startup when disabled', async () => {
    const remoteProfile = {
      id: 'profile-remote',
      type: 'remote',
      name: 'Remote',
      autoUpdate: true,
      interval: 'invalid cron'
    }
    mocks.getAppConfig.mockResolvedValue({ autoUpdateProfileOnStart: false })
    mocks.getProfileConfig.mockResolvedValue({ current: remoteProfile.id, items: [remoteProfile] })
    mocks.getCurrentProfileItem.mockResolvedValue(remoteProfile)
    mocks.getProfileItem.mockResolvedValue(remoteProfile)

    const { initProfileUpdater } = await import('./profileUpdater')
    await initProfileUpdater()

    expect(mocks.addProfileItem).not.toHaveBeenCalled()
  })

  it('updates remote profiles on startup by default', async () => {
    const remoteProfile = {
      id: 'profile-remote',
      type: 'remote',
      name: 'Remote',
      autoUpdate: true,
      interval: 'invalid cron'
    }
    mocks.getProfileConfig.mockResolvedValue({ current: remoteProfile.id, items: [remoteProfile] })
    mocks.getCurrentProfileItem.mockResolvedValue(remoteProfile)
    mocks.getProfileItem.mockResolvedValue(remoteProfile)

    const { initProfileUpdater } = await import('./profileUpdater')
    await initProfileUpdater()

    expect(mocks.addProfileItem).toHaveBeenCalledWith(remoteProfile)
  })
})

describe('findSubscriptionUpdateFlag', () => {
  it('matches --update-subscription case-insensitively', async () => {
    const { findSubscriptionUpdateFlag } = await import('./profileUpdater')
    expect(findSubscriptionUpdateFlag(['app', '--update-subscription'])).toBe(true)
    expect(findSubscriptionUpdateFlag(['app', '--Update-Subscription'])).toBe(true)
    expect(findSubscriptionUpdateFlag(['app', '--other'])).toBe(false)
    expect(findSubscriptionUpdateFlag(['app'])).toBe(false)
  })
})

describe('forceUpdateAllProfiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updates remote and plugin profiles only', async () => {
    const items = [
      { id: 'a', type: 'remote', name: 'A' },
      { id: 'b', type: 'plugin', name: 'B', pluginId: 'p1' },
      { id: 'c', type: 'local', name: 'C' }
    ]
    mocks.getProfileConfig.mockResolvedValue({ current: 'a', items })
    mocks.getProfileItem.mockImplementation(async (id: string) => items.find((i) => i.id === id))

    const { forceUpdateAllProfiles } = await import('./profileUpdater')
    await forceUpdateAllProfiles()

    expect(mocks.addProfileItem).toHaveBeenCalledTimes(1)
    expect(mocks.addProfileItem).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }))
    expect(mocks.updatePluginProfile).toHaveBeenCalledWith('p1')
  })
})
