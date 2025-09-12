import { ChildProcess, exec, execFile, spawn } from 'child_process'
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
import { generateProfile } from './factory'
import {
  getAppConfig,
  getControledMihomoConfig,
  getProfileConfig,
  patchAppConfig,
  patchControledMihomoConfig,
  manageSmartOverride
} from '../config'
import { app, ipcMain, net } from 'electron'
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
import chokidar from 'chokidar'
import { readFile, rm, writeFile } from 'fs/promises'
import { promisify } from 'util'
import { mainWindow } from '..'
import path from 'path'
import os from 'os'
import { createWriteStream, existsSync } from 'fs'
import { uploadRuntimeConfig } from '../resolve/gistApi'
import { startMonitor } from '../resolve/trafficMonitor'
import { safeShowErrorBox } from '../utils/init'
import i18next from '../../shared/i18n'
import { managerLogger } from '../utils/logger'

chokidar.watch(path.join(mihomoCoreDir(), 'meta-update'), {}).on('unlinkDir', async () => {
  try {
    await stopCore(true)
    await startCore()
  } catch (e) {
    safeShowErrorBox('mihomo.error.coreStartFailed', `${e}`)
  }
})

// 动态生成 IPC 路径
export const getMihomoIpcPath = (): string => {
  if (process.platform === 'win32') {
    const isAdmin = getSessionAdminStatus()
    const sessionId = process.env.SESSIONNAME || process.env.USERNAME || 'default'
    const processId = process.pid

    if (isAdmin) {
      return `\\\\.\\pipe\\MihomoParty\\mihomo-admin-${sessionId}-${processId}`
    } else {
      return `\\\\.\\pipe\\MihomoParty\\mihomo-user-${sessionId}-${processId}`
    }
  }

  const uid = process.getuid?.() || 'unknown'
  const processId = process.pid

  return `/tmp/mihomo-party-${uid}-${processId}.sock`
}

const ctlParam = process.platform === 'win32' ? '-ext-ctl-pipe' : '-ext-ctl-unix'

let setPublicDNSTimer: NodeJS.Timeout | null = null
let recoverDNSTimer: NodeJS.Timeout | null = null
let child: ChildProcess
let retry = 10
let isRestarting = false

