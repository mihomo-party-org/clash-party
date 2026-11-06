import { ChildProcess, execFile, spawn } from 'child_process'
import path from 'path'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { readFile, rm, writeFile } from 'fs/promises'
import { dataDir, resourcesFilesDir } from '../utils/dirs'
import { getAppConfig } from '../config'
import { isPidAlive, verifyProcessOwner } from '../core/process'

const execFilePromise = promisify(execFile)

const MONITOR_EXIT_TIMEOUT_MS = 3000
const MONITOR_EXIT_POLL_MS = 100

let child: ChildProcess | undefined
let monitorTask: Promise<void> = Promise.resolve()

// 停止旧实例要等它真正退出，期间设置页可能又切了一次开关；不串行的话两次调用会各自
// 启动一个实例，其中一个不再被引用、永远停不掉
function enqueue(job: () => Promise<void>): Promise<void> {
  const task = monitorTask.then(job)
  monitorTask = task.catch(() => {})
  return task
}

export function startMonitor(detached = false): Promise<void> {
  return enqueue(() => restartMonitor(detached))
}

// 应用退出时 libuv 的 job object 会强杀所有未 detached 的子进程，同样来不及还原任务栏，
// 下次启动又会在缩过的基础上再缩一次（#741），所以退出前先正常关闭。
// 轻量模式直接 app.exit()，不经过退出清理，留在后台的实例不受影响
export function stopMonitor(): Promise<void> {
  return enqueue(stopChildMonitor)
}

async function restartMonitor(detached: boolean): Promise<void> {
  if (process.platform !== 'win32') return
  if (existsSync(path.join(dataDir(), 'monitor.pid'))) {
    const pid = parseInt(await readFile(path.join(dataDir(), 'monitor.pid'), 'utf-8'))
    try {
      if (!isNaN(pid)) {
        const isOwner = await verifyProcessOwner(pid, ['TrafficMonitor'])
        if (isOwner) {
          await closeMonitor(
            pid,
            () => !isPidAlive(pid),
            async () => {
              // 只有 PID 没有句柄，等待期间它可能退出并被别的进程复用，强杀前再确认一次
              if (await verifyProcessOwner(pid, ['TrafficMonitor'])) {
                process.kill(pid)
              }
            }
          )
        }
      }
    } catch {
      // ignore
    } finally {
      await rm(path.join(dataDir(), 'monitor.pid'))
    }
  }
  await stopChildMonitor()
  const { showTraffic = false } = await getAppConfig()
  if (!showTraffic) return
  child = spawn(path.join(resourcesFilesDir(), 'TrafficMonitor/TrafficMonitor.exe'), [], {
    cwd: path.join(resourcesFilesDir(), 'TrafficMonitor'),
    detached: detached,
    stdio: detached ? 'ignore' : undefined
  })
  if (detached) {
    if (child && child.pid) {
      await writeFile(path.join(dataDir(), 'monitor.pid'), child.pid.toString())
    }
    child.unref()
  }
}

function hasExited(proc: ChildProcess): boolean {
  return proc.exitCode !== null || proc.signalCode !== null
}

async function stopChildMonitor(): Promise<void> {
  const current = child
  child = undefined
  if (!current?.pid || hasExited(current)) return
  // 判断退出和强杀都走子进程句柄：Node 在 exit 之前一直持有句柄，PID 不会被系统复用，不会误杀别的进程
  await closeMonitor(
    current.pid,
    () => hasExited(current),
    () => {
      current.kill()
    }
  )
}

// Windows 上 kill() 一律是 TerminateProcess。TrafficMonitor 嵌进任务栏时会挤占任务按钮区域，
// 被强杀就来不及把宽度还回去，下一个实例在缩过的基础上再缩一次，反复开关后越挤越靠左（#741）。
// 先用不带 /F 的 taskkill 发 WM_CLOSE 让它正常退出，并等它真正退出后再启动新实例，超时才强杀。
async function closeMonitor(
  pid: number,
  exited: () => boolean,
  forceKill: () => void | Promise<void>
): Promise<void> {
  try {
    await execFilePromise('taskkill', ['/PID', String(pid)], {
      windowsHide: true,
      timeout: MONITOR_EXIT_TIMEOUT_MS
    })
  } catch {
    // 没有可接收 WM_CLOSE 的窗口时 taskkill 会失败，交给下面的超时强杀
  }
  const deadline = Date.now() + MONITOR_EXIT_TIMEOUT_MS
  while (!exited()) {
    if (Date.now() >= deadline) {
      try {
        await forceKill()
      } catch {
        // ignore
      }
      return
    }
    await new Promise((resolve) => setTimeout(resolve, MONITOR_EXIT_POLL_MS))
  }
}
