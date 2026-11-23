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

// Local profiles store plain Mihomo YAML, so bound source references are resolved from it.
export function findProfileSource(
  draft: LocalDraft,
  item: Pick<IProfileItem, 'id' | 'name' | 'url' | 'pluginId' | 'nodeSource'>
): LocalSource | undefined {
  if (item.pluginId || item.nodeSource === false) return undefined
  const linked = draft.sources.find((source) => source.profileId === item.id)
  if (linked) return linked
  const binding = item.nodeSource
  if (
    !binding ||
    binding.localProfileId === item.id ||
    typeof binding.localProfileId !== 'string' ||
    typeof binding.name !== 'string' ||
    typeof binding.prefix !== 'string' ||
    (binding.mode === 'extract' && !Array.isArray(binding.nodeNames)) ||
    !['extract', 'inline', 'http'].includes(binding.mode)
  ) {
    return undefined
  }

  if (binding.mode !== 'extract') {
    const providers = parseYaml(draft.modules['proxy-providers'])
    if (!isObject(providers)) return undefined
    const provider = providers[binding.name]
    if (isObject(provider) && provider.type === binding.mode) {
      const override = isObject(provider.override) ? provider.override : {}
      return {
        id: `profile-${item.id}`,
        profileId: item.id,
        localProfileId: binding.localProfileId,
        name: binding.name,
        mode: provider.type === 'inline' ? 'inline' : 'http',
        prefix:
          typeof override['additional-prefix'] === 'string'
            ? override['additional-prefix']
            : `[${binding.name}] `,
        interval: Number(provider.interval) || 3600,
        url: typeof provider.url === 'string' ? provider.url : undefined,
        providerOptions: provider,
        proxies: []
      }
    }
    return undefined
  }

  const prefix = binding.prefix
  const boundNames = new Set(binding.nodeNames)
  const nodes = parseYaml(draft.modules.proxies)
  const proxies = Array.isArray(nodes)
    ? nodes
        .filter(
          (node): node is LocalObject =>
            isObject(node) && typeof node.name === 'string' && boundNames.has(node.name)
        )
        .map((node) => {
          const name = String(node.name)
          return { ...node, name: name.startsWith(prefix) ? name.slice(prefix.length) : name }
        })
    : []
  return {
    id: `profile-${item.id}`,
    profileId: item.id,
    localProfileId: binding.localProfileId,
    name: binding.name,
    mode: 'extract',
    prefix,
    interval: 0,
    proxies
  }
}
