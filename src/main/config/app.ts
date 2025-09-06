import { readFile, writeFile } from 'fs/promises'
import { appConfigPath } from '../utils/dirs'
import { parse, stringify } from '../utils/yaml'
import { deepMerge } from '../utils/merge'
import { defaultConfig } from '../utils/template'

let appConfig: IAppConfig // config.yaml

export async function getAppConfig(force = false): Promise<IAppConfig> {
  if (force || !appConfig) {
    const data = await readFile(appConfigPath(), 'utf-8')
    appConfig = parse(data) || defaultConfig
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
