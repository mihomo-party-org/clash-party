import { exec, spawn } from 'child_process'
import { networkInterfaces } from 'os'
import { promisify } from 'util'
import { ipcMain, net } from 'electron'
import {
  getAppConfig,
  getControledMihomoConfig,
  patchAppConfig,
  patchControledMihomoConfig
} from '../config'
import { changeCurrentProfile, getProfileConfig } from '../config/profile'
import { patchMihomoConfig } from '../core/mihomoApi'
import { mainWindow } from '../window'
import { getDefaultDevice } from '../core/manager'
import { updateTrayIcon } from '../resolve/tray'
import { createLogger } from '../utils/logger'

const ssidLogger = createLogger('SSID')

export async function getCurrentSSID(): Promise<string | undefined> {
  if (process.platform === 'win32') {
    try {
      return await getSSIDByNetsh()
    } catch {
      return undefined
    }
  }
  if (process.platform === 'linux') {
    try {
      return await getSSIDByIwconfig()
    } catch {
      return undefined
    }
  }
  if (process.platform === 'darwin') {
    try {
      return await getSSIDByAirport()
    } catch {
      return await getSSIDByNetworksetup()
    }
  }
  return undefined
}

let lastSSID: string | undefined
// 启动后是否已经完成过一次检查。没连无线时 SSID 一直是 undefined，和 lastSSID 的初始值相同，
// 第一次检查不能因此跳过，否则重启后在有线网络下永远恢复不了暂停前的模式
let ssidChecked = false
let ssidCheckInterval: NodeJS.Timeout | null = null
let networkWatcher: ReturnType<typeof spawn> | null = null
let watcherDebounce: NodeJS.Timeout | null = null
let profileBeforeSSIDSwitch: string | undefined
let lastNetworkFingerprint: string | undefined
let lastSSIDProbeAt = 0

// 读不到 SSID 时的兜底重试间隔
const unknownSSIDRetryInterval = 300000
// 按 SSID 切换模式失败（如内核还在启动）后的重试。macOS 只在网络变化时检查，不重试就再也不会切；
// 次数有上限：内核起不来时每次重试都会尝试启动内核，Windows 上还会再调一次 netsh
const ssidSwitchRetryDelay = 15000
const maxSSIDSwitchRetries = 6
let ssidRetryTimer: NodeJS.Timeout | null = null
let ssidRetryCount = 0
let ssidRetryPending = false
let ssidCheckRunning = false
let ssidCheckAgain = false

// Windows 11 把 SSID 当作位置信息：每次 `netsh wlan show interfaces` 都会让
// 「网络命令外壳」向系统申请一次定位，托盘上因此每个轮询周期闪一次定位图标。
// 网卡地址没变时 SSID 不可能变，先用这个免费的指纹过一道，只有网络真的动过才去问 netsh。
function networkFingerprint(): string {
  const interfaces = networkInterfaces()
  return Object.keys(interfaces)
    .sort()
    .map((name) => {
      const addresses = (interfaces[name] ?? [])
        .map((address) => `${address.address}/${address.mac}`)
        .sort()
        .join(',')
      return `${name}=${addresses}`
    })
    .join(';')
}

function scheduleSSIDRetry(): void {
  if (ssidRetryTimer) clearTimeout(ssidRetryTimer)
  ssidRetryTimer = setTimeout(() => {
    ssidRetryTimer = null
    ssidRetryPending = true
    void handleSSIDChange()
  }, ssidSwitchRetryDelay)
}

async function notifyModeChanged(): Promise<void> {
  mainWindow?.webContents.send('controledMihomoConfigUpdated')
  mainWindow?.webContents.send('appConfigUpdated')
  ipcMain.emit('updateTrayMenu')
  await updateTrayIcon()
}

// 轮询、网络监听和失败重试可能同时触发，同一时间只跑一次；跑的过程中又有触发就再跑一轮
async function handleSSIDChange(): Promise<void> {
  if (ssidCheckRunning) {
    ssidCheckAgain = true
    return
  }
  ssidCheckRunning = true
  try {
    do {
      ssidCheckAgain = false
      await checkSSID()
    } while (ssidCheckAgain)
  } finally {
    ssidCheckRunning = false
  }
}

