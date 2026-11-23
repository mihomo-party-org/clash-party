import { describe, it, expect } from 'vitest'
import { parse, stringify } from 'yaml'
import { defaultLocalDraft } from '../../shared/local-config'
import type { LocalDraft, LocalSource } from '../../shared/local-config'
import { bindProfileSource, findProfileSource } from '../../shared/profile-source'
import { compileLocalConfig } from './compiler'

function draftWith(
  partial: Omit<Partial<LocalDraft>, 'modules'> & {
    modules?: Partial<LocalDraft['modules']>
  }
): LocalDraft {
  const base = defaultLocalDraft()
  return { ...base, ...partial, modules: { ...base.modules, ...partial.modules } }
}

function source(partial: Partial<LocalSource>): LocalSource {
  return {
    id: 's1',
    name: '机场A',
    mode: 'extract',
    prefix: '[A] ',
    interval: 0,
    proxies: [],
    ...partial
  }
}

describe('profile source resolution from canonical YAML', () => {
  const item = { id: 'subscription', name: 'Airport', url: 'https://example.test/sub' }

  it('resolves an explicit profile link from the draft', () => {
    const linked = source({ profileId: item.id, name: 'Linked provider' })
    const draft = draftWith({
      sources: [linked],
      modules: { 'proxy-providers': 'Airport: {type: inline, payload: []}\n' }
    })
    expect(findProfileSource(draft, item)).toBe(linked)
  })

  it.each(['http', 'inline'] as const)(
    'resolves an explicitly bound %s provider from canonical YAML',
    (mode) => {
      const boundSource = source({
        name: 'Airport',
        mode,
        prefix: mode === 'http' ? '' : '[Airport] ',
        url: item.url,
        proxies: [{ name: 'Node', type: 'http', server: '127.0.0.1', port: 8080 }]
      })
      const draft = draftWith({ sources: [boundSource] })
      const config = parse(compileLocalConfig(draft).yaml)
      const canonical = draftWith({
        modules: { 'proxy-providers': stringify(config['proxy-providers']) }
      })
      expect(
        findProfileSource(canonical, {
          ...item,
          nodeSource: bindProfileSource(boundSource, 'local')
        })
      ).toMatchObject({
        profileId: item.id,
        localProfileId: 'local',
        name: 'Airport',
        mode,
        prefix: mode === 'http' ? '' : '[Airport] ',
        providerOptions: config['proxy-providers'].Airport
      })
    }
  )

  it('resolves a renamed provider through its explicit nodeSource binding', () => {
    const draft = draftWith({
      modules: {
        'proxy-providers':
          'Renamed: {type: http, url: "https://example.test/sub", override: {additional-prefix: "[Custom] "}}\n'
      }
    })
    const bound = {
      ...item,
      nodeSource: {
        localProfileId: 'local',
        name: 'Renamed',
        mode: 'http' as const,
        prefix: '[Custom] '
      }
    }
    expect(findProfileSource(draft, bound)?.name).toBe('Renamed')
    expect(findProfileSource(draft, bound)?.prefix).toBe('[Custom] ')
  })

  it('resolves bound extracted nodes and removes only their source prefix', () => {
    const node = { name: '[Airport] Node', type: 'http', server: '127.0.0.1', port: 8080 }
    const draft = draftWith({
      modules: { proxies: stringify([node, { ...node, name: 'Unrelated' }]) }
    })
    const bound = {
      ...item,
      nodeSource: {
        localProfileId: 'local',
        name: 'Airport',
        mode: 'extract' as const,
        prefix: '[Airport] ',
        nodeNames: ['[Airport] Node']
      }
    }
    expect(findProfileSource(draft, bound)).toMatchObject({
      mode: 'extract',
      prefix: '[Airport] ',
      proxies: [{ ...node, name: 'Node' }]
    })
  })

  it('never misclassifies unbound legacy, plugin, or self-bound local profiles', () => {
    const draft = draftWith({
      modules: {
        proxies: stringify([
          { name: '[Airport] Node', type: 'http', server: '127.0.0.1', port: 8080 }
        ]),
        'proxy-providers':
          'Airport: {type: inline, payload: []}\nMirror: {type: http, url: "https://example.test/sub"}\n'
      }
    })
    // Legacy v2.0.3 profiles have nodeSource === undefined and must remain normal profiles.
    expect(findProfileSource(draft, item)).toBeUndefined()
    expect(findProfileSource(draft, { ...item, nodeSource: false })).toBeUndefined()
    expect(findProfileSource(draft, { ...item, pluginId: 'plugin' })).toBeUndefined()
    expect(
      findProfileSource(draft, {
        ...item,
        id: 'local',
        nodeSource: {
          localProfileId: 'local',
          name: 'Airport',
          mode: 'inline',
          prefix: '[Airport] '
        }
      })
    ).toBeUndefined()
  })
})

