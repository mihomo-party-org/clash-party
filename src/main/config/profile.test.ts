import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addProfileUpdater } from '../core/profileUpdater'
import { getOverrideConfig, updateOverrideConfig } from './override'
import {
  addProfileItem,
  changeCurrentProfile,
  createProfile,
  getProfileImportInfo,
  getProfileConfig,
  getProfileItem,
  removeProfileItem,
  updateProfileConfig,
  updateProfileItem,
  upsertPluginProfile,
  syncPluginProfileSchedule
} from './profile'

let testDir = ''

async function requireProfileItem(id: string) {
  const item = await getProfileItem(id)
  if (!item) throw new Error(`Profile ${id} was not found`)
  return item
}

const mocks = vi.hoisted(() => ({
  axiosHead: vi.fn(),
  axiosGet: vi.fn(),
  checkProfileConfig: vi.fn(),
  getPluginItem: vi.fn(),
  // fires on every profile.yaml path resolution (i.e. at the start of each config read/write)
  onProfileConfigPath: vi.fn(),
  // awaited right after every fs/promises readFile completes (lets a test commit a write "during" a read)
  afterRead: vi.fn(),
  // awaited right before every atomicWriteFile (lets a test race something against a write in flight)
  beforeWrite: vi.fn(),
  generateProfile: vi.fn(),
  hotReload: vi.fn(),
  restartCore: vi.fn(),
  yamlMaxAliasCount: 100
}))