export async function startCore(detached = false): Promise<Promise<void>[]> {
  const {
    core = 'mihomo',
    autoSetDNS = true,
    diffWorkDir = false,
    mihomoCpuPriority = 'PRIORITY_NORMAL',
    disableLoopbackDetector = false,
    disableEmbedCA = false,
    disableSystemCA = false,
    skipSafePathCheck = false
  } = await getAppConfig()
  const { 'log-level': logLevel } = await getControledMihomoConfig()
  if (existsSync(path.join(dataDir(), 'core.pid'))) {
    const pid = parseInt(await readFile(path.join(dataDir(), 'core.pid'), 'utf-8'))
    try {
      process.kill(pid, 'SIGINT')
    } catch {
      // ignore
    } finally {
      await rm(path.join(dataDir(), 'core.pid'))
    }
  }
  const { current } = await getProfileConfig(true)
  const { tun } = await getControledMihomoConfig()
  const corePath = mihomoCorePath(core)

  // 管理 Smart 内核覆写配置
  await manageSmartOverride()

  await generateProfile()
  await checkProfile()
  await stopCore()

  await cleanupSocketFile()

  if (tun?.enable && autoSetDNS) {
    try {
      await setPublicDNS()
    } catch (error) {
      await managerLogger.error('set dns failed', error)
    }
  }

  // 获取动态 IPC 路径
  const dynamicIpcPath = getMihomoIpcPath()
  await managerLogger.info(`Using IPC path: ${dynamicIpcPath}`)

  if (process.platform === 'win32') {
    await validateWindowsPipeAccess(dynamicIpcPath)
  }

  // 内核日志输出到独立的 core-日期.log 文件
  const stdout = createWriteStream(coreLogPath(), { flags: 'a' })
  const stderr = createWriteStream(coreLogPath(), { flags: 'a' })
  const env = {
    DISABLE_LOOPBACK_DETECTOR: String(disableLoopbackDetector),
    DISABLE_EMBED_CA: String(disableEmbedCA),
    DISABLE_SYSTEM_CA: String(disableSystemCA),
    SKIP_SAFE_PATH_CHECK: String(skipSafePathCheck)
  }
  child = spawn(
    corePath,
    ['-d', diffWorkDir ? mihomoProfileWorkDir(current) : mihomoWorkDir(), ctlParam, dynamicIpcPath],
    {
      detached: detached,
      stdio: detached ? 'ignore' : undefined,
      env: env
    }
  )
  if (process.platform === 'win32' && child.pid) {
    os.setPriority(child.pid, os.constants.priority[mihomoCpuPriority])
  }
  if (detached) {
    await managerLogger.info(`Core process detached successfully on ${process.platform}, PID: ${child.pid}`)
    child.unref()
    return new Promise((resolve) => {
      resolve([new Promise(() => {})])
    })
  }
  child.on('close', async (code, signal) => {
    await managerLogger.info(`Core closed, code: ${code}, signal: ${signal}`)

    if (isRestarting) {
      await managerLogger.info('Core closed during restart, skipping auto-restart')
      return
    }

    if (retry) {
      await managerLogger.info('Try Restart Core')
      retry--
      await restartCore()
    } else {
      await stopCore()
    }
  })
  child.stdout?.pipe(stdout)
  child.stderr?.pipe(stderr)
  return new Promise((resolve, reject) => {
    child.stdout?.on('data', async (data) => {
      const str = data.toString()
      if (str.includes('configure tun interface: operation not permitted')) {
        patchControledMihomoConfig({ tun: { enable: false } })
        mainWindow?.webContents.send('controledMihomoConfigUpdated')
        ipcMain.emit('updateTrayMenu')
        reject(i18next.t('tun.error.tunPermissionDenied'))
      }

      if ((process.platform !== 'win32' && str.includes('External controller unix listen error')) ||
        (process.platform === 'win32' && str.includes('External controller pipe listen error'))
      ) {
        await managerLogger.error('External controller listen error detected:', str)

        if (process.platform === 'win32') {
          await managerLogger.info('Attempting Windows pipe cleanup and retry...')
          try {
            await cleanupWindowsNamedPipes()
            await new Promise(resolve => setTimeout(resolve, 2000))
          } catch (cleanupError) {
            await managerLogger.error('Pipe cleanup failed:', cleanupError)
          }
        }

        reject(i18next.t('mihomo.error.externalControllerListenError'))
      }

      if (
        (process.platform !== 'win32' && str.includes('RESTful API unix listening at')) ||
        (process.platform === 'win32' && str.includes('RESTful API pipe listening at'))
      ) {
        resolve([
          new Promise((resolve) => {
            child.stdout?.on('data', async (data) => {
              if (data.toString().toLowerCase().includes('start initial compatible provider default')) {
                try {
                  mainWindow?.webContents.send('groupsUpdated')
                  mainWindow?.webContents.send('rulesUpdated')
                  await uploadRuntimeConfig()
                } catch {
                  // ignore
                }
                await patchMihomoConfig({ 'log-level': logLevel })
                resolve()
              }
            })
          })
        ])

        await waitForCoreReady()

        // 强制刷新 axios 实例以使用新的管道路径
        await getAxios(true)
        await startMihomoTraffic()
        await startMihomoConnections()
        await startMihomoLogs()
        await startMihomoMemory()
        retry = 10
      }
    })
  })
}

export async function stopCore(force = false): Promise<void> {
  try {
    if (!force) {
      await recoverDNS()
    }
  } catch (error) {
    await managerLogger.error('recover dns failed', error)
  }

  if (child) {
    child.removeAllListeners()
    child.kill('SIGINT')
  }
  stopMihomoTraffic()
  stopMihomoConnections()
  stopMihomoLogs()
  stopMihomoMemory()

  // 强制刷新 axios
  try {
    await getAxios(true)
  } catch (error) {
    await managerLogger.warn('Failed to refresh axios instance:', error)
  }

  // 清理 Socket 文件
  await cleanupSocketFile()
}
async function cleanupSocketFile(): Promise<void> {
  if (process.platform === 'win32') {
    await cleanupWindowsNamedPipes()
  } else {
    await cleanupUnixSockets()
  }
}

