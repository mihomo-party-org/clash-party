import { ChildProcess, execFile, spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { readFile, mkdir, rm, writeFile } from 'fs/promises'
import { promisify } from 'util'
import path from 'path'
import os from 'os'
import { existsSync, watch, type FSWatcher as NodeFSWatcher } from 'fs'
import chokidar, { type FSWatcher as ChokidarWatcher } from 'chokidar'
import { app, ipcMain } from 'electron'
import { mainWindow } from '../window'
import {
  getAppConfig,
  getControledMihomoConfig,
  getProfileItem,
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
import { uploadRuntimeConfigIfChanged } from '../resolve/gistApi'
import { startMonitor } from '../resolve/trafficMonitor'
import { ensureRuntimeFiles, safeShowErrorBox } from '../utils/init'
import { parseAgeSecretKeys } from '../utils/age'
import i18next from '../../shared/i18n'
import { managerLogger } from '../utils/logger'
import { createCappedLogWritableStream } from '../utils/logFile'
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
import {
  checkAdminRestartForTun as checkAdminRestartForTunWithRestart,
  getSessionAdminStatus,
  setStopCoreBeforeAdminRestart
} from './permissions'
import {
  cleanupSocketFile,
  cleanupWindowsNamedPipes,
  validateWindowsPipeAccess,
  waitForCoreReady,
  verifyProcessOwner
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
const coreHookTimeout = 30000

// 核心进程状态
let child: ChildProcess | null = null
let stoppingChild: ChildProcess | null = null
let retry = 10
let isRestarting = false

// 文件监听器
let coreWatcher: ChokidarWatcher | null = null

type CoreStartupMode = 'log' | 'post-up'

interface CoreStartupHook {
  hookDir: string
  upFile: string
  upFileName: string
  postUpCommand: string
  postDownCommand: string
}

interface CoreHookWaiter {
  promise: Promise<void>
  attachProcess: (process: ChildProcess) => void
}

function hasCoreProcess(): boolean {
  return Boolean(child && !child.killed && child.exitCode === null && child.signalCode === null)
}

async function waitForChildExit(proc: ChildProcess, timeout: number): Promise<boolean> {
  if (proc.exitCode !== null || proc.signalCode !== null) return true

  return new Promise((resolve) => {
    let completed = false
    const complete = (exited: boolean): void => {
      if (completed) return
      completed = true
      clearTimeout(timer)
      proc.off('close', onClose)
      resolve(exited)
    }
    const onClose = (): void => complete(true)
    const timer = setTimeout(() => complete(false), timeout)

    proc.once('close', onClose)
    if (proc.exitCode !== null || proc.signalCode !== null) complete(true)
  })
}

export async function waitForCoreExit(timeout = 800): Promise<void> {
  const proc = child ?? stoppingChild
  if (!proc || (await waitForChildExit(proc, timeout))) return

  try {
    proc.kill('SIGKILL')
  } catch {
    // The process exited after the timeout but before SIGKILL was sent.
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

function hookTouchCommand(file: string): string {
  return process.platform === 'win32' ? `type nul > ${file}` : `: > ${shellQuote(file)}`
}

function coreHookDir(): string {
  if (process.platform === 'win32' && process.env.ProgramData) {
    return path.join(process.env.ProgramData, 'mihomo-party', 'core-hooks')
  }

  return path.join(dataDir(), 'core-hooks')
}

async function createCoreStartupHook(): Promise<CoreStartupHook> {
  const runId = randomUUID()
  const hookDir = coreHookDir()

  await rm(hookDir, { recursive: true, force: true })
  await mkdir(hookDir, { recursive: true })

  const upFileName = `${runId}.up`
  const downFileName = `${runId}.down`
  const upFile = path.join(hookDir, upFileName)
  const downFile = path.join(hookDir, downFileName)

  return {
    hookDir,
    upFile,
    upFileName,
    postUpCommand: hookTouchCommand(upFile),
    postDownCommand: hookTouchCommand(downFile)
  }
}

function createCoreHookWaiter(hook: CoreStartupHook): CoreHookWaiter {
  let watcher: NodeFSWatcher | undefined
  let timer: NodeJS.Timeout | undefined
  let attachedProcess: ChildProcess | undefined
  let completed = false

  let resolvePromise: () => void
  let rejectPromise: (reason?: unknown) => void

  const cleanup = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = undefined
    }
    if (watcher) {
      watcher.close()
      watcher = undefined
    }
    if (attachedProcess) {
      attachedProcess.off('close', handleClose)
      attachedProcess = undefined
    }
  }

  const complete = (error?: unknown): void => {
    if (completed) return
    completed = true
    cleanup()
    if (error) {
      rejectPromise(error)
    } else {
      resolvePromise()
    }
  }

  const handleClose = (code: number | null, signal: NodeJS.Signals | null): void => {
    complete(new Error(`Core startup failed before post-up, code: ${code}, signal: ${signal}`))
  }

  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject

    watcher = watch(hook.hookDir, (_eventType, filename) => {
      const changedFile = filename?.toString()
      if (changedFile === hook.upFileName || (!changedFile && existsSync(hook.upFile))) {
        complete()
      }
    })

    watcher.on('error', complete)

    timer = setTimeout(() => {
      complete(new Error(`Timed out waiting for core post-up: ${coreHookTimeout}ms`))
    }, coreHookTimeout)
  })

  return {
    promise,
    attachProcess: (process) => {
      attachedProcess = process
      attachedProcess.once('close', handleClose)
    }
  }
}

async function stopPidFileCore(): Promise<void> {
  const pidPath = path.join(dataDir(), 'core.pid')
  if (!existsSync(pidPath)) return

  const pidString = await readFile(pidPath, 'utf-8').catch(() => '')
  const pid = parseInt(pidString.trim())
  if (!isNaN(pid)) {
    try {
      const isOwner = await verifyProcessOwner(pid, 'mihomo')
      if (isOwner) {
        process.kill(pid, 'SIGINT')
        await new Promise((resolve) => setTimeout(resolve, 1000))
        try {
          process.kill(pid, 0)
          process.kill(pid, 'SIGKILL')
        } catch {
          // ignore
        }
      } else {
        managerLogger.info(`PID ${pid} is not owned by mihomo, skipping kill`)
      }
    } catch {
      // ignore
    }
  }

  await rm(pidPath).catch(() => {})
}

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

  // 监听 restartCore 事件（用于 DNS 状态恢复等场景，避免循环依赖）
  ipcMain.removeAllListeners('restartCore')
  ipcMain.on('restartCore', async () => {
    await restartCore()
    mainWindow?.webContents.send('appConfigUpdated')
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
  safePath?: string
  ipcPath: string
  logLevel: LogLevel
  tunEnabled: boolean
  autoSetDNS: boolean
  cpuPriority: string
  ageSecretKey?: string
  detached: boolean
  startupMode: CoreStartupMode
  startupHook?: CoreStartupHook
}

function buildCoreEnv(safePath?: string, ageSecretKey?: string): NodeJS.ProcessEnv {
  const env = { ...process.env }
  const normalizedAgeSecretKey = parseAgeSecretKeys(ageSecretKey).join('\n')
  if (normalizedAgeSecretKey) {
    env.CLASH_AGE_SECRET_KEY = normalizedAgeSecretKey
  }
  if (!safePath) return env

  const existingSafePaths = env.SAFE_PATHS?.split(path.delimiter).filter(Boolean) ?? []
  env.SAFE_PATHS = existingSafePaths.includes(safePath)
    ? existingSafePaths.join(path.delimiter)
    : [...existingSafePaths, safePath].join(path.delimiter)
  return env
}

// 准备核心配置
async function prepareCore(detached: boolean, skipStop = false): Promise<CoreConfig> {
  await ensureRuntimeFiles()

  const [appConfig, mihomoConfig] = await Promise.all([getAppConfig(), getControledMihomoConfig()])

  const {
    core = 'mihomo',
    autoSetDNS = true,
    diffWorkDir = false,
    mihomoCpuPriority = 'PRIORITY_NORMAL',
    coreStartupMode = 'log'
  } = appConfig

  const { 'log-level': logLevel = 'info' as LogLevel, tun } = mihomoConfig

  // 清理轻量模式遗留的后台核心
  await stopPidFileCore()

  // 管理 Smart 内核覆写配置
  await manageSmartOverride()

  // generateProfile 返回实际使用的 current
  const current = await generateProfile()
  const ageSecretKey = (await getProfileItem(current))?.ageSecretKey || ''
  await checkProfile(current, core, diffWorkDir, ageSecretKey)
  if (!skipStop && hasCoreProcess()) {
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

  const startupMode: CoreStartupMode = coreStartupMode === 'post-up' ? 'post-up' : 'log'
  const startupHook =
    !detached && startupMode === 'post-up' ? await createCoreStartupHook() : undefined

  return {
    corePath: mihomoCorePath(core),
    workDir: diffWorkDir ? mihomoProfileWorkDir(current) : mihomoWorkDir(),
    safePath: diffWorkDir ? mihomoWorkDir() : undefined,
    ipcPath,
    logLevel,
    tunEnabled: tun?.enable ?? false,
    autoSetDNS,
    cpuPriority: mihomoCpuPriority,
    ageSecretKey,
    detached,
    startupMode,
    startupHook
  }
}

// 启动核心进程
function spawnCoreProcess(config: CoreConfig): ChildProcess {
  const {
    corePath,
    workDir,
    safePath,
    ipcPath,
    cpuPriority,
    ageSecretKey,
    detached,
    startupMode,
    startupHook
  } = config

  const args = ['-d', workDir, ctlParam, ipcPath]
  if (startupHook) {
    args.push('-post-up', startupHook.postUpCommand, '-post-down', startupHook.postDownCommand)
    managerLogger.info(`Core startup mode: post-up, post-up command: ${startupHook.postUpCommand}`)
  } else if (!detached) {
    managerLogger.info(`Core startup mode: ${startupMode}`)
  }

  const proc = spawn(corePath, args, {
    detached,
    stdio: detached ? 'ignore' : undefined,
    env: buildCoreEnv(safePath, ageSecretKey)
  })

  if (process.platform === 'win32' && proc.pid) {
    os.setPriority(
      proc.pid,
      os.constants.priority[cpuPriority as keyof typeof os.constants.priority]
    )
  }

  if (!detached) {
    const stdout = createCappedLogWritableStream(coreLogPath)
    const stderr = createCappedLogWritableStream(coreLogPath)
    proc.stdout?.pipe(stdout)
    proc.stderr?.pipe(stderr)
  }

  return proc
}

// 设置核心进程事件监听
function setupCoreListeners(
  proc: ChildProcess,
  config: CoreConfig,
  hookWaiter: CoreHookWaiter | undefined,
  resolve: (value: Promise<void>[]) => void,
  reject: (reason: unknown) => void
): void {
  const { logLevel, startupMode } = config

  const startMihomoApiStreams = async (): Promise<void> => {
    await waitForCoreReady()
    await getAxios(true)
    await Promise.all([
      startMihomoTraffic(),
      startMihomoConnections(),
      startMihomoLogs(),
      startMihomoMemory()
    ])
    retry = 10
  }

  const completeCoreStartup = async (): Promise<void> => {
    try {
      mainWindow?.webContents.send('groupsUpdated')
      mainWindow?.webContents.send('rulesUpdated')
      await uploadRuntimeConfigIfChanged()
    } catch (error) {
      managerLogger.warn('Failed to sync runtime config to Gist', error)
    }
    await patchMihomoConfig({ 'log-level': logLevel })
  }

  proc.on('close', async (code, signal) => {
    managerLogger.info(`Core closed, code: ${code}, signal: ${signal}`)

    if (child === proc) {
      child = null
    }

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
          await cleanupWindowsNamedPipes(true)
          await new Promise((r) => setTimeout(r, 2000))
        } catch (cleanupError) {
          managerLogger.error('Pipe cleanup failed:', cleanupError)
        }
      }

      reject(i18next.t('mihomo.error.externalControllerListenError'))
      return
    }

    if (startupMode === 'post-up') {
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
              completeCoreStartup()
                .then(() => innerResolve())
                .catch((error) => {
                  managerLogger.warn('Failed to complete core startup', error)
                  innerResolve()
                })
            }
          })
        })
      ])

      await startMihomoApiStreams()
    }
  })

  if (startupMode === 'post-up') {
    if (!hookWaiter) {
      reject(new Error('Core post-up startup mode requires a startup hook'))
      return
    }

    hookWaiter.promise
      .then(async () => {
        managerLogger.info('Core post-up hook triggered')
        await startMihomoApiStreams()
        resolve([completeCoreStartup()])
      })
      .catch(reject)
  }
}

