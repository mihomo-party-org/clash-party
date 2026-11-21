import path from 'path'
import { isDeepStrictEqual } from 'node:util'
import { app, dialog } from 'electron'
import { parse, stringify } from '../utils/yaml'
import { atomicWriteFile } from '../utils/safeFile'
import {
  isLocalProfile,
  LOCAL_BUILTIN_OUTBOUNDS,
  type LocalDraft,
  type LocalPreview,
  type LocalObject,
  type LocalProxyGroupEditor,
  type LocalRuleChange,
  type LocalRuleEditor,
  type LocalSource,
  type LocalSubscriptionOptions
} from '../../shared/local-config'
import { bindProfileSource, findProfileSource } from '../../shared/profile-source'
import {
  activeLocalProfileId,
  getLocalState,
  commitLocalState,
  withLocalConfigWrite,
  withLocalProfileScope
} from './store'
import { compileLocalConfig } from './compiler'
import { normalizeLocalProviderOptions } from './providers'
import { replaceLocalSource, resolveLocalDraft, setLocalSourceGroups } from './subscriptions'
import {
  addLocalNodes,
  readLocalNodes,
  removeLocalNode as removeLocalNodeFromDraft,
  updateLocalNode
} from './nodes'
import {
  addLocalGroup,
  readLocalGroups,
  reorderLocalGroups,
  updateLocalGroup,
  removeLocalGroup
} from './groups'
import {
  changeLocalRules,
  changeLocalRuleProvider,
  readLocalRules,
  readLocalRuleProviders
} from './rules'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export async function previewLocalConfig(id?: string): Promise<LocalPreview> {
  return compileLocalConfig(await resolveLocalDraft(await getLocalConfig(id)))
}
export async function getLocalConfig(id?: string): Promise<LocalDraft> {
  if (id === undefined) return getLocalState()
  const { getProfileItem } = await import('../config/profile')
  if (!isLocalProfile(await getProfileItem(id))) throw new Error('找不到本地配置')
  return withLocalProfileScope(id, getLocalState)
}
export async function exportLocalConfig(): Promise<LocalPreview & { path?: string }> {
  const preview = await previewLocalConfig()
  if (preview.errors.length) return preview
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: '导出配置',
    defaultPath: path.join(app.getPath('documents'), 'clash-party-config.yaml'),
    filters: [{ name: 'YAML', extensions: ['yaml', 'yml'] }]
  })
  if (canceled || !filePath) return preview
  await atomicWriteFile(filePath, preview.yaml, { encoding: 'utf8' })
  return { ...preview, path: filePath }
}
export async function getLocalRulesEditor(): Promise<LocalRuleEditor> {
  const draft = await getLocalState()
  const preview = compileLocalConfig(await resolveLocalDraft(draft))
  const subRules = parse(draft.modules['sub-rules'])
  return {
    rules: readLocalRules(draft),
    ruleProviders: readLocalRuleProviders(draft),
    outbounds: preview.references.outbounds,
    subRules: isRecord(subRules) ? Object.keys(subRules) : []
  }
}

export async function saveLocalRules(change: LocalRuleChange, expected: string[]): Promise<void> {
  await withLocalConfigWrite(async () => {
    if (!isRecord(change) || !Array.isArray(expected)) throw new Error('规则参数无效')
    const state = await getLocalState()
    const result = await commitLocalState(state, changeLocalRules(state, change, expected))
    if (result.errors.length) throw new Error(result.errors.join('\n'))
  })
}

export async function saveLocalRuleProvider(
  name: string | undefined,
  nextName: string,
  value: LocalObject | null,
  expected?: LocalObject
): Promise<void> {
  await withLocalConfigWrite(async () => {
    if (
      typeof nextName !== 'string' ||
      (value !== null && !isRecord(value)) ||
      (name !== undefined && (typeof name !== 'string' || !isRecord(expected)))
    )
      throw new Error('规则集参数无效')
    const state = await getLocalState()
    const result = await commitLocalState(
      state,
      changeLocalRuleProvider(state, name, nextName, value, expected)
    )
    if (result.errors.length) throw new Error(result.errors.join('\n'))
  })
}

