import { existsSync } from 'fs'
import { mkdir, readFile, rm } from 'fs/promises'
import path from 'path'
import { isDeepStrictEqual } from 'util'
import { BrowserWindow } from 'electron'
import { atomicWriteFile, WriteQueue } from '../utils/safeFile'
import { parse, stringify } from '../utils/yaml'
import {
  localConfigPath,
  localOutputPath,
  mihomoWorkConfigPath,
  mihomoWorkDir,
  profilePath
} from '../utils/dirs'
import {
  defaultLocalDraft,
  isLocalProfile,
  LOCAL_GENERAL_CONFIG_KEYS,
  LOCAL_MODULES,
  LOCAL_SHARED_CONFIG_KEYS,
  type LocalDraft,
  type LocalState,
  type LocalPreview
} from '../../shared/local-config'
import { compileLocalConfig, type LocalSharedConfig } from './compiler'
import { resolveLocalDraft } from './subscriptions'
import {
  cleanupLocalConfig,
  cleanupLocalDraft,
  removedLocalResources,
  type RemovedLocalResources
} from './references'

export const localWriteQueue = new WriteQueue()

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
function defaultState(): LocalState {
  const draft = defaultLocalDraft()
  return { version: 2, revision: 0, draft, published: clone(draft) }
}
function mergeDraft(value: unknown, base: LocalDraft): LocalDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return base
  const candidate = value as Partial<LocalDraft>
  return {
    ...base,
    ...candidate,
    sources: Array.isArray(candidate.sources) ? candidate.sources : base.sources,
    modules: {
      ...base.modules,
      ...(candidate.modules && typeof candidate.modules === 'object' ? candidate.modules : {})
    },
    preserved:
      candidate.preserved &&
      typeof candidate.preserved === 'object' &&
      !Array.isArray(candidate.preserved)
        ? clone(candidate.preserved)
        : base.preserved,
    moduleOrder: Array.isArray(candidate.moduleOrder) ? candidate.moduleOrder : base.moduleOrder
  }
}
async function activeLocalProfileId(): Promise<string> {
  const { getProfileConfig, getProfileItem } = await import('../config/profile')
  const { current } = await getProfileConfig()
  const item = await getProfileItem(current)
  if (item && isLocalProfile(item)) return item.id
  return 'local'
}

function stateFromProfileConfig(value: unknown): LocalState {
  const state = defaultState()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return state
  const config = value as Record<string, unknown>
  const general = parse(state.draft.modules.general) as Record<string, unknown>
  for (const key of LOCAL_GENERAL_CONFIG_KEYS) {
    if (config[key] !== undefined) general[key] = config[key]
  }
  state.draft.modules.general = stringify(general)
  state.published.modules.general = stringify(general)
  for (const key of Object.keys(LOCAL_MODULES).filter((key) => key !== 'general')) {
    if (config[key] === undefined) continue
    const serialized = stringify(config[key])
    state.draft.modules[key as keyof typeof state.draft.modules] = serialized
    state.published.modules[key as keyof typeof state.published.modules] = serialized
  }
  const preserved = Object.fromEntries(
    Object.entries(config).filter(
      ([key]) =>
        !LOCAL_GENERAL_CONFIG_KEYS.includes(key as (typeof LOCAL_GENERAL_CONFIG_KEYS)[number]) &&
        !Object.hasOwn(LOCAL_MODULES, key)
    )
  )
  state.draft.preserved = preserved
  state.published.preserved = clone(preserved)
  return state
}

export async function importLocalProfileContent(content: string): Promise<void> {
  const state = await getLocalState()
  const next = stateFromProfileConfig(parse(content))
  next.revision = state.revision + 1
  const result = await commitLocalState(state, next)
  if (result.errors.length) throw new Error(result.errors.join('\n'))
}

