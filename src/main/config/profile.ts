import { access, mkdtemp, readFile, rm, unlink } from 'fs/promises'
import { constants, existsSync } from 'fs'
import { execFile } from 'child_process'
import { isAbsolute, join, relative, resolve } from 'path'
import { promisify } from 'util'
import { randomBytes } from 'crypto'
import { tmpdir } from 'os'
import { app } from 'electron'
import i18next from 'i18next'
import axios, { AxiosResponse } from 'axios'
import { parse, stringify } from '../utils/yaml'
import { defaultProfile } from '../utils/template'
import { decryptAgeContent } from '../utils/age'
import { DEFAULT_MIHOMO_PORTS } from '../../shared/appConfig'
import { subStorePort } from '../resolve/server'
import { mihomoCloseAllConnections, mihomoHotReloadConfig } from '../core/mihomoApi'
import { checkProfileConfig, restartCore, type CheckProfileOptions } from '../core/manager'
import { generateProfile, globalOverrideIdsNow } from '../core/factory'
import { addProfileUpdater, removeProfileUpdater } from '../core/profileUpdater'
import {
  mihomoCorePath,
  mihomoProfileWorkDir,
  mihomoWorkDir,
  profileConfigPath,
  profilePath
} from '../utils/dirs'
import { createLogger } from '../utils/logger'
import { atomicWriteFile } from '../utils/safeFile'
import { getAppConfig } from './app'
import { getControledMihomoConfig } from './controledMihomo'
import { getPluginItem, pluginSchedule } from './plugin'
import { runtimeConfigWriteQueue } from './runtimeConfigQueue'

const profileLogger = createLogger('Profile')
const execFilePromise = promisify(execFile)

let profileConfig: IProfileConfig
// 与 override.yaml 共用（见 runtimeConfigQueue.ts）
const profileConfigWriteQueue = runtimeConfigWriteQueue
let changeProfileQueue: Promise<void> = Promise.resolve()
// 并发去重
const inflightRemoteFetches = new Map<string, Promise<IProfileItem>>()

function isPermissionError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code
  return code === 'EACCES' || code === 'EPERM'
}

function assertInsideWorkDir(targetPath: string): void {
  const relativePath = relative(resolve(mihomoWorkDir()), resolve(targetPath))
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`Refusing to delete outside work directory: ${targetPath}`)
  }
}

async function canRemoveProfileWorkDir(workDir: string): Promise<boolean> {
  try {
    await Promise.all([
      access(mihomoWorkDir(), constants.W_OK | constants.X_OK),
      access(workDir, constants.R_OK | constants.W_OK | constants.X_OK)
    ])
    return true
  } catch {
    return false
  }
}

async function removeProfileWorkDirWithPkexec(workDir: string): Promise<void> {
  assertInsideWorkDir(workDir)
  await execFilePromise('pkexec', ['rm', '-rf', '--', workDir])
}

async function removeProfileWorkDir(id: string): Promise<void> {
  const workDir = mihomoProfileWorkDir(id)
  if (!existsSync(workDir)) return
  assertInsideWorkDir(workDir)

  if (process.platform === 'linux' && !(await canRemoveProfileWorkDir(workDir))) {
    await removeProfileWorkDirWithPkexec(workDir)
    return
  }

  try {
    await rm(workDir, { recursive: true, force: true })
  } catch (error) {
    if (process.platform !== 'linux' || !isPermissionError(error)) {
      throw error
    }

    await removeProfileWorkDirWithPkexec(workDir)
  }
}

// 每次经写队列提交的写入 +1：一次迟到的冷加载 / 强制读取不得用旧内容覆盖比它新的缓存（R2-ISS-045 同型）
let profileConfigVersion = 0

export async function getProfileConfig(force = false): Promise<IProfileConfig> {
  if (force || !profileConfig) {
    const seen = profileConfigVersion
    const data = await readFile(profileConfigPath(), 'utf-8')
    const loaded = (parse(data) || { items: [] }) as IProfileConfig
    // 读取期间有写入提交：磁盘与缓存都已比这次读取新，保留缓存
    if (profileConfigVersion === seen || !profileConfig) profileConfig = loaded
  }
  if (typeof profileConfig !== 'object') profileConfig = { items: [] }
  if (!Array.isArray(profileConfig.items)) profileConfig.items = []
  return JSON.parse(JSON.stringify(profileConfig))
}

