import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { controledMihomoConfigPath } from '../utils/dirs'
import { parse, stringify } from '../utils/yaml'
import { generateProfile } from '../core/factory'
import { patchMihomoConfig, startMihomoLogs } from '../core/mihomoApi'
import { defaultControledMihomoConfig } from '../utils/template'
import { deepMerge } from '../utils/merge'
import { createLogger } from '../utils/logger'
import { atomicWriteFile, WriteQueue } from '../utils/safeFile'
import { DEFAULT_CONTROL_DNS, DEFAULT_CONTROL_SNIFF } from '../../shared/appConfig'
import { getAppConfig, patchAppConfig } from './app'

const controledMihomoLogger = createLogger('ControledMihomo')

let controledMihomoConfig: Partial<IMihomoConfig> // mihomo.yaml
const controledMihomoWriteQueue = new WriteQueue()

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
        await atomicWriteFile(controledMihomoConfigPath(), stringify(controledMihomoConfig), {
          encoding: 'utf8'
        })
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
  await controledMihomoWriteQueue.run(async () => {
    const appConfig = await getAppConfig()
    const {
      controlDns = DEFAULT_CONTROL_DNS,
      controlSniff = DEFAULT_CONTROL_SNIFF,
      controlDnsBeforePause
    } = appConfig
    const nextConfig = JSON.parse(
      JSON.stringify(controledMihomoConfig || cloneDefaultControledMihomoConfig())
    ) as Partial<IMihomoConfig>
    const nextPatch = JSON.parse(JSON.stringify(patch)) as Partial<IMihomoConfig>
    // JSON 序列化会丢掉值为 undefined 的键，而这里 undefined 表示「删除该键」，需要补回
    for (const key of Object.keys(patch)) {
      if ((patch as Record<string, unknown>)[key] === undefined) {
        ;(nextPatch as Record<string, unknown>)[key] = undefined
      }
    }
    let restoreDnsState = false

    // 当模式从 direct 切换到 rule/global 时，恢复之前保存的 DNS 状态
    const currentMode = nextConfig.mode
    const newMode = nextPatch.mode
    if (
      currentMode === 'direct' &&
      newMode &&
      newMode !== 'direct' &&
      controlDnsBeforePause !== undefined
    ) {
      restoreDnsState = true
    }

    // 过滤端口字段中的 NaN 值，防止写入无效配置
    const portFields = ['mixed-port', 'socks-port', 'port', 'redir-port', 'tproxy-port'] as const
    for (const field of portFields) {
      if (
        field in nextPatch &&
        (typeof nextPatch[field] !== 'number' || Number.isNaN(nextPatch[field]))
      ) {
        delete nextPatch[field]
      }
    }

    if (nextPatch.hosts) {
      nextConfig.hosts = nextPatch.hosts
    }
    const replaceNameserverPolicy = Object.prototype.hasOwnProperty.call(
      nextPatch.dns || {},
      'nameserver-policy'
    )
    deepMerge(nextConfig, nextPatch)
    if (replaceNameserverPolicy) {
      nextConfig.dns = nextConfig.dns || {}
      nextConfig.dns['nameserver-policy'] = nextPatch.dns?.['nameserver-policy'] ?? {}
    }

    // 从不接管状态恢复
    if (controlDns) {
      // 确保 DNS 配置包含所有必要的默认字段，特别是新增的 fallback 等
      nextConfig.dns = deepMerge(
        cloneDefaultControledMihomoConfig().dns || {},
        nextConfig.dns || {}
      )
    }
    if (controlSniff && !nextConfig.sniffer) {
      nextConfig.sniffer = cloneDefaultControledMihomoConfig().sniffer
    }

    await generateProfile(nextConfig)
    await atomicWriteFile(controledMihomoConfigPath(), stringify(nextConfig), { encoding: 'utf8' })
    controledMihomoConfig = nextConfig
    if (restoreDnsState) {
      await patchAppConfig({ controlDns: controlDnsBeforePause, controlDnsBeforePause: undefined })
    }

    // 优先对运行中内核进行热更新，避免无意义重启
    try {
      await patchMihomoConfig(nextPatch)
    } catch (error) {
      controledMihomoLogger.warn(
        'Hot patch /configs failed, changes will apply on next restart',
        error
      )
    }

    // log-level 改变时重连日志 WebSocket，使新等级立刻生效
    if (nextPatch['log-level']) {
      try {
        await startMihomoLogs()
      } catch (error) {
        controledMihomoLogger.warn('Failed to restart log stream after log-level change', error)
      }
    }

    try {
      const { scheduleRuntimeConfigUpload } = await import('../resolve/gistApi')
      scheduleRuntimeConfigUpload()
    } catch (error) {
      controledMihomoLogger.warn('Failed to schedule runtime config Gist sync', error)
    }
  })
}
