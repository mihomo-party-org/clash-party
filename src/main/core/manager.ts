import { ChildProcess, execFile, spawn } from 'child_process'
import { readFile, rm, writeFile } from 'fs/promises'
import { promisify } from 'util'
import path from 'path'
import os from 'os'
import { createWriteStream, existsSync } from 'fs'
import chokidar, { FSWatcher } from 'chokidar'
import { app, ipcMain } from 'electron'
import { mainWindow } from '../window'
import {
  getAppConfig,
  getControledMihomoConfig,
  patchControledMihomoConfig,
  manageSmartOverride
} from '../config'
import {
  dataDir,
  coreLogPath,
  mihomoCoreDir,
  mihomoCorePath,
  mihomoProfileWorkDir,
  mihomoTestDir,
  mihomoWorkConfigPath,
  mihomoWorkDir
} from '../utils/dirs'
import { uploadRuntimeConfig } from '../resolve/gistApi'
import { startMonitor } from '../resolve/trafficMonitor'
import { safeShowErrorBox } from '../utils/init'
import i18next from '../../shared/i18n'
import { managerLogger } from '../utils/logger'
import {
  startMihomoTraffic,
  startMihomoConnections,
  startMihomoLogs,
  startMihomoMemory,
  stopMihomoConnections,
  stopMihomoTraffic,
  stopMihomoLogs,
  stopMihomoMemory,
  patchMihomoConfig,
  getAxios
} from './mihomoApi'
import { generateProfile } from './factory'
import { getSessionAdminStatus } from './permissions'
import {
  cleanupSocketFile,
  cleanupWindowsNamedPipes,
  validateWindowsPipeAccess,
  waitForCoreReady
} from './process'
import { setPublicDNS, recoverDNS } from './dns'

// 重新导出权限相关函数
export {
  initAdminStatus,
  getSessionAdminStatus,
  checkAdminPrivileges,
  checkMihomoCorePermissions,
  checkHighPrivilegeCore,
  grantTunPermissions,
  restartAsAdmin,
  requestTunPermissions,
  showTunPermissionDialog,
  showErrorDialog,
  checkTunPermissions,
  manualGrantCorePermition
} from './permissions'

export { getDefaultDevice } from './dns'

const execFilePromise = promisify(execFile)
const ctlParam = process.platform === 'win32' ? '-ext-ctl-pipe' : '-ext-ctl-unix'

// 核心进程状态
let child: ChildProcess
let retry = 10
let isRestarting = false

// 文件监听器
let coreWatcher: FSWatcher | null = null

// 初始化核心文件监听
export function initCoreWatcher(): void {
  if (coreWatcher) return

  coreWatcher = chokidar.watch(path.join(mihomoCoreDir(), 'meta-update'), {})
  coreWatcher.on('unlinkDir', async () => {
    // 等待核心自我更新完成，避免与核心自动重启产生竞态
    await new Promise((resolve) => setTimeout(resolve, 3000))
    try {
      await stopCore(true)
      await startCore()
    } catch (e) {
      safeShowErrorBox('mihomo.error.coreStartFailed', `${e}`)
    }
  })
}

// 清理核心文件监听
export function cleanupCoreWatcher(): void {
  if (coreWatcher) {
    coreWatcher.close()
    coreWatcher = null
  }
}

// 动态生成 IPC 路径
export const getMihomoIpcPath = (): string => {
  if (process.platform === 'win32') {
    const isAdmin = getSessionAdminStatus()
    const sessionId = process.env.SESSIONNAME || process.env.USERNAME || 'default'
    const processId = process.pid

    return isAdmin
      ? `\\\\.\\pipe\\MihomoParty\\mihomo-admin-${sessionId}-${processId}`
      : `\\\\.\\pipe\\MihomoParty\\mihomo-user-${sessionId}-${processId}`
  }

  const uid = process.getuid?.() || 'unknown'
  const processId = process.pid
  return `/tmp/mihomo-party-${uid}-${processId}.sock`
}

// 核心配置接口
interface CoreConfig {
  corePath: string
  workDir: string
  ipcPath: string
  logLevel: LogLevel
  tunEnabled: boolean
  autoSetDNS: boolean
  cpuPriority: string
  detached: boolean
}

