import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parse } from 'yaml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultLocalDraft } from '../../shared/local-config'
import { compileLocalConfig } from './compiler'
import { commitLocalState, getLocalState, withLocalProfileScope } from './store'
import {
  configureLocalSource,
  createLocalNodes,
  createLocalProxyGroup,
  getLocalConfig,
  getLocalNode,
  getLocalProxyGroup,
  getLocalRulesEditor,
  saveLocalNode,
  saveLocalProvider,
  saveLocalRules
} from './service'

const state = vi.hoisted(() => ({
  root: '',
  current: 'a',
  items: [] as IProfileItem[],
  subscription: [] as Record<string, unknown>[],
  check: vi.fn(),
  reload: vi.fn()
}))

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../utils/dirs', () => ({
  profilePath: (id: string) => path.join(state.root, 'profiles', `${id}.yaml`),
  mihomoProfileWorkDir: (id: string) => path.join(state.root, 'work', id),
  mihomoWorkDir: () => path.join(state.root, 'work')
}))
vi.mock('../config/profile', () => ({
  getProfileConfig: async () => ({ current: state.current, items: state.items }),
  getProfile: async () => ({ proxies: state.subscription }),
  getProfileItem: async (id: string) => state.items.find((item) => item.id === id),
  updateProfileConfig: async (update: (config: IProfileConfig) => IProfileConfig) => {
    state.items = update({ current: state.current, items: state.items }).items
  },
  validateProfileCandidate: state.check
}))
vi.mock('../config/app', () => ({ getAppConfig: async () => ({ core: 'mihomo' }) }))
vi.mock('../core/mihomoApi', () => ({ mihomoHotReloadConfig: state.reload }))

beforeEach(async () => {
  vi.resetAllMocks()
  state.current = 'a'
  state.items = [
    { id: 'a', type: 'local', name: 'A' },
    { id: 'b', type: 'local', name: 'B' }
  ]
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
      const result = compileLocalConfig(await getLocalState())
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
      expect(await readFile(file, 'utf8')).toBe(content)
    }
  )

  it('imports null optional modules as empty collections without enabling editor defaults', async () => {
    await writeFile(
      path.join(state.root, 'profiles/a.yaml'),
      'proxies: null\nproxy-groups: null\nrules: null\nproxy-providers: null\nrule-providers: null\nsub-rules: null\ndns: null\nhosts: null\ntun: null\nsniffer: null\n'
    )
    const result = compileLocalConfig(await getLocalState())
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
  })

  it.each(['false', '{}', '"null"', 'not-a-list'])(
    'still rejects non-null invalid proxies values: %s',
    async (value) => {
      await writeFile(path.join(state.root, 'profiles/a.yaml'), `proxies: ${value}\n`)
      const local = await getLocalState()
      expect(compileLocalConfig(local).errors).toContain('节点: Error: 应为 YAML 列表')
    }
  )
})

