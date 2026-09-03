import { exec, execFile } from 'child_process'
import { promisify } from 'util'
import { net } from 'electron'
import axios from 'axios'
import { getAppConfig, patchAppConfig } from '../config'
import { managerLogger } from '../utils/logger'

const execPromise = promisify(exec)
const execFilePromise = promisify(execFile)
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
    // 服务名要嵌进 AppleScript 字符串字面量里，双引号/反斜杠不转义会让 osascript 编译期直接语法错误；
    // 再用 execFile 直接传参，省掉 `osascript -e '...'` 那层 shell 单引号拼接。
    const escapedService = service.replace(/\\/g, '\\\\\\\\').replace(/"/g, '\\\\\\"')
    const shell = `networksetup -setdnsservers \\"${escapedService}\\" ${dns}`
    const command = `do shell script "${shell}" with administrator privileges`
    await execFilePromise('osascript', ['-e', command])
  }
}

export async function setPublicDNS(): Promise<void> {
  if (process.platform !== 'darwin') return
  // 两条重试链必须互斥，否则设置与恢复会互相覆盖
  if (recoverDNSTimer) {
    clearTimeout(recoverDNSTimer)
    recoverDNSTimer = null
  }
  if (net.isOnline()) {
    const { originDNS } = await getAppConfig()
    if (!originDNS) {
      await getOriginDNS()
      await setDNS('223.5.5.5')
    }
  } else {
    if (setPublicDNSTimer) clearTimeout(setPublicDNSTimer)
    // 定时器回调里的 Promise 无人接管，不 catch 会变成主进程未捕获异常
    setPublicDNSTimer = setTimeout(() => {
      void setPublicDNS().catch((e) => {
        managerLogger.error('retry setPublicDNS failed', e)
      })
    }, 5000)
  }
}

export async function recoverDNS(options: DNSOperationOptions = {}): Promise<void> {
  if (process.platform !== 'darwin') return
  // 无条件取消待执行的 setPublicDNS 重试：内核已停止，再排下去会在没有内核的情况下把系统 DNS 改掉且无人恢复
  if (setPublicDNSTimer) {
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
    // 定时器回调里的 Promise 无人接管，不 catch 会变成主进程未捕获异常
    recoverDNSTimer = setTimeout(() => {
      void recoverDNS(options).catch((e) => {
        managerLogger.error('retry recoverDNS failed', e)
      })
    }, 5000)
  }
}
