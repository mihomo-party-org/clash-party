import { controledMihomoConfigPath } from '../utils/dirs'
import { readFile, writeFile } from 'fs/promises'
import { parse, stringify } from '../utils/yaml'
import { generateProfile } from '../core/factory'
import { getAppConfig } from './app'
import { defaultControledMihomoConfig } from '../utils/template'
import { deepMerge } from '../utils/merge'
import { existsSync } from 'fs'

let controledMihomoConfig: Partial<IMihomoConfig> // mihomo.yaml

export async function getControledMihomoConfig(force = false): Promise<Partial<IMihomoConfig>> {
  if (force || !controledMihomoConfig) {
    if (existsSync(controledMihomoConfigPath())) {
      const data = await readFile(controledMihomoConfigPath(), 'utf-8')
      controledMihomoConfig = parse(data) || defaultControledMihomoConfig
    } else {
      controledMihomoConfig = defaultControledMihomoConfig
      try {
        await writeFile(controledMihomoConfigPath(), stringify(defaultControledMihomoConfig), 'utf-8')
      } catch (error) {
        console.error('Failed to create mihomo.yaml file:', error)
      }
    }
    
    // 确保配置包含所有必要的默认字段，处理升级场景
    controledMihomoConfig = deepMerge(defaultControledMihomoConfig, controledMihomoConfig)
  }
  if (typeof controledMihomoConfig !== 'object')
    controledMihomoConfig = defaultControledMihomoConfig
  return controledMihomoConfig
}

export async function patchControledMihomoConfig(patch: Partial<IMihomoConfig>): Promise<void> {
  const { controlDns = true, controlSniff = true } = await getAppConfig()

  if (patch.hosts) {
    controledMihomoConfig.hosts = patch.hosts
  }
  if (patch.dns?.['nameserver-policy']) {
    controledMihomoConfig.dns = controledMihomoConfig.dns || {}
    controledMihomoConfig.dns['nameserver-policy'] = patch.dns['nameserver-policy']
  }
  controledMihomoConfig = deepMerge(controledMihomoConfig, patch)

  // 从不接管状态恢复
  if (controlDns) {
    // 确保DNS配置包含所有必要的默认字段，特别是新增的fallback等
    controledMihomoConfig.dns = deepMerge(
      defaultControledMihomoConfig.dns || {},
      controledMihomoConfig.dns || {}
    )
  }
  if (controlSniff && !controledMihomoConfig.sniffer) {
    controledMihomoConfig.sniffer = defaultControledMihomoConfig.sniffer
  }

  await generateProfile()
  await writeFile(controledMihomoConfigPath(), stringify(controledMihomoConfig), 'utf-8')
}
