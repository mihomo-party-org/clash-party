import { randomBytes } from 'node:crypto'
import { readFile } from 'fs/promises'
import { appConfigPath } from '../utils/dirs'
import { atomicWriteFile, WriteQueue } from '../utils/safeFile'
import { parse, stringify } from '../utils/yaml'
import { deepMerge } from '../utils/merge'
import { defaultConfig } from '../utils/template'
import {
  normalizeMaxLogFileSizeMB,
  setCoreLogDisabled,
  setGlobalMaxLogFileSizeMB
} from '../utils/logFile'
import { setAppLogDisabled } from '../utils/logger'
import { normalizeYamlMaxAliasCount } from '../../shared/appConfig'

let appConfig: IAppConfig // config.yaml
let legacyOperationMode: unknown
const appConfigWriteQueue = new WriteQueue()
const appConfigListeners = new Set<(config: IAppConfig) => void>()

function ensureMcpToken(config: IAppConfig): void {
  if (!config.mcpToken?.trim()) config.mcpToken = randomBytes(32).toString('hex')
}

export function getLegacyOperationMode(): unknown {
  return legacyOperationMode
}

function notifyAppConfigListeners(): void {
  for (const listener of appConfigListeners) listener(appConfig)
}

export function subscribeAppConfig(listener: (config: IAppConfig) => void): () => void {
  appConfigListeners.add(listener)
  if (appConfig) listener(appConfig)
  return () => appConfigListeners.delete(listener)
}

function cloneDefaultConfig(): IAppConfig {
  return JSON.parse(JSON.stringify(defaultConfig)) as IAppConfig
}

export async function getAppConfig(force = false): Promise<IAppConfig> {
  if (force || !appConfig) {
    await appConfigWriteQueue.run(async () => {
      const data = await readFile(appConfigPath(), 'utf-8')
      const parsedConfig = parse(data)
      if (parsedConfig && typeof parsedConfig === 'object' && legacyOperationMode === undefined) {
        legacyOperationMode = (parsedConfig as Record<string, unknown>).operationMode ?? null
      }
      const mergedConfig = deepMerge(cloneDefaultConfig(), parsedConfig || {})
      const legacy = mergedConfig as unknown as Record<string, unknown>
      delete legacy.operationMode
      delete legacy.modeSelected
      mergedConfig.maxLogFileSize = normalizeMaxLogFileSizeMB(mergedConfig.maxLogFileSize)
      mergedConfig.yamlMaxAliasCount = normalizeYamlMaxAliasCount(mergedConfig.yamlMaxAliasCount)
      ensureMcpToken(mergedConfig)
      if (JSON.stringify(mergedConfig) !== JSON.stringify(parsedConfig)) {
        await atomicWriteFile(appConfigPath(), stringify(mergedConfig))
      }
      setGlobalMaxLogFileSizeMB(mergedConfig.maxLogFileSize)
      setCoreLogDisabled(mergedConfig.disableCoreLog === true)
      setAppLogDisabled(mergedConfig.disableAppLog === true)
      appConfig = mergedConfig
      notifyAppConfigListeners()
    })
  }
  if (typeof appConfig !== 'object') appConfig = cloneDefaultConfig()
  return appConfig
}

function commitAppConfig(nextConfig: IAppConfig): void {
  appConfig = nextConfig
  setGlobalMaxLogFileSizeMB(nextConfig.maxLogFileSize)
  setCoreLogDisabled(nextConfig.disableCoreLog === true)
  setAppLogDisabled(nextConfig.disableAppLog === true)
  notifyAppConfigListeners()
}

async function writeAppConfig(
  patch: Partial<IAppConfig>,
  commitOnWriteError: boolean
): Promise<void> {
  await appConfigWriteQueue.run(async () => {
    const replaceNameserverPolicy = Object.prototype.hasOwnProperty.call(patch, 'nameserverPolicy')
    const nextConfig = deepMerge(
      JSON.parse(JSON.stringify(appConfig ?? cloneDefaultConfig())) as IAppConfig,
      patch
    )
    if (replaceNameserverPolicy) {
      nextConfig.nameserverPolicy = patch.nameserverPolicy ?? {}
    }
    nextConfig.maxLogFileSize = normalizeMaxLogFileSizeMB(nextConfig.maxLogFileSize)
    nextConfig.yamlMaxAliasCount = normalizeYamlMaxAliasCount(nextConfig.yamlMaxAliasCount)
    ensureMcpToken(nextConfig)
    try {
      await atomicWriteFile(appConfigPath(), stringify(nextConfig))
    } catch (error) {
      if (commitOnWriteError) commitAppConfig(nextConfig)
      throw error
    }
    commitAppConfig(nextConfig)
  })
}

export async function patchAppConfig(patch: Partial<IAppConfig>): Promise<void> {
  await writeAppConfig(patch, false)
}

// 内核应用后同步：落盘失败仍更新内存，并抛错供调用方记录。
export async function syncAppConfigAfterApply(patch: Partial<IAppConfig>): Promise<void> {
  await writeAppConfig(patch, true)
}