vi.mock('electron', () => ({ app: { getVersion: () => '2.0.0' } }))
vi.mock('fs/promises', async (importOriginal) => {
  const orig = await importOriginal<typeof import('fs/promises')>()
  const readFile = orig.readFile as (p: string, o?: unknown) => Promise<unknown>
  return {
    ...orig,
    readFile: async (p: string, o?: unknown) => {
      const r = await readFile(p, o)
      await mocks.afterRead(p)
      return r
    }
  }
})
vi.mock('../utils/safeFile', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../utils/safeFile')>()
  return {
    ...orig,
    atomicWriteFile: async (...args: Parameters<typeof orig.atomicWriteFile>) => {
      await mocks.beforeWrite(String(args[0]))
      return orig.atomicWriteFile(...args)
    }
  }
})
// the real override module backs the global override set (override.yaml lives in the test dir)
vi.mock('../core/factory', async () => {
  const { getOverrideConfig } = await import('./override')
  return {
    generateProfile: mocks.generateProfile,
    globalOverrideIdsNow: async () =>
      (await getOverrideConfig()).items
        .filter((o: { global?: boolean }) => o.global)
        .map((o: { id: string }) => o.id)
  }
})
vi.mock('i18next', () => ({ default: { t: (key: string) => key } }))
vi.mock('axios', () => ({ default: { get: mocks.axiosGet, head: mocks.axiosHead } }))
vi.mock('../utils/age', () => ({
  decryptAgeContent: (content: string) => Promise.resolve(content)
}))
vi.mock('../utils/dirs', () => ({
  mihomoCorePath: () => join(testDir, 'mihomo'),
  mihomoProfileWorkDir: (id: string) => join(testDir, 'work', id),
  mihomoWorkDir: () => join(testDir, 'work'),
  profileConfigPath: () => {
    mocks.onProfileConfigPath()
    return join(testDir, 'profile.yaml')
  },
  profilePath: (id: string) => join(testDir, 'profiles', `${id}.yaml`),
  overrideConfigPath: () => join(testDir, 'override.yaml'),
  overridePath: (id: string, ext: string) => join(testDir, 'overrides', `${id}.${ext}`)
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
vi.mock('../core/profileUpdater', () => ({
  addProfileUpdater: vi.fn(),
  removeProfileUpdater: vi.fn()
}))
vi.mock('./app', () => ({
  getAppConfig: () =>
    Promise.resolve({
      core: 'mihomo',
      subscriptionTimeout: 30000,
      userAgent: 'mihomo.party/v2.0.0 (clash.meta)',
      yamlMaxAliasCount: mocks.yamlMaxAliasCount
    })
}))
vi.mock('./controledMihomo', () => ({
  getControledMihomoConfig: () => Promise.resolve({ 'mixed-port': 7890 })
}))
vi.mock('./plugin', () => ({
  getPluginItem: mocks.getPluginItem,
  pluginSchedule: (item?: { interval?: number; autoUpdate?: boolean }) => ({
    interval: item?.interval ?? 1440,
    autoUpdate: item?.autoUpdate ?? true
  })
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

beforeEach(async () => {
  testDir = mkdtempSync(join(tmpdir(), 'mihomo-party-profile-test-'))
  mkdirSync(join(testDir, 'profiles'), { recursive: true })
  writeFileSync(
    join(testDir, 'profile.yaml'),
    'current: remote\nitems:\n  - id: remote\n    type: remote\n    name: Remote\n'
  )
  writeFileSync(join(testDir, 'profiles', 'remote.yaml'), oldProfile)
  writeFileSync(join(testDir, 'override.yaml'), 'items: []\n')

  vi.clearAllMocks()
  mocks.onProfileConfigPath.mockReset()
  mocks.afterRead.mockReset()
  mocks.beforeWrite.mockReset()
  mocks.axiosGet.mockResolvedValue({
    status: 200,
    data: newProfile,
    headers: { 'content-type': 'text/yaml' }
  })
  mocks.axiosHead.mockResolvedValue({ status: 200, headers: {} })
  mocks.generateProfile.mockResolvedValue('remote')
  mocks.checkProfileConfig.mockResolvedValue(undefined)
  mocks.hotReload.mockResolvedValue(undefined)
  mocks.yamlMaxAliasCount = 100
  // the plugin record the schedule is read from at write time
  mocks.getPluginItem.mockResolvedValue({ id: 'pg', interval: 60, autoUpdate: true })
  // the module caches must match the freshly written files (all real writes go through the queue and keep them in sync)
  await getProfileConfig(true)
  await getOverrideConfig(true)
})

const globalOverride = (id: string) =>
  ({
    id,
    type: 'local',
    ext: 'yaml',
    name: id,
    updated: 1,
    global: true
  }) as const

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('remote profile candidate validation', () => {
  const aliasedProfile = [
    'base: &base',
    '  type: http',
    '  server: 127.0.0.1',
    '  port: 8080',
    'proxies:',
    ...Array.from({ length: 120 }, (_, i) => `  - <<: *base\n    name: p${i}`),
    ''
  ].join('\n')

  it('uses the configured YAML alias limit for trusted subscriptions', async () => {
    mocks.axiosGet.mockResolvedValue({
      status: 200,
      data: aliasedProfile,
      headers: { 'content-type': 'text/yaml' }
    })

    await expect(
      createProfile({ id: 'remote', type: 'remote', name: 'Remote', url: 'https://example.test' })
    ).rejects.toThrow('Excessive alias count')

    mocks.yamlMaxAliasCount = 200
    await expect(
      createProfile({ id: 'remote', type: 'remote', name: 'Remote', url: 'https://example.test' })
    ).resolves.toMatchObject({ id: 'remote' })
    expect(readFileSync(join(testDir, 'profiles', 'remote.yaml'), 'utf8')).toBe(aliasedProfile)

    mocks.yamlMaxAliasCount = -1
    await expect(
      createProfile({ id: 'remote', type: 'remote', name: 'Remote', url: 'https://example.test' })
    ).resolves.toMatchObject({ id: 'remote' })
  })

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

describe('full profile import', () => {
  it.each(['remote', 'local'] as const)(
    'keeps a complete %s profile selectable with its overrides',
    async (type) => {
      const content = `${newProfile}
proxy-groups:
  - name: Imported
    type: select
    proxies: [new]
rules: ["MATCH,Imported"]
`
      if (type === 'remote') {
        mocks.axiosGet.mockResolvedValueOnce({
          status: 200,
          data: content,
          headers: { 'content-type': 'text/yaml' }
        })
      }
      await updateOverrideConfig((config) => {
        config.items.push({ ...globalOverride('custom'), global: false })
        return config
      })
      const imported = await addProfileItem({
        type,
        name: 'Complete profile',
        url: type === 'remote' ? 'https://example.test/full-profile' : undefined,
        file: type === 'local' ? content : undefined,
        override: ['custom']
      })

      expect(readFileSync(join(testDir, 'profiles', `${imported.id}.yaml`), 'utf8')).toBe(content)
      expect(await getProfileItem(imported.id)).toMatchObject({ type, override: ['custom'] })
      expect(addProfileUpdater).toHaveBeenCalledWith(imported)
      expect((await getProfileConfig()).current).toBe('remote')
      await changeCurrentProfile(imported.id)
      expect((await getProfileConfig(true)).current).toBe(imported.id)
      expect(mocks.restartCore).toHaveBeenCalledOnce()
      expect(existsSync(join(testDir, 'profiles', 'local.yaml'))).toBe(false)
    }
  )
})

describe('custom profile homepage', () => {
  const getRemoteProfile = async () => {
    const item = await getProfileItem('remote')
    if (!item) throw new Error('Missing remote profile')
    return item
  }

  it('preserves a custom homepage across subscription updates and restores the supplied homepage when cleared', async () => {
    const item = {
      ...(await getRemoteProfile()),
      url: 'https://example.test/subscription',
      customHome: '  https://custom.example.test  '
    }
    await updateProfileItem(item)
    for (const home of ['https://provider.example.test', undefined]) {
      mocks.axiosGet.mockResolvedValueOnce({
        status: 200,
        data: newProfile,
        headers: { 'content-type': 'text/yaml', 'profile-web-page-url': home }
      })
      await addProfileItem(await getRemoteProfile())
      expect(await getProfileItem('remote')).toMatchObject({
        customHome: 'https://custom.example.test'
      })
    }

    mocks.axiosGet.mockResolvedValueOnce({
      status: 200,
      data: newProfile,
      headers: { 'content-type': 'text/yaml', 'profile-web-page-url': 'https://new.example.test' }
    })
    await updateProfileItem({ ...(await getRemoteProfile()), customHome: '' })
    await addProfileItem(await getRemoteProfile())
    expect((await getProfileConfig(true)).items[0]).toMatchObject({
      home: 'https://new.example.test'
    })
    expect((await getRemoteProfile()).customHome).toBeUndefined()
  })

  it.each(['invalid', 'javascript:alert(1)', 'file:///tmp/example'])(
    'rejects unsupported homepage %s without changing the saved profile',
    async (customHome) => {
      const original = await getRemoteProfile()
      await expect(updateProfileItem({ ...original, customHome })).rejects.toThrow()
      await expect(createProfile({ ...original, customHome })).rejects.toThrow()
      expect(await getProfileItem('remote')).toEqual(original)
      expect(mocks.axiosGet).not.toHaveBeenCalled()
    }
  )
})

describe('remote profile import metadata', () => {
  it('reads metadata from HEAD before importing', async () => {
    mocks.axiosHead.mockResolvedValueOnce({
      status: 200,
      headers: {
        'content-disposition': 'attachment; filename="my-profile.yaml"',
        'profile-web-page-url': 'https://example.test/home',
        'profile-update-interval': '12',
        'subscription-userinfo': 'upload=1; download=2; total=3; expire=4'
      }
    })

    await expect(
      getProfileImportInfo({
        url: 'https://example.test/sub',
        useProxy: false,
        substore: false,
        allowFixedInterval: false
      })
    ).resolves.toMatchObject({
      name: 'my-profile.yaml',
      home: 'https://example.test/home',
      interval: 720,
      extra: { upload: 1, download: 2, total: 3, expire: 4 }
    })
    expect(mocks.axiosHead).toHaveBeenCalledOnce()
    expect(mocks.axiosGet).not.toHaveBeenCalled()
  })

  it('uses response headers and URL name when HEAD has no metadata', async () => {
    mocks.axiosHead.mockResolvedValueOnce({ status: 200, headers: {} })
    mocks.axiosGet.mockResolvedValueOnce({
      status: 200,
      data: '',
      headers: { 'profile-web-page-url': 'https://example.test/home' }
    })

    await expect(
      getProfileImportInfo({
        url: 'https://example.test/my-profile.yaml',
        useProxy: false,
        substore: false,
        allowFixedInterval: false
      })
    ).resolves.toMatchObject({
      name: 'my-profile',
      home: 'https://example.test/home'
    })
  })
})

describe('profile deletion (R2-ISS-034 / R2-ISS-067)', () => {
  it('a failed core restart deletes nothing: the record stays for a retry, and the retry completes the deletion', async () => {
    const workDir = join(testDir, 'work', 'remote')
    mkdirSync(workDir, { recursive: true })
    writeFileSync(join(workDir, 'config.yaml'), 'proxies: []\n')
    mocks.restartCore.mockRejectedValueOnce(new Error('restart failed'))

    await expect(removeProfileItem('remote')).rejects.toThrow('restart failed')
    expect(existsSync(workDir)).toBe(true)
    expect(existsSync(join(testDir, 'profiles', 'remote.yaml'))).toBe(true)
    expect(readFileSync(join(testDir, 'profile.yaml'), 'utf8')).toContain('id: remote')
    expect(vi.mocked(addProfileUpdater)).toHaveBeenCalledOnce() // timer re-armed

    await removeProfileItem('remote') // current already moved away → no restart needed
    expect(existsSync(workDir)).toBe(false)
    expect(existsSync(join(testDir, 'profiles', 'remote.yaml'))).toBe(false)
    expect(readFileSync(join(testDir, 'profile.yaml'), 'utf8')).not.toContain('id: remote')
  })

  it('R2-ISS-071: concurrent deletions never leave current pointing at a deleted profile', async () => {
    writeFileSync(
      join(testDir, 'profile.yaml'),
      'current: A\nitems:\n  - id: A\n    type: remote\n    name: A\n  - id: B\n    type: remote\n    name: B\n'
    )
    await getProfileConfig(true)
    const results = await Promise.allSettled([removeProfileItem('A'), removeProfileItem('B')])
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled'])
    expect(await getProfileConfig()).toEqual({ current: undefined, items: [] })
  })

  it.each([1, 2])(
    'R2-ISS-072 (V2): a failed profile.yaml write (#%s) during deletion keeps the record and re-arms its updater',
    async (failing) => {
      let writes = 0
      mocks.beforeWrite.mockImplementation(async (p: string) => {
        if (!p.endsWith('profile.yaml')) return
        writes++
        if (writes === failing) throw new Error('disk full')
      })
      await expect(removeProfileItem('remote')).rejects.toThrow('disk full')
      expect(readFileSync(join(testDir, 'profile.yaml'), 'utf8')).toContain('id: remote')
      expect(vi.mocked(addProfileUpdater)).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'remote' })
      )
    }
  )

  it('R2-ISS-067: a failed subscription-file removal keeps the record (and the work dir) so the user can retry', async () => {
    const workDir = join(testDir, 'work', 'remote')
    mkdirSync(workDir, { recursive: true })
    writeFileSync(join(workDir, 'config.yaml'), 'proxies: []\n')
    // a directory where the file should be: rm() without recursive fails (EISDIR / EPERM-like)
    rmSync(join(testDir, 'profiles', 'remote.yaml'))
    mkdirSync(join(testDir, 'profiles', 'remote.yaml'))

    await expect(removeProfileItem('remote')).rejects.toThrow()
    expect(readFileSync(join(testDir, 'profile.yaml'), 'utf8')).toContain('id: remote')
    expect(existsSync(workDir)).toBe(true)
    // the record stays → its updater is re-armed (R2-ISS-072)
    expect(vi.mocked(addProfileUpdater)).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'remote' })
    )

    rmSync(join(testDir, 'profiles', 'remote.yaml'), { recursive: true })
    await removeProfileItem('remote')
    expect(existsSync(workDir)).toBe(false)
    expect(readFileSync(join(testDir, 'profile.yaml'), 'utf8')).not.toContain('id: remote')
  })
})

describe('plugin subscription validation (BL-002)', () => {
  const meta = { profileId: 'plugin1', pluginId: 'pg', name: 'P' }

  it('rejects a subscription that fails core validation and keeps the old file', async () => {
    writeFileSync(join(testDir, 'profiles', 'plugin1.yaml'), oldProfile)
    mocks.checkProfileConfig.mockRejectedValueOnce(new Error("proxy 'missing' not found"))
    await expect(upsertPluginProfile(meta, newProfile)).rejects.toMatchObject({
      code: 'PLUGIN_PROFILE_INVALID'
    })
    expect(readFileSync(join(testDir, 'profiles', 'plugin1.yaml'), 'utf8')).toBe(oldProfile)
    expect(mocks.generateProfile).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ profileId: 'plugin1', updateRuntimeConfig: false })
    )
    expect(mocks.checkProfileConfig).toHaveBeenCalledOnce()
    // the item was never inserted, so no updater was armed
    expect(vi.mocked(addProfileUpdater)).not.toHaveBeenCalled()
  })

  it('writes a subscription that passes validation and arms the updater on first insert', async () => {
    await upsertPluginProfile(meta, newProfile)
    expect(readFileSync(join(testDir, 'profiles', 'plugin1.yaml'), 'utf8')).toBe(newProfile)
    expect(vi.mocked(addProfileUpdater)).toHaveBeenCalledOnce()
    expect(vi.mocked(addProfileUpdater).mock.calls[0][0]).toMatchObject({
      id: 'plugin1',
      type: 'local',
      autoUpdate: true,
      interval: 60
    })
  })
})

