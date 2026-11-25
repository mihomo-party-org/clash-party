import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parse, stringify } from 'yaml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultLocalDraft } from '../../shared/local-config'
import {
  getProfileConfig,
  getProfileItem,
  removeProfileItem,
  updateProfileConfig,
  updateProfileItem
} from '../config/profile'
import { compileLocalConfig } from './compiler'
import { configureLocalSource, saveLocalProvider } from './service'

let testDir = ''

const mocks = vi.hoisted(() => ({
  checkProfileConfig: vi.fn(),
  generateProfile: vi.fn(),
  hotReload: vi.fn(),
  restartCore: vi.fn(),
  send: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getVersion: () => '2.0.5', getPath: () => testDir },
  dialog: { showSaveDialog: vi.fn() },
  BrowserWindow: {
    getAllWindows: () => [{ webContents: { send: mocks.send } }]
  }
}))
vi.mock('i18next', () => ({ default: { t: (key: string) => key } }))
vi.mock('axios', () => ({ default: { get: vi.fn(), head: vi.fn() } }))
vi.mock('../utils/age', () => ({
  decryptAgeContent: (content: string) => Promise.resolve(content)
}))
vi.mock('../utils/dirs', () => ({
  mihomoCorePath: () => path.join(testDir, 'mihomo'),
  mihomoProfileWorkDir: (id: string) => path.join(testDir, 'work', id),
  mihomoWorkDir: () => path.join(testDir, 'work'),
  profileConfigPath: () => path.join(testDir, 'profile.yaml'),
  profilePath: (id: string) => path.join(testDir, 'profiles', `${id}.yaml`)
}))
vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })
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
vi.mock('../core/factory', () => ({
  generateProfile: mocks.generateProfile,
  globalOverrideIdsNow: async () => []
}))
vi.mock('../core/profileUpdater', () => ({
  addProfileUpdater: vi.fn(),
  removeProfileUpdater: vi.fn()
}))
vi.mock('../config/app', () => ({
  getAppConfig: async () => ({
    core: 'mihomo',
    yamlMaxAliasCount: 100
  })
}))
vi.mock('../config/controledMihomo', () => ({
  getControledMihomoConfig: async () => ({ 'mixed-port': 7890 })
}))
vi.mock('../config/plugin', () => ({
  getPluginItem: vi.fn(),
  pluginSchedule: () => ({ interval: 1440, autoUpdate: true })
}))

function writeLocalProfileYaml(
  id: string,
  groups: Record<string, unknown>[],
  extra: Record<string, unknown> = {}
): void {
  const draft = defaultLocalDraft()
  draft.modules['proxy-groups'] = stringify(groups)
  if (extra.proxies) draft.modules.proxies = stringify(extra.proxies)
  if (extra.rules) draft.modules.rules = stringify(extra.rules)
  writeFileSync(path.join(testDir, 'profiles', `${id}.yaml`), compileLocalConfig(draft).yaml)
}