async function checkSSID(): Promise<void> {
  try {
    const {
      pauseSSID = [],
      disableDnsOnPauseSSID = false,
      controlDns,
      controlDnsBeforePause,
      pausedBySSID = false,
      ssidProfileMap = {},
      ssidProfileRestore = false
    } = await getAppConfig()
    // 清空 pauseSSID 后不会再按网络切回规则模式，留着标记只会在以后某次检查时改掉用户自己选的模式
    if (pauseSSID.length === 0 && pausedBySSID) {
      await patchAppConfig({ pausedBySSID: undefined })
    }
    if (pauseSSID.length === 0 && Object.keys(ssidProfileMap).length === 0) return
    const fingerprint = networkFingerprint()
    const now = Date.now()
    const retrying = ssidRetryPending
    ssidRetryPending = false
    // 指纹没变就跳过；上次没读到 SSID（无线还没连上、没有无线网卡）时留一条慢速兜底重试
    if (
      !retrying &&
      fingerprint === lastNetworkFingerprint &&
      (lastSSID !== undefined || now - lastSSIDProbeAt < unknownSSIDRetryInterval)
    ) {
      return
    }
    if (fingerprint !== lastNetworkFingerprint) ssidRetryCount = 0
    lastNetworkFingerprint = fingerprint
    lastSSIDProbeAt = now
    const currentSSID = await getCurrentSSID()
    if (ssidChecked && currentSSID === lastSSID) return
    const previousSSID = lastSSID
    const onPauseSSID = currentSSID !== undefined && pauseSSID.includes(currentSSID)
    // 是否处于按 SSID 暂停的状态要落盘：重启后 lastSSID 为空，只靠它判断的话暂停时写下的直连永远恢复不了
    const wasPaused =
      pausedBySSID || (previousSSID !== undefined && pauseSSID.includes(previousSSID))

    // lastSSID 只在切换成功后更新。内核还在启动时热更新会失败，提前更新的话之后每次检查都当作没变化，
    // 配置文件写着直连、内核却还是规则模式，直到重启应用
    try {
      if (onPauseSSID) {
        await patchAppConfig({
          pausedBySSID: true,
          // 在两个暂停网络之间切换或重试时，第一次保存的 DNS 设置不能被已经关掉的值覆盖
          ...(disableDnsOnPauseSSID && controlDnsBeforePause === undefined
            ? { controlDnsBeforePause: controlDns, controlDns: false }
            : {})
        })
        await patchControledMihomoConfig({ mode: 'direct' })
        await patchMihomoConfig({ mode: 'direct' })
      } else if (wasPaused) {
        // 暂停期间用户自己换过模式（托盘、设置页、MCP）就不再改回规则模式
        const { mode } = await getControledMihomoConfig()
        if (mode === 'direct') {
          await patchControledMihomoConfig({ mode: 'rule' })
        }
        // patchControledMihomoConfig 先落盘、热更新失败只记日志，所以重试时配置已经是 rule 而内核可能还在直连，
        // 这时仍要把 rule 发给内核；用户自己选的就是 rule 的话，重发一次没有影响
        if (mode === 'direct' || mode === 'rule') {
          await patchMihomoConfig({ mode: 'rule' })
        }
        await patchAppConfig({ pausedBySSID: undefined })
      }
    } catch (error) {
      if (ssidRetryCount < maxSSIDSwitchRetries) {
        ssidRetryCount++
        ssidLogger.warn(
          `Failed to switch mode for SSID change, retry ${ssidRetryCount}/${maxSSIDSwitchRetries} in ${ssidSwitchRetryDelay}ms`,
          error
        )
        scheduleSSIDRetry()
      } else {
        ssidLogger.warn(
          'Failed to switch mode for SSID change, waiting for a network change',
          error
        )
      }
      return
    }
    ssidRetryCount = 0
    lastSSID = currentSSID
    ssidChecked = true

    if (onPauseSSID || wasPaused) {
      await notifyModeChanged()
    }
    if (onPauseSSID) return

    if (currentSSID && currentSSID in ssidProfileMap) {
      const targetProfileId = ssidProfileMap[currentSSID]
      try {
        const { current } = await getProfileConfig()
        if (!targetProfileId || current === targetProfileId) return
        const { items } = await getProfileConfig()
        if (!items.some((item) => item.id === targetProfileId)) {
          ssidLogger.warn(`SSID profile map references missing profile ${targetProfileId}`)
          return
        }
        if (profileBeforeSSIDSwitch === undefined) {
          profileBeforeSSIDSwitch = current
        }
        await changeCurrentProfile(targetProfileId)
        mainWindow?.webContents.send('profileConfigUpdated')
        ssidLogger.info(`Auto-switched to profile ${targetProfileId} for SSID ${currentSSID}`)
      } catch (e) {
        ssidLogger.warn(`Failed to switch to profile ${targetProfileId} for SSID ${currentSSID}`, e)
      }
      return
    }

    if (ssidProfileRestore && profileBeforeSSIDSwitch !== undefined) {
      try {
        const { current } = await getProfileConfig()
        if (profileBeforeSSIDSwitch && current !== profileBeforeSSIDSwitch) {
          await changeCurrentProfile(profileBeforeSSIDSwitch)
          mainWindow?.webContents.send('profileConfigUpdated')
          ssidLogger.info(
            `Restored profile to ${profileBeforeSSIDSwitch} after leaving mapped SSID`
          )
        }
      } catch (e) {
        ssidLogger.warn('Failed to restore profile after leaving mapped SSID', e)
      } finally {
        profileBeforeSSIDSwitch = undefined
      }
    }
  } catch {
    // ignore
  }
}