describe('plugin schedule sync (BL-003)', () => {
  it('updates the profile item and always re-arms (idempotent); unknown profile is a no-op', async () => {
    await upsertPluginProfile({ profileId: 'plugin1', pluginId: 'pg', name: 'P' }, newProfile)
    vi.mocked(addProfileUpdater).mockClear()
    await syncPluginProfileSchedule('plugin1', { autoUpdate: false })
    expect(vi.mocked(addProfileUpdater)).toHaveBeenCalledOnce()
    expect(vi.mocked(addProfileUpdater).mock.calls[0][0]).toMatchObject({
      id: 'plugin1',
      autoUpdate: false,
      interval: 60
    })
    expect(readFileSync(join(testDir, 'profile.yaml'), 'utf8')).toContain('autoUpdate: false')
    // an unchanged sync still re-arms: the decision is never based on a possibly stale cache
    await syncPluginProfileSchedule('plugin1', { autoUpdate: false })
    expect(vi.mocked(addProfileUpdater)).toHaveBeenCalledTimes(2)
    await syncPluginProfileSchedule('nope', { autoUpdate: false }) // unknown profile → no-op
    expect(vi.mocked(addProfileUpdater)).toHaveBeenCalledTimes(2)
  })
})

describe('plugin subscription validation follow-ups (V6 regressions)', () => {
  const meta = { profileId: 'plugin1', pluginId: 'pg', name: 'P' }

  it('forwards the caller signal and a hard timeout to the core validator', async () => {
    const ac = new AbortController()
    await upsertPluginProfile(meta, newProfile, ac.signal)
    expect(mocks.checkProfileConfig).toHaveBeenLastCalledWith(
      expect.any(String),
      'mihomo',
      undefined,
      expect.objectContaining({ signal: ac.signal, timeoutMs: expect.any(Number) })
    )
  })

  it('does not revert a user override changed while the core was validating', async () => {
    await upsertPluginProfile(meta, newProfile)
    await updateProfileItem({ ...(await requireProfileItem('plugin1')), override: ['A'] })
    // the validator "takes a while"; meanwhile the user switches the override to B
    mocks.checkProfileConfig.mockImplementationOnce(async () => {
      await updateProfileItem({ ...(await requireProfileItem('plugin1')), override: ['B'] })
    })
    await upsertPluginProfile(meta, oldProfile)
    expect((await getProfileItem('plugin1'))?.override).toEqual(['B'])
    expect(readFileSync(join(testDir, 'profiles', 'plugin1.yaml'), 'utf8')).toBe(oldProfile)
  })

  it('concurrent off→on schedule toggles end with the updater armed (last writer wins)', async () => {
    await upsertPluginProfile(meta, newProfile)
    vi.mocked(addProfileUpdater).mockClear()
    await Promise.all([
      syncPluginProfileSchedule('plugin1', { autoUpdate: false }),
      syncPluginProfileSchedule('plugin1', { autoUpdate: true })
    ])
    const calls = vi.mocked(addProfileUpdater).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[calls.length - 1][0]).toMatchObject({ id: 'plugin1', autoUpdate: true })
    expect((await getProfileItem('plugin1'))?.autoUpdate).toBe(true)
  })
})

