import { execFile } from 'child_process'
import { promisify } from 'util'
import { readdir, rm } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { managerLogger } from '../utils/logger'
import { mihomoCoreDir } from '../utils/dirs'
import { getAxios } from './mihomoApi'

const execFilePromise = promisify(execFile)

// 常量
const CORE_READY_MAX_RETRIES = 30
const CORE_READY_RETRY_INTERVAL_MS = 100
const windowsCoreExecutables = ['mihomo.exe', 'mihomo-alpha.exe', 'mihomo-smart.exe']

export async function cleanupSocketFile(): Promise<void> {
  if (process.platform === 'win32') {
    await cleanupWindowsNamedPipes()
  } else {
    await cleanupUnixSockets()
  }
}

// thorough=true 走 PowerShell 慢路径，仅在外部控制器监听冲突时使用
export async function cleanupWindowsNamedPipes(thorough = false): Promise<void> {
  try {
    const pids = await findWindowsCorePids(thorough ? 5000 : 1500)
    if (pids.length === 0) return

    managerLogger.info(`Found potential pipe-blocking core processes: ${pids.join(',')}`)
    for (const pid of pids) {
      await terminateProcess(pid)
    }

    // 给进程留出退出窗口，避免 pipe 占用导致后续启动失败
    await new Promise((resolve) => setTimeout(resolve, thorough ? 1000 : 200))
  } catch (error) {
    managerLogger.warn('Windows named pipe cleanup failed:', error)
  }
}