export async function saveLocalProvider(
  kind: 'proxy-providers' | 'rule-providers',
  name: string | undefined,
  nextName: string,
  value: LocalObject,
  expected?: LocalObject
): Promise<void> {
  if (kind === 'rule-providers') return saveLocalRuleProvider(name, nextName, value, expected)
  await withLocalConfigWrite(async () => {
    if (
      kind !== 'proxy-providers' ||
      typeof nextName !== 'string' ||
      !nextName.trim() ||
      !isRecord(value)
    ) {
      throw new Error('代理集合参数无效')
    }
    const state = await getLocalState()
    const providers = parse<Record<string, LocalObject>>(state.modules[kind])
    if (
      name !== undefined &&
      (!Object.hasOwn(providers, name) || !isDeepStrictEqual(providers[name], expected))
    ) {
      throw new Error('代理集合已变更，请重新打开编辑')
    }
    if (name !== nextName && Object.hasOwn(providers, nextName)) {
      throw new Error(`代理集合名称重复：${nextName}`)
    }
    const next = {
      ...Object.fromEntries(Object.entries(providers).filter(([key]) => key !== name)),
      [nextName]: value
    }
    const result = await commitLocalState(state, {
      ...state,
      modules: { ...state.modules, [kind]: stringify(next) }
    })
    if (result.errors.length) throw new Error(result.errors.join('\n'))
  })
}

export async function getLocalProxyGroup(name?: string): Promise<LocalProxyGroupEditor> {
  const state = await getLocalState()
  const groups = readLocalGroups(state)
  const group =
    name === undefined
      ? { name: '', type: 'select', proxies: ['DIRECT'] }
      : groups.find((group) => group.name === name)
  if (!group) throw new Error(`找不到代理组：${name}`)
  const draft = await resolveLocalDraft(state)
  const preview = compileLocalConfig(draft)
  const config = parse(preview.yaml) as LocalObject
  const outboundDetails: LocalProxyGroupEditor['outboundDetails'] = {
    DIRECT: { type: 'Direct' },
    REJECT: { type: 'Reject' },
    'REJECT-DROP': { type: 'RejectDrop' },
    PASS: { type: 'Pass' },
    'PASS-RULE': { type: 'PassRule' },
    COMPATIBLE: { type: 'Compatible' }
  }
  const sources = new Map<string, string>()
  for (const source of draft.sources) {
    if (source.mode !== 'extract') continue
    for (const proxy of source.proxies) {
      if (typeof proxy.name === 'string')
        sources.set(`${source.prefix || ''}${proxy.name}`, source.name)
    }
  }
  for (const key of ['proxies', 'proxy-groups']) {
    const entries = config[key]
    if (!Array.isArray(entries)) continue
    for (const entry of entries) {
      if (!isRecord(entry) || typeof entry.name !== 'string') continue
      outboundDetails[entry.name] = {
        type: typeof entry.type === 'string' ? entry.type : 'unknown',
        ...(sources.has(entry.name) ? { source: sources.get(entry.name) } : {})
      }
    }
  }
  const providers = config['proxy-providers']
  const providerTypes = Object.fromEntries(
    Object.entries(isRecord(providers) ? providers : {}).map(([name, provider]) => [
      name,
      isRecord(provider) && typeof provider.type === 'string' ? provider.type : 'unknown'
    ])
  )
  return {
    group,
    outbounds: preview.references.outbounds.filter((outbound) => outbound !== name),
    groupNames: groups.map((group) => String(group.name)),
    proxyProviders: preview.references.proxyProviders,
    sources: draft.sources.map((source) => source.name),
    outboundDetails,
    providerTypes
  }
}

