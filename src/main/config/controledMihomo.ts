import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { controledMihomoConfigPath } from '../utils/dirs'
import { parse, stringify } from '../utils/yaml'
import { generateProfile } from '../core/factory'
import { defaultControledMihomoConfig } from '../utils/template'
import { deepMerge } from '../utils/merge'
import { createLogger } from '../utils/logger'
import { getAppConfig } from './app'

const controledMihomoLogger = createLogger('ControledMihomo')

let controledMihomoConfig: Partial<IMihomoConfig> // mihomo.yaml
let controledMihomoWriteQueue: Promise<void> = Promise.resolve()

export async function getControledMihomoConfig(force = false): Promise<Partial<IMihomoConfig>> {
  if (force || !controledMihomoConfig) {
    if (existsSync(controledMihomoConfigPath())) {
      const data = await readFile(controledMihomoConfigPath(), 'utf-8')
      controledMihomoConfig = parse(data) || defaultControledMihomoConfig
    } else {
      controledMihomoConfig = defaultControledMihomoConfig
      try {
        await writeFile(
          controledMihomoConfigPath(),
          stringify(defaultControledMihomoConfig),
          'utf-8'
        )
      } catch (error) {
        controledMihomoLogger.error('Failed to create mihomo.yaml file', error)
      }
    }

    // 确保配置包含所有必要的默认字段，处理升级场景
    controledMihomoConfig = deepMerge(defaultControledMihomoConfig, controledMihomoConfig)

    // 清理端口字段中的 NaN 值，恢复为默认值
    const portFields = ['mixed-port', 'socks-port', 'port', 'redir-port', 'tproxy-port'] as const
    for (const field of portFields) {
      if (
        typeof controledMihomoConfig[field] !== 'number' ||
        Number.isNaN(controledMihomoConfig[field])
      ) {
        controledMihomoConfig[field] = defaultControledMihomoConfig[field]
      }
    }
  }
  if (typeof controledMihomoConfig !== 'object')
    controledMihomoConfig = defaultControledMihomoConfig
  return controledMihomoConfig
}

export async function patchControledMihomoConfig(patch: Partial<IMihomoConfig>): Promise<void> {
  controledMihomoWriteQueue = controledMihomoWriteQueue.then(async () => {
    const { controlDns = true, controlSniff = true } = await getAppConfig()

    // 过滤端口字段中的 NaN 值，防止写入无效配置
    const portFields = ['mixed-port', 'socks-port', 'port', 'redir-port', 'tproxy-port'] as const
    for (const field of portFields) {
      if (field in patch && (typeof patch[field] !== 'number' || Number.isNaN(patch[field]))) {
        delete patch[field]
      }
    }

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
      // 确保 DNS 配置包含所有必要的默认字段，特别是新增的 fallback 等
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
  })
  await controledMihomoWriteQueue
}
