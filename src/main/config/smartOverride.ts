import { getAppConfig } from './app'
import { addOverrideItem, removeOverrideItem, getOverrideItem } from './override'
import { overrideLogger } from '../utils/logger'

const SMART_OVERRIDE_ID = 'smart-core-override'

/**
 * Smart 内核的覆写配置模板
 */
function generateSmartOverrideTemplate(
  useLightGBM: boolean,
  collectData: boolean,
  strategy: string,
  collectorSize: number
): string {
  return `
// 配置会在启用 Smart 内核时自动应用

function main(config) {
  try {
    // 确保配置对象存在
    if (!config || typeof config !== 'object') {
      console.log('[Smart Override] Invalid config object')
      return config
    }

    // 设置 Smart 内核的 profile 配置
    if (!config.profile) {
      config.profile = {}
    }
    config.profile['smart-collector-size'] = ${collectorSize}

    // 确保代理组配置存在
    if (!config['proxy-groups']) {
      config['proxy-groups'] = []
    }

    // 确保代理组是数组
    if (!Array.isArray(config['proxy-groups'])) {
      console.log('[Smart Override] proxy-groups is not an array, converting...')
      config['proxy-groups'] = []
    }

    // 首先检查是否存在 url-test 或 load-balance 代理组
    let hasUrlTestOrLoadBalance = false
    for (let i = 0; i < config['proxy-groups'].length; i++) {
      const group = config['proxy-groups'][i]
      if (group && group.type) {
        const groupType = group.type.toLowerCase()
        if (groupType === 'url-test' || groupType === 'load-balance') {
          hasUrlTestOrLoadBalance = true
          break
        }
      }
    }

    // 如果存在 url-test 或 load-balance 代理组，只进行类型转换
    if (hasUrlTestOrLoadBalance) {
      console.log('[Smart Override] Found url-test or load-balance groups, converting to smart type')
      
      // 记录需要更新引用的代理组名称映射
      const nameMapping = new Map()
      
      for (let i = 0; i < config['proxy-groups'].length; i++) {
        const group = config['proxy-groups'][i]
        if (group && group.type) {
          const groupType = group.type.toLowerCase()
          if (groupType === 'url-test' || groupType === 'load-balance') {
            console.log('[Smart Override] Converting group:', group.name, 'from', group.type, 'to smart')
            
            // 记录原名称和新名称的映射关系
            const originalName = group.name
            
            // 保留原有配置，只修改 type 和添加 Smart 特有配置
            group.type = 'smart'
            
            // 为代理组名称添加 (Smart Group) 后缀
            if (group.name && !group.name.includes('(Smart Group)')) {
              group.name = group.name + '(Smart Group)'
              nameMapping.set(originalName, group.name)
            }
            
            // 添加 Smart 特有配置
            if (!group['policy-priority']) {
              group['policy-priority'] = ''  // policy-priority: <1 means lower priority, >1 means higher priority, the default is 1, pattern support regex and string
            }
            group.uselightgbm = ${useLightGBM}
            group.collectdata = ${collectData}
            group.strategy = '${strategy}'
            
            // 移除 url-test 和 load-balance 特有的配置
            if (group.url) delete group.url
            if (group.interval) delete group.interval
            if (group.tolerance) delete group.tolerance
            if (group.lazy) delete group.lazy
            if (group.expected_status) delete group['expected-status']
          }
        }
      }
      
      // 更新配置文件中其他位置对代理组名称的引用
      if (nameMapping.size > 0) {
        console.log('[Smart Override] Updating references to renamed groups:', Array.from(nameMapping.entries()))
        
        // 更新代理组中的 proxies 字段引用
        if (config['proxy-groups'] && Array.isArray(config['proxy-groups'])) {
          config['proxy-groups'].forEach(group => {
            if (group && group.proxies && Array.isArray(group.proxies)) {
              group.proxies = group.proxies.map(proxyName => {
                if (nameMapping.has(proxyName)) {
                  console.log('[Smart Override] Updated proxy reference:', proxyName, '→', nameMapping.get(proxyName))
                  return nameMapping.get(proxyName)
                }
                return proxyName
              })
            }
          })
        }
        
        // 更新规则中的代理组引用
        if (config.rules && Array.isArray(config.rules)) {
          config.rules = config.rules.map(rule => {
            if (typeof rule === 'string') {
              let updatedRule = rule
              nameMapping.forEach((newName, oldName) => {
                // 使用简单的字符串替换，检查是否完全匹配
                if (updatedRule.includes(oldName)) {
                  updatedRule = updatedRule.split(oldName).join(newName)
                  console.log('[Smart Override] Updated rule reference:', oldName, '→', newName)
                }
              })
              return updatedRule
            } else if (typeof rule === 'object' && rule !== null) {
              // 处理对象格式的规则
              ['target', 'proxy'].forEach(field => {
                if (rule[field] && nameMapping.has(rule[field])) {
                  console.log('[Smart Override] Updated rule object reference:', rule[field], '→', nameMapping.get(rule[field]))
                  rule[field] = nameMapping.get(rule[field])
                }
              })
            }
            return rule
          })
        }
        
        // 更新其他可能的配置字段引用
        ['mode', 'proxy-mode'].forEach(field => {
          if (config[field] && nameMapping.has(config[field])) {
            console.log('[Smart Override] Updated config field', field + ':', config[field], '→', nameMapping.get(config[field]))
            config[field] = nameMapping.get(config[field])
          }
        })
      }
      
      console.log('[Smart Override] Conversion completed, skipping other operations')
      return config
    }

    // 如果没有 url-test 或 load-balance 代理组，执行原有逻辑
    console.log('[Smart Override] No url-test or load-balance groups found, executing original logic')
    
    // 查找现有的 Smart 代理组并更新
    let smartGroupExists = false
    for (let i = 0; i < config['proxy-groups'].length; i++) {
      const group = config['proxy-groups'][i]
      if (group && group.type === 'smart') {
        smartGroupExists = true
        console.log('[Smart Override] Found existing smart group:', group.name)

        if (!group['policy-priority']) {
          group['policy-priority'] = ''  // policy-priority: <1 means lower priority, >1 means higher priority, the default is 1, pattern support regex and string
        }
        group.uselightgbm = ${useLightGBM}
        group.collectdata = ${collectData}
        group.strategy = '${strategy}'
        break
      }
    }

    // 如果没有 Smart 组且有可用代理，创建示例组
    if (!smartGroupExists && config.proxies && Array.isArray(config.proxies) && config.proxies.length > 0) {
      console.log('[Smart Override] Creating new smart group with', config.proxies.length, 'proxies')

      // 获取所有代理的名称
      const proxyNames = config.proxies
        .filter(proxy => proxy && typeof proxy === 'object' && proxy.name)
        .map(proxy => proxy.name)

      if (proxyNames.length > 0) {
        const smartGroup = {
          name: 'Smart Group',
          type: 'smart',
          'policy-priority': '',  // policy-priority: <1 means lower priority, >1 means higher priority, the default is 1, pattern support regex and string
          uselightgbm: ${useLightGBM},
          collectdata: ${collectData},
          strategy: '${strategy}',
          proxies: proxyNames
        }
        config['proxy-groups'].unshift(smartGroup)
        console.log('[Smart Override] Created smart group at first position with proxies:', proxyNames)
      } else {
        console.log('[Smart Override] No valid proxies found, skipping smart group creation')
      }
    } else if (!smartGroupExists) {
      console.log('[Smart Override] No proxies available, skipping smart group creation')
    }

    // 处理规则替换
    if (config.rules && Array.isArray(config.rules)) {
      console.log('[Smart Override] Processing rules, original count:', config.rules.length)

      // 收集所有代理组名称
      const proxyGroupNames = new Set()
      if (config['proxy-groups'] && Array.isArray(config['proxy-groups'])) {
        config['proxy-groups'].forEach(group => {
          if (group && group.name) {
            proxyGroupNames.add(group.name)
          }
        })
      }

      // 添加常见的内置目标
      const builtinTargets = new Set([
        'DIRECT',
        'REJECT',
        'REJECT-DROP',
        'PASS',
        'COMPATIBLE'
      ])

      // 添加常见的规则参数，不应该替换
      const ruleParams = new Set(['no-resolve', 'force-remote-dns', 'prefer-ipv6'])

      console.log('[Smart Override] Found', proxyGroupNames.size, 'proxy groups:', Array.from(proxyGroupNames))

      let replacedCount = 0
      config.rules = config.rules.map(rule => {
        if (typeof rule === 'string') {
          // 检查是否是复杂规则格式（包含括号的嵌套规则）
          if (rule.includes('((') || rule.includes('))')) {
            console.log('[Smart Override] Skipping complex nested rule:', rule)
            return rule
          }

          // 处理字符串格式的规则
          const parts = rule.split(',').map(part => part.trim())
          if (parts.length >= 2) {
            // 找到代理组名称的位置
            let targetIndex = -1
            let targetValue = ''

            // 处理 MATCH 规则
            if (parts[0] === 'MATCH' && parts.length === 2) {
              targetIndex = 1
              targetValue = parts[1]
            } else if (parts.length >= 3) {
              // 处理其他规则
              for (let i = 2; i < parts.length; i++) {
                const part = parts[i]
                if (!ruleParams.has(part)) {
                  targetIndex = i
                  targetValue = part
                  break
                }
              }
            }

            if (targetIndex !== -1 && targetValue) {
              // 检查是否应该替换
              const shouldReplace = !builtinTargets.has(targetValue) &&
                                   (proxyGroupNames.has(targetValue) ||
                                    !ruleParams.has(targetValue))

              if (shouldReplace) {
                parts[targetIndex] = 'Smart Group'
                replacedCount++
                console.log('[Smart Override] Replaced rule target:', targetValue, '→ Smart Group')
                return parts.join(',')
              }
            }
          }
        } else if (typeof rule === 'object' && rule !== null) {
          // 处理对象格式
          let targetField = ''
          let targetValue = ''

          if (rule.target) {
            targetField = 'target'
            targetValue = rule.target
          } else if (rule.proxy) {
            targetField = 'proxy'
            targetValue = rule.proxy
          }

          if (targetField && targetValue) {
            const shouldReplace = !builtinTargets.has(targetValue) &&
                                 (proxyGroupNames.has(targetValue) ||
                                  !ruleParams.has(targetValue))

            if (shouldReplace) {
              rule[targetField] = 'Smart Group'
              replacedCount++
              console.log('[Smart Override] Replaced rule target:', targetValue, '→ Smart Group')
            }
          }
        }
        return rule
      })

      console.log('[Smart Override] Rules processed, replaced', replacedCount, 'non-DIRECT rules with Smart Group')
    } else {
      console.log('[Smart Override] No rules found or rules is not an array')
    }

    console.log('[Smart Override] Configuration processed successfully')
    return config
  } catch (error) {
    console.error('[Smart Override] Error processing config:', error)
    // 发生错误时返回原始配置，避免破坏整个配置
    return config
  }
}
`
}

