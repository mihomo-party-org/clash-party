import { exec } from 'child_process'
import { promisify } from 'util'
import { net } from 'electron'
import axios from 'axios'
import { getAppConfig, patchAppConfig } from '../config'

const execPromise = promisify(exec)
const helperSocketPath = '/tmp/mihomo-party-helper.sock'
const publicDNS = '223.5.5.5'
const emptyDNS = 'Empty'

let setPublicDNSTimer: NodeJS.Timeout | null = null
let recoverDNSTimer: NodeJS.Timeout | null = null

interface DNSOperationOptions {
  force?: boolean
  timeout?: number
}

export async function getDefaultDevice(): Promise<string> {
  const { stdout: deviceOut } = await execPromise(`route -n get default`)
  let device = deviceOut.split('\n').find((s) => s.includes('interface:'))
  device = device?.trim().split(' ').slice(1).join(' ')
  if (!device) throw new Error('Get device failed')
  return device
}

async function getDefaultService(): Promise<string> {
  const device = await getDefaultDevice()
  const { stdout: order } = await execPromise(`networksetup -listnetworkserviceorder`)
  const block = order.split('\n\n').find((s) => s.includes(`Device: ${device}`))
  if (!block) throw new Error('Get networkservice failed')
  for (const line of block.split('\n')) {
    if (line.match(/^\(\d+\).*/)) {
      return line.trim().split(' ').slice(1).join(' ')
    }
  }
  throw new Error('Get service failed')
}

async function getCurrentDNS(): Promise<string> {
  const service = await getDefaultService()
  const { stdout: dns } = await execPromise(`networksetup -getdnsservers "${service}"`)
  if (dns.startsWith("There aren't any DNS Servers set on")) {
    return emptyDNS
  }
  return dns.trim().replace(/\n/g, ' ')
}

async function getOriginDNS(): Promise<void> {
  await patchAppConfig({ originDNS: await getCurrentDNS() })
}

async function setDNS(dns: string, timeout?: number): Promise<void> {
  const service = await getDefaultService()
  try {
    await axios.post(
      'http://localhost/dns',
      { service, dns },
      {
        socketPath: helperSocketPath,
        ...(timeout === undefined ? {} : { timeout })
      }
    )
  } catch (error) {
    // 退出清理使用有界 helper 请求；此时不能再弹授权框或启动无界的 osascript fallback。
    if (timeout !== undefined) throw error
    // fallback to osascript if helper not available
    const shell = `networksetup -setdnsservers "${service}" ${dns}`
    const command = `do shell script "${shell}" with administrator privileges`
    await execPromise(`osascript -e '${command}'`)
  }
}

export async function setPublicDNS(): Promise<void> {
  if (process.platform !== 'darwin') return
  if (net.isOnline()) {
    const currentDNS = await getCurrentDNS()
    if (currentDNS !== publicDNS) {
      const { originDNS } = await getAppConfig()
      if (!originDNS) await getOriginDNS()
      await setDNS(publicDNS)
    }
  } else {
    if (setPublicDNSTimer) clearTimeout(setPublicDNSTimer)
    setPublicDNSTimer = setTimeout(() => setPublicDNS(), 5000)
  }
}

export async function recoverDNS(options: DNSOperationOptions = {}): Promise<void> {
  if (process.platform !== 'darwin') return
  if (options.force && setPublicDNSTimer) {
    clearTimeout(setPublicDNSTimer)
    setPublicDNSTimer = null
  }
  if (net.isOnline() || options.force) {
    const { originDNS } = await getAppConfig()
    if (originDNS) {
      await setDNS(originDNS, options.timeout)
      await patchAppConfig({ originDNS: undefined })
    }
  } else {
    if (recoverDNSTimer) clearTimeout(recoverDNSTimer)
    recoverDNSTimer = setTimeout(() => recoverDNS(options), 5000)
  }
}