export async function setProfileConfig(config: IProfileConfig): Promise<void> {
  await profileConfigWriteQueue.run(async () => {
    const nextConfig = JSON.parse(JSON.stringify(config)) as IProfileConfig
    await atomicWriteFile(profileConfigPath(), stringify(nextConfig), { encoding: 'utf8' })
    profileConfig = nextConfig
    profileConfigVersion++
  })
}

// signal 只约束排队等待：它在轮到本次写入之前触发则写入不执行（调用方得到 signal 的 reason）；
// 已经开始的写入一律完成
export async function updateProfileConfig(
  updater: (config: IProfileConfig) => IProfileConfig | Promise<IProfileConfig>,
  signal?: AbortSignal
): Promise<IProfileConfig> {
  return await profileConfigWriteQueue.run(async () => {
    const data = await readFile(profileConfigPath(), 'utf-8')
    const currentConfig = (parse(data) || { items: [] }) as IProfileConfig
    if (typeof currentConfig !== 'object') {
      throw new Error('Profile config is invalid')
    }
    if (!Array.isArray(currentConfig.items)) currentConfig.items = []
    const nextConfig = await updater(JSON.parse(JSON.stringify(currentConfig)))
    await atomicWriteFile(profileConfigPath(), stringify(nextConfig), { encoding: 'utf8' })
    profileConfig = nextConfig
    profileConfigVersion++
    return JSON.parse(JSON.stringify(nextConfig)) as IProfileConfig
  }, signal)
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
        const { useHotReloadProfile = false, hotReloadProfileAutoCloseConnection = false } =
          await getAppConfig()
        if (useHotReloadProfile) {
          await mihomoHotReloadConfig()
          if (hotReloadProfileAutoCloseConnection) {
            try {
              await mihomoCloseAllConnections()
            } catch (error) {
              profileLogger.warn('Failed to close connections after profile hot reload', error)
            }
          }
        } else {
          await restartCore()
        }
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
  let newProfileIsCurrentAfterUpdate = false
  await updateProfileConfig((config) => {
    const existingIndex = config.items.findIndex((i) => i.id === newItem.id)
    if (existingIndex !== -1) {
      config.items[existingIndex] = newItem
    } else {
      config.items.push(newItem)
    }
    if (!config.current) {
      shouldChangeCurrent = true
      newProfileIsCurrentAfterUpdate = true
    }
    return config
  })

  // If the new profile will become the current profile, ensure generateProfile is called
  // to prepare working directory before restarting core
  if (newProfileIsCurrentAfterUpdate) {
    const { diffWorkDir } = await getAppConfig()
    if (diffWorkDir) {
      try {
        await generateProfile()
      } catch (error) {
        profileLogger.warn('Failed to generate profile for new subscription', error)
      }
    }
  }

  if (shouldChangeCurrent) {
    await changeCurrentProfile(newItem.id)
  }
  await addProfileUpdater(newItem)
}

export async function removeProfileItem(id: string): Promise<void> {
  const item = await getProfileItem(id)
  if (item?.type === 'plugin' && item.pluginId) {
    // 级联删除插件：tombstone → plugin lock → revoke → profile → item → vault 在同一个临界区内完成。
    // profile 记录由插件侧在锁内删除，避免在途更新的 upsertPluginProfile 在取锁前把它重建出来。
    const { removePluginForProfile } = await import('../resolve/plugin')
    const { mainWindow } = await import('../window')
    await removePluginForProfile(item.pluginId, id)
    mainWindow?.webContents.send('pluginConfigUpdated')
    return
  }
  await removeProfileItemCore(id)
}

// 正在删除中的 profile：并发删除时不能把彼此选作新的 current
const deletingProfiles = new Set<string>()

