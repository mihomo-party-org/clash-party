import { createConnection } from 'net'
import axios, { AxiosInstance } from 'axios'
import WebSocket from 'ws'
import { app } from 'electron'
import { getAppConfig, getControledMihomoConfig } from '../config'
import { mainWindow } from '../window'
import { tray } from '../resolve/tray'
import { calcTraffic } from '../utils/calc'
import { floatingWindow } from '../resolve/floatingWindow'
import { createLogger } from '../utils/logger'
import { mihomoWorkConfigPath } from '../utils/dirs'
import { generateProfile, getRuntimeConfig } from './factory'
import { getMihomoIpcPath, hasCoreProcess, restartCore } from './manager'

const mihomoApiLogger = createLogger('MihomoApi')

let axiosIns: AxiosInstance | null = null
let currentIpcPath: string = ''

const MAX_RETRY = 10
const RECONNECT_INTERVAL_MS = 1000

interface MihomoStreamState {
  ws: WebSocket | null
  retry: number
  active: boolean
  generation: number
  reconnectTimer: NodeJS.Timeout | null
}

const trafficStream: MihomoStreamState = {
  ws: null,
  retry: MAX_RETRY,
  active: false,
  generation: 0,
  reconnectTimer: null
}
const memoryStream: MihomoStreamState = {
  ws: null,
  retry: MAX_RETRY,
  active: false,
  generation: 0,
  reconnectTimer: null
}
const logsStream: MihomoStreamState = {
  ws: null,
  retry: MAX_RETRY,
  active: false,
  generation: 0,
  reconnectTimer: null
}
// Renderer demand survives core restarts; page unmount is responsible for clearing it.
let logsRequestedByRenderer = false
const connectionsStream: MihomoStreamState = {
  ws: null,
  retry: MAX_RETRY,
  active: false,
  generation: 0,
  reconnectTimer: null
}

function clearStreamReconnect(stream: MihomoStreamState): void {
  if (!stream.reconnectTimer) return
  clearTimeout(stream.reconnectTimer)
  stream.reconnectTimer = null
}

function disposeStreamSocket(ws: WebSocket): void {
  ws.onmessage = null
  ws.onclose = null
  ws.onerror = null
  ws.removeAllListeners()

  if (ws.readyState === WebSocket.OPEN) {
    ws.close()
  } else if (ws.readyState === WebSocket.CONNECTING) {
    ws.terminate()
  }
}

function activateStream(stream: MihomoStreamState): void {
  stream.active = true
  stream.retry = MAX_RETRY
  clearStreamReconnect(stream)
}

function stopStream(stream: MihomoStreamState): void {
  stream.active = false
  stream.retry = 0
  stream.generation++
  clearStreamReconnect(stream)

  const ws = stream.ws
  stream.ws = null
  if (ws) {
    disposeStreamSocket(ws)
  }
}

function beginStreamConnection(stream: MihomoStreamState): number | null {
  if (!stream.active) return null

  stream.generation++
  clearStreamReconnect(stream)

  const ws = stream.ws
  stream.ws = null
  if (ws) {
    disposeStreamSocket(ws)
  }

  return stream.generation
}

function isCurrentStream(stream: MihomoStreamState, generation: number): boolean {
  return stream.active && stream.generation === generation
}

function scheduleStreamReconnect(
  stream: MihomoStreamState,
  generation: number,
  connect: () => Promise<void>
): void {
  if (!isCurrentStream(stream, generation) || stream.retry <= 0) return

  stream.retry--
  clearStreamReconnect(stream)
  stream.reconnectTimer = setTimeout(() => {
    stream.reconnectTimer = null
    if (isCurrentStream(stream, generation)) {
      void connect()
    }
  }, RECONNECT_INTERVAL_MS)
}

function closeErroredStreamSocket(
  stream: MihomoStreamState,
  generation: number,
  ws: WebSocket
): void {
  if (!isCurrentStream(stream, generation)) return

  if (ws.readyState === WebSocket.OPEN) {
    ws.close()
  } else if (ws.readyState === WebSocket.CONNECTING) {
    ws.terminate()
  }
}

function createMihomoWebSocket(endpoint: string): {
  ws: WebSocket
  ipcPath: string
  wsUrl: string
} {
  const ipcPath = getMihomoIpcPath()
  const wsUrl = `ws://localhost${endpoint}`

  // Keep the named pipe path out of ws+unix URLs. URL parsing percent-encodes
  // non-ASCII Windows usernames, which changes the pipe name before ws connects.
  const createIpcConnection = (() => createConnection({ path: ipcPath })) as typeof createConnection

  return {
    ws: new WebSocket(wsUrl, { createConnection: createIpcConnection }),
    ipcPath,
    wsUrl
  }
}