async function findWindowsCorePids(timeout: number): Promise<number[]> {
  const { stdout } = await execFilePromise('tasklist', ['/FO', 'CSV', '/NH'], {
    windowsHide: true,
    timeout,
    maxBuffer: 4 * 1024 * 1024
  })

  const candidates: number[] = []
  for (const line of stdout.split('\n')) {
    const match = line.match(/^"([^"]+)","(\d+)"/)
    if (!match || !windowsCoreExecutables.includes(match[1].toLowerCase())) continue
    const pid = parseInt(match[2], 10)
    if (!isNaN(pid) && pid !== process.pid) candidates.push(pid)
  }
  if (candidates.length === 0) return []

  let processInfo = ''
  try {
    const result = await execFilePromise(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Process -Id ${candidates.join(',')} -ErrorAction SilentlyContinue | Select-Object Id,Path | ConvertTo-Json -Compress`
      ],
      { windowsHide: true, timeout: timeout + 2500, maxBuffer: 4 * 1024 * 1024 }
    )
    processInfo = result.stdout.trim()
  } catch (error) {
    managerLogger.warn('Failed to inspect core process paths:', error)
    return candidates
  }
  if (!processInfo) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(processInfo)
  } catch (error) {
    managerLogger.warn('Failed to parse core process paths:', error)
    return candidates
  }

  const corePaths = windowsCoreExecutables.map((name) =>
    path.win32.resolve(mihomoCoreDir(), name).toLowerCase()
  )
  const pids: number[] = []
  for (const proc of Array.isArray(parsed) ? parsed : [parsed]) {
    const { Id: pid, Path: exePath } = (proc ?? {}) as { Id?: unknown; Path?: unknown }
    if (typeof pid !== 'number' || !candidates.includes(pid)) continue
    if (typeof exePath !== 'string' || !exePath) {
      pids.push(pid)
    } else if (corePaths.includes(path.win32.resolve(exePath).toLowerCase())) {
      pids.push(pid)
    }
  }
  return pids
}

async function terminateProcess(pid: number): Promise<void> {
  try {
    process.kill(pid, 0)
    process.kill(pid, 'SIGTERM')
    managerLogger.info(`Terminated process ${pid} to free pipe`)
  } catch (error: unknown) {
    if ((error as { code?: string })?.code !== 'ESRCH') {
      managerLogger.warn(`Failed to terminate process ${pid}:`, error)
    }
  }
}

// Best-effort check whether a PID is still alive without actually killing it.
// process.kill(pid, 0) throws ESRCH when the process is gone and EPERM when
// it is alive but owned by another user (we treat that as "alive, don't touch").
export function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ESRCH') return false
    // EPERM etc: assume alive so we err on the side of NOT deleting a live socket.
    return true
  }
}

export async function cleanupUnixSockets(): Promise<void> {
  const uid = process.getuid?.() ?? 'user'

  // Legacy fixed socket paths from older releases. These never contain a PID
  // and are safe to remove unconditionally if they exist.
  const legacyPaths = [
    '/tmp/mihomo-party.sock',
    '/tmp/mihomo-party-admin.sock',
    `/tmp/mihomo-party-${uid}.sock`
  ]

  for (const socketPath of legacyPaths) {
    try {
      if (existsSync(socketPath)) {
        await rm(socketPath)
        managerLogger.info(`Cleaned up legacy socket file: ${socketPath}`)
      }
    } catch (error) {
      managerLogger.warn(`Failed to cleanup socket file ${socketPath}:`, error)
    }
  }

  // Current getMihomoIpcPath() produces /tmp/mihomo-party-<uid>-<pid>.sock,
  // where <pid> is the parent Electron main-process PID. Previous versions
  // never garbage-collected these when the parent exited, so /tmp accumulates
  // one file per historical session. Sweep them now, but ONLY delete files
  // whose parent PID is no longer running to avoid nuking a sibling instance
  // (another Party window from a different user, an admin-elevated session,
  // etc.) that legitimately owns its own socket.
  const currentPrefix = `mihomo-party-${uid}-`
  try {
    const entries = await readdir('/tmp')
    for (const name of entries) {
      if (!name.startsWith(currentPrefix) || !name.endsWith('.sock')) continue
      const pidPart = name.slice(currentPrefix.length, -'.sock'.length)
      const pid = parseInt(pidPart, 10)
      if (!Number.isFinite(pid)) continue
      // Do not touch our own socket.
      if (pid === process.pid) continue
      if (isPidAlive(pid)) continue
      const socketPath = `/tmp/${name}`
      try {
        await rm(socketPath)
        managerLogger.info(`Cleaned up stale per-PID socket: ${socketPath}`)
      } catch (error) {
        managerLogger.warn(`Failed to cleanup socket file ${socketPath}:`, error)
      }
    }
  } catch (error) {
    // ENOENT on /tmp is impossible, EPERM/EACCES worth logging but not fatal.
    managerLogger.warn('Failed to enumerate /tmp for stale sockets:', error)
  }
}

export async function validateWindowsPipeAccess(pipePath: string): Promise<void> {
  try {
    managerLogger.info(`Validating pipe access for: ${pipePath}`)
    managerLogger.info(`Pipe validation completed for: ${pipePath}`)
  } catch (error) {
    managerLogger.error('Windows pipe validation failed:', error)
  }
}

export async function waitForCoreReady(): Promise<void> {
  for (let i = 0; i < CORE_READY_MAX_RETRIES; i++) {
    try {
      const axios = await getAxios(true)
      await axios.get('/')
      managerLogger.info(
        `Core ready after ${i + 1} attempts (${(i + 1) * CORE_READY_RETRY_INTERVAL_MS}ms)`
      )
      return
    } catch {
      if (i === 0) {
        managerLogger.info('Waiting for core to be ready...')
      }

      if (i === CORE_READY_MAX_RETRIES - 1) {
        throw new Error(
          `Core not ready after ${CORE_READY_MAX_RETRIES} attempts (${CORE_READY_MAX_RETRIES * CORE_READY_RETRY_INTERVAL_MS}ms)`
        )
      }

      await new Promise((resolve) => setTimeout(resolve, CORE_READY_RETRY_INTERVAL_MS))
    }
  }
}

function normalizeProcessName(name: string): string {
  return name
    .trim()
    .replace(/\.exe$/i, '')
    .toLowerCase()
}

export async function verifyProcessOwner(
  pid: number,
  expectedNames: readonly string[]
): Promise<boolean> {
  try {
    process.kill(pid, 0)
  } catch {
    return false
  }

  try {
    let processName = ''
    if (process.platform === 'win32') {
      const { stdout } = await execFilePromise(
        'tasklist',
        ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
        { windowsHide: true, timeout: 1000 }
      )
      const match = stdout.match(/^"([^"]+)","(\d+)"/m)
      if (!match || parseInt(match[2], 10) !== pid) return false
      processName = match[1]
    } else {
      const nameField = process.platform === 'darwin' ? 'ucomm=' : 'comm='
      const { stdout } = await execFilePromise('ps', ['-p', `${pid}`, '-o', nameField], {
        timeout: 1000
      })
      processName = stdout.trim().split(/\r?\n/, 1)[0] || ''
    }

    const normalizedName = normalizeProcessName(processName)
    return expectedNames.some((name) => normalizeProcessName(name) === normalizedName)
  } catch {
    return false
  }
}