// 删除 profile 记录、文件与工作目录，不做插件级联。返回被删除的记录（若存在）。
// 顺序：先让核心不再使用它（切走 current + 重启），再删订阅文件与工作目录，最后删记录。任何一步失败都抛出、
// 定时器装回，而记录仍在列表里可以重试——不会出现"记录没了、含节点凭据的文件还在"的无主残留（R2-ISS-067）。
async function removeProfileItemCore(id: string): Promise<IProfileItem | undefined> {
  deletingProfiles.add(id)
  try {
    return await removeProfileItemSteps(id)
  } finally {
    deletingProfiles.delete(id)
  }
}

function nextCurrentAfter(config: IProfileConfig, removing: string): string | undefined {
  return config.items.find((i) => i.id !== removing && !deletingProfiles.has(i.id))?.id
}

async function removeProfileItemSteps(id: string): Promise<IProfileItem | undefined> {
  const item = (await getProfileConfig()).items.find((i) => i.id === id)
  await removeProfileUpdater(id)

  let removedItem: IProfileItem | undefined
  let repicked = false
  try {
    let switched = false
    await updateProfileConfig((config) => {
      if (config.current === id) {
        switched = true
        config.current = nextCurrentAfter(config, id)
      }
      return config
    })
    if (switched) await restartCore()
    if (existsSync(profilePath(id))) await rm(profilePath(id))
    await removeProfileWorkDir(id)
    await updateProfileConfig((config) => {
      removedItem = config.items?.find((i) => i.id === id)
      config.items = config.items?.filter((i) => i.id !== id)
      // 并发删除可能在我们切走之后又把 current 指回来（对方选 next 时我们还在列表里）：最终一步再核对一次
      if (config.current !== undefined && !config.items.some((i) => i.id === config.current)) {
        config.current = nextCurrentAfter(config, id)
        repicked = true
      }
      return config
    })
  } catch (e) {
    // 记录还在（任何一步失败——配置写入、核心重启、文件 / 工作目录删除）：把定时器装回去，留给用户重试
    if (item) await addProfileUpdater(item)
    throw e
  }
  // 记录已删除：重启失败只需上抛，没有定时器要恢复
  if (repicked) await restartCore()
  return removedItem
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
  ageSecretKey?: string
  authToken?: string
  timeout: number
  substore: boolean
}

interface FetchResult {
  data: string
  headers: Record<string, string>
}

const MAX_TIMER_DELAY_MS = 2_147_483_647
const MAX_PROFILE_INTERVAL_MINUTES = Math.floor(MAX_TIMER_DELAY_MS / (60 * 1000))

function redactSubscriptionUrl(url: string): string {
  try {
    const urlObj = new URL(url)
    if (urlObj.username) urlObj.username = '***'
    if (urlObj.password) urlObj.password = '***'
    if (urlObj.search) urlObj.search = '?***'
    return urlObj.toString()
  } catch {
    return url.includes('?') ? `${url.split('?')[0]}?***` : url
  }
}

function normalizeAxiosHeaders(headers: AxiosResponse['headers']): Record<string, string> {
  const normalized: Record<string, string> = {}
  Object.entries(headers as Record<string, unknown>).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      normalized[key.toLowerCase()] = value.join(', ')
    } else if (value !== undefined) {
      normalized[key.toLowerCase()] = String(value)
    }
  })
  return normalized
}

function parsedProfileSummary(parsed: Record<string, unknown>): string {
  const topKeys = Object.keys(parsed).slice(0, 20)
  const proxies = parsed['proxies']
  const proxyProviders = parsed['proxy-providers']
  const proxyCount = Array.isArray(proxies) ? proxies.length : undefined
  const providerCount =
    proxyProviders && typeof proxyProviders === 'object'
      ? Object.keys(proxyProviders).length
      : undefined

  return JSON.stringify({
    topKeys,
    hasProxies: Boolean(proxies),
    hasProxyProviders: Boolean(proxyProviders),
    proxyCount,
    providerCount
  })
}

