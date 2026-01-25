import { readFile, rm, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import i18next from 'i18next'
import * as chromeRequest from '../utils/chromeRequest'
import { parse, stringify } from '../utils/yaml'
import { defaultProfile } from '../utils/template'
import { subStorePort } from '../resolve/server'
import { mihomoUpgradeConfig } from '../core/mihomoApi'
import { restartCore } from '../core/manager'
import { addProfileUpdater, removeProfileUpdater } from '../core/profileUpdater'
import { mihomoProfileWorkDir, mihomoWorkDir, profileConfigPath, profilePath } from '../utils/dirs'
import { createLogger } from '../utils/logger'
import { getAppConfig } from './app'
import { getControledMihomoConfig } from './controledMihomo'

const profileLogger = createLogger('Profile')

let profileConfig: IProfileConfig
let profileConfigWriteQueue: Promise<void> = Promise.resolve()
let changeProfileQueue: Promise<void> = Promise.resolve()

export async function getProfileConfig(force = false): Promise<IProfileConfig> {
  if (force || !profileConfig) {
    const data = await readFile(profileConfigPath(), 'utf-8')
    profileConfig = parse(data) || { items: [] }
  }
  if (typeof profileConfig !== 'object') profileConfig = { items: [] }
  if (!Array.isArray(profileConfig.items)) profileConfig.items = []
  return structuredClone(profileConfig)
}

export async function setProfileConfig(config: IProfileConfig): Promise<void> {
  profileConfigWriteQueue = profileConfigWriteQueue.then(async () => {
    profileConfig = config
    await writeFile(profileConfigPath(), stringify(config), 'utf-8')
  })
  await profileConfigWriteQueue
}

export async function updateProfileConfig(
  updater: (config: IProfileConfig) => IProfileConfig | Promise<IProfileConfig>
): Promise<IProfileConfig> {
  let result: IProfileConfig | undefined
  profileConfigWriteQueue = profileConfigWriteQueue.then(async () => {
    const data = await readFile(profileConfigPath(), 'utf-8')
    profileConfig = parse(data) || { items: [] }
    if (typeof profileConfig !== 'object') profileConfig = { items: [] }
    if (!Array.isArray(profileConfig.items)) profileConfig.items = []
    profileConfig = await updater(structuredClone(profileConfig))
    result = profileConfig
    await writeFile(profileConfigPath(), stringify(profileConfig), 'utf-8')
  })
  await profileConfigWriteQueue
  return structuredClone(result ?? profileConfig)
}

export async function getProfileItem(id: string | undefined): Promise<IProfileItem | undefined> {
  const { items } = await getProfileConfig()
  if (!id || id === 'default')
    return { id: 'default', type: 'local', name: i18next.t('profiles.emptyProfile') }
  return items.find((item) => item.id === id)
}

export async function changeCurrentProfile(id: string): Promise<void> {
  // 使用队列确保 profile 切换串行执行，避免竞态条件
  let taskError: unknown = null
  changeProfileQueue = changeProfileQueue
    .catch(() => {})
    .then(async () => {
      const { current } = await getProfileConfig()
      if (current === id) return

      try {
        await updateProfileConfig((config) => {
          config.current = id
          return config
        })
        await restartCore()
      } catch (e) {
        // 回滚配置
        await updateProfileConfig((config) => {
          config.current = current
          return config
        })
        taskError = e
      }
    })
  await changeProfileQueue
  if (taskError) {
    throw taskError
  }
}

export async function updateProfileItem(item: IProfileItem): Promise<void> {
  await updateProfileConfig((config) => {
    const index = config.items.findIndex((i) => i.id === item.id)
    if (index === -1) {
      throw new Error('Profile not found')
    }
    config.items[index] = item
    return config
  })
}

export async function addProfileItem(item: Partial<IProfileItem>): Promise<void> {
  const newItem = await createProfile(item)
  let shouldChangeCurrent = false
  await updateProfileConfig((config) => {
    const existingIndex = config.items.findIndex((i) => i.id === newItem.id)
    if (existingIndex !== -1) {
      config.items[existingIndex] = newItem
    } else {
      config.items.push(newItem)
    }
    if (!config.current) {
      shouldChangeCurrent = true
    }
    return config
  })

  if (shouldChangeCurrent) {
    await changeCurrentProfile(newItem.id)
  }
  await addProfileUpdater(newItem)
}

export async function removeProfileItem(id: string): Promise<void> {
  await removeProfileUpdater(id)

  let shouldRestart = false
  await updateProfileConfig((config) => {
    config.items = config.items?.filter((item) => item.id !== id)
    if (config.current === id) {
      shouldRestart = true
      config.current = config.items.length > 0 ? config.items[0].id : undefined
    }
    return config
  })

  if (existsSync(profilePath(id))) {
    await rm(profilePath(id))
  }
  if (shouldRestart) {
    await restartCore()
  }
  if (existsSync(mihomoProfileWorkDir(id))) {
    await rm(mihomoProfileWorkDir(id), { recursive: true })
  }
}

export async function getCurrentProfileItem(): Promise<IProfileItem> {
  const { current } = await getProfileConfig()
  return (
    (await getProfileItem(current)) || {
      id: 'default',
      type: 'local',
      name: i18next.t('profiles.emptyProfile')
    }
  )
}

interface FetchOptions {
  url: string
  useProxy: boolean
  mixedPort: number
  userAgent: string
  authToken?: string
  timeout: number
  substore: boolean
}

interface FetchResult {
  data: string
  headers: Record<string, string>
}

async function fetchAndValidateSubscription(options: FetchOptions): Promise<FetchResult> {
  const { url, useProxy, mixedPort, userAgent, authToken, timeout, substore } = options

  const headers: Record<string, string> = { 'User-Agent': userAgent }
  if (authToken) headers['Authorization'] = authToken

  let res: chromeRequest.Response<string>
  if (substore) {
    const urlObj = new URL(`http://127.0.0.1:${subStorePort}${url}`)
    urlObj.searchParams.set('target', 'ClashMeta')
    urlObj.searchParams.set('noCache', 'true')
    if (useProxy) {
      urlObj.searchParams.set('proxy', `http://127.0.0.1:${mixedPort}`)
    }
    res = await chromeRequest.get(urlObj.toString(), { headers, responseType: 'text', timeout })
  } else {
    res = await chromeRequest.get(url, {
      headers,
      responseType: 'text',
      timeout,
      proxy: useProxy ? { protocol: 'http', host: '127.0.0.1', port: mixedPort } : false
    })
  }

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Subscription failed: Request status code ${res.status}`)
  }

  const parsed = parse(res.data) as Record<string, unknown> | null
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Subscription failed: Profile is not a valid YAML')
  }
  if (!parsed['proxies'] && !parsed['proxy-providers']) {
    throw new Error('Subscription failed: Profile missing proxies or providers')
  }

  return { data: res.data, headers: res.headers }
}

export async function createProfile(item: Partial<IProfileItem>): Promise<IProfileItem> {
  const id = item.id || new Date().getTime().toString(16)
  const newItem: IProfileItem = {
    id,
    name: item.name || (item.type === 'remote' ? 'Remote File' : 'Local File'),
    type: item.type || 'local',
    url: item.url,
    substore: item.substore || false,
    interval: item.interval || 0,
    override: item.override || [],
    useProxy: item.useProxy || false,
    allowFixedInterval: item.allowFixedInterval || false,
    autoUpdate: item.autoUpdate ?? false,
    authToken: item.authToken,
    updated: new Date().getTime(),
    updateTimeout: item.updateTimeout || 5
  }

  // Local
  if (newItem.type === 'local') {
    await setProfileStr(id, item.file || '')
    return newItem
  }

  // Remote
  if (!item.url) throw new Error('Empty URL')

  const { userAgent, subscriptionTimeout = 30000 } = await getAppConfig()
  const { 'mixed-port': mixedPort = 7890 } = await getControledMihomoConfig()
  const userItemTimeoutMs = (newItem.updateTimeout || 5) * 1000

  const baseOptions: Omit<FetchOptions, 'useProxy' | 'timeout'> = {
    url: item.url,
    mixedPort,
    userAgent: userAgent || `mihomo.party/v${app.getVersion()} (clash.meta)`,
    authToken: item.authToken,
    substore: newItem.substore || false
  }

  const fetchSub = (useProxy: boolean, timeout: number) =>
    fetchAndValidateSubscription({ ...baseOptions, useProxy, timeout })

  let result: FetchResult
  if (newItem.useProxy || newItem.substore) {
    result = await fetchSub(Boolean(newItem.useProxy), userItemTimeoutMs)
  } else {
    try {
      result = await fetchSub(false, userItemTimeoutMs)
    } catch (directError) {
      try {
        // smart fallback
        result = await fetchSub(true, subscriptionTimeout)
      } catch {
        throw directError
      }
    }
  }

  const { data, headers } = result

  if (headers['content-disposition'] && newItem.name === 'Remote File') {
    newItem.name = parseFilename(headers['content-disposition'])
  }
  if (headers['profile-web-page-url']) {
    newItem.home = headers['profile-web-page-url']
  }
  if (headers['profile-update-interval'] && !item.allowFixedInterval) {
    newItem.interval = parseInt(headers['profile-update-interval']) * 60
  }
  if (headers['subscription-userinfo']) {
    newItem.extra = parseSubinfo(headers['subscription-userinfo'])
  }

  await setProfileStr(id, data)
  return newItem
}

export async function getProfileStr(id: string | undefined): Promise<string> {
  if (existsSync(profilePath(id || 'default'))) {
    return await readFile(profilePath(id || 'default'), 'utf-8')
  } else {
    return stringify(defaultProfile)
  }
}

export async function setProfileStr(id: string, content: string): Promise<void> {
  // 读取最新的配置
  const { current } = await getProfileConfig(true)
  await writeFile(profilePath(id), content, 'utf-8')
  if (current === id) {
    try {
      const { generateProfile } = await import('../core/factory')
      await generateProfile()
      await mihomoUpgradeConfig()
      profileLogger.info('Config reloaded successfully using mihomoUpgradeConfig')
    } catch (error) {
      profileLogger.error('Failed to reload config with mihomoUpgradeConfig', error)
      try {
        profileLogger.info('Falling back to restart core')
        const { restartCore } = await import('../core/manager')
        await restartCore()
        profileLogger.info('Core restarted successfully')
      } catch (restartError) {
        profileLogger.error('Failed to restart core', restartError)
        throw restartError
      }
    }
  }
}

export async function getProfile(id: string | undefined): Promise<IMihomoConfig> {
  const profile = await getProfileStr(id)

  // 检测是否为 HTML 内容（订阅返回错误页面）
  const trimmed = profile.trim()
  if (
    trimmed.startsWith('<!DOCTYPE') ||
    trimmed.startsWith('<html') ||
    trimmed.startsWith('<HTML') ||
    /<style[^>]*>/i.test(trimmed.slice(0, 500))
  ) {
    throw new Error(
      `Profile "${id}" contains HTML instead of YAML. The subscription may have returned an error page. Please re-import or update the subscription.`
    )
  }

  try {
    let result = parse(profile)
    if (typeof result !== 'object') result = {}
    return result as IMihomoConfig
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`Failed to parse profile "${id}": ${msg}`)
  }
}

// attachment;filename=xxx.yaml; filename*=UTF-8''%xx%xx%xx
function parseFilename(str: string): string {
  if (str.match(/filename\*=.*''/)) {
    const parts = str.split(/filename\*=.*''/)
    if (parts[1]) {
      return decodeURIComponent(parts[1])
    }
  }
  const parts = str.split('filename=')
  if (parts[1]) {
    return parts[1].replace(/^["']|["']$/g, '')
  }
  return 'Remote File'
}

// subscription-userinfo: upload=1234; download=2234; total=1024000; expire=2218532293
function parseSubinfo(str: string): ISubscriptionUserInfo {
  const parts = str.split(/\s*;\s*/)
  const obj = {} as ISubscriptionUserInfo
  parts.forEach((part) => {
    const [key, value] = part.split('=')
    obj[key] = parseInt(value)
  })
  return obj
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[a-zA-Z]:\\/.test(path)
}

export async function getFileStr(path: string): Promise<string> {
  const { diffWorkDir = false } = await getAppConfig()
  const { current } = await getProfileConfig()
  if (isAbsolutePath(path)) {
    return await readFile(path, 'utf-8')
  } else {
    return await readFile(
      join(diffWorkDir ? mihomoProfileWorkDir(current) : mihomoWorkDir(), path),
      'utf-8'
    )
  }
}

export async function setFileStr(path: string, content: string): Promise<void> {
  const { diffWorkDir = false } = await getAppConfig()
  const { current } = await getProfileConfig()
  if (isAbsolutePath(path)) {
    await writeFile(path, content, 'utf-8')
  } else {
    await writeFile(
      join(diffWorkDir ? mihomoProfileWorkDir(current) : mihomoWorkDir(), path),
      content,
      'utf-8'
    )
  }
}

export async function convertMrsRuleset(filePath: string, behavior: string): Promise<string> {
  const { exec } = await import('child_process')
  const { promisify } = await import('util')
  const execAsync = promisify(exec)
  const { mihomoCorePath } = await import('../utils/dirs')
  const { getAppConfig } = await import('./app')
  const { tmpdir } = await import('os')
  const { randomBytes } = await import('crypto')
  const { unlink } = await import('fs/promises')

  const { core = 'mihomo' } = await getAppConfig()
  const corePath = mihomoCorePath(core)
  const { diffWorkDir = false } = await getAppConfig()
  const { current } = await getProfileConfig()
  let fullPath: string
  if (isAbsolutePath(filePath)) {
    fullPath = filePath
  } else {
    fullPath = join(diffWorkDir ? mihomoProfileWorkDir(current) : mihomoWorkDir(), filePath)
  }

  const tempFileName = `mrs-convert-${randomBytes(8).toString('hex')}.txt`
  const tempFilePath = join(tmpdir(), tempFileName)

  try {
    // 使用 mihomo convert-ruleset 命令转换 MRS 文件为 text 格式
    // 命令格式: mihomo convert-ruleset <behavior> <format> <source>
    await execAsync(`"${corePath}" convert-ruleset ${behavior} mrs "${fullPath}" "${tempFilePath}"`)
    const content = await readFile(tempFilePath, 'utf-8')
    await unlink(tempFilePath)

    return content
  } catch (error) {
    try {
      await unlink(tempFilePath)
    } catch {
      // ignore
    }
    throw error
  }
}