export async function getLocalState(): Promise<LocalState> {
  const profileId = await activeLocalProfileId()
  const statePath = profilePath(profileId)
  const legacyPath = localConfigPath()
  const readPath = existsSync(statePath)
    ? statePath
    : profileId === 'local'
      ? legacyPath
      : statePath
  if (!existsSync(readPath)) {
    if (profileId !== 'local') {
      try {
        const { getProfileStr } = await import('../config/profile')
        return stateFromProfileConfig(parse(await getProfileStr(profileId)))
      } catch {
        return defaultState()
      }
    }
    return defaultState()
  }
  let raw: unknown
  try {
    raw = parse(await readFile(readPath, 'utf8'))
  } catch {
    return defaultState()
  }
  if (!raw || typeof raw !== 'object') return defaultState()
  const base = defaultState()
  const value = raw as Partial<LocalState>
  if (!value.draft && !value.published) return stateFromProfileConfig(raw)
  return {
    version: 2,
    revision: Number(value.revision) || 0,
    draft: mergeDraft(value.draft, base.draft),
    published: mergeDraft(value.published, base.published)
  }
}
export async function saveLocalState(state: LocalState): Promise<void> {
  await mkdir(mihomoWorkDir(), { recursive: true })
  const profileId = await activeLocalProfileId()
  const result = compileLocalConfig(await resolveLocalDraft(state.draft), await getSharedConfig())
  if (result.errors.length) throw new Error(result.errors.join('\n'))
  await mkdir(path.dirname(profilePath(profileId)), { recursive: true })
  await atomicWriteFile(profilePath(profileId), result.yaml, { encoding: 'utf8' })
  await rm(localConfigPath(), { force: true })
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('controledMihomoConfigUpdated')
  }
}
export async function compileAndWriteLocal(
  state: LocalState,
  publish: boolean,
  shared?: LocalSharedConfig
): Promise<LocalPreview> {
  const effectiveShared = shared ?? (await getSharedConfig())
  const result = compileLocalConfig(
    await resolveLocalDraft(publish ? state.published : state.draft),
    effectiveShared
  )
  if (result.errors.length) return result
  await mkdir(mihomoWorkDir(), { recursive: true })
  await atomicWriteFile(localOutputPath(), result.yaml, { encoding: 'utf8' })
  await atomicWriteFile(mihomoWorkConfigPath('work'), result.yaml, { encoding: 'utf8' })
  return result
}
export async function isLocalProfileActive(): Promise<boolean> {
  const { getProfileConfig, getProfileItem } = await import('../config/profile')
  const { current } = await getProfileConfig()
  return isLocalProfile(await getProfileItem(current))
}

export async function commitLocalState(
  state: LocalState,
  next: LocalState,
  options: { shared?: LocalSharedConfig } = {}
): Promise<LocalPreview> {
  const previousShared = await getSharedConfig()
  const shared = structuredClone(options.shared ?? previousShared)
  const removed: RemovedLocalResources = {
    outbounds: new Set(),
    providers: new Set(),
    ruleProviders: new Set(),
    subRules: new Set(),
    sources: new Set()
  }
  for (const key of ['draft', 'published'] as const) {
    const before = await resolveLocalDraft(state[key])
    const after = await resolveLocalDraft(next[key])
    const changes = removedLocalResources(
      compileLocalConfig(before, shared),
      compileLocalConfig(after, shared),
      before,
      after
    )
    for (const kind of Object.keys(removed) as (keyof RemovedLocalResources)[])
      changes[kind].forEach((name) => removed[kind].add(name))
  }
  if (Object.values(removed).some((names) => names.size)) {
    next = {
      ...next,
      draft: cleanupLocalDraft(await resolveLocalDraft(next.draft), removed),
      published: cleanupLocalDraft(await resolveLocalDraft(next.published), removed)
    }
    cleanupLocalConfig(shared, removed)
  }
  const result = compileLocalConfig(await resolveLocalDraft(next.published), shared)
  if (result.errors.length) return result
  const [{ getAppConfig }, { checkProfileConfig }, { mihomoHotReloadConfig }] = await Promise.all([
    import('../config/app'),
    import('../core/manager'),
    import('../core/mihomoApi')
  ])
  const appConfig = await getAppConfig()
  const active = await isLocalProfileActive()
  const candidate = path.join(mihomoWorkDir(), '.local-candidate.yaml')
  await mkdir(mihomoWorkDir(), { recursive: true })
  try {
    await atomicWriteFile(candidate, result.yaml, { encoding: 'utf8' })
    await checkProfileConfig(candidate, appConfig.core, undefined, {
      workDir: mihomoWorkDir(),
      timeoutMs: 30000
    })
  } catch (error) {
    return { ...result, errors: [String(error)] }
  } finally {
    await rm(candidate, { force: true })
  }
  const sharedChanged = !isDeepStrictEqual(previousShared, shared)
  const { writeLocalSharedConfig } = await import('../config/controledMihomo')
  try {
    if (sharedChanged) await writeLocalSharedConfig(shared)
    await saveLocalState(next)
    if (active) await mihomoHotReloadConfig()
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('localConfigUpdated')
      if (active) {
        window.webContents.send('groupsUpdated')
        window.webContents.send('rulesUpdated')
      }
    }
    return result
  } catch (error) {
    try {
      if (sharedChanged) await writeLocalSharedConfig(previousShared)
      await saveLocalState(state)
      if (active) await mihomoHotReloadConfig()
    } catch (restoreError) {
      return {
        ...result,
        errors: [`应用失败: ${String(error)}`, `恢复配置或内核失败: ${String(restoreError)}`]
      }
    }
    return { ...result, errors: [`应用失败，已恢复原配置: ${String(error)}`] }
  }
}

async function getSharedConfig(): Promise<LocalSharedConfig> {
  const { getControledMihomoConfig } = await import('../config/controledMihomo')
  const config = await getControledMihomoConfig(true)
  return Object.fromEntries(
    LOCAL_SHARED_CONFIG_KEYS.filter((key) => config[key] !== undefined).map((key) => [
      key,
      structuredClone(config[key])
    ])
  ) as LocalSharedConfig
}