async function fetchAndValidateSubscription(options: FetchOptions): Promise<FetchResult> {
  const { url, useProxy, mixedPort, userAgent, authToken, timeout, substore } = options
  const redactedUrl = redactSubscriptionUrl(url)
  const fetchMode = substore ? 'substore' : useProxy ? 'proxy' : 'direct'

  const headers: Record<string, string> = {
    'User-Agent': userAgent,
    'Accept-Encoding': 'identity'
  }
  if (authToken) headers['Authorization'] = authToken

  await profileLogger.info(
    `Fetching remote profile url=${redactedUrl} mode=${fetchMode} timeout=${timeout}ms auth=${authToken ? 'yes' : 'no'}`
  )

  let requestUrl = url
  let proxy:
    | {
        protocol: 'http'
        host: string
        port: number
      }
    | false = false

  if (substore) {
    const urlObj = new URL(`http://127.0.0.1:${subStorePort}${url}`)
    urlObj.searchParams.set('target', 'ClashMeta')
    urlObj.searchParams.set('noCache', 'true')
    if (useProxy && mixedPort !== 0) {
      urlObj.searchParams.set('proxy', `http://127.0.0.1:${mixedPort}`)
    }
    requestUrl = urlObj.toString()
  } else if (useProxy && mixedPort !== 0) {
    proxy = { protocol: 'http', host: '127.0.0.1', port: mixedPort }
  }

  let res: AxiosResponse<string>
  try {
    res = await axios.get<string>(requestUrl, {
      headers,
      responseType: 'text',
      timeout,
      proxy,
      validateStatus: () => true,
      transformResponse: [(data) => data]
    })
  } catch (error) {
    await profileLogger.warn(
      `Remote profile request failed url=${redactedUrl} mode=${fetchMode}`,
      error
    )
    throw error
  }

  const data = typeof res.data === 'string' ? res.data : String(res.data ?? '')
  const responseHeaders = normalizeAxiosHeaders(res.headers)

  await profileLogger.info(
    `Remote profile response url=${redactedUrl} mode=${fetchMode} status=${res.status} contentType=${String(
      responseHeaders['content-type'] || ''
    )} bytes=${Buffer.byteLength(data, 'utf8')}`
  )

  if (res.status < 200 || res.status >= 300) {
    await profileLogger.warn(
      `Remote profile request rejected url=${redactedUrl} mode=${fetchMode} status=${res.status}`
    )
    throw new Error(`Subscription failed: Request status code ${res.status}`)
  }

  const decryptedData = await decryptAgeContent(data, options.ageSecretKey, 'subscription')
  const parsed = parse(decryptedData) as Record<string, unknown> | null
  if (typeof parsed !== 'object' || parsed === null) {
    await profileLogger.warn(
      `Remote profile parse failed url=${redactedUrl} mode=${fetchMode} parsedType=${typeof parsed}`
    )
    throw new Error('Subscription failed: Profile is not a valid YAML')
  }
  await profileLogger.info(
    `Remote profile parsed url=${redactedUrl} mode=${fetchMode} summary=${parsedProfileSummary(parsed)}`
  )
  if (!parsed['proxies'] && !parsed['proxy-providers']) {
    await profileLogger.warn(
      `Remote profile validation failed url=${redactedUrl} mode=${fetchMode} reason=missing-proxies-or-providers summary=${parsedProfileSummary(
        parsed
      )}`
    )
    throw new Error('Subscription failed: Profile missing proxies or providers')
  }

  return { data, headers: responseHeaders }
}

