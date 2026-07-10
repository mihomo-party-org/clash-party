import { copyFile, mkdir, writeFile, readFile, stat } from 'fs/promises'
import vm from 'vm'
import { existsSync, writeFileSync } from 'fs'
import path from 'path'
import { isIP } from 'net'
import {
  getControledMihomoConfig,
  getProfileConfig,
  getProfile,
  getProfileItem,
  getOverride,
  getOverrideItem,
  getOverrideConfig,
  getAppConfig
} from '../config'
import {
  mihomoProfileWorkDir,
  mihomoWorkConfigPath,
  mihomoWorkDir,
  overridePath,
  rulePath
} from '../utils/dirs'
import { parse, stringify } from '../utils/yaml'
import { deepMerge } from '../utils/merge'
import { createLogger } from '../utils/logger'
import { decryptAgeContent } from '../utils/age'
import { DEFAULT_CONTROL_DNS, DEFAULT_CONTROL_SNIFF } from '../../shared/appConfig'

const factoryLogger = createLogger('Factory')
const SMART_OVERRIDE_ID = 'smart-core-override'

let runtimeConfigStr: string = ''
let runtimeConfig: IMihomoConfig = {} as IMihomoConfig

// 辅助函数：处理带偏移量的规则
function processRulesWithOffset(ruleStrings: string[], currentRules: string[], isAppend = false) {
  const normalRules: string[] = []
  const rules = [...currentRules]

  ruleStrings.forEach((ruleStr) => {
    const parts = ruleStr.split(',')
    const firstPartIsNumber =
      !isNaN(Number(parts[0])) && parts[0].trim() !== '' && parts.length >= 3

    if (firstPartIsNumber) {
      const offset = parseInt(parts[0])
      const rule = parts.slice(1).join(',')

      if (isAppend) {
        // 后置规则的插入位置计算
        const insertPosition = Math.max(0, rules.length - Math.min(offset, rules.length))
        rules.splice(insertPosition, 0, rule)
      } else {
        // 前置规则的插入位置计算
        const insertPosition = Math.min(offset, rules.length)
        rules.splice(insertPosition, 0, rule)
      }
    } else {
      normalRules.push(ruleStr)
    }
  })

  return { normalRules, insertRules: rules }
}

/**
 * 确保在启用特定条件（如 Smart 覆写）且启用了 TUN 模式时，将代理服务器的 IP 地址添加到路由排除列表中，以避免路由回环。
 * 该函数会遍历配置中的所有代理节点，提取出服务器的 IP 地址（支持 IPv4/IPv6），并将其转换为对应的 CIDR 格式（IPv4: /32, IPv6: /128）。
 *
 * @param profile 当前的 Mihomo 配置对象
 * @param enabled 是否需要执行排除逻辑（通常为是否启用了 Smart 核心覆写）
 * @returns 此次新添加到排除列表中的网段/IP 数组
 */
function ensureSmartProxyServerTunExclude(profile: IMihomoConfig, enabled: boolean): string[] {
  if (!enabled || profile.tun?.enable !== true || !Array.isArray(profile.proxies)) return []

  const routeExcludeAddress = Array.isArray(profile.tun['route-exclude-address'])
    ? [...profile.tun['route-exclude-address']]
    : []
  profile.tun['route-exclude-address'] = routeExcludeAddress

  const existing = new Set(routeExcludeAddress.map((address) => address.trim().toLowerCase()))
  const added: string[] = []

  for (const proxy of profile.proxies as unknown[]) {
    if (!proxy || typeof proxy !== 'object') continue

    const server = (proxy as Record<string, unknown>).server
    if (typeof server !== 'string' && typeof server !== 'number') continue

    const host = String(server)
      .trim()
      .replace(/^\[(.*)\]$/, '$1')
      .toLowerCase()
    const ipVersion = isIP(host)
    if (!ipVersion) continue

    const cidr = ipVersion === 4 ? `${host}/32` : `${host}/128`
    if (existing.has(host) || existing.has(cidr)) continue

    routeExcludeAddress.push(cidr)
    existing.add(cidr)
    added.push(cidr)
  }

  return added
}