beforeEach(async () => {
  testDir = mkdtempSync(path.join(tmpdir(), 'mihomo-party-source-cleanup-'))
  mkdirSync(path.join(testDir, 'profiles'), { recursive: true })
  writeFileSync(
    path.join(testDir, 'profile.yaml'),
    stringify({
      current: 'local',
      items: [{ id: 'local', type: 'local', name: '本地配置' }]
    })
  )
  writeLocalProfileYaml('local', [{ name: 'PROXY', type: 'select', proxies: ['DIRECT'] }])

  vi.clearAllMocks()
  mocks.checkProfileConfig.mockResolvedValue(undefined)
  mocks.generateProfile.mockResolvedValue('local')
  mocks.hotReload.mockResolvedValue(undefined)
  mocks.restartCore.mockResolvedValue(undefined)
  await getProfileConfig(true)
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('nodeSource cleanup and unbinding', () => {
  it('cleans up http/inline providers and proxy-groups[].use when deleting a nodeSource subscription, including local-to-local without deadlock', async () => {
    await updateProfileConfig((config) => {
      config.items.push(
        { id: 'remote-sub', type: 'remote', name: 'RemoteSub', url: 'https://example.test/sub' },
        { id: 'local-sub', type: 'local', name: 'LocalSub' }
      )
      return config
    })
    writeFileSync(
      path.join(testDir, 'profiles', 'local-sub.yaml'),
      stringify({
        proxies: [{ name: 'LocalNode', type: 'http', server: '127.0.0.1', port: 8080 }]
      })
    )
    writeLocalProfileYaml('local', [{ name: 'PROXY', type: 'select', proxies: [] }])

    await configureLocalSource('remote-sub', {
      mode: 'group',
      providerName: 'RemoteProvider',
      targetGroups: ['PROXY']
    })
    await configureLocalSource('local-sub', {
      mode: 'group',
      providerName: 'LocalProvider',
      targetGroups: ['PROXY']
    })

    // 删除 http provider 绑定订阅：清理 RemoteProvider，保留 LocalProvider
    await removeProfileItem('remote-sub')
    expect(await getProfileItem('remote-sub')).toBeUndefined()
    const afterRemote = parse(readFileSync(path.join(testDir, 'profiles', 'local.yaml'), 'utf8'))
    expect(afterRemote['proxy-providers']).not.toHaveProperty('RemoteProvider')
    expect(afterRemote['proxy-providers']).toHaveProperty('LocalProvider')
    expect(afterRemote['proxy-groups'][0].use).toEqual(['LocalProvider'])

    // 删除 type: 'local' 且作为另一个本地配置 nodeSource 的订阅：不得在 localWriteQueue 上死锁
    await removeProfileItem('local-sub')
    expect(await getProfileItem('local-sub')).toBeUndefined()
    expect(existsSync(path.join(testDir, 'profiles', 'local-sub.yaml'))).toBe(false)
    const afterLocal = parse(readFileSync(path.join(testDir, 'profiles', 'local.yaml'), 'utf8'))
    expect(afterLocal['proxy-providers']).toEqual({})
    expect(afterLocal['proxy-groups'][0].use).toEqual([])
    expect(afterLocal['proxy-groups'][0].proxies).toEqual(['DIRECT'])
  })

  it('keeps the subscription record intact if local cleanup fails during removal (R2-ISS-067)', async () => {
    await updateProfileConfig((config) => {
      config.items.push({
        id: 'remote-sub',
        type: 'remote',
        name: 'RemoteSub',
        url: 'https://example.test/sub'
      })
      return config
    })
    await configureLocalSource('remote-sub', {
      mode: 'group',
      providerName: 'RemoteProvider',
      targetGroups: ['PROXY']
    })
    mocks.checkProfileConfig.mockRejectedValueOnce(new Error('core check failed'))

    await expect(removeProfileItem('remote-sub')).rejects.toThrow('core check failed')
    const kept = await getProfileItem('remote-sub')
    expect(kept?.nodeSource).toMatchObject({ localProfileId: 'local', name: 'RemoteProvider' })
  })

  it('cleans up extracted nodes and references when deleting an extract-mode nodeSource subscription', async () => {
    await updateProfileConfig((config) => {
      config.items.push({ id: 'extract-sub', type: 'local', name: 'ExtractSub' })
      return config
    })
    writeFileSync(
      path.join(testDir, 'profiles', 'extract-sub.yaml'),
      stringify({
        proxies: [{ name: 'NodeA', type: 'http', server: '127.0.0.1', port: 8081 }]
      })
    )
    writeLocalProfileYaml('local', [{ name: 'PROXY', type: 'select', proxies: ['ManualNode'] }], {
      proxies: [{ name: 'ManualNode', type: 'http', server: '127.0.0.1', port: 8080 }],
      rules: ['DOMAIN,a.example,[Sub] NodeA', 'MATCH,PROXY']
    })

    await configureLocalSource('extract-sub', {
      mode: 'nodes',
      prefix: '[Sub] ',
      targetGroups: ['PROXY']
    })
    // 把 PROXY 改为只引用提取节点以验证空组回退 DIRECT
    const before = parse(readFileSync(path.join(testDir, 'profiles', 'local.yaml'), 'utf8'))
    before['proxy-groups'][0].proxies = ['[Sub] NodeA']
    writeFileSync(path.join(testDir, 'profiles', 'local.yaml'), stringify(before))

    await removeProfileItem('extract-sub')

    expect(await getProfileItem('extract-sub')).toBeUndefined()
    expect(existsSync(path.join(testDir, 'profiles', 'extract-sub.yaml'))).toBe(false)
    const after = parse(readFileSync(path.join(testDir, 'profiles', 'local.yaml'), 'utf8'))
    expect(after.proxies.map((node: { name: string }) => node.name)).toEqual(['ManualNode'])
    expect(after['proxy-groups'][0].proxies).toEqual(['DIRECT'])
    expect(after.rules).toEqual(['MATCH,PROXY'])
  })

  it('unbinds a historical nodeSource subscription via updateProfileItem(item, null) and allows saving overrides', async () => {
    await updateProfileConfig((config) => {
      config.items.push({
        id: 'sub-1',
        type: 'remote',
        name: 'Sub1',
        url: 'https://example.test/sub1'
      })
      return config
    })
    writeFileSync(
      path.join(testDir, 'profiles', 'sub-1.yaml'),
      stringify({ proxies: [{ name: 'N1', type: 'http', server: '127.0.0.1', port: 8080 }] })
    )
    await configureLocalSource('sub-1', {
      mode: 'group',
      providerName: 'SubProvider',
      targetGroups: ['PROXY']
    })
    const bound = await getProfileItem('sub-1')
    if (!bound) throw new Error('Expected sub-1 profile item to exist')
    expect(bound.nodeSource).toBeTruthy()

    // 即使调用方传入的 item 仍带着旧的 nodeSource，updateProfileItem(..., null) 也必须将其清理并抹除
    await updateProfileItem({ ...bound, name: 'Sub1 Standalone', override: ['custom-ov'] }, null)

    const unbound = await getProfileItem('sub-1')
    expect(unbound).toMatchObject({ id: 'sub-1', name: 'Sub1 Standalone', override: ['custom-ov'] })
    expect(unbound?.nodeSource).toBeUndefined()
    expect(existsSync(path.join(testDir, 'profiles', 'sub-1.yaml'))).toBe(true)

    const localYaml = parse(readFileSync(path.join(testDir, 'profiles', 'local.yaml'), 'utf8'))
    expect(localYaml['proxy-providers']).toEqual({})
    expect(localYaml['proxy-groups'][0].proxies).toEqual(['DIRECT'])

    // 目标本地配置已不存在时，仍可完成历史绑定解绑
    await updateProfileConfig((config) => {
      config.items.push({
        id: 'orphan-sub',
        type: 'remote',
        name: 'Orphan',
        url: 'https://example.test/orphan',
        nodeSource: {
          localProfileId: 'missing-local',
          name: 'Orphan',
          mode: 'http',
          prefix: '[Orphan] '
        }
      })
      return config
    })
    const orphan = await getProfileItem('orphan-sub')
    if (!orphan) throw new Error('Expected orphan-sub profile item to exist')
    await updateProfileItem({ ...orphan, override: ['ov'] }, null)
    const unboundOrphan = await getProfileItem('orphan-sub')
    expect(unboundOrphan?.nodeSource).toBeUndefined()
    expect(unboundOrphan?.override).toEqual(['ov'])
  })

  it('deletes a proxy-provider via saveLocalProvider(null) and clears bound nodeSource metadata', async () => {
    await updateProfileConfig((config) => {
      config.items.push(
        { id: 'bound-http', type: 'remote', name: 'BoundHttp', url: 'https://example.test/http' },
        { id: 'bound-other', type: 'remote', name: 'Other', url: 'https://example.test/other' }
      )
      return config
    })
    await configureLocalSource('bound-http', {
      mode: 'group',
      providerName: 'TargetProvider',
      targetGroups: ['PROXY']
    })
    await configureLocalSource('bound-other', {
      mode: 'group',
      providerName: 'OtherProvider',
      targetGroups: ['PROXY']
    })

    const localYaml = parse(readFileSync(path.join(testDir, 'profiles', 'local.yaml'), 'utf8'))
    const expected = localYaml['proxy-providers'].TargetProvider
    mocks.send.mockClear()

    await saveLocalProvider('proxy-providers', 'TargetProvider', 'TargetProvider', null, expected)

    const updated = parse(readFileSync(path.join(testDir, 'profiles', 'local.yaml'), 'utf8'))
    expect(updated['proxy-providers']).not.toHaveProperty('TargetProvider')
    expect(updated['proxy-providers']).toHaveProperty('OtherProvider')
    expect(updated['proxy-groups'][0].use).toEqual(['OtherProvider'])
    expect((await getProfileItem('bound-http'))?.nodeSource).toBeUndefined()
    expect((await getProfileItem('bound-other'))?.nodeSource).toMatchObject({
      name: 'OtherProvider'
    })
    expect(mocks.send).toHaveBeenCalledWith('profileConfigUpdated')

    // 继续删除最后一个 provider，策略组应自动回退 DIRECT
    await saveLocalProvider(
      'proxy-providers',
      'OtherProvider',
      'OtherProvider',
      null,
      updated['proxy-providers'].OtherProvider
    )
    const finalLocal = parse(readFileSync(path.join(testDir, 'profiles', 'local.yaml'), 'utf8'))
    expect(finalLocal['proxy-providers']).toEqual({})
    expect(finalLocal['proxy-groups'][0].use).toEqual([])
    expect(finalLocal['proxy-groups'][0].proxies).toEqual(['DIRECT'])
    expect((await getProfileItem('bound-other'))?.nodeSource).toBeUndefined()
  })
})
