import { getControledMihomoConfig } from './controledMihomo'
import { mihomoProfileWorkDir, mihomoWorkDir, profileConfigPath, profilePath } from '../utils/dirs'
import { addProfileUpdater, removeProfileUpdater } from '../core/profileUpdater'
import { readFile, rm, writeFile } from 'fs/promises'
import { restartCore } from '../core/manager'
import { getAppConfig } from './app'
import { existsSync } from 'fs'
import * as chromeRequest from '../utils/chromeRequest'
import { parse, stringify } from '../utils/yaml'
import { defaultProfile } from '../utils/template'
import { subStorePort } from '../resolve/server'
import { join } from 'path'
import { app } from 'electron'
import { mihomoUpgradeConfig } from '../core/mihomoApi'

let profileConfig: IProfileConfig // profile.yaml
// 最终选中订阅ID
let targetProfileId: string | null = null

export async function getProfileConfig(force = false): Promise<IProfileConfig> {
  if (force || !profileConfig) {
    const data = await readFile(profileConfigPath(), 'utf-8')
    profileConfig = parse(data) || { items: [] }
  }
  if (typeof profileConfig !== 'object') profileConfig = { items: [] }
  return profileConfig
}

export async function setProfileConfig(config: IProfileConfig): Promise<void> {
  profileConfig = config
  await writeFile(profileConfigPath(), stringify(config), 'utf-8')
}

export async function getProfileItem(id: string | undefined): Promise<IProfileItem | undefined> {
  const { items } = await getProfileConfig()
  if (!id || id === 'default') return { id: 'default', type: 'local', name: '空白订阅' }
  return items.find((item) => item.id === id)
}

export async function changeCurrentProfile(id: string): Promise<void> {
  const config = await getProfileConfig()
  const current = config.current

  if (current === id && targetProfileId !== id) {
    return
  }

  targetProfileId = id

  config.current = id
  const configSavePromise = setProfileConfig(config)

  try {
    await configSavePromise

    // 检查订阅切换是否中断
    if (targetProfileId !== id) {
      return
    }
    await restartCore()
    if (targetProfileId === id) {
      targetProfileId = null
    }
  } catch (e) {
    if (targetProfileId === id) {
      config.current = current
      await setProfileConfig(config)
      targetProfileId = null
      throw e
    }
  }
}

export async function updateProfileItem(item: IProfileItem): Promise<void> {
  const config = await getProfileConfig()
  const index = config.items.findIndex((i) => i.id === item.id)
  if (index === -1) {
    throw new Error('Profile not found')
  }
  config.items[index] = item
  await setProfileConfig(config)
}

export async function addProfileItem(item: Partial<IProfileItem>): Promise<void> {
  const newItem = await createProfile(item)
  const config = await getProfileConfig()
  if (await getProfileItem(newItem.id)) {
    await updateProfileItem(newItem)
  } else {
    config.items.push(newItem)
  }
  await setProfileConfig(config)

  if (!config.current) {
    await changeCurrentProfile(newItem.id)
  }
  await addProfileUpdater(newItem)
}

export async function removeProfileItem(id: string): Promise<void> {
  // 先清理自动更新定时器，防止已删除的订阅重新出现
  await removeProfileUpdater(id)
  
  const config = await getProfileConfig()
  config.items = config.items?.filter((item) => item.id !== id)
  let shouldRestart = false
  if (config.current === id) {
    shouldRestart = true
    if (config.items.length > 0) {
      config.current = config.items[0].id
    } else {
      config.current = undefined
    }
  }
  await setProfileConfig(config)
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
  return (await getProfileItem(current)) || { id: 'default', type: 'local', name: '空白订阅' }
}

export async function createProfile(item: Partial<IProfileItem>): Promise<IProfileItem> {
  const id = item.id || new Date().getTime().toString(16)
  const newItem = {
    id,
    name: item.name || (item.type === 'remote' ? 'Remote File' : 'Local File'),
    type: item.type,
    url: item.url,
    substore: item.substore || false,
    interval: item.interval || 0,
    override: item.override || [],
    useProxy: item.useProxy || false,
    allowFixedInterval: item.allowFixedInterval || false,
    updated: new Date().getTime()
  } as IProfileItem
  switch (newItem.type) {
    case 'remote': {
      const { userAgent, subscriptionTimeout = 30000 } = await getAppConfig()
      const { 'mixed-port': mixedPort = 7890 } = await getControledMihomoConfig()
      if (!item.url) throw new Error('Empty URL')
      let res: chromeRequest.Response<string>
      if (newItem.substore) {
        const urlObj = new URL(`http://127.0.0.1:${subStorePort}${item.url}`)
        urlObj.searchParams.set('target', 'ClashMeta')
        urlObj.searchParams.set('noCache', 'true')
        if (newItem.useProxy) {
          urlObj.searchParams.set('proxy', `http://127.0.0.1:${mixedPort}`)
        } else {
          urlObj.searchParams.delete('proxy')
        }
        res = await chromeRequest.get(urlObj.toString(), {
          headers: {
            'User-Agent': userAgent || `mihomo.party/v${app.getVersion()} (clash.meta)`
          },
          responseType: 'text',
          timeout: subscriptionTimeout
        })
      } else {
        res = await chromeRequest.get(item.url, {
          proxy: newItem.useProxy
            ? {
                protocol: 'http',
                host: '127.0.0.1',
                port: mixedPort
              }
            : false,
          headers: {
            'User-Agent': userAgent || `mihomo.party/v${app.getVersion()} (clash.meta)`
          },
          responseType: 'text',
          timeout: subscriptionTimeout
        })
      }

      const data = res.data
      const headers = res.headers
      if (headers['content-disposition'] && newItem.name === 'Remote File') {
        newItem.name = parseFilename(headers['content-disposition'])
      }
      if (headers['profile-web-page-url']) {
        newItem.home = headers['profile-web-page-url']
      }
      if (headers['profile-update-interval']) {
        if (!item.allowFixedInterval) {
          newItem.interval = parseInt(headers['profile-update-interval']) * 60
        }
      }
      if (headers['subscription-userinfo']) {
        newItem.extra = parseSubinfo(headers['subscription-userinfo'])
      }
      await setProfileStr(id, data)
      break
    }
    case 'local': {
      const data = item.file || ''
      await setProfileStr(id, data)
      break
    }
  }
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
      console.log('[Profile] Config reloaded successfully using mihomoUpgradeConfig')
    } catch (error) {
      console.error('[Profile] Failed to reload config with mihomoUpgradeConfig:', error)
      try {
        console.log('[Profile] Falling back to restart core')
        const { restartCore } = await import('../core/manager')
        await restartCore()
        console.log('[Profile] Core restarted successfully')
      } catch (restartError) {
        console.error('[Profile] Failed to restart core:', restartError)
        throw restartError
      }
    }
  }
}

export async function getProfile(id: string | undefined): Promise<IMihomoConfig> {
  const profile = await getProfileStr(id)
  let result = parse(profile)
  if (typeof result !== 'object') result = {}
  return result as IMihomoConfig
}

// attachment;filename=xxx.yaml; filename*=UTF-8''%xx%xx%xx
function parseFilename(str: string): string {
  if (str.match(/filename\*=.*''/)) {
    const filename = decodeURIComponent(str.split(/filename\*=.*''/)[1])
    return filename
  } else {
    const filename = str.split('filename=')[1]
    return filename
  }
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