export async function generateProfile(): Promise<string | undefined> {
  // 读取最新的配置
  const { current } = await getProfileConfig(true)
  const {
    diffWorkDir = false,
    controlDns = DEFAULT_CONTROL_DNS,
    controlSniff = DEFAULT_CONTROL_SNIFF,
    useNameserverPolicy
  } = await getAppConfig()
  const currentProfileItem = await getProfileItem(current)
  const ageSecretKey = currentProfileItem?.ageSecretKey || ''
  const baseProfile = await getProfile(current)
  const overrideIds = await getOrderedOverrideIds(current)
  const profileWithNormalOverride = await applyOverrides(
    baseProfile,
    overrideIds.normal,
    ageSecretKey
  )
  const profileWithRuleOverride = await applyRuleOverride(current, profileWithNormalOverride)
  const currentProfile = await applyOverrides(
    profileWithRuleOverride,
    overrideIds.smart,
    ageSecretKey
  )
  let controledMihomoConfig = await getControledMihomoConfig()

  // 根据开关状态过滤控制配置
  controledMihomoConfig = { ...controledMihomoConfig }
  if (!controlDns) {
    delete controledMihomoConfig.dns
    delete controledMihomoConfig.hosts
  }
  if (!controlSniff) {
    delete controledMihomoConfig.sniffer
  }
  if (!useNameserverPolicy) {
    delete controledMihomoConfig?.dns?.['nameserver-policy']
  }

  const profile = deepMerge(currentProfile, controledMihomoConfig)
  // 关闭 DNS 覆写时，如果最终配置没有启用的 DNS 配置，清空 dns-hijack 避免请求被劫持但无法处理
  if (!controlDns && profile.tun && !profile.dns?.enable) {
    profile.tun = { ...profile.tun, 'dns-hijack': [] }
  }
  // Smart Override JS 早于受控 TUN 配置合并执行；最终配置写出前再排除代理服务器 IP。
  const addedProxyServerRouteExcludes = ensureSmartProxyServerTunExclude(
    profile,
    overrideIds.smart.length > 0
  )
  if (addedProxyServerRouteExcludes.length > 0) {
    factoryLogger.info(
      'Added Smart Override proxy server TUN route excludes',
      addedProxyServerRouteExcludes
    )
  }
  // 确保可以拿到基础日志信息
  // 使用 debug 可以调试内核相关问题 `debug/pprof`
  if (['info', 'debug'].includes(profile['log-level']) === false) {
    profile['log-level'] = 'info'
  }
  // 删除空的局域网允许列表，避免局域网访问异常
  if (!profile['lan-allowed-ips']?.length) {
    delete profile['lan-allowed-ips']
  }
  // WebUI 仅在外部控制器启用时有效；关闭面板时不向 Mihomo 写入下载地址。
  const partialProfile = profile as Partial<IMihomoConfig>
  if (profile['external-controller'] === '') {
    delete partialProfile['external-controller']
    delete partialProfile['external-ui']
    delete partialProfile['external-ui-url']
    delete partialProfile['external-controller-cors']
  } else if (profile['external-ui'] === '') {
    delete partialProfile['external-ui']
    delete partialProfile['external-ui-url']
  }
  runtimeConfig = profile
  runtimeConfigStr = stringify(profile)
  if (diffWorkDir) {
    await prepareProfileWorkDir(current)
  }
  await writeFile(
    diffWorkDir ? mihomoWorkConfigPath(current) : mihomoWorkConfigPath('work'),
    runtimeConfigStr
  )
  return current
}

async function applyRuleOverride(
  current: string | undefined,
  profile: IMihomoConfig
): Promise<IMihomoConfig> {
  try {
    const ruleFilePath = rulePath(current || 'default')
    if (!existsSync(ruleFilePath)) {
      return profile
    }

    const ruleFileContent = await readFile(ruleFilePath, 'utf-8')
    const ruleData = parse(ruleFileContent) as {
      prepend?: string[]
      append?: string[]
      delete?: string[]
    } | null

    if (!ruleData || typeof ruleData !== 'object') {
      return profile
    }

    if (!profile.rules) {
      profile.rules = [] as unknown as []
    }

    let rules = [...profile.rules] as unknown as string[]

    if (ruleData.prepend?.length) {
      const { normalRules: prependRules, insertRules } = processRulesWithOffset(
        ruleData.prepend,
        rules
      )
      rules = [...prependRules, ...insertRules]
    }

    if (ruleData.append?.length) {
      const { normalRules: appendRules, insertRules } = processRulesWithOffset(
        ruleData.append,
        rules,
        true
      )
      rules = [...insertRules, ...appendRules]
    }

    if (ruleData.delete?.length) {
      const deleteSet = new Set(ruleData.delete)
      rules = rules.filter((rule) => {
        const ruleStr = Array.isArray(rule) ? rule.join(',') : rule
        return !deleteSet.has(ruleStr)
      })
    }

    profile.rules = rules as unknown as []
    return profile
  } catch (error) {
    factoryLogger.error('Failed to read or apply rule file', error)
    return profile
  }
}

