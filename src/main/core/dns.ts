import { exec } from 'child_process'
import { promisify } from 'util'
import { net } from 'electron'
import axios from 'axios'
import { getAppConfig, patchAppConfig } from '../config'

const execPromise = promisify(exec)
const helperSocketPath = '/tmp/mihomo-party-helper.sock'

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

async function getOriginDNS(): Promise<void> {
  const service = await getDefaultService()
  const { stdout: dns } = await execPromise(`networksetup -getdnsservers "${service}"`)
  if (dns.startsWith("There aren't any DNS Servers set on")) {
    await patchAppConfig({ originDNS: 'Empty' })
  } else {
    await patchAppConfig({ originDNS: dns.trim().replace(/\n/g, ' ') })
  }
}

async function setDNS(dns: string, timeout?: number): Promise<void> {
  const service = await getDefaultService()
  const postViaHelper = async (attemptTimeout?: number): Promise<void> => {
    await axios.post(
      'http://localhost/dns',
      { service, dns },
      {
        socketPath: helperSocketPath,
        ...(attemptTimeout === undefined ? {} : { timeout: attemptTimeout })
      }
    )
  }

  try {
    await postViaHelper(timeout)
  } catch (error) {
    // 退出清理使用有界 helper 请求；此时不能再弹授权框或启动无界的 osascript fallback。
    if (timeout !== undefined) throw error

    const errCode = (error as NodeJS.ErrnoException).code
    const errMsg = (error as Error).message || ''
    // helper.sock 重启后 ENOENT/ECONNREFUSED：先给 launchd 起 helper 一次机会再重试（#1468）
    if (
      errCode === 'ENOENT' ||
      errCode === 'ECONNREFUSED' ||
      errMsg.includes('ENOENT') ||
      errMsg.includes('ECONNREFUSED')
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      try {
        await postViaHelper(5000)
        return
      } catch {
        // fall through to osascript
      }
    }

    // fallback to osascript if helper not available
    const shell = `networksetup -setdnsservers "${service}" ${dns}`
    const command = `do shell script "${shell}" with administrator privileges`
    await execPromise(`osascript -e '${command}'`)
  }
}

export async function setPublicDNS(): Promise<void> {
  if (process.platform !== 'darwin') return
  if (net.isOnline()) {
    const { originDNS } = await getAppConfig()
    if (!originDNS) {
      await getOriginDNS()
      await setDNS('223.5.5.5')
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
