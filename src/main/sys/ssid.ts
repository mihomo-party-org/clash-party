import { exec, spawn } from 'child_process'
import { networkInterfaces } from 'os'
import { promisify } from 'util'
import { ipcMain, net } from 'electron'
import { getAppConfig, patchAppConfig, patchControledMihomoConfig } from '../config'
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
let ssidCheckInterval: NodeJS.Timeout | null = null
let networkWatcher: ReturnType<typeof spawn> | null = null
let watcherDebounce: NodeJS.Timeout | null = null
let profileBeforeSSIDSwitch: string | undefined
let lastNetworkFingerprint: string | undefined
let lastSSIDProbeAt = 0

// 读不到 SSID 时的兜底重试间隔
const unknownSSIDRetryInterval = 300000

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

async function handleSSIDChange(): Promise<void> {
  try {
    const {
      pauseSSID = [],
      disableDnsOnPauseSSID = false,
      controlDns,
      ssidProfileMap = {},
      ssidProfileRestore = false
    } = await getAppConfig()
    if (pauseSSID.length === 0 && Object.keys(ssidProfileMap).length === 0) return
    const fingerprint = networkFingerprint()
    const now = Date.now()
    // 指纹没变就跳过；上次没读到 SSID（无线还没连上、没有无线网卡）时留一条慢速兜底重试
    if (
      fingerprint === lastNetworkFingerprint &&
      (lastSSID !== undefined || now - lastSSIDProbeAt < unknownSSIDRetryInterval)
    ) {
      return
    }
    lastNetworkFingerprint = fingerprint
    lastSSIDProbeAt = now
    const currentSSID = await getCurrentSSID()
    if (currentSSID === lastSSID) return
    const previousSSID = lastSSID
    lastSSID = currentSSID

    if (currentSSID && pauseSSID.includes(currentSSID)) {
      if (disableDnsOnPauseSSID) {
        await patchAppConfig({ controlDnsBeforePause: controlDns, controlDns: false })
      }
      await patchControledMihomoConfig({ mode: 'direct' })
      await patchMihomoConfig({ mode: 'direct' })
      mainWindow?.webContents.send('controledMihomoConfigUpdated')
      mainWindow?.webContents.send('appConfigUpdated')
      ipcMain.emit('updateTrayMenu')
      await updateTrayIcon()
      return
    }

    if (
      previousSSID &&
      pauseSSID.includes(previousSSID) &&
      (!currentSSID || !pauseSSID.includes(currentSSID))
    ) {
      await patchControledMihomoConfig({ mode: 'rule' })
      await patchMihomoConfig({ mode: 'rule' })
      mainWindow?.webContents.send('controledMihomoConfigUpdated')
      mainWindow?.webContents.send('appConfigUpdated')
      ipcMain.emit('updateTrayMenu')
      await updateTrayIcon()
    }

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
