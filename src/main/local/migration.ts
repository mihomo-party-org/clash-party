import { constants } from 'fs'
import { copyFile, readFile, rm } from 'fs/promises'
import path from 'path'
import { resources } from '../../shared/i18n'
import {
  defaultLocalDraft,
  LOCAL_PROFILE_ID,
  type LocalDraft,
  type LocalSource,
  type LocalSourceBinding
} from '../../shared/local-config'
import { bindProfileSource } from '../../shared/profile-source'
import { getProfileConfig, updateProfileConfig } from '../config/profile'
import { getAppConfig } from '../config/app'
import { appConfigPath, dataDir, profilePath } from '../utils/dirs'
import { createLogger } from '../utils/logger'
import { atomicWriteFile } from '../utils/safeFile'
import { parse, stringify } from '../utils/yaml'
import { parseYaml } from '../../shared/yaml'
import { compileLocalConfig } from './compiler'
import { resolveLocalDraft } from './subscriptions'

const legacyProfileId = 'simple-mode'
const migrationLogger = createLogger('Migration')

async function readOptional(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return undefined
  }
}

function isWrappedLocalConfig(content: string): boolean {
  return /^draft:|^published:/m.test(content)
}

function defaultLocalProfileName(language: unknown): string {
  const normalized =
    typeof language === 'string' ? language.trim().replace('_', '-').toLowerCase() : ''
  const localeKeys = Object.keys(resources) as Array<keyof typeof resources>
  const key =
    localeKeys.find((candidate) => candidate.toLowerCase() === normalized) ||
    localeKeys.find(
      (candidate) => candidate.split('-')[0].toLowerCase() === normalized.split('-')[0]
    )
  const locale = key ? resources[key] : resources['zh-CN']
  return locale.translation['profiles.localProfile'] || '本地配置'
}

async function compileLegacyDraft(
  saved: Partial<LocalDraft>
): Promise<{ yaml: string; sources: LocalSource[] }> {
  const base = defaultLocalDraft()
  const config: LocalDraft = { ...base, ...saved, modules: { ...base.modules, ...saved.modules } }
  const resolved = await resolveLocalDraft(config)
  const result = compileLocalConfig(resolved)
  if (result.errors.length) throw new Error(result.errors.join('\n'))
  return { yaml: result.yaml, sources: resolved.sources }
}

async function backupLegacyFile(file: string | undefined): Promise<void> {
  if (!file) return
  try {
    await copyFile(file, `${file}.bak`, constants.COPYFILE_EXCL)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT' && code !== 'EEXIST') {
      await migrationLogger.warn(`Failed to back up legacy local config ${file}`, error)
    }
  }
}

interface LegacyFile {
  file: string
  content: string
}

async function validLegacyYaml(
  source: LegacyFile | undefined,
  maxAliasCount: number | undefined
): Promise<string | undefined> {
  if (!source) return undefined
  try {
    if (!source.content.trim()) throw new Error('empty YAML content')
    const parsed = parseYaml(source.content, { maxAliasCount })
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('local config must be a YAML object')
    return source.content
  } catch (error) {
    await migrationLogger.warn(`Failed to parse fallback local config ${source.file}`, error)
    await backupLegacyFile(source.file)
    return undefined
  }
}

async function firstValidLegacyYaml(
  sources: LegacyFile[],
  maxAliasCount: number | undefined
): Promise<string | undefined> {
  for (const source of sources) {
    const yaml = await validLegacyYaml(source, maxAliasCount)
    if (yaml !== undefined) return yaml
  }
  return undefined
}

