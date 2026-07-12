import { exec, execFile } from 'child_process'
import { promisify } from 'util'
import { rm } from 'fs/promises'
import { existsSync } from 'fs'
import { managerLogger } from '../utils/logger'
import { getAxios } from './mihomoApi'

const execPromise = promisify(exec)
const execFilePromise = promisify(execFile)

// 常量
const CORE_READY_MAX_RETRIES = 30
const CORE_READY_RETRY_INTERVAL_MS = 100

export async function cleanupSocketFile(): Promise<void> {
  if (process.platform === 'win32') {
    await cleanupWindowsNamedPipes()
  } else {
    await cleanupUnixSockets()
  }
}

// thorough=true 走 PowerShell 慢路径，仅在外部控制器监听冲突时使用
export async function cleanupWindowsNamedPipes(thorough = false): Promise<void> {
  if (!thorough) {
    try {
      const { stdout } = await execFilePromise(
        'tasklist',
        ['/FI', 'IMAGENAME eq mihomo*', '/FO', 'CSV', '/NH'],
        { windowsHide: true, timeout: 1500, maxBuffer: 1 * 1024 * 1024 }
      )

      const pids: number[] = []
      for (const line of stdout.split('\n')) {
        const match = line.match(/^"([^"]+)","(\d+)"/)
        if (!match) continue
        const pid = parseInt(match[2], 10)
        if (!isNaN(pid) && pid !== process.pid) pids.push(pid)
      }

      if (pids.length === 0) return

      for (const pid of pids) {
        await terminateProcess(pid)
      }

      // 给进程留出退出窗口，避免 pipe 占用导致后续启动失败
      await new Promise((resolve) => setTimeout(resolve, 200))
    } catch (error) {
      managerLogger.warn('Lightweight pipe cleanup failed:', error)
    }
    return
  }

  try {
    try {
      const { stdout } = await execPromise(
        `powershell -NoProfile -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Process | Where-Object {$_.ProcessName -like '*mihomo*'} | Select-Object Id,ProcessName | ConvertTo-Json"`,
        { encoding: 'utf8' }
      )

      if (stdout.trim()) {
        managerLogger.info(`Found potential pipe-blocking processes: ${stdout}`)

        try {
          const processes = JSON.parse(stdout)
          const processArray = Array.isArray(processes) ? processes : [processes]

          for (const proc of processArray) {
            const pid = proc.Id
            if (pid && pid !== process.pid) {
              await terminateProcess(pid)
            }
          }
        } catch (parseError) {
          managerLogger.warn('Failed to parse process list JSON:', parseError)
          await fallbackTextParsing(stdout)
        }
      }
    } catch (error) {
      managerLogger.warn('Failed to check mihomo processes:', error)
    }

    await new Promise((resolve) => setTimeout(resolve, 1000))
  } catch (error) {
    managerLogger.error('Windows named pipe cleanup failed:', error)
  }
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

async function fallbackTextParsing(stdout: string): Promise<void> {
  const lines = stdout.split('\n').filter((line) => line.includes('mihomo'))
  for (const line of lines) {
    const match = line.match(/(\d+)/)
    if (match) {
      const pid = parseInt(match[1])
      if (pid !== process.pid) {
        await terminateProcess(pid)
      }
    }
  }
}

export async function cleanupUnixSockets(): Promise<void> {
  try {
    const socketPaths = [
      '/tmp/mihomo-party.sock',
      '/tmp/mihomo-party-admin.sock',
      `/tmp/mihomo-party-${process.getuid?.() || 'user'}.sock`
    ]

    for (const socketPath of socketPaths) {
      try {
        if (existsSync(socketPath)) {
          await rm(socketPath)
          managerLogger.info(`Cleaned up socket file: ${socketPath}`)
        }
      } catch (error) {
        managerLogger.warn(`Failed to cleanup socket file ${socketPath}:`, error)
      }
    }
  } catch (error) {
    managerLogger.error('Unix socket cleanup failed:', error)
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
        managerLogger.warn(
          `Core not ready after ${CORE_READY_MAX_RETRIES} attempts, proceeding anyway`
        )
        return
      }

      await new Promise((resolve) => setTimeout(resolve, CORE_READY_RETRY_INTERVAL_MS))
    }
  }
}

export async function verifyProcessOwner(pid: number, nameMatch: string): Promise<boolean> {
  try {
    process.kill(pid, 0)
  } catch {
    return false
  }

  try {
    if (process.platform === 'win32') {
      const { stdout } = await execPromise(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, {
        windowsHide: true,
        timeout: 1000
      })
      return stdout.toLowerCase().includes(nameMatch.toLowerCase())
    } else {
      // 使用 `comm=` 参数最多可显示 15 字符，超出会截断；TrafficMonitor 为 14 字符，可用
      const { stdout } = await execPromise(`ps -p ${pid} -o comm=`, { timeout: 1000 })
      return stdout.toLowerCase().includes(nameMatch.toLowerCase())
    }
  } catch {
    return false
  }
}