export const getAxios = async (force: boolean = false): Promise<AxiosInstance> => {
  const dynamicIpcPath = getMihomoIpcPath()

  if (axiosIns && !force && currentIpcPath === dynamicIpcPath) {
    return axiosIns
  }

  currentIpcPath = dynamicIpcPath
  mihomoApiLogger.info(`Creating axios instance with path: ${dynamicIpcPath}`)

  axiosIns = axios.create({
    baseURL: `http://localhost`,
    socketPath: dynamicIpcPath,
    timeout: 15000
  })

  axiosIns.interceptors.response.use(
    (response) => {
      return response.data
    },
    (error) => {
      if (error.code === 'ENOENT') {
        mihomoApiLogger.debug(`Pipe not ready: ${error.config?.socketPath}`)
      } else {
        mihomoApiLogger.error(`Axios error with path ${dynamicIpcPath}: ${error.message}`)
      }

      if (error.response && error.response.data) {
        return Promise.reject(error.response.data)
      }
      return Promise.reject(error)
    }
  )
  return axiosIns
}

export async function mihomoVersion(): Promise<IMihomoVersion> {
  const instance = await getAxios()
  return await instance.get('/version')
}

export const patchMihomoConfig = async (patch: Partial<IMihomoConfig>): Promise<void> => {
  const patchConfig = async (): Promise<void> => {
    const instance = await getAxios()
    await instance.patch('/configs', patch)
  }

  // Configuration patches can also be the first recovery action after startup
  // failed. Do not start the core during pre-ready migrations.
  if (!hasCoreProcess() && app.isReady()) {
    mihomoApiLogger.warn('Core is not running, restarting core before config patch')
    await restartCore()
  }

  try {
    await patchConfig()
  } catch (error) {
    if (hasCoreProcess() || !app.isReady()) throw error

    mihomoApiLogger.warn('Core exited before config patch completed, restarting core', error)
    await restartCore()
    await patchConfig()
  }
}

export const mihomoCloseConnection = async (id: string): Promise<void> => {
  const instance = await getAxios()
  return await instance.delete(`/connections/${encodeURIComponent(id)}`)
}

export const mihomoCloseAllConnections = async (): Promise<void> => {
  const instance = await getAxios()
  return await instance.delete('/connections')
}

export const mihomoRules = async (): Promise<IMihomoRulesInfo> => {
  const instance = await getAxios()
  return await instance.get('/rules')
}

export const mihomoRulesDisable = async (rules: Record<string, boolean>): Promise<void> => {
  const instance = await getAxios()
  return await instance.patch('/rules/disable', rules)
}

export const mihomoProxies = async (): Promise<IMihomoProxies> => {
  const instance = await getAxios()
  const proxies = (await instance.get('/proxies')) as IMihomoProxies
  if (!proxies.proxies['GLOBAL']) {
    throw new Error('GLOBAL proxy not found')
  }
  return proxies
}

function isMihomoGroup(proxy: IMihomoProxy | IMihomoGroup | undefined): proxy is IMihomoGroup {
  return Boolean(proxy && 'all' in proxy)
}

const PROVIDER_DETAIL_FETCH_THRESHOLD = 8

async function mihomoProxyProvider(name: string): Promise<IMihomoProxyProvider> {
  const instance = await getAxios()
  return await instance.get(`/providers/proxies/${encodeURIComponent(name)}`)
}

async function resolveProviderProxies(
  names: Set<string>,
  providerNames: Set<string>,
  fallbackToAllProviders: boolean
): Promise<Record<string, IMihomoProxy>> {
  if (names.size === 0) return {}

  const providers =
    fallbackToAllProviders || providerNames.size > PROVIDER_DETAIL_FETCH_THRESHOLD
      ? Object.values((await mihomoProxyProviders()).providers)
      : (
          await Promise.allSettled([...providerNames].map((name) => mihomoProxyProvider(name)))
        ).flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))

  const providerProxies: Record<string, IMihomoProxy> = {}
  providers.forEach((provider) => {
    provider.proxies?.forEach((proxy) => {
      if (names.has(proxy.name)) {
        providerProxies[proxy.name] = proxy
      }
    })
  })
  return providerProxies
}

