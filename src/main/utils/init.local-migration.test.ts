import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import yaml from 'yaml'

let dataDir = ''

vi.mock('electron', () => ({
  app: {
    getPath: () => dataDir,
    getPathSync: () => dataDir,
    getVersion: () => '0.0.0-test',
    isPackaged: true,
    setName: () => {},
    setPath: () => {},
    on: () => {}
  },
  dialog: { showSaveDialog: vi.fn() },
  BrowserWindow: class {
    static getAllWindows(): unknown[] {
      return []
    }
  },
  net: { fetch: vi.fn() }
}))

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))

vi.mock('sysproxy-rs', () => ({
  triggerAutoProxy: vi.fn(),
  triggerManualProxy: vi.fn()
}))

vi.mock('../resolve/server', () => ({
  startPacServer: vi.fn(),
  startSubStoreBackendServer: vi.fn(),
  startSubStoreFrontendServer: vi.fn(),
  subStorePort: () => 0,
  subStoreFrontendPort: () => 0
}))

vi.mock('../sys/sysproxy', () => ({ triggerSysProxy: vi.fn() }))
vi.mock('../sys/ssid', () => ({ startSSIDCheck: vi.fn() }))
vi.mock('../sys/resume', () => ({ initResumeRecovery: vi.fn() }))

vi.mock('../traffic/recorder', () => ({ recordTrafficUsage: vi.fn() }))

vi.mock('../core/manager', () => ({
  checkProfileConfig: vi.fn(),
  checkProfile: vi.fn(),
  restartCore: vi.fn(),
  hasCoreProcess: () => false
}))

function seedLegacyData(): void {
  writeFileSync(
    path.join(dataDir, 'config.yaml'),
    yaml.stringify({ core: 'mihomo', modeSelected: true, operationMode: 'simple' })
  )
  writeFileSync(
    path.join(dataDir, 'profile.yaml'),
    yaml.stringify({
      items: [
        {
          id: 'sub-a',
          type: 'local',
          name: '机场A',
          interval: 0,
          override: [],
          useProxy: false,
          allowFixedInterval: false,
          autoUpdate: false,
          substore: false,
          updated: 1
        }
      ]
    })
  )
  writeFileSync(
    path.join(dataDir, 'profiles', 'sub-a.yaml'),
    yaml.stringify({ proxies: [{ name: 'n1', type: 'ss', server: '127.0.0.1', port: 8388 }] })
  )
  const draft = {
    sources: [
      {
        id: 'profile-sub-a',
        name: '机场A',
        mode: 'extract',
        prefix: '[机场A] ',
        interval: 0,
        proxies: [],
        profileId: 'sub-a'
      }
    ],
    modules: {
      general: 'mixed-port: 7890\nmode: rule\n',
      proxies: '[]\n',
      'proxy-providers': '{}\n',
      'proxy-groups': '- name: PROXY\n  type: select\n  proxies: [DIRECT]\n',
      rules: '- MATCH,PROXY\n',
      'rule-providers': '{}\n',
      'sub-rules': '{}\n',
      dns: 'enable: false\n',
      hosts: '{}\n',
      tun: 'enable: false\n',
      sniffer: 'enable: false\n'
    },
    preserved: {},
    moduleOrder: []
  }
  writeFileSync(
    path.join(dataDir, 'simple-config.yaml'),
    yaml.stringify({ version: 2, revision: 7, draft, published: draft })
  )
}

