import { readFile, writeFile } from 'fs/promises'
import { appConfigPath } from '../utils/dirs'
import { parse, stringify } from '../utils/yaml'
import { deepMerge } from '../utils/merge'
import { defaultConfig } from '../utils/template'

let appConfig: IAppConfig // config.yaml

export async function getAppConfig(force = false): Promise<IAppConfig> {
  if (force || !appConfig) {
    const data = await readFile(appConfigPath(), 'utf-8')
    const parsedConfig = parse(data)
    const mergedConfig = deepMerge({ ...defaultConfig }, parsedConfig || {})
    if (JSON.stringify(mergedConfig) !== JSON.stringify(parsedConfig)) {
      await writeFile(appConfigPath(), stringify(mergedConfig))
    }

    appConfig = mergedConfig
  }
  if (typeof appConfig !== 'object') appConfig = defaultConfig
  return appConfig
}

export async function patchAppConfig(patch: Partial<IAppConfig>): Promise<void> {
  if (patch.nameserverPolicy) {
    appConfig.nameserverPolicy = patch.nameserverPolicy
  }
  appConfig = deepMerge(appConfig, patch)
  await writeFile(appConfigPath(), stringify(appConfig))
}
