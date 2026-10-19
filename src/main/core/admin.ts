import { execFile } from 'child_process'
import { promisify } from 'util'
import { managerLogger } from '../utils/logger'

const execFilePromise = promisify(execFile)

// admin 状态在 Node 进程生命周期内不会变化，永久缓存
let adminPrivilegePromise: Promise<boolean> | null = null

// 允许 lifecycle.ts 同步检测的结果直接填入缓存，避免重复跑一次 fltmc
export function primeAdminPrivilegesCache(value: boolean): void {
  if (adminPrivilegePromise) return
  adminPrivilegePromise = Promise.resolve(value)
  managerLogger.info(`Admin privileges primed from sync check: ${value}`)
}

type ProbeResult = { ok: true } | { ok: false; timedOut: boolean; detail: string }

// 默认 1.5s 足够快速判断；被杀掉（超时）后再用更长的超时重试，避免慢机器被误判为非管理员
const PROBE_TIMEOUTS = [1500, 10000]

async function probe(command: string, args: string[]): Promise<ProbeResult> {
  let last: ProbeResult = { ok: false, timedOut: false, detail: 'not run' }
  for (const timeout of PROBE_TIMEOUTS) {
    try {
      await execFilePromise(command, args, { windowsHide: true, timeout })
      return { ok: true }
    } catch (error: unknown) {
      const { code, signal, killed } = error as {
        code?: number | string | null
        signal?: string | null
        killed?: boolean
      }
      // 超时被杀时 code 为 null 且 killed/signal 被设置，不能当作退出码 0
      const timedOut = code == null && (killed === true || signal != null)
      last = {
        ok: false,
        timedOut,
        detail: timedOut ? `killed by ${signal ?? 'signal'} after ${timeout}ms` : `code ${code}`
      }
      if (!timedOut) return last
      managerLogger.debug(`${command} ${last.detail}, retrying with a longer timeout`)
    }
  }
  return last
}

export async function checkAdminPrivileges(): Promise<boolean> {
  if (process.platform !== 'win32') {
    return true
  }

  if (adminPrivilegePromise) return adminPrivilegePromise

  adminPrivilegePromise = (async () => {
    const fltmc = await probe('fltmc', [])
    if (fltmc.ok) {
      managerLogger.info('Admin privileges confirmed via fltmc')
      return true
    }
    managerLogger.debug(`fltmc failed (${fltmc.detail}), trying net session as fallback`)

    const net = await probe('net', ['session'])
    if (net.ok) {
      managerLogger.info('Admin privileges confirmed via net session')
      return true
    }

    if (fltmc.timedOut || net.timedOut) {
      // 结果不确定，不缓存，下次调用时重新检测
      managerLogger.warn(
        `Admin privilege check inconclusive, not caching. fltmc: ${fltmc.detail}, net: ${net.detail}`
      )
      adminPrivilegePromise = null
      return false
    }

    managerLogger.debug(
      `Both fltmc and net session failed, no admin privileges. fltmc: ${fltmc.detail}, net: ${net.detail}`
    )
    return false
  })()

  return adminPrivilegePromise
}