// Windows 命名管道清理
async function cleanupWindowsNamedPipes(): Promise<void> {
  try {
    const execPromise = promisify(exec)

    try {
      const { stdout } = await execPromise(
        `powershell -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Process | Where-Object {$_.ProcessName -like '*mihomo*'} | Select-Object Id,ProcessName | ConvertTo-Json"`,
        { encoding: 'utf8' }
      )

      if (stdout.trim()) {
        await managerLogger.info(`Found potential pipe-blocking processes: ${stdout}`)

        try {
          const processes = JSON.parse(stdout)
          const processArray = Array.isArray(processes) ? processes : [processes]

          for (const proc of processArray) {
            const pid = proc.Id
            if (pid && pid !== process.pid) {
              try {
                // 先检查进程是否存在
                process.kill(pid, 0)
                process.kill(pid, 'SIGTERM')
                await managerLogger.info(`Terminated process ${pid} to free pipe`)
              } catch (error: any) {
                if (error.code !== 'ESRCH') {
                  await managerLogger.warn(`Failed to terminate process ${pid}:`, error)
                }
              }
            }
          }
        } catch (parseError) {
          await managerLogger.warn('Failed to parse process list JSON:', parseError)

          // 回退到文本解析
          const lines = stdout.split('\n').filter(line => line.includes('mihomo'))
          for (const line of lines) {
            const match = line.match(/(\d+)/)
            if (match) {
              const pid = parseInt(match[1])
              if (pid !== process.pid) {
                try {
                  process.kill(pid, 0)
                  process.kill(pid, 'SIGTERM')
                  await managerLogger.info(`Terminated process ${pid} to free pipe`)
                } catch (error: any) {
                  if (error.code !== 'ESRCH') {
                    await managerLogger.warn(`Failed to terminate process ${pid}:`, error)
                  }
                }
              }
            }
          }
        }
      }
    } catch (error) {
      await managerLogger.warn('Failed to check mihomo processes:', error)
    }

    await new Promise(resolve => setTimeout(resolve, 1000))

  } catch (error) {
    await managerLogger.error('Windows named pipe cleanup failed:', error)
  }
}

// Unix Socket 清理
async function cleanupUnixSockets(): Promise<void> {
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
          await managerLogger.info(`Cleaned up socket file: ${socketPath}`)
        }
      } catch (error) {
        await managerLogger.warn(`Failed to cleanup socket file ${socketPath}:`, error)
      }
    }
  } catch (error) {
    await managerLogger.error('Unix socket cleanup failed:', error)
  }
}

// Windows 命名管道访问验证
async function validateWindowsPipeAccess(pipePath: string): Promise<void> {
  try {
    await managerLogger.info(`Validating pipe access for: ${pipePath}`)
    await managerLogger.info(`Pipe validation completed for: ${pipePath}`)
  } catch (error) {
    await managerLogger.error('Windows pipe validation failed:', error)
  }
}

export async function restartCore(): Promise<void> {
  // 防止并发重启
  if (isRestarting) {
    await managerLogger.info('Core restart already in progress, skipping duplicate request')
    return
  }

  isRestarting = true
  try {
    await startCore()
  } catch (e) {
    await managerLogger.error('restart core failed', e)
    throw e
  } finally {
    isRestarting = false
  }
}

export async function keepCoreAlive(): Promise<void> {
  try {
    await startCore(true)
    if (child && child.pid) {
      await writeFile(path.join(dataDir(), 'core.pid'), child.pid.toString())
    }
  } catch (e) {
    safeShowErrorBox('mihomo.error.coreStartFailed', `${e}`)
  }
}

export async function quitWithoutCore(): Promise<void> {
  await managerLogger.info(`Starting lightweight mode on platform: ${process.platform}`)

  try {
    await startCore(true)
    if (child && child.pid) {
      await writeFile(path.join(dataDir(), 'core.pid'), child.pid.toString())
      await managerLogger.info(`Core started in lightweight mode with PID: ${child.pid}`)
    }
  } catch (e) {
    await managerLogger.error('Failed to start core in lightweight mode:', e)
    safeShowErrorBox('mihomo.error.coreStartFailed', `${e}`)
  }

  await startMonitor(true)
  await managerLogger.info('Exiting main process, core will continue running in background')
  app.exit()
}