export const mihomoGroups = async (includeHidden = false): Promise<IMihomoMixedGroup[]> => {
  const { mode = 'rule' } = await getControledMihomoConfig()
  if (mode === 'direct') return []
  const [proxies, runtime] = await Promise.all([mihomoProxies(), getRuntimeConfig()])
  const rawGroups: { group: IMihomoGroup; providers: string[] }[] = []

  runtime?.['proxy-groups']?.forEach((group: { name: string; url?: string; use?: string[] }) => {
    const proxy = proxies.proxies[group.name]
    if (isMihomoGroup(proxy) && (includeHidden || !proxy.hidden)) {
      rawGroups.push({ group: { ...proxy, testUrl: group.url }, providers: group.use || [] })
    }
  })

  if (!rawGroups.find(({ group }) => group.name === 'GLOBAL')) {
    const global = proxies.proxies['GLOBAL']
    if (isMihomoGroup(global) && (includeHidden || !global.hidden)) {
      rawGroups.push({ group: global, providers: [] })
    }
  }

  const missingProxyNames = new Set<string>()
  const providerNames = new Set<string>()
  let fallbackToAllProviders = false
  rawGroups.forEach(({ group, providers }) => {
    const proxyNames = group.all || []
    proxyNames.forEach((name) => {
      if (!proxies.proxies[name]) {
        missingProxyNames.add(name)
        if (providers.length > 0) {
          providers.forEach((provider) => providerNames.add(provider))
        } else {
          fallbackToAllProviders = true
        }
      }
    })
  })

  const providerProxies = await resolveProviderProxies(
    missingProxyNames,
    providerNames,
    fallbackToAllProviders
  )
  const groups: IMihomoMixedGroup[] = []
  rawGroups.forEach(({ group }) => {
    const newAll = (group.all || [])
      .map((name) => proxies.proxies[name] || providerProxies[name])
      .filter((proxy): proxy is IMihomoProxy | IMihomoGroup => Boolean(proxy))
    groups.push({ ...group, all: newAll })
  })

  if (mode === 'global') {
    const global = groups.findIndex((group) => group.name === 'GLOBAL')
    if (global > 0) groups.unshift(groups.splice(global, 1)[0])
  }
  return groups
}

export const mihomoProxyProviders = async (): Promise<IMihomoProxyProviders> => {
  const instance = await getAxios()
  return await instance.get('/providers/proxies')
}

export const mihomoUpdateProxyProviders = async (name: string): Promise<void> => {
  const instance = await getAxios()
  return await instance.put(`/providers/proxies/${encodeURIComponent(name)}`)
}

export const mihomoRuleProviders = async (): Promise<IMihomoRuleProviders> => {
  const instance = await getAxios()
  return await instance.get('/providers/rules')
}

export const mihomoUpdateRuleProviders = async (name: string): Promise<void> => {
  const instance = await getAxios()
  return await instance.put(`/providers/rules/${encodeURIComponent(name)}`)
}

export const mihomoChangeProxy = async (group: string, proxy: string): Promise<IMihomoProxy> => {
  const instance = await getAxios()
  return await instance.put(`/proxies/${encodeURIComponent(group)}`, { name: proxy })
}

export const mihomoUnfixedProxy = async (group: string): Promise<IMihomoProxy> => {
  const instance = await getAxios()
  return await instance.delete(`/proxies/${encodeURIComponent(group)}`)
}

export const mihomoUpgradeGeo = async (): Promise<void> => {
  const instance = await getAxios()
  return await instance.post('/configs/geo')
}

export const mihomoProxyDelay = async (
  proxy: string,
  url?: string,
  provider?: string
): Promise<IMihomoDelay> => {
  const appConfig = await getAppConfig()
  const { delayTestUrl, delayTestTimeout } = appConfig
  const instance = await getAxios()
  const path = provider
    ? `/providers/proxies/${encodeURIComponent(provider)}/${encodeURIComponent(proxy)}/healthcheck`
    : `/proxies/${encodeURIComponent(proxy)}/delay`
  return await instance.get(path, {
    params: {
      url: delayTestUrl || url || 'https://www.gstatic.com/generate_204',
      timeout: delayTestTimeout || 5000
    }
  })
}

export const mihomoGroupDelay = async (group: string, url?: string): Promise<IMihomoGroupDelay> => {
  const appConfig = await getAppConfig()
  const { delayTestUrl, delayTestTimeout } = appConfig
  const instance = await getAxios()
  return await instance.get(`/group/${encodeURIComponent(group)}/delay`, {
    params: {
      url: delayTestUrl || url || 'https://www.gstatic.com/generate_204',
      timeout: delayTestTimeout || 5000
    }
  })
}