describe('local migration', () => {
  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'clash-party-migration-'))
    mkdirSync(path.join(dataDir, 'profiles'), { recursive: true })
    vi.resetModules()
  })

  it('migrates legacy simple-mode data into a local profile', async () => {
    seedLegacyData()
    const { initBasic } = await import('./init')
    await initBasic()

    const profileConfig = yaml.parse(readFileSync(path.join(dataDir, 'profile.yaml'), 'utf-8'))
    const local = profileConfig.items.find((item: { id?: string }) => item.id === 'local')
    expect(local).toBeDefined()
    expect(local.id).toBe('local')
    expect(profileConfig.current).toBe('local')

    expect(existsSync(path.join(dataDir, 'profiles', 'local.yaml'))).toBe(true)
    expect(existsSync(path.join(dataDir, 'local-config.yaml'))).toBe(false)
    expect(existsSync(path.join(dataDir, 'simple-config.yaml'))).toBe(false)
    const config = yaml.parse(readFileSync(path.join(dataDir, 'profiles', 'local.yaml'), 'utf8'))
    expect(config.proxies).toMatchObject([{ name: '[机场A] n1' }])
    expect(config['proxy-groups']).toMatchObject([{ name: 'PROXY', proxies: ['DIRECT'] }])
    expect(config.rules).toEqual(['MATCH,PROXY'])
    expect(config.draft).toBeUndefined()

    const appConfig = yaml.parse(readFileSync(path.join(dataDir, 'config.yaml'), 'utf-8'))
    expect(appConfig.operationMode).toBeUndefined()
    expect(appConfig.modeSelected).toBeUndefined()
  }, 15000)

  it('heals a local profile that lost its name', async () => {
    writeFileSync(path.join(dataDir, 'config.yaml'), yaml.stringify({ core: 'mihomo' }))
    writeFileSync(
      path.join(dataDir, 'profile.yaml'),
      yaml.stringify({
        current: 'simple-mode',
        items: [{ id: 'simple-mode', type: 'local', updated: 1 }]
      })
    )
    const { initBasic } = await import('./init')
    await initBasic()
    const profileConfig = yaml.parse(readFileSync(path.join(dataDir, 'profile.yaml'), 'utf-8'))
    const local = profileConfig.items.find((item: { id?: string }) => item.id === 'local')
    expect(local.name).toBe('本地配置')
  })

  it('leaves a fresh standard install untouched', async () => {
    const { initBasic } = await import('./init')
    await initBasic()
    const profileConfig = yaml.parse(readFileSync(path.join(dataDir, 'profile.yaml'), 'utf-8'))
    expect(profileConfig.items.some((item: { id?: string }) => item.id === 'local')).toBe(false)
    expect(profileConfig.current).toBeUndefined()
  })

  it('keeps the original YAML and active selection when a local profile is already migrated', async () => {
    seedLegacyData()
    const canonical = '# edited locally\nproxies: []\nproxy-groups: []\nrules: [MATCH,DIRECT]\n'
    writeFileSync(path.join(dataDir, 'config.yaml'), yaml.stringify({ core: 'mihomo' }))
    writeFileSync(
      path.join(dataDir, 'profile.yaml'),
      yaml.stringify({
        current: 'remote',
        items: [
          { id: 'local', type: 'local', name: 'Existing local' },
          { id: 'remote', type: 'remote', name: 'Full subscription' }
        ]
      })
    )
    const file = path.join(dataDir, 'profiles', 'local.yaml')
    writeFileSync(file, canonical)
    const { initBasic } = await import('./init')
    await initBasic()
    expect(readFileSync(file, 'utf8')).toBe(canonical)
    expect(yaml.parse(readFileSync(path.join(dataDir, 'profile.yaml'), 'utf8')).current).toBe(
      'remote'
    )
  })

  it('prefers valid published snapshot over a broken unapplied draft', async () => {
    seedLegacyData()
    const simplePath = path.join(dataDir, 'simple-config.yaml')
    const raw = yaml.parse(readFileSync(simplePath, 'utf8')) as {
      draft: { modules: Record<string, string> }
      published: Record<string, unknown>
    }
    raw.draft = structuredClone(raw.draft)
    raw.draft.modules['proxy-groups'] = '- name: BROKEN\n  type: select\n'
    writeFileSync(simplePath, yaml.stringify(raw))

    const { initBasic } = await import('./init')
    await initBasic()

    expect(existsSync(simplePath)).toBe(false)
    expect(existsSync(`${simplePath}.bak`)).toBe(false)
    const config = yaml.parse(readFileSync(path.join(dataDir, 'profiles', 'local.yaml'), 'utf8'))
    expect(config['proxy-groups']).toMatchObject([{ name: 'PROXY', proxies: ['DIRECT'] }])
  })

  it('falls back to legacy generated YAML and backs up source when all snapshots fail', async () => {
    seedLegacyData()
    writeFileSync(path.join(dataDir, 'profiles', 'sub-a.yaml'), yaml.stringify({ proxies: [] }))
    const generatedYaml = 'proxies: []\nproxy-groups: []\nrules:\n  - MATCH,DIRECT\n'
    writeFileSync(path.join(dataDir, 'simple-config.generated.yaml'), generatedYaml)

    const { initBasic } = await import('./init')
    await initBasic()

    expect(readFileSync(path.join(dataDir, 'profiles', 'local.yaml'), 'utf8')).toBe(generatedYaml)
    expect(existsSync(path.join(dataDir, 'simple-config.yaml'))).toBe(false)
    expect(existsSync(path.join(dataDir, 'simple-config.yaml.bak'))).toBe(true)
    expect(existsSync(path.join(dataDir, 'simple-config.generated.yaml'))).toBe(false)
  })

  it('skips invalid generated YAML and preserves an existing backup', async () => {
    seedLegacyData()
    writeFileSync(path.join(dataDir, 'profiles', 'sub-a.yaml'), yaml.stringify({ proxies: [] }))
    const simplePath = path.join(dataDir, 'simple-config.yaml')
    const generatedPath = path.join(dataDir, 'simple-config.generated.yaml')
    writeFileSync(`${simplePath}.bak`, 'keep this backup')
    writeFileSync(generatedPath, 'proxies: [unterminated')

    const { initBasic } = await import('./init')
    await initBasic()

    const config = yaml.parse(readFileSync(path.join(dataDir, 'profiles', 'local.yaml'), 'utf8'))
    expect(config.rules).toEqual(['MATCH,PROXY'])
    expect(readFileSync(`${simplePath}.bak`, 'utf8')).toBe('keep this backup')
    expect(existsSync(`${generatedPath}.bak`)).toBe(true)
  })

  it('does not block startup on corrupt legacy YAML syntax', async () => {
    writeFileSync(
      path.join(dataDir, 'config.yaml'),
      yaml.stringify({ core: 'mihomo', operationMode: 'simple', language: 'en-us' })
    )
    writeFileSync(path.join(dataDir, 'profile.yaml'), yaml.stringify({ items: [] }))
    writeFileSync(path.join(dataDir, 'simple-config.yaml'), 'draft: [unterminated')

    const { initBasic } = await import('./init')
    await initBasic()

    expect(existsSync(path.join(dataDir, 'simple-config.yaml'))).toBe(false)
    expect(existsSync(path.join(dataDir, 'simple-config.yaml.bak'))).toBe(true)
    const config = yaml.parse(readFileSync(path.join(dataDir, 'profiles', 'local.yaml'), 'utf8'))
    expect(config.rules).toEqual(['MATCH,PROXY'])
    const profileConfig = yaml.parse(readFileSync(path.join(dataDir, 'profile.yaml'), 'utf8'))
    const local = profileConfig.items.find((item: { id?: string }) => item.id === 'local')
    expect(local?.name).toBe('Local Config')
  })
})