export async function createProfile(item: Partial<IProfileItem>): Promise<IProfileItem> {
  const id = item.id || new Date().getTime().toString(16)
  // 手输的订阅链接常带上首尾空白（中文输入法下还可能是全角空格），
  // 这类字符不会被 URL 解析器忽略，会让请求直接以 Invalid URL 失败，
  // 并且原样存进配置，之后每次自动更新都失败。存之前统一去掉。
  const url = typeof item.url === 'string' ? item.url.trim() : item.url
  const newItem: IProfileItem = {
    id,
    name: item.name || (item.type === 'remote' ? 'Remote File' : 'Local File'),
    type: item.type || 'local',
    url,
    substore: item.substore || false,
    interval: item.interval || 0,
    override: item.override || [],
    useProxy: item.useProxy || false,
    allowFixedInterval: item.allowFixedInterval || false,
    autoUpdate: item.autoUpdate ?? true,
    authToken: item.authToken,
    userAgent: item.userAgent,
    ageSecretKey: item.ageSecretKey,
    updated: new Date().getTime(),
    updateTimeout: item.updateTimeout
  }

  // Local
  if (newItem.type === 'local') {
    await setProfileStr(id, item.file || '')
    return newItem
  }

  // Remote
  if (!url) throw new Error('Empty URL')

  const profileUrl = url
  await profileLogger.info(
    `Creating/updating remote profile id=${id} name=${newItem.name} url=${redactSubscriptionUrl(
      profileUrl
    )} useProxy=${newItem.useProxy} substore=${newItem.substore}`
  )
  const dedupKey = `${id}::${profileUrl}`
  const existing = inflightRemoteFetches.get(dedupKey)
  if (existing) {
    await profileLogger.info(
      `Remote profile fetch deduplicated id=${id} url=${redactSubscriptionUrl(profileUrl)}`
    )
    return existing
  }

  const promise = (async (): Promise<IProfileItem> => {
    const { userAgent, subscriptionTimeout = 30000 } = await getAppConfig()
    const { 'mixed-port': mixedPort = DEFAULT_MIHOMO_PORTS.mixed } =
      await getControledMihomoConfig()
    const userItemTimeoutMs =
      typeof newItem.updateTimeout === 'number' && newItem.updateTimeout > 0
        ? newItem.updateTimeout * 1000
        : subscriptionTimeout

    const baseOptions: Omit<FetchOptions, 'useProxy' | 'timeout'> = {
      url: profileUrl,
      mixedPort,
      userAgent: item.userAgent || userAgent || `mihomo.party/v${app.getVersion()} (clash.meta)`,
      ageSecretKey: newItem.ageSecretKey,
      authToken: item.authToken,
      substore: newItem.substore || false
    }

    const fetchSub = (useProxy: boolean, timeout: number): Promise<FetchResult> =>
      fetchAndValidateSubscription({ ...baseOptions, useProxy, timeout })

    let result: FetchResult
    if (newItem.useProxy || newItem.substore) {
      result = await fetchSub(Boolean(newItem.useProxy), userItemTimeoutMs)
    } else {
      try {
        result = await fetchSub(false, userItemTimeoutMs)
      } catch (directError) {
        await profileLogger.warn(
          `Direct remote profile fetch failed id=${id} url=${redactSubscriptionUrl(
            profileUrl
          )}; trying proxy fallback`,
          directError
        )
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
      const hours = Number(headers['profile-update-interval'])
      if (Number.isFinite(hours) && hours > 0) {
        newItem.interval = Math.min(Math.ceil(hours * 60), MAX_PROFILE_INTERVAL_MINUTES)
      }
    }
    if (headers['subscription-userinfo']) {
      newItem.extra = parseSubinfo(headers['subscription-userinfo'])
    }

    await validateProfileCandidate(newItem, data)
    await setProfileStr(id, data)
    await profileLogger.info(
      `Remote profile saved id=${id} name=${newItem.name} path=${profilePath(
        id
      )} bytes=${Buffer.byteLength(data || '', 'utf8')}`
    )
    return newItem
  })()

  inflightRemoteFetches.set(dedupKey, promise)
  try {
    return await promise
  } finally {
    inflightRemoteFetches.delete(dedupKey)
  }
}

// 候选校验：把新内容放进临时目录，生成带 override 的完整运行配置，再交核心 `-t` 校验。远程订阅与插件订阅
// 共用；失败抛错，调用方保留旧文件。
export async function validateProfileCandidate(
  item: IProfileItem,
  content: string,
  opts: CheckProfileOptions & { globalOverrideIds?: string[] } = {}
): Promise<void> {
  const candidateDir = await mkdtemp(join(tmpdir(), 'mihomo-party-profile-'))
  const candidatePath = join(candidateDir, 'config.yaml')

  try {
    const { core = 'mihomo' } = await getAppConfig()
    const baseProfile = await parseProfileContent(item.id, content, item.ageSecretKey)
    await generateProfile(undefined, {
      profileId: item.id,
      baseProfile,
      ageSecretKey: item.ageSecretKey,
      profileOverrideIds: item.override ?? [],
      globalOverrideIds: opts.globalOverrideIds,
      outputPath: candidatePath,
      updateRuntimeConfig: false
    })
    await checkProfileConfig(candidatePath, core, item.ageSecretKey, opts)
  } finally {
    await rm(candidateDir, { recursive: true, force: true }).catch(() => {})
  }
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
  // 内容没变就不要热重载：内核的 ApplyConfig 会 OnSuspend 整条隧道、重载 DNS 与外部资源、
  // 最后 ResetConnection，代价是一次真实的断流。订阅定时刷新经常拉回一模一样的文件
  // （机场用 profile-update-interval 头指定间隔，半小时的很常见），
  // 那种情况下重载纯属白白断网一次。
  if (existsSync(profilePath(id))) {
    try {
      if ((await readFile(profilePath(id), 'utf-8')) === content) {
        profileLogger.info(`Profile ${id} unchanged, skipping reload`)
        return
      }
    } catch (error) {
      profileLogger.warn(`Failed to compare profile ${id} with the stored one`, error)
    }
  }
  await atomicWriteFile(profilePath(id), content, { encoding: 'utf8' })
  if (current === id) await reloadCurrentProfile()
}

// 当前订阅的内容已替换：热加载，失败则回退到重启核心
async function reloadCurrentProfile(): Promise<void> {
  try {
    await mihomoHotReloadConfig()
    profileLogger.info('Config reloaded successfully')
  } catch (error) {
    profileLogger.error('Failed to reload config', error)
    try {
      profileLogger.info('Falling back to restart core')
      await restartCore()
      profileLogger.info('Core restarted successfully')
    } catch (restartError) {
      profileLogger.error('Failed to restart core', restartError)
      throw restartError
    }
  }
}

export async function getProfile(id: string | undefined): Promise<IMihomoConfig> {
  const item = await getProfileItem(id)
  return await parseProfileContent(id, await getProfileStr(id), item?.ageSecretKey)
}

export async function parseProfileContent(
  id: string | undefined,
  content: string,
  ageSecretKey?: string
): Promise<IMihomoConfig> {
  const profile = await decryptAgeContent(content, ageSecretKey, `profile "${id || 'default'}"`)

  // 检测是否为 HTML 内容（订阅返回错误页面）；HTML 标签大小写不敏感，逐个大小写变体列不完
  const trimmed = profile.trim()
  if (
    /^<!doctype/i.test(trimmed) ||
    /^<html/i.test(trimmed) ||
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
    await atomicWriteFile(path, content, { encoding: 'utf8' })
  } else {
    await atomicWriteFile(
      join(diffWorkDir ? mihomoProfileWorkDir(current) : mihomoWorkDir(), path),
      content,
      { encoding: 'utf8' }
    )
  }
}

const MRS_RULESET_BEHAVIORS = ['domain', 'ipcidr', 'classical'] as const

export async function convertMrsRuleset(filePath: string, behavior: string): Promise<string> {
  // behavior 来自订阅下发的 rule-providers，属于不可信输入，只接受内核支持的固定取值
  if (!(MRS_RULESET_BEHAVIORS as readonly string[]).includes(behavior)) {
    throw new Error(`Unsupported ruleset behavior: ${behavior}`)
  }

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
    // 命令格式：mihomo convert-ruleset <behavior> <format> <source>
    // 用 execFile 传参数数组，避免 behavior / 路径经过 shell 解析导致命令注入
    await execFilePromise(corePath, ['convert-ruleset', behavior, 'mrs', fullPath, tempFilePath])
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

// 插件订阅内容未通过核心校验：与磁盘写入失败区分开，调用方按"服务端给了坏配置"的瞬时失败处理，
// 保留旧订阅。用 code 而不是 class 身份识别，模块被 mock 时依然可判。
export const PLUGIN_PROFILE_INVALID = 'PLUGIN_PROFILE_INVALID'
export class PluginProfileInvalidError extends Error {
  code = PLUGIN_PROFILE_INVALID
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause))
    this.name = 'PluginProfileInvalidError'
  }
}
export function isPluginProfileInvalidError(e: unknown): boolean {
  return (
    typeof e === 'object' && e !== null && (e as { code?: unknown }).code === PLUGIN_PROFILE_INVALID
  )
}