export const mihomoUpgrade = async (): Promise<void> => {
  const instance = await getAxios()
  return await instance.post('/upgrade', undefined, { timeout: 90000 })
}

export const mihomoUpgradeUI = async (): Promise<void> => {
  const instance = await getAxios()
  return await instance.post('/upgrade/ui')
}

export const mihomoHotReloadConfig = async (): Promise<void> => {
  mihomoApiLogger.info('mihomoHotReloadConfig called')
  if (!hasCoreProcess()) {
    mihomoApiLogger.warn('Core is not running, restarting core instead of hot reload')
    await restartCore()
    return
  }
  const current = await generateProfile()
  const { diffWorkDir = false } = await getAppConfig()
  const configPath = diffWorkDir ? mihomoWorkConfigPath(current) : mihomoWorkConfigPath('work')
  mihomoApiLogger.info(`hot reload config path: ${configPath}`)
  const instance = await getAxios()
  try {
    await instance.put('/configs?force=true', { path: configPath })
  } catch (error) {
    if (hasCoreProcess()) throw error
    mihomoApiLogger.warn('Core exited before hot reload completed, restarting core', error)
    await restartCore()
    return
  }
  mihomoApiLogger.info('hot reload config completed')
  try {
    const { scheduleRuntimeConfigUpload } = await import('../resolve/gistApi')
    scheduleRuntimeConfigUpload()
  } catch (error) {
    mihomoApiLogger.warn('Failed to schedule runtime config Gist sync', error)
  }
}

// Smart 内核 API
export const mihomoSmartGroupWeights = async (
  groupName: string
): Promise<Record<string, number>> => {
  const instance = await getAxios()
  return await instance.get(`/group/${encodeURIComponent(groupName)}/weights`)
}

export const mihomoSmartFlushCache = async (configName?: string): Promise<void> => {
  const instance = await getAxios()
  if (configName) {
    return await instance.post(`/cache/smart/flush/${encodeURIComponent(configName)}`)
  } else {
    return await instance.post('/cache/smart/flush')
  }
}

export const startMihomoTraffic = async (): Promise<void> => {
  activateStream(trafficStream)
  await mihomoTraffic()
}

export const stopMihomoTraffic = (): void => {
  stopStream(trafficStream)
}

const mihomoTraffic = async (): Promise<void> => {
  const generation = beginStreamConnection(trafficStream)
  if (generation === null) return

  const { ws, ipcPath, wsUrl } = createMihomoWebSocket('/traffic')

  mihomoApiLogger.info(`Creating traffic WebSocket with URL: ${wsUrl}, IPC path: ${ipcPath}`)
  trafficStream.ws = ws

  ws.onmessage = (e): void => {
    if (!isCurrentStream(trafficStream, generation)) return

    const data = e.data as string
    trafficStream.retry = MAX_RETRY
    try {
      // JSON.parse 必须放在 try 内：内核发来非 JSON 帧时，旧实现会在 async 回调里
      // 抛出并变成未捕获的 Promise rejection（其余三条流都已在 try 内解析）。
      const json = JSON.parse(data) as IMihomoTrafficInfo
      mainWindow?.webContents.send('mihomoTraffic', json)
      if (process.platform !== 'linux') {
        tray?.setToolTip(
          '↑' +
            `${calcTraffic(json.up)}/s`.padStart(9) +
            '\n↓' +
            `${calcTraffic(json.down)}/s`.padStart(9)
        )
      }
      floatingWindow?.webContents.send('mihomoTraffic', json)
    } catch {
      // ignore
    }
  }

  ws.onclose = (): void => {
    if (!isCurrentStream(trafficStream, generation)) return
    trafficStream.ws = null
    scheduleStreamReconnect(trafficStream, generation, mihomoTraffic)
  }

  ws.onerror = (error): void => {
    mihomoApiLogger.error('Traffic WebSocket error', error)
    closeErroredStreamSocket(trafficStream, generation, ws)
  }
}

export const startMihomoMemory = async (): Promise<void> => {
  activateStream(memoryStream)
  await mihomoMemory()
}

export const stopMihomoMemory = (): void => {
  stopStream(memoryStream)
}