describe('compileLocalConfig', () => {
  it('compiles the default draft without errors', () => {
    const result = compileLocalConfig(defaultLocalDraft())
    expect(result.errors).toEqual([])
    const config = parse(result.yaml)
    expect(config['mixed-port']).toBe(7890)
    expect(config['proxy-groups'][0].name).toBe('PROXY')
    expect(config.rules).toEqual(['MATCH,PROXY'])
  })

  it('inlines extract-source nodes with prefix and rewrites dialer-proxy', () => {
    const draft = draftWith({
      sources: [
        source({
          proxies: [
            { name: '节点1', type: 'ss', server: 'a', port: 1 },
            { name: '节点2', type: 'ss', server: 'b', port: 2, 'dialer-proxy': '节点1' }
          ]
        })
      ]
    })
    const result = compileLocalConfig(draft)
    expect(result.errors).toEqual([])
    const config = parse(result.yaml)
    expect(config.proxies.map((p: { name: string }) => p.name)).toEqual(['[A] 节点1', '[A] 节点2'])
    expect(config.proxies[1]['dialer-proxy']).toBe('[A] 节点1')
  })

  it('turns inline sources into inline proxy-providers', () => {
    const draft = draftWith({
      sources: [
        source({
          mode: 'inline',
          proxies: [{ name: '节点1', type: 'ss', server: 'a', port: 1 }]
        })
      ]
    })
    const result = compileLocalConfig(draft)
    expect(result.errors).toEqual([])
    const config = parse(result.yaml)
    expect(config['proxy-providers']['机场A'].type).toBe('inline')
    expect(config['proxy-providers']['机场A'].payload[0].name).toBe('[A] 节点1')
  })

  it('turns http sources into http proxy-providers with prefix and headers', () => {
    const draft = draftWith({
      sources: [
        source({
          mode: 'http',
          url: 'https://example.com/sub',
          interval: 3600,
          userAgent: 'UA',
          authorization: 'token'
        })
      ]
    })
    const result = compileLocalConfig(draft)
    expect(result.errors).toEqual([])
    const provider = parse(result.yaml)['proxy-providers']['机场A']
    expect(provider.type).toBe('http')
    expect(provider.override['additional-prefix']).toBe('[A] ')
    expect(provider.header['User-Agent']).toEqual(['UA'])
    expect(provider.header.Authorization).toEqual(['token'])
  })

  it('keeps preserved standard fields and flattens the general module', () => {
    const draft = draftWith({
      preserved: { 'geodata-mode': true },
      modules: { general: 'mixed-port: 7899\nmode: global\n' }
    })
    const result = compileLocalConfig(draft)
    expect(result.errors).toEqual([])
    const config = parse(result.yaml)
    expect(config['mixed-port']).toBe(7899)
    expect(config.mode).toBe('global')
    expect(config['geodata-mode']).toBe(true)
  })

  it('expands group.source references by source mode', () => {
    const draft = draftWith({
      sources: [
        source({
          id: 's1',
          name: '外链',
          mode: 'extract',
          prefix: '[外链] ',
          proxies: [{ name: 'n1', type: 'ss' }]
        }),
        source({ id: 's2', name: '集合', mode: 'inline', proxies: [{ name: 'n2', type: 'ss' }] })
      ],
      modules: {
        'proxy-groups':
          '- name: G1\n  type: select\n  source: 外链\n- name: G2\n  type: select\n  source: 集合\n',
        rules: '- MATCH,G1\n'
      }
    })
    const result = compileLocalConfig(draft)
    expect(result.errors).toEqual([])
    const groups = parse(result.yaml)['proxy-groups']
    expect(groups[0].proxies).toContain('[外链] n1')
    expect(groups[1].use).toContain('集合')
  })

  it('reports duplicate builtin names and undefined rule targets', () => {
    const draft = draftWith({
      modules: {
        'proxy-groups': '- name: DIRECT\n  type: select\n  proxies: [DIRECT]\n',
        rules: '- DOMAIN-SUFFIX,example.com,NOPE\n'
      }
    })
    const result = compileLocalConfig(draft)
    expect(result.errors.some((e) => e.includes('内置名称'))).toBe(true)
    expect(result.errors.some((e) => e.includes('未定义出站 NOPE'))).toBe(true)
  })

  it('detects outbound cycles', () => {
    const draft = draftWith({
      modules: {
        'proxy-groups':
          '- name: A\n  type: select\n  proxies: [B]\n- name: B\n  type: select\n  proxies: [A]\n'
      }
    })
    const result = compileLocalConfig(draft)
    expect(result.errors.some((e) => e.includes('循环引用'))).toBe(true)
  })

  it('rejects duplicated source names', () => {
    const draft = draftWith({
      sources: [source({ id: 'a' }), source({ id: 'b' })]
    })
    const result = compileLocalConfig(draft)
    expect(result.errors.some((e) => e.includes('名称重复'))).toBe(true)
  })
})
