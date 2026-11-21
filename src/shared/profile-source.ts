import type { LocalDraft, LocalObject, LocalSource, LocalSourceBinding } from './local-config'
import { parseYaml } from './yaml'

function isObject(value: unknown): value is LocalObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function bindProfileSource(source: LocalSource, localProfileId: string): LocalSourceBinding {
  return {
    localProfileId,
    name: source.name,
    mode: source.mode,
    prefix: source.prefix,
    nodeNames:
      source.mode === 'extract'
        ? source.proxies.map((node) => `${source.prefix}${node.name}`)
        : undefined
  }
}

// Local profiles store plain Mihomo YAML, so source references must also be resolved from it.
export function findProfileSource(
  draft: LocalDraft,
  item: Pick<IProfileItem, 'id' | 'name' | 'url' | 'pluginId' | 'nodeSource'>
): LocalSource | undefined {
  if (item.pluginId || item.nodeSource === false) return undefined
  const linked = draft.sources.find((source) => source.profileId === item.id)
  if (linked) return linked
  const binding = item.nodeSource

  const providers = parseYaml(draft.modules['proxy-providers'])
  if (isObject(providers) && binding?.mode !== 'extract') {
    const entry = Object.entries(providers).find(
      ([name, value]) =>
        isObject(value) &&
        (binding
          ? name === binding.name && value.type === binding.mode
          : (Boolean(item.url) && value.url === item.url) ||
            (name === item.name && value.type === 'inline'))
    )
    if (entry && isObject(entry[1])) {
      const provider = entry[1]
      const override = isObject(provider.override) ? provider.override : {}
      return {
        id: `profile-${item.id}`,
        profileId: item.id,
        localProfileId: binding?.localProfileId,
        name: entry[0],
        mode: provider.type === 'inline' ? 'inline' : 'http',
        prefix:
          typeof override['additional-prefix'] === 'string'
            ? override['additional-prefix']
            : `[${entry[0]}] `,
        interval: Number(provider.interval) || 3600,
        url: typeof provider.url === 'string' ? provider.url : undefined,
        providerOptions: provider,
        proxies: []
      }
    }
  }
  if (binding && binding.mode !== 'extract') return undefined
  const prefix = binding?.prefix ?? `[${item.name}] `
  const boundNames = binding ? new Set(binding.nodeNames ?? []) : undefined
  const nodes = parseYaml(draft.modules.proxies)
  const proxies = Array.isArray(nodes)
    ? nodes
        .filter(
          (node): node is LocalObject =>
            isObject(node) &&
            typeof node.name === 'string' &&
            (boundNames ? boundNames.has(node.name) : node.name.startsWith(prefix))
        )
        .map((node) => ({ ...node, name: String(node.name).slice(prefix.length) }))
    : []
  if (!proxies.length && !binding) return undefined
  return {
    id: `profile-${item.id}`,
    profileId: item.id,
    localProfileId: binding?.localProfileId,
    name: binding?.name ?? item.name,
    mode: 'extract',
    prefix,
    interval: 0,
    proxies
  }
}