// 插件 profile：内容已由 plugin 网关取得，这里只写内容 + 维护 profile item，不走远程 URL 下载。
// 写入前与远程订阅一样先跑候选校验（含用户 override 与核心 -t）：结构合法但语义非法的内容不得覆盖仍可用的旧订阅。
// 核心校验子进程的硬上限：即便调用方没有预算 signal，一次 `-t` 也不能无限期占住插件锁
const PLUGIN_PROFILE_CHECK_TIMEOUT_MS = 60_000

// 一次校验只覆盖当时参与生成运行配置的 override 集合（profile 自己的 override 列表 + 全局 override）。
// 全局集合由这里读一次并原样传给 generateProfile，键与校验所用集合按构造一致；落盘前在 profile 写队列内
// 重新推导同一集合核对，变了就按新集合重新校验（有界），保证写下的"内容 + override"组合经过校验。
// override 文件内容本身的编辑不在此列（与远程订阅一致）。
function overrideSetKey(item: IProfileItem | undefined, globalIds: string[]): string {
  return JSON.stringify({ own: item?.override ?? [], global: globalIds })
}

const MAX_PLUGIN_PROFILE_REVALIDATIONS = 2

class OverrideChangedError extends Error {}

export async function upsertPluginProfile(
  meta: { profileId: string; pluginId: string; name: string },
  content: string,
  signal?: AbortSignal
): Promise<void> {
  // 插件拥有的字段；用户在 profile 上设置的其它字段（override 等）不属于这里，写回时不得带入旧快照。
  // 调度字段（interval / autoUpdate）不在这里：它们在写入时从插件记录现读，见 commitPluginProfile
  const owned = {
    id: meta.profileId,
    type: 'plugin' as const,
    name: meta.name,
    pluginId: meta.pluginId,
    updated: Date.now()
  }
  for (let attempt = 0; ; attempt++) {
    // 校验用当前快照里的 override（与运行时一致）
    const snapshot = await getProfileItem(meta.profileId)
    const candidate: IProfileItem = { ...snapshot, ...owned }
    const globalIds = await globalOverrideIdsNow()
    const validatedKey = overrideSetKey(candidate, globalIds)
    try {
      await validateProfileCandidate(candidate, content, {
        signal,
        timeoutMs: PLUGIN_PROFILE_CHECK_TIMEOUT_MS,
        globalOverrideIds: globalIds
      })
    } catch (e) {
      throw new PluginProfileInvalidError(e)
    }
    try {
      await commitPluginProfile(meta, owned, content, validatedKey, signal)
      return
    } catch (e) {
      if (!(e instanceof OverrideChangedError)) throw e
      // 校验期间 override 集合变了：按新集合再校验一次；一直在变就放弃本次，旧订阅原样保留
      if (attempt >= MAX_PLUGIN_PROFILE_REVALIDATIONS) throw new PluginProfileInvalidError(e)
    }
  }
}

