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
import { copyFile, mkdir, writeFile, readFile } from 'fs/promises'
import { deepMerge } from '../utils/merge'
import vm from 'vm'
import { existsSync, writeFileSync } from 'fs'
import path from 'path'

let runtimeConfigStr: string
let runtimeConfig: IMihomoConfig

// 辅助函数：处理带偏移量的规则
function processRulesWithOffset(ruleStrings: string[], currentRules: string[], isAppend = false) {
  const normalRules: string[] = []
  let rules = [...currentRules]
  
  ruleStrings.forEach(ruleStr => {
    const parts = ruleStr.split(',')
    const firstPartIsNumber = !isNaN(Number(parts[0])) && parts[0].trim() !== '' && parts.length >= 3
    
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

export async function generateProfile(): Promise<void> {
  // 读取最新的配置
  const { current } = await getProfileConfig(true)
  const { diffWorkDir = false, controlDns = true, controlSniff = true, useNameserverPolicy } = await getAppConfig()
  let currentProfile = await overrideProfile(current, await getProfile(current))
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

  // 应用规则文件
  try {
    const ruleFilePath = rulePath(current || 'default')
    if (existsSync(ruleFilePath)) {
      const ruleFileContent = await readFile(ruleFilePath, 'utf-8')
      const ruleData = parse(ruleFileContent) as { prepend?: string[], append?: string[], delete?: string[] } | null
      
      if (ruleData && typeof ruleData === 'object') {
        // 确保 rules 数组存在
        if (!currentProfile.rules) {
          currentProfile.rules = [] as unknown as []
        }
        
        let rules = [...currentProfile.rules] as unknown as string[]
        
        // 处理前置规则
        if (ruleData.prepend?.length) {
          const { normalRules: prependRules, insertRules } = processRulesWithOffset(ruleData.prepend, rules)
          rules = [...prependRules, ...insertRules]
        }
        
        // 处理后置规则
        if (ruleData.append?.length) {
          const { normalRules: appendRules, insertRules } = processRulesWithOffset(ruleData.append, rules, true)
          rules = [...insertRules, ...appendRules]
        }
        
        // 处理删除规则
        if (ruleData.delete?.length) {
          const deleteSet = new Set(ruleData.delete)
          rules = rules.filter(rule => {
            const ruleStr = Array.isArray(rule) ? rule.join(',') : rule
            return !deleteSet.has(ruleStr)
          })
        }
        
        currentProfile.rules = rules as unknown as []
      }
    }
  } catch (error) {
    console.error('读取或应用规则文件时出错:', error)
  }

  const profile = deepMerge(currentProfile, controledMihomoConfig)
  // 确保可以拿到基础日志信息
  // 使用 debug 可以调试内核相关问题 `debug/pprof`
  if (['info', 'debug'].includes(profile['log-level']) === false) {
    profile['log-level'] = 'info'
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
}

async function prepareProfileWorkDir(current: string | undefined): Promise<void> {
  if (!existsSync(mihomoProfileWorkDir(current))) {
    await mkdir(mihomoProfileWorkDir(current), { recursive: true })
  }
  const copy = async (file: string): Promise<void> => {
    const targetPath = path.join(mihomoProfileWorkDir(current), file)
    const sourcePath = path.join(mihomoWorkDir(), file)
    if (!existsSync(targetPath) && existsSync(sourcePath)) {
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

async function overrideProfile(
  current: string | undefined,
  profile: IMihomoConfig
): Promise<IMihomoConfig> {
  const { items = [] } = (await getOverrideConfig()) || {}
  const globalOverride = items.filter((item) => item.global).map((item) => item.id)
  const { override = [] } = (await getProfileItem(current)) || {}
  for (const ov of new Set(globalOverride.concat(override))) {
    const item = await getOverrideItem(ov)
    const content = await getOverride(ov, item?.ext || 'js')
    switch (item?.ext) {
      case 'js':
        profile = runOverrideScript(profile, content, item)
        break
      case 'yaml': {
        let patch = parse(content) || {}
        if (typeof patch !== 'object') patch = {}
        profile = deepMerge(profile, patch)
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