function startDarwinNetworkWatcher(): void {
  stopNetworkWatcher()

  let restartBackoff = 0
  const minRestartInterval = 1000

  function runWatcher(): void {
    const now = Date.now()
    if (now - restartBackoff < minRestartInterval) {
      setTimeout(runWatcher, minRestartInterval)
      return
    }
    restartBackoff = now

    networkWatcher = spawn('scutil', ['-w', 'State:/Network/Global/IPv4'], {
      stdio: 'ignore'
    })

    networkWatcher.on('exit', () => {
      if (watcherDebounce) clearTimeout(watcherDebounce)
      watcherDebounce = setTimeout(() => {
        handleSSIDChange()
      }, 500)
      runWatcher()
    })

    networkWatcher.on('error', (err) => {
      ssidLogger.warn('scutil watcher error, falling back to polling', err)
      stopNetworkWatcher()
      ssidCheckInterval = setInterval(handleSSIDChange, 15000)
    })
  }

  runWatcher()
}

function stopNetworkWatcher(): void {
  if (networkWatcher) {
    networkWatcher.kill()
    networkWatcher = null
  }
  if (watcherDebounce) {
    clearTimeout(watcherDebounce)
    watcherDebounce = null
  }
}

export async function startSSIDCheck(): Promise<void> {
  stopSSIDCheck()
  await handleSSIDChange()
  if (process.platform === 'darwin') {
    startDarwinNetworkWatcher()
  } else {
    ssidCheckInterval = setInterval(handleSSIDChange, 15000)
  }
}

export function stopSSIDCheck(): void {
  lastNetworkFingerprint = undefined
  lastSSIDProbeAt = 0
  if (ssidRetryTimer) {
    clearTimeout(ssidRetryTimer)
    ssidRetryTimer = null
  }
  stopNetworkWatcher()
  if (ssidCheckInterval) {
    clearInterval(ssidCheckInterval)
    ssidCheckInterval = null
  }
}

async function getSSIDByAirport(): Promise<string | undefined> {
  const execPromise = promisify(exec)
  const { stdout } = await execPromise(
    '/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport -I'
  )
  if (stdout.trim().startsWith('WARNING')) {
    throw new Error('airport cannot be used')
  }
  for (const line of stdout.split('\n')) {
    if (line.trim().startsWith('SSID')) {
      return line.split(': ')[1].trim()
    }
  }
  return undefined
}

async function getSSIDByNetworksetup(): Promise<string | undefined> {
  const execPromise = promisify(exec)
  if (net.isOnline()) {
    const service = await getDefaultDevice()
    const { stdout } = await execPromise(`networksetup -listpreferredwirelessnetworks ${service}`)
    if (stdout.trim().startsWith('Preferred networks on')) {
      if (stdout.split('\n').length > 1) {
        return stdout.split('\n')[1].trim()
      }
    }
  }
  return undefined
}

async function getSSIDByNetsh(): Promise<string | undefined> {
  const execPromise = promisify(exec)
  const { stdout } = await execPromise('netsh wlan show interfaces')
  for (const line of stdout.split('\n')) {
    if (line.trim().startsWith('SSID')) {
      return line.split(': ')[1].trim()
    }
  }
  return undefined
}

async function getSSIDByIwconfig(): Promise<string | undefined> {
  const execPromise = promisify(exec)
  const { stdout } = await execPromise(
    `iwconfig 2>/dev/null | grep 'ESSID' | awk -F'"' '{print $2}'`
  )
  if (stdout.trim() !== '') {
    return stdout.trim()
  }
  return undefined
}