async function checkProfile(): Promise<void> {
  const {
    core = 'mihomo',
    diffWorkDir = false,
    skipSafePathCheck = false
  } = await getAppConfig()
  const { current } = await getProfileConfig()
  const corePath = mihomoCorePath(core)
  const execFilePromise = promisify(execFile)
  const env = {
    SKIP_SAFE_PATH_CHECK: String(skipSafePathCheck)
  }
  try {
    await execFilePromise(corePath, [
      '-t',
      '-f',
      diffWorkDir ? mihomoWorkConfigPath(current) : mihomoWorkConfigPath('work'),
      '-d',
      mihomoTestDir()
    ], { env })
  } catch (error) {
    await managerLogger.error('Profile check failed', error)

    if (error instanceof Error && 'stdout' in error) {
      const { stdout, stderr } = error as { stdout: string; stderr?: string }
      await managerLogger.info('Profile check stdout', stdout)
      await managerLogger.info('Profile check stderr', stderr)

      const errorLines = stdout
        .split('\n')
        .filter((line) => line.includes('level=error') || line.includes('error'))
        .map((line) => {
          if (line.includes('level=error')) {
            return line.split('level=error')[1]?.trim() || line
          }
          return line.trim()
        })
        .filter(line => line.length > 0)

      if (errorLines.length === 0) {
        const allLines = stdout.split('\n').filter(line => line.trim().length > 0)
        throw new Error(`${i18next.t('mihomo.error.profileCheckFailed')}:\n${allLines.join('\n')}`)
      } else {
        throw new Error(`${i18next.t('mihomo.error.profileCheckFailed')}:\n${errorLines.join('\n')}`)
      }
    } else {
      throw new Error(`${i18next.t('mihomo.error.profileCheckFailed')}: ${error}`)
    }
  }
}

export async function checkTunPermissions(): Promise<boolean> {
  const { core = 'mihomo' } = await getAppConfig()
  const corePath = mihomoCorePath(core)

  try {
    if (process.platform === 'win32') {
      return await checkAdminPrivileges()
    }

    if (process.platform === 'darwin' || process.platform === 'linux') {
      const { stat } = await import('fs/promises')
      const stats = await stat(corePath)
      return (stats.mode & 0o4000) !== 0 && stats.uid === 0
    }
  } catch {
    return false
  }

  return false
}

export async function grantTunPermissions(): Promise<void> {
  const { core = 'mihomo' } = await getAppConfig()
  const corePath = mihomoCorePath(core)
  const execPromise = promisify(exec)
  const execFilePromise = promisify(execFile)

  if (process.platform === 'darwin') {
    const shell = `chown root:admin ${corePath.replace(' ', '\\\\ ')}\nchmod +sx ${corePath.replace(' ', '\\\\ ')}`
    const command = `do shell script "${shell}" with administrator privileges`
    await execPromise(`osascript -e '${command}'`)
  }

  if (process.platform === 'linux') {
    await execFilePromise('pkexec', [
      'bash',
      '-c',
      `chown root:root "${corePath}" && chmod +sx "${corePath}"`
    ])
  }

  if (process.platform === 'win32') {
    throw new Error('Windows platform requires running as administrator')
  }
}

// 在应用启动时检测一次权限
let sessionAdminStatus: boolean | null = null

export async function initAdminStatus(): Promise<void> {
  if (process.platform === 'win32' && sessionAdminStatus === null) {
    sessionAdminStatus = await checkAdminPrivileges().catch(() => false)
  }
}

export function getSessionAdminStatus(): boolean {
  if (process.platform !== 'win32') {
    return true
  }
  return sessionAdminStatus ?? false
}

// 等待内核完全启动并创建管道
async function waitForCoreReady(): Promise<void> {
  const maxRetries = 30
  const retryInterval = 500

  for (let i = 0; i < maxRetries; i++) {
    try {
      const axios = await getAxios(true)
      await axios.get('/')
      await managerLogger.info(`Core ready after ${i + 1} attempts (${(i + 1) * retryInterval}ms)`)
      return
    } catch (error) {
      if (i === 0) {
        await managerLogger.info('Waiting for core to be ready...')
      }

      if (i === maxRetries - 1) {
        await managerLogger.warn(`Core not ready after ${maxRetries} attempts, proceeding anyway`)
        return
      }

      await new Promise(resolve => setTimeout(resolve, retryInterval))
    }
  }
}

