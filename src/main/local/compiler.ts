import { parse, stringify } from '../utils/yaml'
import { parseLocalRule, ruleParts, ruleSetNames } from '../../shared/local-rules'
export { ruleParts } from '../../shared/local-rules'
import {
  LOCAL_BUILTIN_OUTBOUNDS,
  LOCAL_MODULES,
  type LocalDraft,
  type LocalObject,
  type LocalPreview
} from '../../shared/local-config'

export function isObject(value: unknown): value is LocalObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function compileLocalConfig(draft: LocalDraft): LocalPreview {
  const errors: string[] = []
  const config: LocalObject = structuredClone(draft.preserved || {})
  for (const key of Object.keys(LOCAL_MODULES)) {
    try {
      const value: unknown = parse(draft.modules[key])
      const list = ['proxies', 'proxy-groups', 'rules'].includes(key)
      if (list ? !Array.isArray(value) : !isObject(value)) {
        throw new Error(list ? '应为 YAML 列表' : '应为 YAML 对象')
      }
      if (key === 'general') {
        for (const [field, fieldValue] of Object.entries(value as LocalObject)) {
          config[field] = fieldValue
        }
      } else config[key] = value
    } catch (e) {
      errors.push(`${LOCAL_MODULES[key]}: ${String(e)}`)
      if (key !== 'general')
        config[key] = ['proxies', 'proxy-groups', 'rules'].includes(key) ? [] : {}
    }
  }
  const proxies = config.proxies as LocalObject[]
  const providers = config['proxy-providers'] as Record<string, LocalObject>
  const ruleProviders = config['rule-providers'] as Record<string, LocalObject>
  const groups = config['proxy-groups'] as LocalObject[]
  const sourceByName = new Map(draft.sources.map((source) => [source.name, source]))
  const sourceNames = new Set<string>()
  const sourceIds = new Set<string>()
  for (const source of draft.sources) {
    if (!isObject(source)) {
      errors.push('订阅来源必须是对象')
      continue
    }
    if (!source.id || sourceIds.has(source.id)) errors.push(`订阅来源 ID 重复或为空: ${source.id}`)
    sourceIds.add(source.id)
    const sourceName = source.name?.trim()
    if (!sourceName) errors.push('订阅来源名称不能为空')
    else if (sourceNames.has(sourceName)) errors.push(`订阅来源名称重复: ${sourceName}`)
    else sourceNames.add(sourceName)
    if (!['extract', 'inline', 'http'].includes(source.mode))
      errors.push(`订阅 ${sourceName || '(未命名)'}: 未知导入方式 ${source.mode}`)
    if (typeof source.prefix !== 'string')
      errors.push(`订阅 ${sourceName || '(未命名)'}: 前缀必须是字符串`)
    if (!Array.isArray(source.proxies)) {
      errors.push(`订阅 ${sourceName || '(未命名)'}: 节点必须是列表`)
      continue
    }
    const nodes = source.proxies
      .filter((proxy, index) => {
        if (!isObject(proxy)) {
          errors.push(`订阅 ${sourceName || '(未命名)'}.proxies[${index}]: 节点必须是对象`)
          return false
        }
        if (typeof proxy.name !== 'string' || !proxy.name.trim()) {
          errors.push(`订阅 ${sourceName || '(未命名)'}.proxies[${index}]: 缺少 name`)
          return false
        }
        return true
      })
      .map((proxy) => {
        return {
          ...proxy,
          name: `${source.prefix || ''}${proxy.name}`
        }
      })
    // Rewrite references between nodes from the same subscription when adding a prefix.
    const ownNames = new Set(source.proxies.filter(isObject).map((node) => String(node.name)))
    for (const node of nodes) {
      if (typeof node['dialer-proxy'] === 'string' && ownNames.has(node['dialer-proxy'])) {
        node['dialer-proxy'] = `${source.prefix}${node['dialer-proxy']}`
      }
    }
    if (source.mode === 'extract') proxies.push(...nodes)
    else {
      if (Object.hasOwn(providers, source.name)) errors.push(`代理集合名称重复: ${source.name}`)
      if (source.mode === 'http') {
        try {
          if (!['http:', 'https:'].includes(new URL(source.url || '').protocol)) throw new Error()
        } catch {
          errors.push(`订阅 ${source.name}: HTTP Provider 需要 http(s) URL`)
        }
        if (!Number.isSafeInteger(source.interval) || source.interval < 0)
          errors.push(`订阅 ${source.name}: 更新间隔必须是非负整数`)
        providers[source.name] = {
          ...(source.ageSecretKey ? { 'age-secret-key': source.ageSecretKey } : {}),
          ...(source.proxy ? { proxy: source.proxy } : {}),
          ...structuredClone(source.providerOptions || {}),
          type: 'http',
          url: source.url,
          interval: source.interval,
          override: {
            ...(isObject(source.providerOptions?.override) ? source.providerOptions.override : {}),
            'additional-prefix': source.prefix
          },
          header: {
            ...(source.userAgent ? { 'User-Agent': [source.userAgent] } : {}),
            ...(source.authorization ? { Authorization: [source.authorization] } : {}),
            ...(isObject(source.providerOptions?.header) ? source.providerOptions.header : {})
          }
        }
      } else if (source.mode === 'inline')
        providers[source.name] = {
          ...structuredClone(source.providerOptions || {}),
          type: 'inline',
          payload: nodes
        }
      else errors.push(`未知导入方式: ${source.mode}`)
    }
  }
  const outbounds = new Set(LOCAL_BUILTIN_OUTBOUNDS)
  const graph = new Map<string, string[]>()
  for (const [kind, entries] of [
    ['节点', proxies],
    ['策略组', groups]
  ] as const) {
    entries.forEach((entry, index) => {
      if (!isObject(entry) || typeof entry.name !== 'string' || !entry.name.trim()) {
        errors.push(`${kind}[${index}]: 缺少 name`)
        return
      }
      if (outbounds.has(entry.name) || entry.name === 'GLOBAL')
        errors.push(`${kind}名称重复或占用内置名称: ${entry.name}`)
      outbounds.add(entry.name)
      if (typeof entry.type !== 'string') errors.push(`${kind} ${entry.name}: 缺少 type`)
      graph.set(entry.name, [])
    })
  }
  function outbound(value: unknown, location: string, owner?: string): void {
    if (typeof value !== 'string' || !outbounds.has(value))
      errors.push(`${location}: 未定义出站 ${String(value)}`)
    else if (owner && graph.has(value)) graph.get(owner)?.push(value)
  }
  function names(value: unknown, location: string, visit: (name: unknown) => void): void {
    if (value === undefined) return
    if (!Array.isArray(value)) {
      errors.push(`${location}: 应为列表`)
      return
    }
    value.forEach(visit)
  }
  for (const node of proxies) {
    if (isObject(node) && node['dialer-proxy'] !== undefined)
      outbound(node['dialer-proxy'], `节点 ${node.name}.dialer-proxy`, String(node.name))
  }
  for (const group of groups) {
    if (!isObject(group)) continue
    const owner = String(group.name)
    if (typeof group.source === 'string') {
      const source = sourceByName.get(group.source)
      if (!source) errors.push(`策略组 ${owner}: 未定义订阅来源 ${group.source}`)
      else if (source.mode === 'extract') {
        const selected = source.proxies.map((node) => `${source.prefix}${node.name}`)
        group.proxies = [
          ...new Set([...(Array.isArray(group.proxies) ? group.proxies : []), ...selected])
        ]
      } else {
        group.use = [...new Set([...(Array.isArray(group.use) ? group.use : []), source.name])]
      }
      delete group.source
    }
    names(group.proxies, `策略组 ${owner}.proxies`, (name) =>
      outbound(name, `策略组 ${owner}`, owner)
    )
    names(group.use, `策略组 ${owner}.use`, (name) => {
      if (typeof name !== 'string' || !Object.hasOwn(providers, name))
        errors.push(`策略组 ${owner}: 未定义代理集合 ${String(name)}`)
    })
    if (
      !group['include-all'] &&
      !group['include-all-proxies'] &&
      !group['include-all-providers'] &&
      !(Array.isArray(group.proxies) && group.proxies.length) &&
      !(Array.isArray(group.use) && group.use.length)
    ) {
      errors.push(`策略组 ${owner}: 至少添加一个节点、策略组或代理集合`)
    }
  }
  for (const [kind, entries] of [
    ['代理集合', providers],
    ['规则集合', ruleProviders]
  ] as const) {
    for (const [name, provider] of Object.entries(entries)) {
      if (!isObject(provider)) {
        errors.push(`${kind} ${name}: 应为对象`)
        continue
      }
      if (provider.proxy !== undefined) outbound(provider.proxy, `${kind} ${name}.proxy`)
      if (!['http', 'file', 'inline'].includes(String(provider.type)))
        errors.push(`${kind} ${name}: type 必须是 http/file/inline`)
      if (provider.type === 'http' && typeof provider.url !== 'string')
        errors.push(`${kind} ${name}: 缺少 url`)
      if (provider.type === 'file' && typeof provider.path !== 'string')
        errors.push(`${kind} ${name}: 缺少 path`)
      if (kind === '代理集合' && Array.isArray(provider.payload)) {
        const nodeNames = new Set<string>()
        for (const node of provider.payload) {
          if (!isObject(node) || typeof node.name !== 'string' || !node.name.trim()) {
            errors.push(`代理集合 ${name}.payload: 节点缺少 name`)
            continue
          }
          if (nodeNames.has(node.name)) errors.push(`代理集合 ${name}: 节点名称重复 ${node.name}`)
          nodeNames.add(node.name)
        }
        for (const node of provider.payload) {
          if (
            isObject(node) &&
            node['dialer-proxy'] !== undefined &&
            !nodeNames.has(String(node['dialer-proxy']))
          )
            outbound(node['dialer-proxy'], `代理集合 ${name}.payload.dialer-proxy`)
        }
      }
      if (isObject(provider.override) && provider.override['dialer-proxy'] !== undefined)
        outbound(provider.override['dialer-proxy'], `${kind} ${name}.override.dialer-proxy`)
    }
  }
  const subRules = config['sub-rules'] as Record<string, unknown>
  const subGraph = new Map<string, string[]>(Object.keys(subRules).map((name) => [name, []]))
  function rules(value: unknown, location: string, owner?: string): void {
    names(value, location, (rule) => {
      if (typeof rule !== 'string') {
        errors.push(`${location}: 规则应为字符串`)
        return
      }
      const parts = ruleParts(rule)
      const type = parts[0]
      for (const name of ruleSetNames(rule)) {
        if (!Object.hasOwn(ruleProviders, name)) errors.push(`${location}: 未定义规则集合 ${name}`)
      }
      if (type === 'SUB-RULE') {
        const target = parts[2]
        if (!Object.hasOwn(subRules, target)) errors.push(`${location}: 未定义子规则 ${target}`)
        else if (owner) subGraph.get(owner)?.push(target)
      } else {
        const { target } = parseLocalRule(rule)
        if (parts.length < 2) errors.push(`${location}: 无效规则 ${rule}`)
        else outbound(target, `${location}: ${rule}`)
      }
    })
  }
  rules(config.rules, '规则')
  for (const [name, value] of Object.entries(subRules)) rules(value, `子规则 ${name}`, name)
  function cycles(edges: Map<string, string[]>, label: string): void {
    const visited = new Set<string>()
    const active = new Set<string>()
    function visit(name: string): void {
      if (active.has(name)) {
        errors.push(`${label}循环引用: ${[...active, name].join(' → ')}`)
        return
      }
      if (visited.has(name)) return
      active.add(name)
      for (const next of edges.get(name) || []) visit(next)
      active.delete(name)
      visited.add(name)
    }
    for (const name of edges.keys()) visit(name)
  }
  cycles(graph, '出站')
  cycles(subGraph, '子规则')
  for (const key of ['route-address-set', 'route-exclude-address-set']) {
    names((config.tun as LocalObject)[key], `TUN.${key}`, (name) => {
      if (typeof name !== 'string' || !Object.hasOwn(ruleProviders, name))
        errors.push(`TUN.${key}: 未定义规则集合 ${String(name)}`)
    })
  }
  return {
    yaml: stringify(config),
    errors,
    references: {
      outbounds: [...outbounds],
      proxyProviders: Object.keys(providers),
      ruleProviders: Object.keys(ruleProviders)
    }
  }
}