/**
 * 创建或更新 Smart 内核覆写配置
 */
export async function createSmartOverride(): Promise<void> {
  try {
    // 获取应用配置
    const {
      smartCoreUseLightGBM = false,
      smartCoreCollectData = false,
      smartCoreStrategy = 'sticky-sessions',
      smartCollectorSize = 100
    } = await getAppConfig()

    // 生成覆写模板
    const template = generateSmartOverrideTemplate(
      smartCoreUseLightGBM,
      smartCoreCollectData,
      smartCoreStrategy,
      smartCollectorSize
    )

    await addOverrideItem({
      id: SMART_OVERRIDE_ID,
      name: 'Smart Core Override',
      type: 'local',
      ext: 'js',
      global: true,
      file: template
    })
  } catch (error) {
    await overrideLogger.error('Failed to create Smart override', error)
    throw error
  }
}

/**
 * 删除 Smart 内核覆写配置
 */
export async function removeSmartOverride(): Promise<void> {
  try {
    const existingOverride = await getOverrideItem(SMART_OVERRIDE_ID)
    if (existingOverride) {
      await removeOverrideItem(SMART_OVERRIDE_ID)
    }
  } catch (error) {
    await overrideLogger.error('Failed to remove Smart override', error)
    throw error
  }
}

/**
 * 根据应用配置管理 Smart 覆写
 */
export async function manageSmartOverride(): Promise<void> {
  const { enableSmartCore = true, enableSmartOverride = true, core } = await getAppConfig()

  if (enableSmartCore && enableSmartOverride && core === 'mihomo-smart') {
    await createSmartOverride()
  } else {
    await removeSmartOverride()
  }
}

/**
 * 检查 Smart 覆写是否存在
 */
export async function isSmartOverrideExists(): Promise<boolean> {
  try {
    const override = await getOverrideItem(SMART_OVERRIDE_ID)
    return !!override
  } catch {
    return false
  }
}
