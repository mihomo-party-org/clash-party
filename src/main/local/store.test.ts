import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parse } from 'yaml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultLocalDraft } from '../../shared/local-config'
import { compileLocalConfig } from './compiler'
import { commitLocalState, getLocalState, saveLocalState, withLocalProfileScope } from './store'

const state = vi.hoisted(() => ({
  root: '',
  current: 'a',
  check: vi.fn(),
  reload: vi.fn(),
  writeShared: vi.fn()
}))

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../utils/dirs', () => ({
  profilePath: (id: string) => path.join(state.root, 'profiles', `${id}.yaml`),
  localConfigPath: () => path.join(state.root, 'legacy.yaml'),
  localOutputPath: () => path.join(state.root, 'generated.yaml'),
  mihomoWorkDir: () => path.join(state.root, 'work'),
  mihomoWorkConfigPath: () => path.join(state.root, 'work', 'config.yaml')
}))
vi.mock('../config/profile', () => ({
  getProfileConfig: async () => ({
    current: state.current,
    items: [
      { id: 'a', type: 'local', name: 'A' },
      { id: 'b', type: 'local', name: 'B' }
    ]
  }),
  getProfile: async () => ({}),
  getProfileItem: async (id: string) => ({ id, type: 'local' })
}))
vi.mock('../config/controledMihomo', () => ({
  getControledMihomoConfig: async () => ({}),
  writeLocalSharedConfig: state.writeShared
}))
vi.mock('../config/app', () => ({ getAppConfig: async () => ({ core: 'mihomo' }) }))
vi.mock('../core/manager', () => ({ checkProfileConfig: state.check }))
vi.mock('../core/mihomoApi', () => ({ mihomoHotReloadConfig: state.reload }))

beforeEach(async () => {
  vi.resetAllMocks()
  state.current = 'a'
  state.root = await mkdtemp(path.join(tmpdir(), 'mcp-local-scope-'))
  await mkdir(path.join(state.root, 'profiles'))
  for (const [id, port] of [
    ['a', 7890],
    ['b', 7891]
  ] as const) {
    const draft = defaultLocalDraft()
    draft.modules.general = `mixed-port: ${port}\nmode: rule\n`
    await writeFile(path.join(state.root, 'profiles', `${id}.yaml`), compileLocalConfig(draft).yaml)
  }
})

afterEach(async () => {
  await rm(state.root, { recursive: true, force: true })
})

describe('local YAML profile import', () => {
  it.each(['null', '~', ''])(
    'loads provider-only profiles with an empty proxies value: %j',
    async (empty) => {
      const content = `
dns: {enable: true, nameserver: [223.5.5.5]}
provider: &provider {type: http, url: "https://subscription.invalid/profile", interval: 3600}
group: &group {type: select, use: [Sub]}
proxy-providers:
  Sub: {<<: *provider}
proxies: ${empty}
proxy-groups:
  - {name: PROXY, <<: *group}
rules: ["MATCH,PROXY"]
`
      const file = path.join(state.root, 'profiles/a.yaml')
      await writeFile(file, content)
      const local = await getLocalState()
      for (const draft of [local.draft, local.published]) {
        const result = compileLocalConfig(draft)
        expect(result.errors).toEqual([])
        const config = parse(result.yaml)
        expect(config.proxies).toEqual([])
        expect(config['proxy-providers'].Sub).toMatchObject({
          type: 'http',
          url: 'https://subscription.invalid/profile',
          interval: 3600
        })
        expect(config['proxy-groups']).toEqual([{ name: 'PROXY', type: 'select', use: ['Sub'] }])
        expect(config.dns).toEqual({ enable: true, nameserver: ['223.5.5.5'] })
        expect(config.rules).toEqual(['MATCH,PROXY'])
      }
      expect(await readFile(file, 'utf8')).toBe(content)
    }
  )

  it('imports null optional modules as empty collections without enabling editor defaults', async () => {
    await writeFile(
      path.join(state.root, 'profiles/a.yaml'),
      'proxies: null\nproxy-groups: null\nrules: null\nproxy-providers: null\nrule-providers: null\nsub-rules: null\ndns: null\nhosts: null\ntun: null\nsniffer: null\n'
    )
    const local = await getLocalState()
    for (const draft of [local.draft, local.published]) {
      const result = compileLocalConfig(draft)
      expect(result.errors).toEqual([])
      const config = parse(result.yaml)
      for (const key of ['proxies', 'proxy-groups', 'rules']) expect(config[key]).toEqual([])
      for (const key of [
        'proxy-providers',
        'rule-providers',
        'sub-rules',
        'dns',
        'hosts',
        'tun',
        'sniffer'
      ])
        expect(config[key]).toEqual({})
    }
  })

  it.each(['false', '{}', '"null"', 'not-a-list'])(
    'still rejects non-null invalid proxies values: %s',
    async (value) => {
      await writeFile(path.join(state.root, 'profiles/a.yaml'), `proxies: ${value}\n`)
      const local = await getLocalState()
      expect(compileLocalConfig(local.draft).errors).toContain('节点: Error: 应为 YAML 列表')
    }
  )
})