export async function checkAdminPrivileges(): Promise<boolean> {
  if (process.platform !== 'win32') {
    return true
  }

  const execPromise = promisify(exec)
  
  try {
    // fltmc 检测管理员权限
    await execPromise('chcp 65001 >nul 2>&1 && fltmc', { encoding: 'utf8' })
    await managerLogger.info('Admin privileges confirmed via fltmc')
    return true
  } catch (fltmcError: any) {
    const errorCode = fltmcError?.code || 0
    await managerLogger.debug(`fltmc failed with code ${errorCode}, trying net session as fallback`)
    
    try {
      // net session 备用
      await execPromise('chcp 65001 >nul 2>&1 && net session', { encoding: 'utf8' })
      await managerLogger.info('Admin privileges confirmed via net session')
      return true
    } catch (netSessionError: any) {
      const netErrorCode = netSessionError?.code || 0
      await managerLogger.debug(`Both fltmc and net session failed, no admin privileges. Error codes: fltmc=${errorCode}, net=${netErrorCode}`)
      return false
    }
  }
}

// TUN 权限确认框
export async function showTunPermissionDialog(): Promise<boolean> {
  const { dialog } = await import('electron')
  const i18next = await import('i18next')

  await managerLogger.info('Preparing TUN permission dialog...')
  await managerLogger.info(`i18next available: ${typeof i18next.t === 'function'}`)

  const title = i18next.t('tun.permissions.title') || '需要管理员权限'
  const message = i18next.t('tun.permissions.message') || '启用TUN模式需要管理员权限，是否现在重启应用获取权限？'
  const confirmText = i18next.t('common.confirm') || '确认'
  const cancelText = i18next.t('common.cancel') || '取消'

  await managerLogger.info(`Dialog texts - Title: "${title}", Message: "${message}", Confirm: "${confirmText}", Cancel: "${cancelText}"`)

  const choice = dialog.showMessageBoxSync({
    type: 'warning',
    title: title,
    message: message,
    buttons: [confirmText, cancelText],
    defaultId: 0,
    cancelId: 1
  })

  await managerLogger.info(`TUN permission dialog choice: ${choice}`)

  return choice === 0
}

// 错误显示框
export async function showErrorDialog(title: string, message: string): Promise<void> {
  const { dialog } = await import('electron')
  const i18next = await import('i18next')

  const okText = i18next.t('common.confirm') || '确认'

  dialog.showMessageBoxSync({
    type: 'error',
    title: title,
    message: message,
    buttons: [okText],
    defaultId: 0
  })
}