async function assertLocalNameAvailable(
  draft: LocalDraft,
  label: string,
  value: LocalObject,
  previousName?: string
): Promise<void> {
  if (typeof value.name !== 'string' || !value.name.trim()) throw new Error(`${label}名称不能为空`)
  const name = value.name.trim()
  if (LOCAL_BUILTIN_OUTBOUNDS.includes(name) || name === 'GLOBAL') {
    throw new Error(`不能使用内置出站或 GLOBAL 名称: ${name}`)
  }
  if (name === previousName) return
  const resolved = await resolveLocalDraft(draft)
  const { references } = compileLocalConfig(resolved)
  if (references.outbounds.includes(name))
    throw new Error(`${label}名称与已有节点或代理组冲突: ${name}`)
  if (references.proxyProviders.includes(name))
    throw new Error(`${label}名称与已有代理集合冲突: ${name}`)
}

export async function saveLocalProxyGroup(
  name: string,
  value: LocalObject,
  expected: LocalObject
): Promise<void> {
  await withLocalConfigWrite(async () => {
    if (!isRecord(value) || !isRecord(expected)) throw new Error('代理组参数必须是对象')
    const state = await getLocalState()
    await assertLocalNameAvailable(state, '代理组', value, name)
    const result = await commitLocalState(state, updateLocalGroup(state, name, value, expected))
    if (result.errors.length) throw new Error(result.errors.join('\n'))
  })
}

export async function createLocalProxyGroup(value: LocalObject): Promise<void> {
  await withLocalConfigWrite(async () => {
    if (!isRecord(value)) throw new Error('代理组参数必须是对象')
    const state = await getLocalState()
    await assertLocalNameAvailable(state, '代理组', value)
    const result = await commitLocalState(state, addLocalGroup(state, value))
    if (result.errors.length) throw new Error(result.errors.join('\n'))
  })
}

export async function removeLocalProxyGroup(name: string, expected: LocalObject): Promise<void> {
  await withLocalConfigWrite(async () => {
    if (typeof name !== 'string' || !isRecord(expected)) throw new Error('代理组参数无效')
    const state = await getLocalState()
    const result = await commitLocalState(state, removeLocalGroup(state, name, expected))
    if (result.errors.length) throw new Error(result.errors.join('\n'))
  })
}

export async function reorderLocalProxyGroups(names: string[]): Promise<void> {
  await withLocalConfigWrite(async () => {
    if (!Array.isArray(names) || names.some((name) => typeof name !== 'string')) {
      throw new Error('代理组顺序必须是名称列表')
    }
    const state = await getLocalState()
    const result = await commitLocalState(state, reorderLocalGroups(state, names))
    if (result.errors.length) throw new Error(result.errors.join('\n'))
  })
}

export async function getLocalNode(name?: string): Promise<LocalObject> {
  const state = await getLocalState()
  const node =
    name === undefined
      ? { name: '', type: 'ss' }
      : readLocalNodes(state).find((item) => item.name === name)
  if (!node) throw new Error(`找不到节点：${name}`)
  return node
}

export async function createLocalNodes(values: LocalObject[]): Promise<void> {
  await withLocalConfigWrite(async () => {
    if (!Array.isArray(values) || !values.length) throw new Error('节点参数不能为空')
    const state = await getLocalState()
    for (const value of values) {
      if (!isRecord(value)) throw new Error('节点参数必须是对象')
      await assertLocalNameAvailable(state, '节点', value)
    }
    const result = await commitLocalState(state, addLocalNodes(state, values))
    if (result.errors.length) throw new Error(result.errors.join('\n'))
  })
}

export async function saveLocalNode(
  name: string,
  value: LocalObject,
  expected: LocalObject
): Promise<void> {
  await withLocalConfigWrite(async () => {
    if (typeof name !== 'string' || !isRecord(value) || !isRecord(expected)) {
      throw new Error('节点参数必须是对象')
    }
    const state = await getLocalState()
    await assertLocalNameAvailable(state, '节点', value, name)
    const result = await commitLocalState(state, updateLocalNode(state, name, value, expected))
    if (result.errors.length) throw new Error(result.errors.join('\n'))
  })
}