async function prepareProfileWorkDir(current: string | undefined): Promise<void> {
  if (!existsSync(mihomoProfileWorkDir(current))) {
    await mkdir(mihomoProfileWorkDir(current), { recursive: true })
  }

  const isSourceNewer = async (sourcePath: string, targetPath: string): Promise<boolean> => {
    try {
      const [sourceStats, targetStats] = await Promise.all([stat(sourcePath), stat(targetPath)])
      return sourceStats.mtime > targetStats.mtime
    } catch {
      return true
    }
  }

  const copy = async (file: string): Promise<void> => {
    const targetPath = path.join(mihomoProfileWorkDir(current), file)
    const sourcePath = path.join(mihomoWorkDir(), file)
    if (!existsSync(sourcePath)) return
    // 复制条件：目标不存在 或 源文件更新
    const shouldCopy = !existsSync(targetPath) || (await isSourceNewer(sourcePath, targetPath))
    if (shouldCopy) {
      await copyFile(sourcePath, targetPath)
    }
  }
  await Promise.all([
    copy('country.mmdb'),
    copy('geoip.metadb'),
    copy('geoip.dat'),
    copy('geosite.dat'),
    copy('ASN.mmdb')
  ])
}

async function getOrderedOverrideIds(current: string | undefined): Promise<{
  normal: string[]
  smart: string[]
}> {
  const { items = [] } = (await getOverrideConfig()) || {}
  const globalOverride = items.filter((item) => item.global).map((item) => item.id)
  const { override = [] } = (await getProfileItem(current)) || {}
  const orderedOverrideIds = [...new Set(globalOverride.concat(override))]

  return {
    normal: orderedOverrideIds.filter((id) => id !== SMART_OVERRIDE_ID),
    smart: orderedOverrideIds.filter((id) => id === SMART_OVERRIDE_ID)
  }
}

async function applyOverrides(
  profile: IMihomoConfig,
  overrideIds: string[],
  ageSecretKey: string
): Promise<IMihomoConfig> {
  for (const ov of overrideIds) {
    const item = await getOverrideItem(ov)
    const content = await getOverride(ov, item?.ext || 'js')
    switch (item?.ext) {
      case 'js':
        profile = runOverrideScript(profile, content, item)
        break
      case 'yaml': {
        const decryptedContent = await decryptAgeContent(content, ageSecretKey, `override "${ov}"`)
        let patch = parse(decryptedContent) || {}
        if (typeof patch !== 'object') patch = {}
        profile = deepMerge(profile, patch, true)
        break
      }
    }
  }
  return profile
}

function runOverrideScript(
  profile: IMihomoConfig,
  script: string,
  item: IOverrideItem
): IMihomoConfig {
  const log = (type: string, data: string, flag = 'a'): void => {
    writeFileSync(overridePath(item.id, 'log'), `[${type}] ${data}\n`, {
      encoding: 'utf-8',
      flag
    })
  }
  try {
    const ctx = {
      console: Object.freeze({
        log(data: never) {
          log('log', JSON.stringify(data))
        },
        info(data: never) {
          log('info', JSON.stringify(data))
        },
        error(data: never) {
          log('error', JSON.stringify(data))
        },
        debug(data: never) {
          log('debug', JSON.stringify(data))
        }
      })
    }
    vm.createContext(ctx)
    const code = `${script} main(${JSON.stringify(profile)})`
    log('info', '开始执行脚本', 'w')
    const newProfile = vm.runInContext(code, ctx)
    if (typeof newProfile !== 'object') {
      throw new Error('脚本返回值必须是对象')
    }
    log('info', '脚本执行成功')
    return newProfile
  } catch (e) {
    log('exception', `脚本执行失败：${e}`)
    return profile
  }
}

export async function getRuntimeConfigStr(): Promise<string> {
  return runtimeConfigStr
}

export async function getRuntimeConfig(): Promise<IMihomoConfig> {
  return runtimeConfig
}
