import type { LocalDraft, LocalObject, LocalSource } from '../../shared/local-config'
import { parse, stringify } from '../utils/yaml'
import { readLocalGroups } from './groups'

// Resolve linked subscriptions at compile time; profile files remain the only node store.
export async function resolveLocalDraft(draft: LocalDraft): Promise<LocalDraft> {
  if (!draft.sources.some((source) => source.profileId)) return draft
  const { getProfileConfig, getProfile } = await import('../config/profile')
  const { items } = await getProfileConfig()
  const snapshots = new Map<string, Promise<IMihomoConfig>>()
  const sources: LocalSource[] = []
  for (const source of draft.sources) {
    if (!source.profileId) {
      sources.push(source)
      continue
    }
    const item = items.find((item) => item.id === source.profileId)
    if (!item) continue
    const mode = source.mode === 'http' && item.type !== 'remote' ? 'inline' : source.mode
    let proxies: LocalObject[] = []
    if (mode !== 'http') {
      const snapshot = snapshots.get(item.id) ?? getProfile(item.id)
      snapshots.set(item.id, snapshot)
      const profile = await snapshot
      if (!Array.isArray(profile?.proxies) || profile.proxies.length === 0) {
        throw new Error(`订阅 ${item.name}: 没有可导入的 proxies 节点`)
      }
      proxies = structuredClone(profile.proxies) as LocalObject[]
      for (const node of proxies) {
        if (
          typeof node['dialer-proxy'] === 'string' &&
          source.removedDialerProxies?.[String(node.name)]?.includes(node['dialer-proxy'])
        )
          delete node['dialer-proxy']
      }
    }
    const minutes = Number(item.interval)
    sources.push({
      ...source,
      mode,
      url: item.url,
      interval:
        item.autoUpdate === false
          ? 0
          : Number.isFinite(minutes) && minutes > 0
            ? Math.ceil(minutes * 60)
            : 3600,
      userAgent: item.userAgent,
      authorization: item.authToken,
      ageSecretKey: item.ageSecretKey,
      extra: item.extra,
      updated: item.updated,
      proxies
    })
  }
  return { ...draft, sources }
}

export function replaceLocalSource(
  draft: LocalDraft,
  previous: LocalSource | undefined,
  source: LocalSource
): LocalDraft {
  const sources = previous
    ? draft.sources.map((item) => (item.id === previous.id ? source : item))
    : [...draft.sources, source]
  if (!previous) return { ...draft, sources }
  const groups = parse(draft.modules['proxy-groups']) as LocalObject[]
  if (!Array.isArray(groups)) throw new Error('策略组应为 YAML 列表')
  const oldNodes = new Map(
    previous.proxies.map((node) => [
      `${previous.prefix}${node.name}`,
      `${source.prefix}${node.name}`
    ])
  )
  for (const group of groups) {
    if (group.source === previous.name) group.source = source.name
    if (Array.isArray(group.use) && group.use.includes(previous.name)) {
      group.use = group.use.filter((name) => name !== previous.name)
      if (source.mode === 'extract') {
        group.proxies = [
          ...new Set([
            ...(Array.isArray(group.proxies) ? group.proxies : []),
            ...source.proxies.map((node) => `${source.prefix}${node.name}`)
          ])
        ]
      } else group.use = [...new Set([...(group.use as string[]), source.name])]
    }
    if (previous.mode === 'extract' && Array.isArray(group.proxies)) {
      if (source.mode === 'extract') {
        group.proxies = [...new Set(group.proxies.map((name) => oldNodes.get(name) ?? name))]
      } else if (group.proxies.some((name) => oldNodes.has(name))) {
        group.proxies = group.proxies.filter((name) => !oldNodes.has(name))
        group.use = [...new Set([...(Array.isArray(group.use) ? group.use : []), source.name])]
      }
    }
  }
  return {
    ...draft,
    sources,
    modules: { ...draft.modules, 'proxy-groups': stringify(groups) }
  }
}

export function setLocalSourceGroups(
  draft: LocalDraft,
  previous: LocalSource,
  source: LocalSource,
  targetGroups: string[]
): LocalDraft {
  const groups = readLocalGroups(draft)
  const selected = new Set(targetGroups)
  const missing = targetGroups.filter((name) => !groups.some((group) => group.name === name))
  if (missing.length) throw new Error(`代理组不存在: ${missing.join('、')}`)
  const previousEntries = new Set(
    previous.mode === 'extract'
      ? previous.proxies.map((node) => `${previous.prefix}${node.name}`)
      : []
  )
  const sourceEntries = new Set(
    source.mode === 'extract' ? source.proxies.map((node) => `${source.prefix}${node.name}`) : []
  )
  for (const group of groups) {
    if (Array.isArray(group.use))
      group.use = group.use.filter((name) => name !== previous.name && name !== source.name)
    if (Array.isArray(group.proxies)) {
      group.proxies = group.proxies.filter(
        (name) => !previousEntries.has(name) && !sourceEntries.has(name)
      )
    }
  }
  const entries = source.mode === 'extract' ? [...sourceEntries] : [source.name]
  for (const group of groups) {
    if (!selected.has(String(group.name))) continue
    if (source.mode === 'extract') {
      group.proxies = [
        ...new Set([...(Array.isArray(group.proxies) ? group.proxies : []), ...entries])
      ]
    } else {
      group.use = [...new Set([...(Array.isArray(group.use) ? group.use : []), ...entries])]
    }
  }
  return { ...draft, modules: { ...draft.modules, 'proxy-groups': stringify(groups) } }
}