export async function removeLocalNode(name: string, expected: LocalObject): Promise<void> {
  await withLocalConfigWrite(async () => {
    if (typeof name !== 'string' || !isRecord(expected)) throw new Error('节点参数无效')
    const state = await getLocalState()
    const result = await commitLocalState(state, removeLocalNodeFromDraft(state, name, expected))
    if (result.errors.length) throw new Error(result.errors.join('\n'))
  })
}

export async function configureLocalSource(
  profileId: string,
  options?: LocalSubscriptionOptions,
  previousItem?: IProfileItem
): Promise<void> {
  if (options && !['group', 'nodes'].includes(options.mode)) {
    throw new Error('未知订阅导入方式')
  }
  const { getProfileItem, updateProfileConfig } = await import('../config/profile')
  const localId =
    (previousItem?.nodeSource || undefined)?.localProfileId ?? (await activeLocalProfileId())
  await withLocalProfileScope(localId, () =>
    withLocalConfigWrite(async () => {
      const item = await getProfileItem(profileId)
      if (!item) throw new Error('找不到订阅')
      const state = await getLocalState()
      const previous = previousItem ? findProfileSource(state, previousItem) : undefined
      const providers = parse<Record<string, LocalObject>>(state.modules['proxy-providers'])
      const names = new Set([
        ...state.sources
          .filter((source) => source.profileId !== profileId)
          .map((source) => source.name),
        ...Object.keys(providers)
      ])
      let name = options?.providerName?.trim() || previous?.name || item.name.trim() || '订阅'
      if (!previous && !options?.providerName?.trim()) {
        const base = name
        for (let suffix = 2; names.has(name); suffix++) name = `${base} (${suffix})`
      }
      if (name !== previous?.name && names.has(name)) throw new Error(`代理集合名称重复：${name}`)
      const mode = options
        ? options.mode === 'nodes'
          ? 'extract'
          : item.type === 'remote'
            ? 'http'
            : 'inline'
        : previous?.mode || (item.type === 'remote' ? 'http' : 'inline')
      const source: LocalSource = {
        ...previous,
        id: previous?.id || `profile-${profileId}`,
        profileId,
        name,
        mode,
        prefix: options?.prefix ?? previous?.prefix ?? `[${name}] `,
        providerOptions:
          options?.providerOptions !== undefined
            ? normalizeLocalProviderOptions(options.providerOptions)
            : previous?.providerOptions,
        interval: previous?.interval ?? 3600,
        proxies: []
      }
      const nextSource = (await resolveLocalDraft({ ...state, sources: [source] })).sources[0]
      if (!nextSource) throw new Error('找不到订阅来源')
      const base = structuredClone(state)
      if (previous && !base.sources.some((candidate) => candidate.profileId === profileId)) {
        base.sources.push(previous)
        if (previous.mode === 'extract') {
          const names = new Set(previous.proxies.map((node) => `${previous.prefix}${node.name}`))
          base.modules.proxies = stringify(
            readLocalNodes(base).filter((node) => !names.has(String(node.name)))
          )
        } else {
          delete providers[previous.name]
          base.modules['proxy-providers'] = stringify(providers)
        }
      }
      let next = replaceLocalSource(base, previous, nextSource)
      if (options?.targetGroups !== undefined) {
        next = setLocalSourceGroups(next, previous || nextSource, nextSource, options.targetGroups)
      }
      const result = await commitLocalState(state, next)
      if (result.errors.length) throw new Error(result.errors.join('\n'))
      await updateProfileConfig((config) => {
        const saved = config.items.find(({ id }) => id === profileId)
        if (saved) saved.nodeSource = bindProfileSource(nextSource, localId)
        return config
      })
    })
  )
}

export async function withLocalProfileRemoval<T>(
  profileId: string,
  remove: () => Promise<T>
): Promise<T> {
  return withLocalProfileScope(profileId, () => withLocalConfigWrite(remove))
}