// 准备核心配置
async function prepareCore(detached: boolean, skipStop = false): Promise<CoreConfig> {
  const [appConfig, mihomoConfig] = await Promise.all([getAppConfig(), getControledMihomoConfig()])

  const {
    core = 'mihomo',
    autoSetDNS = true,
    diffWorkDir = false,
    mihomoCpuPriority = 'PRIORITY_NORMAL'
  } = appConfig

  const { 'log-level': logLevel = 'info' as LogLevel, tun } = mihomoConfig

  // 清理旧进程
  const pidPath = path.join(dataDir(), 'core.pid')
  if (existsSync(pidPath)) {
    const pid = parseInt(await readFile(pidPath, 'utf-8'))
    try {
      process.kill(pid, 'SIGINT')
    } catch {
      // ignore
    } finally {
      await rm(pidPath)
    }
  }

  // 管理 Smart 内核覆写配置
  await manageSmartOverride()

  // generateProfile 返回实际使用的 current
  const current = await generateProfile()
  await checkProfile(current, core, diffWorkDir)
  if (!skipStop) {
    await stopCore()
  }
  await cleanupSocketFile()

  // 设置 DNS
  if (tun?.enable && autoSetDNS) {
    try {
      await setPublicDNS()
    } catch (error) {
      managerLogger.error('set dns failed', error)
    }
  }

  // 获取动态 IPC 路径
  const ipcPath = getMihomoIpcPath()
  managerLogger.info(`Using IPC path: ${ipcPath}`)

  if (process.platform === 'win32') {
    await validateWindowsPipeAccess(ipcPath)
  }

  return {
    corePath: mihomoCorePath(core),
    workDir: diffWorkDir ? mihomoProfileWorkDir(current) : mihomoWorkDir(),
    ipcPath,
    logLevel,
    tunEnabled: tun?.enable ?? false,
    autoSetDNS,
    cpuPriority: mihomoCpuPriority,
    detached
  }
}

// 启动核心进程
function spawnCoreProcess(config: CoreConfig): ChildProcess {
  const { corePath, workDir, ipcPath, cpuPriority, detached } = config

  const stdout = createWriteStream(coreLogPath(), { flags: 'a' })
  const stderr = createWriteStream(coreLogPath(), { flags: 'a' })

  const proc = spawn(corePath, ['-d', workDir, ctlParam, ipcPath], {
    detached,
    stdio: detached ? 'ignore' : undefined
  })

  if (process.platform === 'win32' && proc.pid) {
    os.setPriority(
      proc.pid,
      os.constants.priority[cpuPriority as keyof typeof os.constants.priority]
    )
  }

  if (!detached) {
    proc.stdout?.pipe(stdout)
    proc.stderr?.pipe(stderr)
  }

  return proc
}

// 设置核心进程事件监听
function setupCoreListeners(
  proc: ChildProcess,
  logLevel: LogLevel,
  resolve: (value: Promise<void>[]) => void,
  reject: (reason: unknown) => void
): void {
  proc.on('close', async (code, signal) => {
    managerLogger.info(`Core closed, code: ${code}, signal: ${signal}`)

    if (isRestarting) {
      managerLogger.info('Core closed during restart, skipping auto-restart')
      return
    }

    if (retry) {
      managerLogger.info('Try Restart Core')
      retry--
      await restartCore()
    } else {
      await stopCore()
    }
  })

  proc.stdout?.on('data', async (data) => {
    const str = data.toString()

    // TUN 权限错误
    if (str.includes('configure tun interface: operation not permitted')) {
      patchControledMihomoConfig({ tun: { enable: false } })
      mainWindow?.webContents.send('controledMihomoConfigUpdated')
      ipcMain.emit('updateTrayMenu')
      reject(i18next.t('tun.error.tunPermissionDenied'))
      return
    }

    // 控制器监听错误
    const isControllerError =
      (process.platform !== 'win32' && str.includes('External controller unix listen error')) ||
      (process.platform === 'win32' && str.includes('External controller pipe listen error'))

    if (isControllerError) {
      managerLogger.error('External controller listen error detected:', str)

      if (process.platform === 'win32') {
        managerLogger.info('Attempting Windows pipe cleanup and retry...')
        try {
          await cleanupWindowsNamedPipes()
          await new Promise((r) => setTimeout(r, 2000))
        } catch (cleanupError) {
          managerLogger.error('Pipe cleanup failed:', cleanupError)
        }
      }

      reject(i18next.t('mihomo.error.externalControllerListenError'))
      return
    }

    // API 就绪
    const isApiReady =
      (process.platform !== 'win32' && str.includes('RESTful API unix listening at')) ||
      (process.platform === 'win32' && str.includes('RESTful API pipe listening at'))

    if (isApiReady) {
      resolve([
        new Promise((innerResolve) => {
          proc.stdout?.on('data', async (innerData) => {
            if (
              innerData
                .toString()
                .toLowerCase()
                .includes('start initial compatible provider default')
            ) {
              try {
                mainWindow?.webContents.send('groupsUpdated')
                mainWindow?.webContents.send('rulesUpdated')
                await uploadRuntimeConfig()
              } catch {
                // ignore
              }
              await patchMihomoConfig({ 'log-level': logLevel })
              innerResolve()
            }
          })
        })
      ])

      await waitForCoreReady()
      await getAxios(true)
      await startMihomoTraffic()
      await startMihomoConnections()
      await startMihomoLogs()
      await startMihomoMemory()
      retry = 10
    }
  })
}

