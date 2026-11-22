import { readFile, rm } from 'fs/promises'
import path from 'path'
import i18next from 'i18next'
import {
  defaultLocalDraft,
  LOCAL_PROFILE_ID,
  type LocalDraft,
  type LocalSourceBinding
} from '../../shared/local-config'
import { bindProfileSource } from '../../shared/profile-source'
import { getProfileConfig, updateProfileConfig } from '../config/profile'
import { getAppConfig } from '../config/app'
import { appConfigPath, dataDir, profilePath } from '../utils/dirs'
import { atomicWriteFile } from '../utils/safeFile'
import { parse, stringify } from '../utils/yaml'
import { compileLocalConfig } from './compiler'
import { resolveLocalDraft } from './subscriptions'

const legacyProfileId = 'simple-mode'

async function readOptional(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return undefined
  }
}

export async function migrateLocalProfiles(): Promise<void> {
  const appConfig = parse<Record<string, unknown>>(await readFile(appConfigPath(), 'utf8'))
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
  const [current, previous, localState, simpleState] = await Promise.all(
    [target, oldProfile, ...oldConfigs].map(readOptional)
  )
  const content = current ?? localState ?? simpleState ?? previous
  const bindings = new Map<string, LocalSourceBinding>()
  if (local || legacy || content !== undefined || activateLocal) {
    // A normal profile should remain readable by the usual loader, even when its YAML needs repair.
    const parsed =
      content !== undefined && (current === undefined || /^draft:|^published:/m.test(current))
        ? parse(content, { maxAliasCount: appConfig.yamlMaxAliasCount as number | undefined })
        : undefined
    const wrapped =
      parsed && typeof parsed === 'object'
        ? (parsed as { draft?: Partial<LocalDraft>; published?: Partial<LocalDraft> })
        : {}
    const saved = wrapped.draft ?? wrapped.published
    if (saved || content === undefined) {
      const base = defaultLocalDraft()
      const config = { ...base, ...saved, modules: { ...base.modules, ...saved?.modules } }
      const resolved = await resolveLocalDraft(config)
      const result = compileLocalConfig(resolved)
      if (result.errors.length) throw new Error(result.errors.join('\n'))
      await atomicWriteFile(target, result.yaml)
      for (const source of resolved.sources) {
        if (source.profileId)
          bindings.set(source.profileId, bindProfileSource(source, LOCAL_PROFILE_ID))
      }
    } else if (current === undefined) {
      await atomicWriteFile(target, content)
    }
  }
  const needsLocalEntry =
    (activateLocal || local || legacy || content !== undefined) &&
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
        const translated = i18next.t('profiles.localProfile')
        const item: IProfileItem = {
          ...(local ?? legacy),
          id: LOCAL_PROFILE_ID,
          type: 'local',
          name:
            local?.name ||
            legacy?.name ||
            (translated && translated !== 'profiles.localProfile' ? translated : '本地配置'),
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
    [
      ...oldConfigs,
      oldProfile,
      path.join(dataDir(), 'simple-config.generated.yaml'),
      path.join(dataDir(), 'local-config.generated.yaml')
    ].map((file) => rm(file, { force: true }))
  )
}