describe('local edit profile scope and validation', () => {
  it('saves form edits to one YAML file and reads them back after each edit', async () => {
    const otherFile = path.join(state.root, 'profiles/b.yaml')
    const otherBefore = await readFile(otherFile, 'utf8')
    const node = { name: 'Node', type: 'http', server: '127.0.0.1', port: 8080 }
    await createLocalNodes([node])
    await createLocalProxyGroup({ name: 'Manual', type: 'select', proxies: ['Node'] })
    await saveLocalNode('Node', { ...node, name: 'Renamed' }, await getLocalNode('Node'))
    expect((await getLocalProxyGroup('Manual')).group.proxies).toEqual(['Renamed'])
    const provider = { type: 'inline', payload: [{ ...node, name: 'Provider node' }] }
    await saveLocalProvider('proxy-providers', undefined, 'Inline', provider)
    await saveLocalProvider('rule-providers', undefined, 'Domains', {
      type: 'inline',
      behavior: 'domain',
      payload: ['example.test']
    })
    await saveLocalRules(
      { action: 'add', index: 0, value: 'RULE-SET,Domains,Manual' },
      (await getLocalRulesEditor()).rules
    )
    const config = parse(await readFile(path.join(state.root, 'profiles/a.yaml'), 'utf8'))
    expect(config).toMatchObject({
      mode: 'rule',
      'mixed-port': 7890,
      proxies: [{ ...node, name: 'Renamed' }],
      'proxy-providers': { Inline: provider }
    })
    expect((await getLocalRulesEditor()).rules[0]).toBe('RULE-SET,Domains,Manual')
    expect(parse((await getLocalConfig()).modules.general).mode).toBe('rule')
    expect(await readFile(otherFile, 'utf8')).toBe(otherBefore)
    expect(state.reload).toHaveBeenCalledTimes(6)
  })

  it('validates a form edit with the profile overrides and keeps omitted settings omitted', async () => {
    const file = path.join(state.root, 'profiles/a.yaml')
    await writeFile(file, 'proxies: null\ndns: null\ngeodata-mode: true\nrules: ["MATCH,DIRECT"]\n')
    await saveLocalRules(
      { action: 'add', index: 0, value: 'DOMAIN,example.test,DIRECT' },
      (await getLocalRulesEditor()).rules
    )
    const yaml = await readFile(file, 'utf8')
    expect(parse(yaml)).toEqual({
      proxies: null,
      dns: null,
      'geodata-mode': true,
      rules: ['DOMAIN,example.test,DIRECT', 'MATCH,DIRECT']
    })
    expect(state.check).toHaveBeenCalledWith(state.items[0], yaml, expect.anything())
  })

  it('restores the exact original YAML if the runtime rejects an edit', async () => {
    const file = path.join(state.root, 'profiles/a.yaml')
    const original = '# keep this comment\nrules:\n  - MATCH,DIRECT\n'
    await writeFile(file, original)
    state.reload.mockRejectedValueOnce(new Error('reload failed'))
    await expect(
      saveLocalRules({ action: 'add', index: 0, value: 'DOMAIN,example.test,DIRECT' }, [
        'MATCH,DIRECT'
      ])
    ).rejects.toThrow('已恢复原配置')
    expect(await readFile(file, 'utf8')).toBe(original)
    expect(state.reload).toHaveBeenCalledTimes(2)
  })

  it('updates an imported node source in its original profile with a custom prefix', async () => {
    state.items.push({ id: 'source', name: 'Subscription', type: 'remote' })
    const node = { name: 'Node', type: 'http', server: '127.0.0.1', port: 8080 }
    state.subscription = [node]
    await createLocalNodes([{ ...node, name: 'Custom manual' }])
    await configureLocalSource('source', { mode: 'nodes', prefix: 'Custom ' })
    const previous = structuredClone(state.items[2])
    state.current = 'b'
    const otherFile = path.join(state.root, 'profiles/b.yaml')
    const otherBefore = await readFile(otherFile, 'utf8')
    state.subscription = [{ ...node, name: 'Refreshed' }]
    await configureLocalSource('source', undefined, previous)
    const owner = parse(await readFile(path.join(state.root, 'profiles/a.yaml'), 'utf8'))
    expect(owner.proxies.map(({ name }: { name: string }) => name)).toEqual([
      'Custom manual',
      'Custom Refreshed'
    ])
    expect(await readFile(otherFile, 'utf8')).toBe(otherBefore)
    expect(state.reload).toHaveBeenCalledTimes(2)
  })

  it('rejects a stale proxy provider form without losing the latest YAML', async () => {
    const provider = { type: 'inline', payload: [] }
    await saveLocalProvider('proxy-providers', undefined, 'Inline', provider)
    const file = path.join(state.root, 'profiles/a.yaml')
    const before = await readFile(file, 'utf8')
    await expect(
      saveLocalProvider('proxy-providers', 'Inline', 'Changed', provider, { type: 'http' })
    ).rejects.toThrow('代理集合已变更')
    expect(await readFile(file, 'utf8')).toBe(before)
    expect(state.reload).toHaveBeenCalledOnce()
  })

  it('keeps writes on the requested file if the UI changes the active profile', async () => {
    const otherBefore = await readFile(path.join(state.root, 'profiles/b.yaml'), 'utf8')
    await withLocalProfileScope('a', async () => {
      const local = await getLocalState()
      state.current = 'b'
      const next = structuredClone(local)
      next.modules.proxies =
        '- name: Scoped\n  type: ss\n  server: proxy.invalid\n  port: 443\n  cipher: aes-128-gcm\n  password: secret\n'
      expect((await commitLocalState(local, next)).errors).toEqual([])
    })
    expect(await readFile(path.join(state.root, 'profiles/b.yaml'), 'utf8')).toBe(otherBefore)
    const written = parse(await readFile(path.join(state.root, 'profiles/a.yaml'), 'utf8'))
    expect(written.proxies[0].name).toBe('Scoped')
    const unscoped = await getLocalState()
    expect(parse(unscoped.modules.general)['mixed-port']).toBe(7891)
  })

  it('isolates simultaneous async scopes and restores the default context afterwards', async () => {
    state.current = 'b'
    const ports = await Promise.all(
      ['a', 'b'].map((id) =>
        withLocalProfileScope(
          id,
          async () => parse((await getLocalState()).modules.general)['mixed-port']
        )
      )
    )
    expect(ports).toEqual([7890, 7891])
    expect(parse((await getLocalState()).modules.general)['mixed-port']).toBe(7891)
  })

  it('does not publish if core validation fails', async () => {
    const before = await readFile(path.join(state.root, 'profiles/a.yaml'), 'utf8')
    state.check.mockRejectedValueOnce(new Error('core validation rejected candidate'))
    const output = await withLocalProfileScope('a', async () => {
      const local = await getLocalState()
      const next = structuredClone(local)
      next.modules.rules = '- DOMAIN,example.com,DIRECT\n'
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
      runtimePort = parse((await getLocalState()).modules.general)['mixed-port']
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