export async function restartAsAdmin(forTun: boolean = true): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error('This function is only available on Windows')
  }

  const exePath = process.execPath
  const args = process.argv.slice(1)
  const restartArgs = forTun ? [...args, '--admin-restart-for-tun'] : args

  try {
    // 处理路径和参数的引号
    const escapedExePath = exePath.replace(/'/g, "''")
    const argsString = restartArgs.map(arg => arg.replace(/'/g, "''")).join("', '")

    let command: string
    if (restartArgs.length > 0) {
      command = `powershell -Command "Start-Process -FilePath '${escapedExePath}' -ArgumentList '${argsString}' -Verb RunAs"`
    } else {
      command = `powershell -Command "Start-Process -FilePath '${escapedExePath}' -Verb RunAs"`
    }

    await managerLogger.info('Restarting as administrator with command', command)

    // 执行PowerShell命令
    exec(command, { windowsHide: true }, async (error, _stdout, stderr) => {
      if (error) {
        await managerLogger.error('PowerShell execution error', error)
        await managerLogger.error('stderr', stderr)
      } else {
        await managerLogger.info('PowerShell command executed successfully')
      }
    })

    const { app } = await import('electron')
    app.quit()
  } catch (error) {
    await managerLogger.error('Failed to restart as administrator', error)
    throw new Error(`Failed to restart as administrator: ${error}`)
  }
}

export async function checkMihomoCorePermissions(): Promise<boolean> {
  const { core = 'mihomo' } = await getAppConfig()
  const corePath = mihomoCorePath(core)

  try {
    if (process.platform === 'win32') {
      // Windows权限检查
      return await checkAdminPrivileges()
    }

    if (process.platform === 'darwin' || process.platform === 'linux') {
      const { stat } = await import('fs/promises')
      const stats = await stat(corePath)
      return (stats.mode & 0o4000) !== 0 && stats.uid === 0
    }
  } catch {
    return false
  }

  return false
}

// 检测高权限内核
export async function checkHighPrivilegeCore(): Promise<boolean> {
  try {
    const { core = 'mihomo' } = await getAppConfig()
    const corePath = mihomoCorePath(core)

    await managerLogger.info(`Checking high privilege core: ${corePath}`)

    if (process.platform === 'win32') {
      const { existsSync } = await import('fs')
      if (!existsSync(corePath)) {
        await managerLogger.info('Core file does not exist')
        return false
      }

      const hasHighPrivilegeProcess = await checkHighPrivilegeMihomoProcess()
      if (hasHighPrivilegeProcess) {
        await managerLogger.info('Found high privilege mihomo process running')
        return true
      }

      const isAdmin = await checkAdminPrivileges()
      await managerLogger.info(`Current process admin privileges: ${isAdmin}`)
      return isAdmin
    }

    if (process.platform === 'darwin' || process.platform === 'linux') {
      await managerLogger.info('Non-Windows platform, skipping high privilege core check')
      return false
    }
  } catch (error) {
    await managerLogger.error('Failed to check high privilege core', error)
    return false
  }

  return false
}

async function checkHighPrivilegeMihomoProcess(): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      const execPromise = promisify(exec)

      const mihomoExecutables = ['mihomo.exe', 'mihomo-alpha.exe', 'mihomo-smart.exe']

      for (const executable of mihomoExecutables) {
        try {
          const { stdout } = await execPromise(`chcp 65001 >nul 2>&1 && tasklist /FI "IMAGENAME eq ${executable}" /FO CSV`, { encoding: 'utf8' })
          const lines = stdout.split('\n').filter(line => line.includes(executable))

          if (lines.length > 0) {
            await managerLogger.info(`Found ${lines.length} ${executable} processes running`)

            for (const line of lines) {
              const parts = line.split(',')
              if (parts.length >= 2) {
                const pid = parts[1].replace(/"/g, '').trim()
                try {
                  const { stdout: processInfo } = await execPromise(
                    `powershell -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Process -Id ${pid} | Select-Object Name,Id,Path,CommandLine | ConvertTo-Json"`,
                    { encoding: 'utf8' }
                  )
                  const processJson = JSON.parse(processInfo)
                  await managerLogger.info(`Process ${pid} info: ${processInfo.substring(0, 200)}`)

                  if (processJson.Name.includes('mihomo') && processJson.Path === null) {
                    return true
                  }
                } catch (error) {
                  await managerLogger.info(`Cannot get info for process ${pid}, might be high privilege`)
                }
              }
            }
          }
        } catch (error) {
          await managerLogger.error(`Failed to check ${executable} processes`, error)
        }
      }
    }

    if (process.platform === 'darwin' || process.platform === 'linux') {
      const execPromise = promisify(exec)

      try {
        const mihomoExecutables = ['mihomo', 'mihomo-alpha', 'mihomo-smart']
        let foundProcesses = false

        for (const executable of mihomoExecutables) {
          try {
            const { stdout } = await execPromise(`ps aux | grep ${executable} | grep -v grep`)
            const lines = stdout.split('\n').filter(line => line.trim() && line.includes(executable))

            if (lines.length > 0) {
              foundProcesses = true
              await managerLogger.info(`Found ${lines.length} ${executable} processes running`)

              for (const line of lines) {
                const parts = line.trim().split(/\s+/)
                if (parts.length >= 1) {
                  const user = parts[0]
                  await managerLogger.info(`${executable} process running as user: ${user}`)

                  if (user === 'root') {
                    return true
                  }
                }
              }
            }
          } catch (error) {
          }
        }

        if (!foundProcesses) {
          await managerLogger.info('No mihomo processes found running')
        }
      } catch (error) {
        await managerLogger.error('Failed to check mihomo processes on Unix', error)
      }
    }
  } catch (error) {
    await managerLogger.error('Failed to check high privilege mihomo process', error)
  }

  return false
}