// 落盘（profile 写队列内，同一临界区）：核对 override 集合 → 查预算 → 写订阅文件 → 更新 item。
// 订阅文件一旦写下，item 写入必须完成（§0.4 唯一的持久化提交；半截提交比迟到的提交更糟）。
async function commitPluginProfile(
  meta: { profileId: string; pluginId: string; name: string },
  owned: IProfileItem,
  content: string,
  validatedKey: string,
  signal?: AbortSignal
): Promise<void> {
  let isNew = false
  let scheduleChanged = false
  let wasCurrent = false
  let hadCurrent = true
  // 是否已进入临界区：只有排队等待期间的中止才按预算失败处理；进入之后的任何错误都是真实的提交错误
  let entered = false
  const commit = updateProfileConfig(async (config) => {
    entered = true
    const idx = config.items.findIndex((i) => i.id === meta.profileId)
    const current = idx === -1 ? undefined : config.items[idx]
    if (overrideSetKey(current, await globalOverrideIdsNow()) !== validatedKey) {
      throw new OverrideChangedError('profile override changed during validation')
    }
    // 写入边界：校验通过后到这里（清理临时目录、读取配置）预算也可能耗尽；下面是第一处落盘，之前最后一次查 signal
    if (signal?.aborted) throw new PluginProfileInvalidError(signal.reason)
    await atomicWriteFile(profilePath(meta.profileId), content, { encoding: 'utf8' })
    // 调度字段在写队列内从插件记录现读（不是 op 开始时的旧快照）：用户在校验期间切换的自动更新要么已被读到，
    // 要么其 syncPluginProfileSchedule 排在本次写入之后覆盖，不会被拉取回退
    const schedule = pluginSchedule(await getPluginItem(meta.pluginId))
    if (!current) {
      isNew = true
      config.items.push({ ...owned, ...schedule })
    } else {
      scheduleChanged =
        current.interval !== schedule.interval || current.autoUpdate !== schedule.autoUpdate
      config.items[idx] = { ...current, ...owned, ...schedule }
    }
    wasCurrent = config.current === meta.profileId
    hadCurrent = !!config.current
    return config
  }, signal)
  try {
    await commit
  } catch (e) {
    // 排队等待期间预算耗尽（还没进临界区、什么都没写）：与校验阶段中止同一条路径（R2-ISS-065）。
    // 已进入临界区后的错误（如 profile.yaml 写入失败）原样抛出，即使此时预算恰好也耗尽了
    if (!entered && signal?.aborted) throw new PluginProfileInvalidError(signal.reason)
    throw e
  }
  // 新建，或调度字段相对写入时的现值有变化（插件记录里改了 interval / autoUpdate 之后的下一次拉取）→ 重建定时器。
  // 先于下面的核心加载：item 与调度已经落盘，加载失败也不能把定时器漏掉——重试时 item 已存在、调度未变，不会再走到这里
  if (isNew || scheduleChanged) {
    const saved = await getProfileItem(meta.profileId)
    if (saved) await addProfileUpdater(saved)
  }
  if (wasCurrent) {
    // 当前订阅的内容变了：热加载（失败则重启核心）
    await reloadCurrentProfile()
  } else if (!hadCurrent) {
    // 还没有当前订阅（例如删光后安装插件）：走正式切换流程让核心真正加载它——只写 current 不会加载，
    // 而且 changeCurrentProfile 遇到已相同的 current 会直接返回
    await changeCurrentProfile(meta.profileId)
  }
}