const mihomoMemory = async (): Promise<void> => {
  const generation = beginStreamConnection(memoryStream)
  if (generation === null) return

  const { ws } = createMihomoWebSocket('/memory')
  memoryStream.ws = ws

  ws.onmessage = (e): void => {
    if (!isCurrentStream(memoryStream, generation)) return

    const data = e.data as string
    memoryStream.retry = MAX_RETRY
    try {
      mainWindow?.webContents.send('mihomoMemory', JSON.parse(data) as IMihomoMemoryInfo)
    } catch {
      // ignore
    }
  }

  ws.onclose = (): void => {
    if (!isCurrentStream(memoryStream, generation)) return
    memoryStream.ws = null
    scheduleStreamReconnect(memoryStream, generation, mihomoMemory)
  }

  ws.onerror = (): void => {
    closeErroredStreamSocket(memoryStream, generation, ws)
  }
}

export const startMihomoLogs = async (): Promise<void> => {
  if (!logsRequestedByRenderer || !hasCoreProcess()) return
  activateStream(logsStream)
  await mihomoLogs()
}

export const stopMihomoLogs = (): void => {
  stopStream(logsStream)
}

export const setMihomoLogsActive = async (active: boolean): Promise<void> => {
  if (logsRequestedByRenderer === active) return

  logsRequestedByRenderer = active
  if (active) {
    await startMihomoLogs()
  } else {
    stopMihomoLogs()
  }
}

const mihomoLogs = async (): Promise<void> => {
  const generation = beginStreamConnection(logsStream)
  if (generation === null) return

  const { 'log-level': logLevel = 'info' } = await getControledMihomoConfig()
  if (!logsRequestedByRenderer || !isCurrentStream(logsStream, generation)) return

  const { ws } = createMihomoWebSocket(`/logs?level=${logLevel}`)
  logsStream.ws = ws

  ws.onmessage = (e): void => {
    if (!isCurrentStream(logsStream, generation)) return

    const data = e.data as string
    logsStream.retry = MAX_RETRY
    try {
      mainWindow?.webContents.send('mihomoLogs', JSON.parse(data) as IMihomoLogInfo)
    } catch {
      // ignore
    }
  }

  ws.onclose = (): void => {
    if (!isCurrentStream(logsStream, generation)) return
    logsStream.ws = null
    scheduleStreamReconnect(logsStream, generation, mihomoLogs)
  }

  ws.onerror = (): void => {
    closeErroredStreamSocket(logsStream, generation, ws)
  }
}

export const startMihomoConnections = async (): Promise<void> => {
  activateStream(connectionsStream)
  await mihomoConnections()
}

export const stopMihomoConnections = (): void => {
  stopStream(connectionsStream)
}

const mihomoConnections = async (): Promise<void> => {
  const generation = beginStreamConnection(connectionsStream)
  if (generation === null) return

  const { ws } = createMihomoWebSocket('/connections')
  connectionsStream.ws = ws

  ws.onmessage = (e): void => {
    if (!isCurrentStream(connectionsStream, generation)) return

    const data = e.data as string
    connectionsStream.retry = MAX_RETRY
    try {
      mainWindow?.webContents.send('mihomoConnections', JSON.parse(data) as IMihomoConnectionsInfo)
    } catch {
      // ignore
    }
  }

  ws.onclose = (): void => {
    if (!isCurrentStream(connectionsStream, generation)) return
    connectionsStream.ws = null
    scheduleStreamReconnect(connectionsStream, generation, mihomoConnections)
  }

  ws.onerror = (): void => {
    closeErroredStreamSocket(connectionsStream, generation, ws)
  }
}

export async function SysProxyStatus(): Promise<boolean> {
  const appConfig = await getAppConfig()
  // 配置缺失/损坏时 sysProxy 可能为 undefined，直接取 .enable 会抛错并连带
  // 把托盘图标状态刷新整条链路打断（TunStatus 已经是可选链写法）。
  return appConfig?.sysProxy?.enable === true
}

export const TunStatus = async (): Promise<boolean> => {
  const config = await getControledMihomoConfig()
  return config?.tun?.enable === true
}

export function calculateTrayIconStatus(
  sysProxyEnabled: boolean,
  tunEnabled: boolean
): 'white' | 'blue' | 'green' | 'red' {
  if (sysProxyEnabled && tunEnabled) {
    return 'red' // 系统代理 + TUN 同时启用（警告状态）
  } else if (sysProxyEnabled) {
    return 'blue' // 仅系统代理启用
  } else if (tunEnabled) {
    return 'green' // 仅 TUN 启用
  } else {
    return 'white' // 全关
  }
}

export async function getTrayIconStatus(): Promise<'white' | 'blue' | 'green' | 'red'> {
  const [sysProxyEnabled, tunEnabled] = await Promise.all([SysProxyStatus(), TunStatus()])
  return calculateTrayIconStatus(sysProxyEnabled, tunEnabled)
}