export async function migrateLocalProfiles(): Promise<void> {
  let appConfig: Record<string, unknown> = {}
  try {
    const content = await readFile(appConfigPath(), 'utf8')
    const parsed = parseYaml(content)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      appConfig = parsed as Record<string, unknown>
    else throw new Error('app config must be a YAML object')
  } catch (error) {
    await migrationLogger.warn('Failed to parse app config during local profile migration', error)
  }
  const profileConfig = await getProfileConfig(true)
  const local = profileConfig.items.find((item) => item.id === LOCAL_PROFILE_ID)
  const legacy = profileConfig.items.find((item) => item.id === legacyProfileId)
  const activateLocal =
    profileConfig.current === legacyProfileId ||
    (appConfig.operationMode === 'simple' && (!profileConfig.current || !local))
  const target = profilePath(LOCAL_PROFILE_ID)
  const oldProfile = profilePath(legacyProfileId)
  const oldConfigs = ['local-config.yaml', 'simple-config.yaml'].map((name) =>
    path.join(dataDir(), name)
  )
  const oldGenerated = ['local-config.generated.yaml', 'simple-config.generated.yaml'].map((name) =>
    path.join(dataDir(), name)
  )
  const [current, previous, localState, simpleState, localGenerated, simpleGenerated] =
    await Promise.all([target, oldProfile, ...oldConfigs, ...oldGenerated].map(readOptional))
  const contentSource: LegacyFile | undefined =
    current !== undefined
      ? { file: target, content: current }
      : localState !== undefined
        ? { file: oldConfigs[0], content: localState }
        : simpleState !== undefined
          ? { file: oldConfigs[1], content: simpleState }
          : previous !== undefined
            ? { file: oldProfile, content: previous }
            : undefined
  const content = contentSource?.content
  const generatedSources: LegacyFile[] = [
    localGenerated !== undefined ? { file: oldGenerated[0], content: localGenerated } : undefined,
    simpleGenerated !== undefined ? { file: oldGenerated[1], content: simpleGenerated } : undefined
  ].filter((source): source is LegacyFile => source !== undefined)
  const bindings = new Map<string, LocalSourceBinding>()
  if (local || legacy || content !== undefined || generatedSources.length > 0 || activateLocal) {
    // A normal profile should remain readable by the usual loader, even when its YAML needs repair.
    const shouldInspectContent =
      content !== undefined && (current === undefined || isWrappedLocalConfig(current))
    if (shouldInspectContent) {
      let parsed: unknown
      let parseFailed = false
      try {
        parsed = parseYaml(content, {
          maxAliasCount: appConfig.yamlMaxAliasCount as number | undefined
        })
      } catch (error) {
        parseFailed = true
        await migrationLogger.warn('Failed to parse legacy local profile config', error)
      }
      const wrapped =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as { draft?: Partial<LocalDraft>; published?: Partial<LocalDraft> })
          : {}
      // Prefer the applied published snapshot over an unapplied draft; fall back if needed.
      const candidates = [...new Set([wrapped.published, wrapped.draft])].filter(
        (candidate): candidate is Partial<LocalDraft> =>
          Boolean(candidate && typeof candidate === 'object' && !Array.isArray(candidate))
      )
      let compiled: { yaml: string; sources: LocalSource[] } | undefined
      for (const candidate of candidates) {
        try {
          compiled = await compileLegacyDraft(candidate)
          break
        } catch (error) {
          await migrationLogger.warn('Failed to compile legacy local profile candidate', error)
        }
      }
      if (compiled) {
        await atomicWriteFile(target, compiled.yaml)
        for (const source of compiled.sources) {
          if (source.profileId)
            bindings.set(source.profileId, bindProfileSource(source, LOCAL_PROFILE_ID))
        }
      } else if (
        parseFailed ||
        candidates.length > 0 ||
        isWrappedLocalConfig(content) ||
        !content.trim() ||
        !parsed ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
      ) {
        await backupLegacyFile(contentSource?.file)
        const fallbackSources = [
          ...generatedSources,
          previous !== undefined && !isWrappedLocalConfig(previous)
            ? { file: oldProfile, content: previous }
            : undefined
        ].filter((source): source is LegacyFile => source !== undefined)
        const fallbackYaml = await firstValidLegacyYaml(
          fallbackSources,
          appConfig.yamlMaxAliasCount as number | undefined
        )
        await atomicWriteFile(target, fallbackYaml ?? compileLocalConfig(defaultLocalDraft()).yaml)
      } else if (current === undefined) {
        await atomicWriteFile(target, content)
      }
    } else if (content === undefined) {
      const fallbackYaml = await firstValidLegacyYaml(
        generatedSources,
        appConfig.yamlMaxAliasCount as number | undefined
      )
      await atomicWriteFile(target, fallbackYaml ?? compileLocalConfig(defaultLocalDraft()).yaml)
    }
  }
  const needsLocalEntry =
    (activateLocal || local || legacy || content !== undefined || generatedSources.length > 0) &&
    (!local?.name || local.type !== 'local')
  if (
    needsLocalEntry ||
    legacy ||
    bindings.size ||
    (activateLocal && profileConfig.current !== LOCAL_PROFILE_ID) ||
    profileConfig.items.some((item) => Object.hasOwn(item, 'usage'))
  ) {
    await updateProfileConfig((config) => {
      config.items = config.items.filter((item) => item.id !== legacyProfileId)
      if (needsLocalEntry) {
        const item: IProfileItem = {
          ...(local ?? legacy),
          id: LOCAL_PROFILE_ID,
          type: 'local',
          name: local?.name || legacy?.name || defaultLocalProfileName(appConfig.language),
          updated: local?.updated ?? legacy?.updated ?? Date.now()
        }
        const index = config.items.findIndex((entry) => entry.id === LOCAL_PROFILE_ID)
        if (index < 0) config.items.push(item)
        else config.items[index] = item
      }
      for (const item of config.items) {
        delete (item as IProfileItem & { usage?: unknown }).usage
        const binding = bindings.get(item.id)
        if (binding) item.nodeSource = binding
      }
      if (activateLocal || config.current === legacyProfileId) config.current = LOCAL_PROFILE_ID
      return config
    })
  }
  if (Object.hasOwn(appConfig, 'operationMode') || Object.hasOwn(appConfig, 'modeSelected')) {
    const currentAppConfig = parse<Record<string, unknown>>(await readFile(appConfigPath(), 'utf8'))
    delete currentAppConfig.operationMode
    delete currentAppConfig.modeSelected
    await atomicWriteFile(appConfigPath(), stringify(currentAppConfig))
    await getAppConfig(true)
  }
  await Promise.all(
    [...oldConfigs, oldProfile, ...oldGenerated].map((file) => rm(file, { force: true }))
  )
}
