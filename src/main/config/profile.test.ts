import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProfile } from './profile'

let testDir = ''

const mocks = vi.hoisted(() => ({
  axiosGet: vi.fn(),
  checkProfileConfig: vi.fn(),
  generateProfile: vi.fn(),
  hotReload: vi.fn(),
  restartCore: vi.fn()
}))

vi.mock('electron', () => ({ app: { getVersion: () => '2.0.0' } }))
vi.mock('i18next', () => ({ default: { t: (key: string) => key } }))
vi.mock('axios', () => ({ default: { get: mocks.axiosGet } }))
vi.mock('../utils/age', () => ({
  decryptAgeContent: (content: string) => Promise.resolve(content)
}))
vi.mock('../utils/dirs', () => ({
  mihomoCorePath: () => join(testDir, 'mihomo'),
  mihomoProfileWorkDir: (id: string) => join(testDir, 'work', id),
  mihomoWorkDir: () => join(testDir, 'work'),
  profileConfigPath: () => join(testDir, 'profile.yaml'),
  profilePath: (id: string) => join(testDir, 'profiles', `${id}.yaml`)
}))
vi.mock('../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))
vi.mock('../resolve/server', () => ({ subStorePort: 8299 }))
vi.mock('../core/mihomoApi', () => ({
  mihomoCloseAllConnections: vi.fn(),
  mihomoHotReloadConfig: mocks.hotReload
}))
vi.mock('../core/manager', () => ({
  checkProfileConfig: mocks.checkProfileConfig,
  restartCore: mocks.restartCore
}))
vi.mock('../core/factory', () => ({ generateProfile: mocks.generateProfile }))
vi.mock('../core/profileUpdater', () => ({
  addProfileUpdater: vi.fn(),
  removeProfileUpdater: vi.fn()
}))
vi.mock('./app', () => ({
  getAppConfig: () =>
    Promise.resolve({
      core: 'mihomo',
      subscriptionTimeout: 30000,
      userAgent: 'mihomo.party/v2.0.0 (clash.meta)'
    })
}))
vi.mock('./controledMihomo', () => ({
  getControledMihomoConfig: () => Promise.resolve({ 'mixed-port': 7890 })
}))

const oldProfile = `proxies:
  - name: old
    type: http
    server: 127.0.0.1
    port: 8080
`

const newProfile = `proxies:
  - name: new
    type: http
    server: 127.0.0.1
    port: 8081
`

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'mihomo-party-profile-test-'))
  mkdirSync(join(testDir, 'profiles'), { recursive: true })
  writeFileSync(
    join(testDir, 'profile.yaml'),
    'current: remote\nitems:\n  - id: remote\n    type: remote\n    name: Remote\n'
  )
  writeFileSync(join(testDir, 'profiles', 'remote.yaml'), oldProfile)

  vi.clearAllMocks()
  mocks.axiosGet.mockResolvedValue({
    status: 200,
    data: newProfile,
    headers: { 'content-type': 'text/yaml' }
  })
  mocks.generateProfile.mockResolvedValue('remote')
  mocks.checkProfileConfig.mockResolvedValue(undefined)
  mocks.hotReload.mockResolvedValue(undefined)
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('remote profile candidate validation', () => {
  it('keeps the last-known-good profile when semantic validation fails', async () => {
    mocks.checkProfileConfig.mockRejectedValueOnce(new Error("proxy 'missing-group' not found"))

    await expect(
      createProfile({ id: 'remote', type: 'remote', name: 'Remote', url: 'https://example.test' })
    ).rejects.toThrow("proxy 'missing-group' not found")

    expect(readFileSync(join(testDir, 'profiles', 'remote.yaml'), 'utf8')).toBe(oldProfile)
    expect(mocks.generateProfile).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ profileId: 'remote', updateRuntimeConfig: false })
    )
    expect(mocks.hotReload).not.toHaveBeenCalled()
  })

  it('replaces the profile only after semantic validation succeeds', async () => {
    await createProfile({
      id: 'remote',
      type: 'remote',
      name: 'Remote',
      url: 'https://example.test'
    })

    expect(mocks.checkProfileConfig).toHaveBeenCalledOnce()
    expect(readFileSync(join(testDir, 'profiles', 'remote.yaml'), 'utf8')).toBe(newProfile)
    expect(mocks.hotReload).toHaveBeenCalledOnce()
  })
})