describe('local edit profile scope and validation', () => {
  it('keeps writes on the requested file if the UI changes the active profile', async () => {
    const otherBefore = await readFile(path.join(state.root, 'profiles/b.yaml'), 'utf8')
    await withLocalProfileScope('a', async () => {
      const local = await getLocalState()
      state.current = 'b'
      local.draft.modules.proxies =
        '- name: Scoped\n  type: ss\n  server: proxy.invalid\n  port: 443\n  cipher: aes-128-gcm\n  password: secret\n'
      await saveLocalState(local)
    })
    expect(await readFile(path.join(state.root, 'profiles/b.yaml'), 'utf8')).toBe(otherBefore)
    const written = parse(await readFile(path.join(state.root, 'profiles/a.yaml'), 'utf8'))
    expect(written.proxies[0].name).toBe('Scoped')
    const unscoped = await getLocalState()
    expect(parse(unscoped.draft.modules.general)['mixed-port']).toBe(7891)
  })

  it('isolates simultaneous async scopes and restores the default context afterwards', async () => {
    state.current = 'b'
    const ports = await Promise.all(
      ['a', 'b'].map((id) =>
        withLocalProfileScope(
          id,
          async () => parse((await getLocalState()).draft.modules.general)['mixed-port']
        )
      )
    )
    expect(ports).toEqual([7890, 7891])
    expect(parse((await getLocalState()).draft.modules.general)['mixed-port']).toBe(7891)
  })

  it('does not publish if core validation fails', async () => {
    const before = await readFile(path.join(state.root, 'profiles/a.yaml'), 'utf8')
    state.check.mockRejectedValueOnce(new Error('core validation rejected candidate'))
    const output = await withLocalProfileScope('a', async () => {
      const local = await getLocalState()
      const next = structuredClone(local)
      next.draft.modules.rules = '- DOMAIN,example.com,DIRECT\n'
      next.published = structuredClone(next.draft)
      return commitLocalState(local, next)
    })
    expect(output.errors).toHaveLength(1)
    expect(await readFile(path.join(state.root, 'profiles/a.yaml'), 'utf8')).toBe(before)
    expect(state.reload).not.toHaveBeenCalled()
  })

  it('does not reload a different active profile after a switch during validation', async () => {
    state.check.mockImplementationOnce(async () => {
      state.current = 'b'
    })
    const otherBefore = await readFile(path.join(state.root, 'profiles/b.yaml'), 'utf8')
    const output = await withLocalProfileScope('a', async () => {
      const local = await getLocalState()
      return commitLocalState(local, structuredClone(local))
    })
    expect(output.errors).toEqual([])
    expect(state.reload).not.toHaveBeenCalled()
    expect(await readFile(path.join(state.root, 'profiles/b.yaml'), 'utf8')).toBe(otherBefore)
  })

  it('leaves the edit file scope before runtime regeneration', async () => {
    let runtimePort: number | undefined
    state.reload.mockImplementationOnce(async () => {
      state.current = 'b'
      runtimePort = parse((await getLocalState()).draft.modules.general)['mixed-port']
    })
    await withLocalProfileScope('a', async () => {
      const local = await getLocalState()
      await commitLocalState(local, structuredClone(local))
    })
    expect(runtimePort).toBe(7891)
  })

  it.each(['../a', '/tmp/a', 'a/b', 'a\\b', '', 'a\u0000'])(
    'rejects unsafe scope IDs: %j',
    (id) => {
      expect(() => withLocalProfileScope(id, async () => undefined)).toThrow(
        'Invalid local profile ID'
      )
    }
  )
})