// 启动核心
export async function startCore(detached = false, skipStop = false): Promise<Promise<void>[]> {
  const config = await prepareCore(detached, skipStop)
  child = spawnCoreProcess(config)

  if (detached) {
    managerLogger.info(
      `Core process detached successfully on ${process.platform}, PID: ${child.pid}`
    )
    child.unref()
    return [new Promise(() => {})]
  }

  return new Promise((resolve, reject) => {
    setupCoreListeners(child, config.logLevel, resolve, reject)
  })
}

// 停止核心
export async function stopCore(force = false): Promise<void> {
  try {
    if (!force) {
      await recoverDNS()
    }
  } catch (error) {
    managerLogger.error('recover dns failed', error)
  }

  if (child) {
    child.removeAllListeners()
    child.kill('SIGINT')
  }

  stopMihomoTraffic()
  stopMihomoConnections()
  stopMihomoLogs()
  stopMihomoMemory()

  try {
    await getAxios(true)
  } catch (error) {
    managerLogger.warn('Failed to refresh axios instance:', error)
  }

  await cleanupSocketFile()
}

// 重启核心
export async function restartCore(): Promise<void> {
  if (isRestarting) {
    managerLogger.info('Core restart already in progress, skipping duplicate request')
    return
  }

  isRestarting = true
  let retryCount = 0
  const maxRetries = 3

  try {
    // 先显式停止核心，确保状态干净
    await stopCore()

    // 尝试启动核心，失败时重试
    while (retryCount < maxRetries) {
      try {
        // skipStop=true 因为我们已经在上面停止了核心
        await startCore(false, true)
        return // 成功启动，退出函数
      } catch (e) {
        retryCount++
        managerLogger.error(`restart core failed (attempt ${retryCount}/${maxRetries})`, e)

        if (retryCount >= maxRetries) {
          throw e
        }

        // 重试前等待一段时间
        await new Promise((resolve) => setTimeout(resolve, 1000 * retryCount))
        // 确保清理干净再重试
        await stopCore()
        await cleanupSocketFile()
      }
    }
  } finally {
    isRestarting = false
  }
}

// 保持核心运行
export async function keepCoreAlive(): Promise<void> {
  try {
    await startCore(true)
    if (child?.pid) {
      await writeFile(path.join(dataDir(), 'core.pid'), child.pid.toString())
    }
  } catch (e) {
    safeShowErrorBox('mihomo.error.coreStartFailed', `${e}`)
  }
}

// 退出但保持核心运行
export async function quitWithoutCore(): Promise<void> {
  managerLogger.info(`Starting lightweight mode on platform: ${process.platform}`)

  try {
    await startCore(true)
    if (child?.pid) {
      await writeFile(path.join(dataDir(), 'core.pid'), child.pid.toString())
      managerLogger.info(`Core started in lightweight mode with PID: ${child.pid}`)
    }
  } catch (e) {
    managerLogger.error('Failed to start core in lightweight mode:', e)
    safeShowErrorBox('mihomo.error.coreStartFailed', `${e}`)
  }

  await startMonitor(true)
  managerLogger.info('Exiting main process, core will continue running in background')
  app.exit()
}

// 检查配置文件
async function checkProfile(
  current: string | undefined,
  core: string = 'mihomo',
  diffWorkDir: boolean = false
): Promise<void> {
  const corePath = mihomoCorePath(core)

  try {
    await execFilePromise(corePath, [
      '-t',
      '-f',
      diffWorkDir ? mihomoWorkConfigPath(current) : mihomoWorkConfigPath('work'),
      '-d',
      mihomoTestDir()
    ])
  } catch (error) {
    managerLogger.error('Profile check failed', error)

    if (error instanceof Error && 'stdout' in error) {
      const { stdout, stderr } = error as { stdout: string; stderr?: string }
      managerLogger.info('Profile check stdout', stdout)
      managerLogger.info('Profile check stderr', stderr)

      const errorLines = stdout
        .split('\n')
        .filter((line) => line.includes('level=error') || line.includes('error'))
        .map((line) => {
          if (line.includes('level=error')) {
            return line.split('level=error')[1]?.trim() || line
          }
          return line.trim()
        })
        .filter((line) => line.length > 0)

      if (errorLines.length === 0) {
        const allLines = stdout.split('\n').filter((line) => line.trim().length > 0)
        throw new Error(`${i18next.t('mihomo.error.profileCheckFailed')}:\n${allLines.join('\n')}`)
      } else {
        throw new Error(
          `${i18next.t('mihomo.error.profileCheckFailed')}:\n${errorLines.join('\n')}`
        )
      }
    } else {
      throw new Error(`${i18next.t('mihomo.error.profileCheckFailed')}: ${error}`)
    }
  }
}

// 权限检查入口（从 permissions.ts 调用）
export async function checkAdminRestartForTun(): Promise<void> {
  const { checkAdminRestartForTun: check } = await import('./permissions')
  await check(restartCore)
}
