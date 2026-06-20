import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { controledMihomoConfigPath } from '../utils/dirs'
import { parse, stringify } from '../utils/yaml'
import { generateProfile } from '../core/factory'
import { patchMihomoConfig, startMihomoLogs } from '../core/mihomoApi'
import { defaultControledMihomoConfig } from '../utils/template'
import { deepMerge } from '../utils/merge'
import { createLogger } from '../utils/logger'
import { DEFAULT_CONTROL_DNS, DEFAULT_CONTROL_SNIFF } from '../../shared/appConfig'
import { getAppConfig, patchAppConfig } from './app'

const controledMihomoLogger = createLogger('ControledMihomo')

let controledMihomoConfig: Partial<IMihomoConfig> // mihomo.yaml
let controledMihomoWriteQueue: Promise<void> = Promise.resolve()

function cloneDefaultControledMihomoConfig(): Partial<IMihomoConfig> {
  return JSON.parse(JSON.stringify(defaultControledMihomoConfig)) as Partial<IMihomoConfig>
}

export async function getControledMihomoConfig(force = false): Promise<Partial<IMihomoConfig>> {
  if (force || !controledMihomoConfig) {
    if (existsSync(controledMihomoConfigPath())) {
      const data = await readFile(controledMihomoConfigPath(), 'utf-8')
      controledMihomoConfig = parse(data) || cloneDefaultControledMihomoConfig()
    } else {
      controledMihomoConfig = cloneDefaultControledMihomoConfig()
      try {
        await writeFile(controledMihomoConfigPath(), stringify(controledMihomoConfig), 'utf-8')
      } catch (error) {
        controledMihomoLogger.error('Failed to create mihomo.yaml file', error)
      }
    }

    // 确保配置包含所有必要的默认字段，处理升级场景
    controledMihomoConfig = deepMerge(cloneDefaultControledMihomoConfig(), controledMihomoConfig)

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
    controledMihomoConfig = cloneDefaultControledMihomoConfig()
  return controledMihomoConfig
}

export async function patchControledMihomoConfig(patch: Partial<IMihomoConfig>): Promise<void> {
  controledMihomoWriteQueue = controledMihomoWriteQueue.then(async () => {
    const appConfig = await getAppConfig()
    const {
      controlDns = DEFAULT_CONTROL_DNS,
      controlSniff = DEFAULT_CONTROL_SNIFF,
      controlDnsBeforePause
    } = appConfig

    // 当模式从 direct 切换到 rule/global 时，恢复之前保存的 DNS 状态
    const currentMode = controledMihomoConfig?.mode
    const newMode = patch.mode
    if (
      currentMode === 'direct' &&
      newMode &&
      newMode !== 'direct' &&
      controlDnsBeforePause !== undefined
    ) {
      // 恢复 DNS 状态并清除保存的状态
      await patchAppConfig({ controlDns: controlDnsBeforePause, controlDnsBeforePause: undefined })
    }

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
    const replaceNameserverPolicy = Object.prototype.hasOwnProperty.call(
      patch.dns || {},
      'nameserver-policy'
    )
    controledMihomoConfig = deepMerge(controledMihomoConfig, patch)
    if (replaceNameserverPolicy) {
      controledMihomoConfig.dns = controledMihomoConfig.dns || {}
      controledMihomoConfig.dns['nameserver-policy'] = patch.dns?.['nameserver-policy'] ?? {}
    }

    // 从不接管状态恢复
    if (controlDns) {
      // 确保 DNS 配置包含所有必要的默认字段，特别是新增的 fallback 等
      controledMihomoConfig.dns = deepMerge(
        cloneDefaultControledMihomoConfig().dns || {},
        controledMihomoConfig.dns || {}
      )
    }
    if (controlSniff && !controledMihomoConfig.sniffer) {
      controledMihomoConfig.sniffer = cloneDefaultControledMihomoConfig().sniffer
    }

    await generateProfile()
    await writeFile(controledMihomoConfigPath(), stringify(controledMihomoConfig), 'utf-8')

    // 优先对运行中内核进行热更新，避免无意义重启
    try {
      await patchMihomoConfig(patch)
    } catch (error) {
      controledMihomoLogger.warn(
        'Hot patch /configs failed, changes will apply on next restart',
        error
      )
    }

    // log-level 改变时重连日志 WebSocket，使新等级立刻生效
    if (patch['log-level']) {
      try {
        await startMihomoLogs()
      } catch (error) {
        controledMihomoLogger.warn('Failed to restart log stream after log-level change', error)
      }
    }
  })
  await controledMihomoWriteQueue
}