// 启动核心
export async function startCore(detached = false, skipStop = false): Promise<Promise<void>[]> {
  const config = await prepareCore(detached, skipStop)
  const hookWaiter = config.startupHook ? createCoreHookWaiter(config.startupHook) : undefined
  const proc = spawnCoreProcess(config)
  hookWaiter?.attachProcess(proc)
  child = proc

  if (detached) {
    managerLogger.info(
      `Core process detached successfully on ${process.platform}, PID: ${proc.pid}`
    )
    proc.unref()
    return [new Promise(() => {})]
  }

  return new Promise((resolve, reject) => {
    setupCoreListeners(proc, config, hookWaiter, resolve, reject)
  })
}

// 停止核心
export async function stopCore(force = false, waitForExit = false): Promise<void> {
  if (!force && process.platform === 'darwin') {
    try {
      await recoverDNS()
    } catch (error) {
      managerLogger.error('recover dns failed', error)
    }
  }

  if (child) {
    const proc = child
    proc.removeAllListeners()
    stoppingChild = proc
    proc.once('close', () => {
      if (stoppingChild === proc) stoppingChild = null
    })
    proc.kill('SIGINT')
    child = null
  }

  if (waitForExit) await waitForCoreExit()

  stopMihomoTraffic()
  stopMihomoConnections()
  stopMihomoLogs()
  stopMihomoMemory()

  try {
    await getAxios(true)
  } catch (error) {
    managerLogger.warn('Failed to refresh axios instance:', error)
  }

  await stopPidFileCore()
  await cleanupSocketFile()
}

setStopCoreBeforeAdminRestart(stopCore)

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
  await keepCoreAlive()
  await startMonitor(true)
  managerLogger.info('Exiting main process, core will continue running in background')
  app.exit()
}

// 检查配置文件
async function checkProfile(
  current: string | undefined,
  core: string = 'mihomo',
  diffWorkDir: boolean = false,
  ageSecretKey?: string
): Promise<void> {
  const corePath = mihomoCorePath(core)

  try {
    await execFilePromise(
      corePath,
      [
        '-t',
        '-f',
        diffWorkDir ? mihomoWorkConfigPath(current) : mihomoWorkConfigPath('work'),
        '-d',
        mihomoTestDir()
      ],
      { env: buildCoreEnv(undefined, ageSecretKey) }
    )
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
  await checkAdminRestartForTunWithRestart(restartCore)
}