describe('plugin subscription validation follow-ups (V7 regressions)', () => {
  const meta = { profileId: 'plugin1', pluginId: 'pg', name: 'P' }

  it('R2-ISS-051: refuses to write when the budget ran out after validation succeeded', async () => {
    writeFileSync(join(testDir, 'profiles', 'plugin1.yaml'), oldProfile)
    const ac = new AbortController()
    // the core check itself passed; the budget expires while the candidate dir is being cleaned up
    mocks.checkProfileConfig.mockImplementationOnce(async () => ac.abort())
    await expect(upsertPluginProfile(meta, newProfile, ac.signal)).rejects.toMatchObject({
      code: 'PLUGIN_PROFILE_INVALID'
    })
    expect(readFileSync(join(testDir, 'profiles', 'plugin1.yaml'), 'utf8')).toBe(oldProfile)
    expect(readFileSync(join(testDir, 'profile.yaml'), 'utf8')).not.toContain('plugin1')
    expect(vi.mocked(addProfileUpdater)).not.toHaveBeenCalled()
  })

  it('R2-ISS-051: refuses to write when the budget runs out during the config read that precedes the write', async () => {
    writeFileSync(join(testDir, 'profiles', 'plugin1.yaml'), oldProfile)
    const ac = new AbortController()
    let validated = false
    mocks.checkProfileConfig.mockImplementationOnce(async () => {
      validated = true
    })
    // the first config read after validation is setProfileStr's; the budget expires while it is in flight
    mocks.onProfileConfigPath.mockImplementation(() => {
      if (validated && !ac.signal.aborted) ac.abort()
    })
    await expect(upsertPluginProfile(meta, newProfile, ac.signal)).rejects.toMatchObject({
      code: 'PLUGIN_PROFILE_INVALID'
    })
    expect(readFileSync(join(testDir, 'profiles', 'plugin1.yaml'), 'utf8')).toBe(oldProfile)
    expect(readFileSync(join(testDir, 'profile.yaml'), 'utf8')).not.toContain('plugin1')
    expect(vi.mocked(addProfileUpdater)).not.toHaveBeenCalled()
  })

  it('R2-ISS-053: an override enabled during validation triggers a re-validation against the new set before the write', async () => {
    await upsertPluginProfile(meta, newProfile)
    await updateProfileItem({ ...(await requireProfileItem('plugin1')), override: ['A'] })
    mocks.generateProfile.mockClear()
    mocks.checkProfileConfig.mockImplementationOnce(async () => {
      await updateProfileItem({ ...(await requireProfileItem('plugin1')), override: ['A', 'B'] })
    })
    await upsertPluginProfile(meta, oldProfile)
    // validated once against [A], then again against [A, B]; the write happened after the second pass
    expect(mocks.generateProfile).toHaveBeenCalledTimes(2)
    expect(mocks.generateProfile.mock.calls[0][1]).toMatchObject({ profileOverrideIds: ['A'] })
    expect(mocks.generateProfile.mock.calls[1][1]).toMatchObject({ profileOverrideIds: ['A', 'B'] })
    expect((await getProfileItem('plugin1'))?.override).toEqual(['A', 'B'])
    expect(readFileSync(join(testDir, 'profiles', 'plugin1.yaml'), 'utf8')).toBe(oldProfile)
  })

  it('R2-ISS-053: a global override toggled during validation also forces a re-validation', async () => {
    await upsertPluginProfile(meta, newProfile)
    mocks.generateProfile.mockClear()
    mocks.checkProfileConfig.mockImplementationOnce(async () => {
      await updateOverrideConfig(() => ({ items: [globalOverride('G')] }))
    })
    await upsertPluginProfile(meta, oldProfile)
    expect(mocks.generateProfile).toHaveBeenCalledTimes(2)
    // the global set the core validated against is the one the caller recorded, passed in explicitly
    expect(mocks.generateProfile.mock.calls[0][1]).toMatchObject({ globalOverrideIds: [] })
    expect(mocks.generateProfile.mock.calls[1][1]).toMatchObject({ globalOverrideIds: ['G'] })
    expect(readFileSync(join(testDir, 'profiles', 'plugin1.yaml'), 'utf8')).toBe(oldProfile)
  })

  it('R2-ISS-053 (V1-R5): a global override flipped off and back on around the generation step is still caught', async () => {
    await updateOverrideConfig(() => ({ items: [globalOverride('G')] }))
    await upsertPluginProfile(meta, newProfile)
    mocks.generateProfile.mockClear()
    // the recorded set is [G]; G is off while the config is generated and back on before the commit check
    mocks.generateProfile.mockImplementationOnce(
      async (_c: unknown, o?: { globalOverrideIds?: string[] }) => {
        expect(o?.globalOverrideIds).toEqual(['G']) // generation uses the recorded set, not a fresh read
        await updateOverrideConfig(() => ({ items: [] }))
        return 'remote'
      }
    )
    mocks.checkProfileConfig.mockImplementationOnce(async () => {
      await updateOverrideConfig(() => ({ items: [globalOverride('G')] }))
    })
    await upsertPluginProfile(meta, oldProfile)
    expect(mocks.generateProfile).toHaveBeenCalledTimes(1)
    expect(readFileSync(join(testDir, 'profiles', 'plugin1.yaml'), 'utf8')).toBe(oldProfile)
  })

  it('R2-ISS-053 (V2-R5): a global override toggle cannot land between the final check and the file write', async () => {
    await upsertPluginProfile(meta, newProfile)
    mocks.generateProfile.mockClear()
    let toggle: Promise<void> | undefined
    let landedDuringWrite: boolean | undefined
    mocks.beforeWrite.mockImplementation(async (p: string) => {
      if (toggle || !p.endsWith(join('profiles', 'plugin1.yaml'))) return
      // the commit passed its final check and is about to replace the file: flip a global override now
      toggle = updateOverrideConfig(() => ({ items: [globalOverride('G')] }))
      await new Promise((r) => setTimeout(r, 30))
      landedDuringWrite = (await getOverrideConfig()).items.length > 0
    })
    await upsertPluginProfile(meta, oldProfile)
    // the toggle was queued behind the commit's critical section (shared runtime-config write queue)
    expect(landedDuringWrite).toBe(false)
    await toggle
    expect((await getOverrideConfig()).items.map((i: { id: string }) => i.id)).toEqual(['G'])
    // what landed was validated against the set that was current at the write: no globals
    expect(mocks.generateProfile).toHaveBeenCalledTimes(1)
    expect(mocks.generateProfile.mock.calls[0][1]).toMatchObject({ globalOverrideIds: [] })
    expect(readFileSync(join(testDir, 'profiles', 'plugin1.yaml'), 'utf8')).toBe(oldProfile)
  })

  it('R2-ISS-063: a forced override read that completes after a queued write does not roll the cache back', async () => {
    let injected = false
    mocks.afterRead.mockImplementation(async (p: string) => {
      if (injected || !p.endsWith('override.yaml')) return
      injected = true
      await updateOverrideConfig(() => ({ items: [globalOverride('NEW')] }))
    })
    const forced = await getOverrideConfig(true)
    expect(forced.items.map((i: { id: string }) => i.id)).toEqual(['NEW'])
    expect((await getOverrideConfig()).items.map((i: { id: string }) => i.id)).toEqual(['NEW'])
  })

  it('R2-ISS-065: a budget that expires while the commit waits for the write queue aborts the commit without writing', async () => {
    await upsertPluginProfile(meta, newProfile)
    let release!: () => void
    const held = updateProfileConfig(async (c) => {
      await new Promise<void>((r) => {
        release = r
      })
      return c
    })
    await new Promise((r) => setTimeout(r, 5)) // the holder is inside the queue
    const ac = new AbortController()
    const commit = upsertPluginProfile(meta, oldProfile, ac.signal)
    await new Promise((r) => setTimeout(r, 20)) // validated; now queued behind the holder
    ac.abort(new Error('budget exhausted'))
    await expect(commit).rejects.toMatchObject({ code: 'PLUGIN_PROFILE_INVALID' })
    release()
    await held
    expect(readFileSync(join(testDir, 'profiles', 'plugin1.yaml'), 'utf8')).toBe(newProfile)
  })

  it('R2-ISS-073: a commit error after the subscription file was written is reported as-is, even if the budget expired meanwhile', async () => {
    await upsertPluginProfile(meta, newProfile)
    const ac = new AbortController()
    let subscriptionWritten = false
    mocks.beforeWrite.mockImplementation(async (p: string) => {
      if (p.endsWith(join('profiles', 'plugin1.yaml'))) subscriptionWritten = true
      else if (subscriptionWritten && p.endsWith('profile.yaml')) {
        ac.abort(new Error('budget exhausted'))
        throw new Error('disk full')
      }
    })
    await expect(upsertPluginProfile(meta, oldProfile, ac.signal)).rejects.toThrow('disk full')
  })

  it('R2-ISS-060: a failed first activation does not lose the auto-update timer on the retry', async () => {
    writeFileSync(join(testDir, 'profile.yaml'), 'items: []\n')
    mocks.restartCore.mockRejectedValueOnce(new Error('core refused to start'))
    await expect(upsertPluginProfile(meta, newProfile)).rejects.toThrow('core refused to start')
    // the item and its schedule were committed; the updater was armed before the activation attempt
    expect(await getProfileItem('plugin1')).toMatchObject({ interval: 60, autoUpdate: true })
    expect(vi.mocked(addProfileUpdater)).toHaveBeenCalledOnce()
    expect((await getProfileConfig()).current).toBeUndefined()
    await upsertPluginProfile(meta, newProfile) // next login: activation succeeds
    expect((await getProfileConfig()).current).toBe('plugin1')
    expect(vi.mocked(addProfileUpdater)).toHaveBeenCalledOnce() // nothing changed → not re-armed, but armed
  })

  it('R2-ISS-053: gives up after bounded re-validations when the override set keeps changing; old file kept', async () => {
    await upsertPluginProfile(meta, newProfile)
    mocks.generateProfile.mockClear()
    let n = 0
    mocks.checkProfileConfig.mockImplementation(async () => {
      n++
      await updateProfileItem({ ...(await requireProfileItem('plugin1')), override: [`O${n}`] })
    })
    await expect(upsertPluginProfile(meta, oldProfile)).rejects.toMatchObject({
      code: 'PLUGIN_PROFILE_INVALID'
    })
    expect(mocks.generateProfile).toHaveBeenCalledTimes(3) // 1 + MAX_PLUGIN_PROFILE_REVALIDATIONS
    expect(readFileSync(join(testDir, 'profiles', 'plugin1.yaml'), 'utf8')).toBe(newProfile)
  })

  it('R2-ISS-057: the first subscription (no current profile yet) is activated through the real switch flow', async () => {
    writeFileSync(join(testDir, 'profile.yaml'), 'items: []\n')
    await upsertPluginProfile(meta, newProfile)
    expect((await getProfileConfig()).current).toBe('plugin1')
    // useHotReloadProfile is off in this harness → the switch flow restarts the core
    expect(mocks.restartCore).toHaveBeenCalledOnce()
  })

  it('R2-ISS-057: a re-fetch of the current plugin profile hot-reloads; a non-current one leaves the core alone', async () => {
    await upsertPluginProfile(meta, newProfile) // current stays "remote"
    expect(mocks.hotReload).not.toHaveBeenCalled()
    expect(mocks.restartCore).not.toHaveBeenCalled()
    await updateProfileConfig((c) => {
      c.current = 'plugin1'
      return c
    })
    await upsertPluginProfile(meta, oldProfile)
    expect(mocks.hotReload).toHaveBeenCalledOnce()
  })

  it('R2-ISS-056: a forced config read that completes after a queued write does not roll the cache back', async () => {
    await getProfileConfig(true)
    let injected = false
    mocks.afterRead.mockImplementation(async (p: string) => {
      if (injected || !p.endsWith('profile.yaml')) return
      injected = true
      // commits (and caches) a newer config while the forced read's file content is already in hand
      await updateProfileConfig((c) => {
        c.current = 'newer'
        return c
      })
    })
    const forced = await getProfileConfig(true)
    expect(forced.current).toBe('newer')
    expect((await getProfileConfig()).current).toBe('newer')
    expect(readFileSync(join(testDir, 'profile.yaml'), 'utf8')).toContain('current: newer')
  })

  it('R2-ISS-052: an in-flight fetch does not revert a schedule the user changed during validation', async () => {
    mocks.getPluginItem.mockResolvedValue({ id: 'pg', interval: 60, autoUpdate: false })
    await upsertPluginProfile(meta, newProfile)
    expect((await getProfileItem('plugin1'))?.autoUpdate).toBe(false)
    vi.mocked(addProfileUpdater).mockClear()
    // the next fetch is validating; meanwhile the user turns auto-update on (plugin record + schedule sync)
    mocks.checkProfileConfig.mockImplementationOnce(async () => {
      mocks.getPluginItem.mockResolvedValue({ id: 'pg', interval: 60, autoUpdate: true })
      await syncPluginProfileSchedule('plugin1', { autoUpdate: true })
    })
    await upsertPluginProfile(meta, oldProfile)
    expect((await getProfileItem('plugin1'))?.autoUpdate).toBe(true)
    // the sync armed it; the fetch saw the same schedule at write time and did not re-arm it to off
    const calls = vi.mocked(addProfileUpdater).mock.calls
    expect(calls.length).toBeGreaterThanOrEqual(1)
    expect(calls[calls.length - 1][0]).toMatchObject({ id: 'plugin1', autoUpdate: true })
  })

  it('R2-ISS-052: a first insert takes the schedule from the plugin record at write time', async () => {
    mocks.getPluginItem.mockResolvedValue({ id: 'pg', interval: 30, autoUpdate: false })
    await upsertPluginProfile(meta, newProfile)
    expect(await getProfileItem('plugin1')).toMatchObject({ interval: 30, autoUpdate: false })
    expect(vi.mocked(addProfileUpdater).mock.calls[0][0]).toMatchObject({
      interval: 30,
      autoUpdate: false
    })
  })
})
