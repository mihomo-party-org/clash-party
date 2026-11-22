import { existsSync } from 'fs'
import { mkdir, readFile, rm } from 'fs/promises'
import path from 'path'
import { isDeepStrictEqual } from 'util'
import { AsyncLocalStorage } from 'node:async_hooks'
import { BrowserWindow } from 'electron'
import { atomicWriteFile, WriteQueue } from '../utils/safeFile'
import { parse, stringify } from '../utils/yaml'
import { mihomoProfileWorkDir, mihomoWorkDir, profilePath } from '../utils/dirs'
import {
  defaultLocalDraft,
  isLocalProfile,
  LOCAL_PROFILE_ID,
  LOCAL_GENERAL_CONFIG_KEYS,
  LOCAL_MODULES,
  type LocalDraft,
  type LocalObject,
  type LocalPreview
} from '../../shared/local-config'
import { compileLocalConfig, isObject } from './compiler'
import { resolveLocalDraft } from './subscriptions'
import { cleanupLocalDraft, removedLocalResources } from './references'

const localWriteQueue = new WriteQueue()
const localProfileScope = new AsyncLocalStorage<string>()

export function withLocalProfileScope<T>(profileId: string, run: () => Promise<T>): Promise<T> {
  if (!/^[a-zA-Z0-9_-]+$/.test(profileId)) throw new Error('Invalid local profile ID')
  return localProfileScope.run(profileId, run)
}

export async function activeLocalProfileId(): Promise<string> {
  const scopedId = localProfileScope.getStore()
  if (scopedId) return scopedId
  const { getProfileConfig, getProfileItem } = await import('../config/profile')
  const { current } = await getProfileConfig()
  const item = await getProfileItem(current)
  if (item && isLocalProfile(item)) return item.id
  return LOCAL_PROFILE_ID
}

export async function withLocalConfigWrite<T>(run: () => Promise<T>): Promise<T> {
  const profileId = await activeLocalProfileId()
  return localWriteQueue.run(() => withLocalProfileScope(profileId, run))
}

function draftFromProfileConfig(value: unknown): LocalDraft {
  const draft = defaultLocalDraft()
  const config = isObject(value) ? value : {}
  const general: LocalObject = {}
  for (const key of LOCAL_GENERAL_CONFIG_KEYS) {
    if (config[key] !== undefined) general[key] = config[key]
  }
  draft.modules.general = stringify(general)
  for (const key of Object.keys(LOCAL_MODULES).filter((key) => key !== 'general')) {
    // Optional YAML collections may be null (e.g. provider-only profiles with no inline nodes).
    const empty = ['proxies', 'proxy-groups', 'rules'].includes(key) ? [] : {}
    draft.modules[key as keyof typeof draft.modules] = stringify(config[key] ?? empty)
  }
  draft.preserved = Object.fromEntries(
    Object.entries(config).filter(
      ([key]) =>
        !LOCAL_GENERAL_CONFIG_KEYS.includes(key as (typeof LOCAL_GENERAL_CONFIG_KEYS)[number]) &&
        !Object.hasOwn(LOCAL_MODULES, key)
    )
  )
  return draft
}

async function parseLocalYaml(content: string): Promise<unknown> {
  const { getAppConfig } = await import('../config/app')
  const { yamlMaxAliasCount } = await getAppConfig()
  return parse(content, { maxAliasCount: yamlMaxAliasCount })
}

export async function getLocalState(): Promise<LocalDraft> {
  const profileId = await activeLocalProfileId()
  const statePath = profilePath(profileId)
  if (existsSync(statePath))
    return draftFromProfileConfig(await parseLocalYaml(await readFile(statePath, 'utf8')))
  if (profileId === LOCAL_PROFILE_ID) return defaultLocalDraft()
  const { getProfileStr } = await import('../config/profile')
  return draftFromProfileConfig(await parseLocalYaml(await getProfileStr(profileId)))
}

export async function commitLocalState(state: LocalDraft, next: LocalDraft): Promise<LocalPreview> {
  const before = compileLocalConfig(state)
  const after = await resolveLocalDraft(next)
  const compiled = compileLocalConfig(after)
  const removed = removedLocalResources(before, compiled, state, after)
  const result = Object.values(removed).some((names) => names.size)
    ? compileLocalConfig(cleanupLocalDraft(after, removed))
    : compiled
  if (result.errors.length) return result

  const profileId = await activeLocalProfileId()
  const file = profilePath(profileId)
  const previous = existsSync(file) ? await readFile(file, 'utf8') : undefined
  if (previous !== undefined) {
    // Keep absent and null fields as they were unless the form actually changed them.
    const original = await parseLocalYaml(previous)
    if (!isObject(original)) throw new Error('配置必须是 YAML 对象')
    const originalView = parse<LocalObject>(before.yaml)
    const editedView = parse<LocalObject>(result.yaml)
    for (const key of new Set([...Object.keys(originalView), ...Object.keys(editedView)])) {
      if (isDeepStrictEqual(originalView[key], editedView[key])) continue
      if (Object.hasOwn(editedView, key)) original[key] = editedView[key]
      else delete original[key]
    }
    result.yaml = stringify(original)
  }

  const [{ getAppConfig }, profiles, { mihomoHotReloadConfig }] = await Promise.all([
    import('../config/app'),
    import('../config/profile'),
    import('../core/mihomoApi')
  ])
  const { diffWorkDir } = await getAppConfig()
  const existing = await profiles.getProfileItem(profileId)
  const item = existing ?? {
    id: profileId,
    type: 'local',
    name: '本地配置',
    updated: Date.now()
  }
  const profileWorkDir = mihomoProfileWorkDir(profileId)
  const workDir = diffWorkDir && existsSync(profileWorkDir) ? profileWorkDir : mihomoWorkDir()
  try {
    await profiles.validateProfileCandidate(item, result.yaml, { workDir, timeoutMs: 30000 })
  } catch (error) {
    return { ...result, errors: [String(error)] }
  }

  const isActive = async (): Promise<boolean> =>
    (await profiles.getProfileConfig()).current === profileId
  try {
    await mkdir(path.dirname(file), { recursive: true })
    await atomicWriteFile(file, result.yaml, { encoding: 'utf8' })
  } catch (error) {
    return { ...result, errors: [String(error)] }
  }
  try {
    if (await isActive()) await localProfileScope.exit(mihomoHotReloadConfig)
  } catch (error) {
    try {
      if (previous === undefined) await rm(file, { force: true })
      else await atomicWriteFile(file, previous, { encoding: 'utf8' })
      if (await isActive()) await localProfileScope.exit(mihomoHotReloadConfig)
    } catch (restoreError) {
      return {
        ...result,
        errors: [`应用失败：${String(error)}`, `恢复配置或内核失败：${String(restoreError)}`]
      }
    }
    return { ...result, errors: [`应用失败，已恢复原配置：${String(error)}`] }
  }
  if (!existing && profileId === LOCAL_PROFILE_ID) {
    await profiles.updateProfileConfig((config) => {
      if (!config.items.some(({ id }) => id === profileId)) config.items.push(item)
      return config
    })
  }
  const active = await isActive()
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('localConfigUpdated')
    if (active) {
      window.webContents.send('groupsUpdated')
      window.webContents.send('rulesUpdated')
    }
  }
  return result
}
