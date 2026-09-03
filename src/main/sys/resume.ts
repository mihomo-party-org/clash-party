import os from 'os'
import { net, powerMonitor } from 'electron'
import { getAppConfig, getControledMihomoConfig } from '../config'
import { hasCoreProcess, restartCore } from '../core/manager'
import { mihomoHotReloadConfig, mihomoVersion, patchMihomoConfig } from '../core/mihomoApi'
import { getDefaultMihomoTunDevice } from '../../shared/appConfig'
import { createLogger } from '../utils/logger'
import { triggerSysProxy } from './sysproxy'

const resumeLogger = createLogger('Resume')

// 唤醒瞬间网卡还在重新初始化，立刻探测必然失败
const resumeSettleDelay = 3000
const networkWaitTimeout = 30000
const networkWaitInterval = 1000

let recovering = false

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForNetwork(): Promise<void> {
  const deadline = Date.now() + networkWaitTimeout
  while (!net.isOnline() && Date.now() < deadline) {
    await wait(networkWaitInterval)
  }
}

function isTunDevicePresent(device: string): boolean {
  return Object.keys(os.networkInterfaces()).some(
    (name) => name.toLowerCase() === device.toLowerCase()
  )
}

async function isCoreResponsive(): Promise<boolean> {
  if (!hasCoreProcess()) return false
  try {
    await mihomoVersion()
    return true
  } catch {
    return false
  }
}

export async function recoverAfterResume(): Promise<void> {
  if (recovering) return
  recovering = true
  try {
    await wait(resumeSettleDelay)
    await waitForNetwork()

    if (await isCoreResponsive()) {
      const { tun } = await getControledMihomoConfig()
      const device = tun?.device || getDefaultMihomoTunDevice(process.platform)
      if (tun?.enable && !isTunDevicePresent(device)) {
        // 内核只在 TUN 配置真正变化时才重建虚拟网卡（ReCreateTun 先和 LastTunConf 比较），
        // 所以必须先关后开，等价于用户手动开关 TUN 这个既有的绕过办法。
        resumeLogger.warn(`TUN device ${device} is gone after resume, recreating it`)
        await patchMihomoConfig({ tun: { enable: false } })
        await patchMihomoConfig({ tun: { enable: true } })
      } else if (tun?.enable) {
        // 网卡还在、内核也活着，但 TUN 的路由与 DNS 劫持在挂起期间可能已经失效
        // （用户报告唤醒后代理端口正常、DNS 却不响应）。热重载会让内核重跑
        // updateDNS / updateTun / updateIPTables，正是用户手动去 DNS 页保存一次
        // 所触发的那条路径。
        await mihomoHotReloadConfig()
        resumeLogger.info('Reloaded core config after resume to restore TUN routing and DNS')
      }
    } else {
      resumeLogger.warn('Core is unreachable after resume, restarting it')
      await restartCore()
    }

    const { sysProxy } = await getAppConfig()
    if (sysProxy?.enable) {
      // 幂等；网络还没回来时 triggerSysProxy 自己会排队重试
      await triggerSysProxy(true)
    }
  } catch (error) {
    resumeLogger.warn('Failed to recover after system resume', error)
  } finally {
    recovering = false
  }
}

export function initResumeRecovery(): void {
  powerMonitor.on('resume', () => {
    resumeLogger.info('System resumed, checking core and network state')
    void recoverAfterResume()
  })
}