// 插件设置里改了自动更新 / 间隔：同步到关联的 profile item 并重建定时器（调度以 profile item 为准）。
// autoUpdate 为 false 时 addProfileUpdater 只拆不装，定时器随之停止。
// 写入只合并调度字段（不带旧快照），并且总是重建定时器：多次并发切换按 profile 写队列的顺序落盘，
// 最后一次写入者的值最终生效并被装上——不能凭可能过期的缓存判断"无变化"而跳过。
export async function syncPluginProfileSchedule(
  profileId: string,
  schedule: { interval?: number; autoUpdate?: boolean }
): Promise<void> {
  let saved: IProfileItem | undefined
  await updateProfileConfig((config) => {
    const idx = config.items.findIndex((i) => i.id === profileId)
    if (idx === -1 || config.items[idx].type !== 'plugin') return config
    config.items[idx] = {
      ...config.items[idx],
      ...(schedule.interval !== undefined ? { interval: schedule.interval } : {}),
      ...(schedule.autoUpdate !== undefined ? { autoUpdate: schedule.autoUpdate } : {})
    }
    saved = config.items[idx]
    return config
  })
  if (saved) await addProfileUpdater(saved)
}

// 由插件删除临界区调用：只删 profile，不再级联回插件（调用方已持有 plugin lock）。
export async function removePluginProfileContent(profileId: string): Promise<void> {
  await removeProfileItemCore(profileId)
}
