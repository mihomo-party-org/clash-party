import { ChildProcess, execFile, spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { readFile, mkdir, rm, writeFile } from 'fs/promises'
import { promisify } from 'util'
import { setTimeout as delay } from 'timers/promises'
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
import { createCoreLogWritableStream } from '../utils/logFile'
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
import { syncSmartModelToTestDir } from './smartModel'
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
const automaticRestartDelay = 750
const coreShutdownTimeout = 500
const coreProcessNames = ['mihomo', 'mihomo-alpha', 'mihomo-smart'] as const

// 核心进程状态
interface CoreProcessWatchdog {
  process: ChildProcess
  corePid: number
}

let child: ChildProcess | null = null
let coreProcessWatchdog: CoreProcessWatchdog | null = null
let isRestarting = false
let coreOperationPhase: 'initializing' | 'ready' | 'blocked' | 'shutting-down' = 'ready'
let coreOperationTail: Promise<void> = Promise.resolve()
let pendingRestart: Promise<void> | null = null
let cancelActiveStartup: ((reason: Error) => void) | null = null
let automaticRestartController: AbortController | null = null

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

export function hasCoreProcess(): boolean {
  return Boolean(child && !child.killed && child.exitCode === null && child.signalCode === null)
}

export function beginCoreInitialization(): void {
  coreOperationPhase = 'initializing'
}

export function completeCoreInitialization(canStart: boolean): void {
  if (coreOperationPhase !== 'shutting-down') {
    coreOperationPhase = canStart ? 'ready' : 'blocked'
  }
}

function ensureCoreOperationAllowed(): void {
  if (coreOperationPhase === 'initializing') {
    throw new Error('Core is still initializing')
  }
  if (coreOperationPhase === 'blocked') {
    throw new Error('Core startup is unavailable because startup safety checks did not pass')
  }
  if (coreOperationPhase === 'shutting-down') {
    throw new Error('Core startup was cancelled because the application is shutting down')
  }
}

function ensureNotShuttingDown(): void {
  if (coreOperationPhase === 'shutting-down') {
    throw new Error('Core startup was cancelled because the application is shutting down')
  }
}

function runCoreOperation<T>(operation: () => Promise<T>): Promise<T> {
  const current = coreOperationTail.then(operation, operation)
  coreOperationTail = current.then(
    () => undefined,
    () => undefined
  )
  return current
}

function cancelAutomaticRestart(): void {
  automaticRestartController?.abort()
  automaticRestartController = null
}

function stopCoreProcessWatchdog(corePid?: number): void {
  const watchdog = coreProcessWatchdog
  if (!watchdog || (corePid !== undefined && watchdog.corePid !== corePid)) return

  coreProcessWatchdog = null
  if (watchdog.process.pid) {
    try {
      process.kill(-watchdog.process.pid, 'SIGKILL')
    } catch {
      // The watchdog has already exited.
    }
  }
  watchdog.process.stdin?.destroy()
}

function startCoreProcessWatchdog(proc: ChildProcess, detached: boolean): void {
  if (process.platform !== 'linux' || detached || !proc.pid) return

  stopCoreProcessWatchdog()

  const corePid = proc.pid
  const watchdogProcess = spawn(
    'sh',
    ['-c', 'cat >/dev/null; kill -9 "$1" 2>/dev/null', 'mihomo-core-watchdog', `${corePid}`],
    {
      stdio: ['pipe', 'ignore', 'ignore'],
      detached: true
    }
  )
  coreProcessWatchdog = { process: watchdogProcess, corePid }

  const watchdogStdin = watchdogProcess.stdin as typeof watchdogProcess.stdin & {
    unref?: () => void
  }
  watchdogStdin.unref?.()
  watchdogProcess.unref()

  watchdogProcess.once('error', (error) => {
    if (coreProcessWatchdog?.process === watchdogProcess) {
      coreProcessWatchdog = null
    }
    watchdogProcess.stdin.destroy()
    managerLogger.warn('Failed to start core process watchdog', error)
  })
  watchdogProcess.once('exit', (code, signal) => {
    if (coreProcessWatchdog?.process !== watchdogProcess) return

    coreProcessWatchdog = null
    managerLogger.warn(
      `Core process watchdog exited unexpectedly, code: ${code}, signal: ${signal}`
    )
  })
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
      if (await verifyProcessOwner(pid, coreProcessNames)) {
        process.kill(pid, 'SIGINT')
        const deadline = Date.now() + coreShutdownTimeout
        let stillRunning = true
        while (stillRunning && Date.now() < deadline) {
          await delay(50)
          try {
            process.kill(pid, 0)
          } catch {
            stillRunning = false
          }
        }
        if (stillRunning) {
          try {
            process.kill(pid, 'SIGKILL')
          } catch {
            // ignore
          }
        }
      } else {
        managerLogger.info(`PID ${pid} is not a known mihomo process, skipping kill`)
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
      await restartCore(true)
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
    coreStartupMode = 'log',
    testProfileOnStart = true
  } = appConfig

  const { 'log-level': logLevel = 'info' as LogLevel, tun } = mihomoConfig

  // 清理轻量模式遗留的后台核心
  await stopPidFileCore()

  // 管理 Smart 内核覆写配置
  await manageSmartOverride()

  // generateProfile 返回实际使用的 current
  const current = await generateProfile()
  const ageSecretKey = (await getProfileItem(current))?.ageSecretKey || ''
  if (testProfileOnStart) {
    await checkProfile(current, core, diffWorkDir, ageSecretKey)
  }
  if (!skipStop && hasCoreProcess()) {
    await stopCoreInternal()
  }
  await cleanupSocketFile()

  // 设置 DNS
  if (tun?.enable && autoSetDNS) {
    ensureNotShuttingDown()
    try {
      await setPublicDNS()
    } catch (error) {
      managerLogger.error('set dns failed', error)
    }
    ensureNotShuttingDown()
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
    const stdout = createCoreLogWritableStream(coreLogPath)
    const stderr = createCoreLogWritableStream(coreLogPath)
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
  let startupSettled = false
  const startupTimer =
    startupMode === 'log'
      ? setTimeout(() => {
          rejectStartup(new Error(`Timed out waiting for core API readiness: ${coreHookTimeout}ms`))
        }, coreHookTimeout)
      : undefined

  const resolveStartup = (value: Promise<void>[]): void => {
    if (startupSettled) return
    startupSettled = true
    if (startupTimer) clearTimeout(startupTimer)
    resolve(value)
  }

  const rejectStartup = (reason: unknown): void => {
    if (startupSettled) return
    startupSettled = true
    if (startupTimer) clearTimeout(startupTimer)
    reject(reason)
  }

  const startMihomoApiStreams = async (): Promise<void> => {
    await waitForCoreReady()
    await getAxios(true)
    await Promise.all([
      startMihomoTraffic(),
      startMihomoConnections(),
      startMihomoLogs(),
      startMihomoMemory()
    ])
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
    stopCoreProcessWatchdog(proc.pid)

    if (child === proc) {
      child = null
    }

    if (coreOperationPhase === 'shutting-down') {
      rejectStartup(new Error('Core closed because the application is shutting down'))
      return
    }

    if (isRestarting) {
      managerLogger.info('Core closed during restart, skipping auto-restart')
      rejectStartup(new Error('Core startup was interrupted by restart'))
      return
    }

    if (coreOperationPhase === 'ready') {
      managerLogger.info('Try Restart Core after unexpected exit')
      try {
        await restartCoreAfterUnexpectedExit()
        resolveStartup([])
      } catch (error) {
        managerLogger.error('Automatic core recovery failed', error)
        rejectStartup(error)
      }
    } else {
      await runCoreOperation(() => stopCoreInternal())
      rejectStartup(new Error(`Core exited before startup completed, code: ${code}`))
    }
  })

  proc.stdout?.on('data', async (data) => {
    const str = data.toString()

    // TUN 权限错误
    if (str.includes('configure tun interface: operation not permitted')) {
      patchControledMihomoConfig({ tun: { enable: false } })
      mainWindow?.webContents.send('controledMihomoConfigUpdated')
      ipcMain.emit('updateTrayMenu')
      rejectStartup(i18next.t('tun.error.tunPermissionDenied'))
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

      rejectStartup(i18next.t('mihomo.error.externalControllerListenError'))
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
      resolveStartup([
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
      rejectStartup(new Error('Core post-up startup mode requires a startup hook'))
      return
    }

    hookWaiter.promise
      .then(async () => {
        managerLogger.info('Core post-up hook triggered')
        await startMihomoApiStreams()
        resolveStartup([completeCoreStartup()])
      })
      .catch(rejectStartup)
  }

  cancelActiveStartup = (reason) => rejectStartup(reason)
}

interface CoreStartAttempt {
  readiness: Promise<Promise<void>[]>
}

async function startCoreInternal(detached = false, skipStop = false): Promise<CoreStartAttempt> {
  ensureNotShuttingDown()
  const config = await prepareCore(detached, skipStop)
  ensureNotShuttingDown()
  const hookWaiter = config.startupHook ? createCoreHookWaiter(config.startupHook) : undefined
  const proc = spawnCoreProcess(config)
  hookWaiter?.attachProcess(proc)
  child = proc
  startCoreProcessWatchdog(proc, detached)

  if (detached) {
    managerLogger.info(
      `Core process detached successfully on ${process.platform}, PID: ${proc.pid}`
    )
    proc.unref()
    return { readiness: Promise.resolve([new Promise(() => {})]) }
  }

  const readiness = new Promise<Promise<void>[]>((resolve, reject) => {
    setupCoreListeners(proc, config, hookWaiter, resolve, reject)
  })
  const activeCancel = cancelActiveStartup
  readiness.then(
    () => {
      if (cancelActiveStartup === activeCancel) cancelActiveStartup = null
    },
    () => {
      if (cancelActiveStartup === activeCancel) cancelActiveStartup = null
    }
  )

  return {
    readiness
  }
}

// 互斥只覆盖 prepare/spawn；API-ready 等待在队列外进行，避免 close handler 自重启死锁。
function queueCoreStart(detached = false, skipStop = false): Promise<Promise<void>[]> {
  return runCoreOperation(async () => {
    ensureNotShuttingDown()
    if (!detached && !skipStop && hasCoreProcess()) {
      return { readiness: Promise.resolve<Promise<void>[]>([]) }
    }
    return startCoreInternal(detached, skipStop)
  }).then((attempt) => attempt.readiness)
}

export function startCore(detached = false, skipStop = false): Promise<Promise<void>[]> {
  ensureCoreOperationAllowed()
  return queueCoreStart(detached, skipStop)
}

// 启动期唯一的例外入口：安全检查通过后由主流程调用，仍受退出状态保护。
export function startCoreForStartup(): Promise<Promise<void>[]> {
  if (coreOperationPhase === 'blocked') {
    throw new Error('Core startup is unavailable because startup safety checks did not pass')
  }
  ensureNotShuttingDown()
  return queueCoreStart()
}

async function stopCoreInternal(force = false, cancelStartup = true): Promise<void> {
  if (!force && process.platform === 'darwin') {
    try {
      await recoverDNS()
    } catch (error) {
      managerLogger.error('recover dns failed', error)
    }
  }

  stopCoreProcessAndStreams(cancelStartup)

  await cleanupStoppedCoreResources()
}

function stopCoreProcessAndStreams(cancelStartup = true): void {
  if (cancelStartup) {
    cancelActiveStartup?.(new Error('Core startup was cancelled by a stop request'))
    cancelActiveStartup = null
  }
  if (child) {
    child.removeAllListeners()
    child.kill('SIGINT')
    child = null
  }

  stopCoreProcessWatchdog()

  stopMihomoTraffic()
  stopMihomoConnections()
  stopMihomoLogs()
  stopMihomoMemory()
}

async function cleanupStoppedCoreResources(): Promise<void> {
  try {
    await getAxios(true)
  } catch (error) {
    managerLogger.warn('Failed to refresh axios instance:', error)
  }

  await stopPidFileCore()
  await cleanupSocketFile()
}

export async function stopCore(force = false): Promise<void> {
  ensureCoreOperationAllowed()
  cancelAutomaticRestart()
  return runCoreOperation(() => stopCoreInternal(force))
}

// 退出不排队等待启动/重启完成：先同步终止子进程，再做有界清理。
export async function stopCoreForExit(): Promise<void> {
  coreOperationPhase = 'shutting-down'
  cancelAutomaticRestart()
  stopCoreProcessAndStreams()
  await Promise.allSettled([
    recoverDNS({ force: true, timeout: 750 }),
    cleanupStoppedCoreResources()
  ])
}

setStopCoreBeforeAdminRestart(stopCore)

async function ensureCoreProcessExited(proc: ChildProcess | null): Promise<void> {
  if (!proc) return

  const waitForExit = async (): Promise<boolean> => {
    const deadline = Date.now() + coreShutdownTimeout
    while (proc.exitCode === null && proc.signalCode === null && Date.now() < deadline) {
      await delay(50)
    }
    return proc.exitCode !== null || proc.signalCode !== null
  }

  if (await waitForExit()) return
  managerLogger.warn(`Core PID ${proc.pid ?? 'unknown'} did not exit after SIGINT; sending SIGKILL`)
  proc.kill('SIGKILL')
  if (!(await waitForExit())) {
    throw new Error(`Core PID ${proc.pid ?? 'unknown'} is still running after SIGKILL`)
  }
}

async function restartCoreOnce(forceStop: boolean): Promise<void> {
  const startAttempt = await runCoreOperation(async () => {
    const previousChild = child
    await stopCoreInternal(forceStop)
    if (process.platform === 'darwin') await ensureCoreProcessExited(previousChild)
    return startCoreInternal(false, true)
  })
  await startAttempt.readiness
}

function trackCoreRestart(operation: () => Promise<void>): Promise<void> {
  if (pendingRestart) return pendingRestart

  isRestarting = true
  const restart = operation().finally(() => {
    isRestarting = false
    if (pendingRestart === restart) pendingRestart = null
  })
  pendingRestart = restart
  return restart
}

async function restartCoreAfterUnexpectedExit(): Promise<void> {
  ensureCoreOperationAllowed()
  const controller = new AbortController()
  automaticRestartController = controller
  try {
    await trackCoreRestart(async () => {
      try {
        await restartCoreOnce(true)
      } catch (error) {
        if (controller.signal.aborted || coreOperationPhase === 'shutting-down') throw error

        managerLogger.warn('Automatic core restart failed (attempt 1/2), retrying', error)
        await delay(automaticRestartDelay, undefined, { signal: controller.signal })
        await restartCoreOnce(true)
      }
    })
  } finally {
    if (automaticRestartController === controller) automaticRestartController = null
  }
}

export function restartCore(forceStop = false): Promise<void> {
  ensureCoreOperationAllowed()
  return trackCoreRestart(() => restartCoreOnce(forceStop))
}

// 保持核心运行
export async function keepCoreAlive(): Promise<boolean> {
  try {
    await startCore(true)
    if (child?.pid) {
      await writeFile(path.join(dataDir(), 'core.pid'), child.pid.toString())
    }
    return Boolean(child?.pid)
  } catch (e) {
    safeShowErrorBox('mihomo.error.coreStartFailed', `${e}`)
    return false
  }
}

// PAC 脚本由主进程内的 HTTP 服务提供，轻量模式下主进程退出后该服务随之消失，
// 而系统代理仍指向已经失效的 PAC URL，结果就是一进轻量模式就断网。
// 退出前把系统代理改写成等价的手动代理，直接指向仍在后台运行的内核端口。
// 下次正常启动时 init() 会按配置里的 auto 模式重新拉起 PAC 服务并写回 PAC 地址。
async function keepSysProxyUsableWithoutMainProcess(): Promise<void> {
  try {
    const { sysProxy } = await getAppConfig()
    if (!sysProxy?.enable || (sysProxy.mode ?? 'manual') !== 'auto') return
    const { triggerSysProxy } = await import('../sys/sysproxy')
    await triggerSysProxy(true, { force: true, forceManual: true })
    managerLogger.info('Rewrote PAC system proxy to manual before entering lightweight mode')
  } catch (error) {
    managerLogger.warn('Failed to rewrite PAC system proxy before lightweight mode', error)
  }
}

// 退出但保持核心运行
export async function quitWithoutCore(): Promise<void> {
  managerLogger.info(`Starting lightweight mode on platform: ${process.platform}`)
  if (!(await keepCoreAlive())) return
  await keepSysProxyUsableWithoutMainProcess()
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
  await checkProfileConfig(
    diffWorkDir ? mihomoWorkConfigPath(current) : mihomoWorkConfigPath('work'),
    core,
    ageSecretKey
  )
}

export async function checkProfileConfig(
  configPath: string,
  core: string = 'mihomo',
  ageSecretKey?: string
): Promise<void> {
  const corePath = mihomoCorePath(core)
  await syncSmartModelToTestDir()

  try {
    await execFilePromise(corePath, ['-t', '-f', configPath, '-d', mihomoTestDir()], {
      env: buildCoreEnv(undefined, ageSecretKey)
    })
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