// TUN模式获取权限
export async function requestTunPermissions(): Promise<void> {
  if (process.platform === 'win32') {
    await restartAsAdmin()
  } else {
    const hasPermissions = await checkMihomoCorePermissions()
    if (!hasPermissions) {
      await grantTunPermissions()
    }
  }
}

export async function checkAdminRestartForTun(): Promise<void> {
  if (process.argv.includes('--admin-restart-for-tun')) {
    await managerLogger.info('Detected admin restart for TUN mode, auto-enabling TUN...')

    try {
      if (process.platform === 'win32') {
        const hasAdminPrivileges = await checkAdminPrivileges()
        if (hasAdminPrivileges) {
          await patchControledMihomoConfig({ tun: { enable: true }, dns: { enable: true } })

          const { checkAutoRun, enableAutoRun } = await import('../sys/autoRun')
          const autoRunEnabled = await checkAutoRun()
          if (autoRunEnabled) {
            await enableAutoRun()
          }

          await restartCore()

          await managerLogger.info('TUN mode auto-enabled after admin restart')

          const { mainWindow } = await import('../index')
          mainWindow?.webContents.send('controledMihomoConfigUpdated')
          ipcMain.emit('updateTrayMenu')
        } else {
          await managerLogger.warn('Admin restart detected but no admin privileges found')
        }
      }
    } catch (error) {
      await managerLogger.error('Failed to auto-enable TUN after admin restart', error)
    }
  } else {
    // 检查TUN配置与权限的匹配，但不自动开启 TUN
    await validateTunPermissionsOnStartup()
  }
}

export async function validateTunPermissionsOnStartup(): Promise<void> {
  try {
    const { tun } = await getControledMihomoConfig()

    if (!tun?.enable) {
      return
    }

    const hasPermissions = await checkMihomoCorePermissions()

    if (!hasPermissions) {
      await managerLogger.warn(
        'TUN is enabled but insufficient permissions detected, prompting user...'
      )
      const confirmed = await showTunPermissionDialog()
      if (confirmed) {
        await restartAsAdmin()
        return
      }

      await managerLogger.warn('User declined admin restart, auto-disabling TUN...')
      await patchControledMihomoConfig({ tun: { enable: false } })

      const { mainWindow } = await import('../index')
      mainWindow?.webContents.send('controledMihomoConfigUpdated')
      ipcMain.emit('updateTrayMenu')

      await managerLogger.info('TUN auto-disabled due to insufficient permissions')
    } else {
      await managerLogger.info('TUN permissions validated successfully')
    }
  } catch (error) {
    await managerLogger.error('Failed to validate TUN permissions on startup', error)
  }
}

export async function manualGrantCorePermition(): Promise<void> {
  return grantTunPermissions()
}

export async function getDefaultDevice(): Promise<string> {
  const execPromise = promisify(exec)
  const { stdout: deviceOut } = await execPromise(`route -n get default`)
  let device = deviceOut.split('\n').find((s) => s.includes('interface:'))
  device = device?.trim().split(' ').slice(1).join(' ')
  if (!device) throw new Error('Get device failed')
  return device
}

async function getDefaultService(): Promise<string> {
  const execPromise = promisify(exec)
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
  const execPromise = promisify(exec)
  const service = await getDefaultService()
  const { stdout: dns } = await execPromise(`networksetup -getdnsservers "${service}"`)
  if (dns.startsWith("There aren't any DNS Servers set on")) {
    await patchAppConfig({ originDNS: 'Empty' })
  } else {
    await patchAppConfig({ originDNS: dns.trim().replace(/\n/g, ' ') })
  }
}

async function setDNS(dns: string): Promise<void> {
  const service = await getDefaultService()
  const execPromise = promisify(exec)
  await execPromise(`networksetup -setdnsservers "${service}" ${dns}`)
}

async function setPublicDNS(): Promise<void> {
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

async function recoverDNS(): Promise<void> {
  if (process.platform !== 'darwin') return
  if (net.isOnline()) {
    const { originDNS } = await getAppConfig()
    if (originDNS) {
      await setDNS(originDNS)
      await patchAppConfig({ originDNS: undefined })
    }
  } else {
    if (recoverDNSTimer) clearTimeout(recoverDNSTimer)
    recoverDNSTimer = setTimeout(() => recoverDNS(), 5000)
  }
}
