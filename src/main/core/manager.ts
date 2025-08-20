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
  patchMihomoConfig
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

export const mihomoIpcPath =
  process.platform === 'win32' ? '\\\\.\\pipe\\MihomoParty\\mihomo' : '/tmp/mihomo-party.sock'
const ctlParam = process.platform === 'win32' ? '-ext-ctl-pipe' : '-ext-ctl-unix'

let setPublicDNSTimer: NodeJS.Timeout | null = null
let recoverDNSTimer: NodeJS.Timeout | null = null
let child: ChildProcess
let retry = 10

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
  const { current } = await getProfileConfig()
  const { tun } = await getControledMihomoConfig()
  const corePath = mihomoCorePath(core)

  // 管理 Smart 内核覆写配置
  await manageSmartOverride()

  await generateProfile()
  await checkProfile()
  await stopCore()
  if (tun?.enable && autoSetDNS) {
    try {
      await setPublicDNS()
    } catch (error) {
      await managerLogger.error('set dns failed', error)
    }
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
    ['-d', diffWorkDir ? mihomoProfileWorkDir(current) : mihomoWorkDir(), ctlParam, mihomoIpcPath],
    {
      detached: true,
      stdio: detached ? 'ignore' : undefined,
      env: env
    }
  )
  if (process.platform === 'win32' && child.pid) {
    os.setPriority(child.pid, os.constants.priority[mihomoCpuPriority])
  }
  if (detached) {
    child.unref()
    return new Promise((resolve) => {
      resolve([new Promise(() => {})])
    })
  }
  child.on('close', async (code, signal) => {
    await managerLogger.info(`Core closed, code: ${code}, signal: ${signal}`)
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
}

export async function restartCore(): Promise<void> {
  try {
    await startCore()
  } catch (e) {
    // 记录错误到日志而不是显示阻塞对话框
    await managerLogger.error('restart core failed', e)
    // 重新抛出错误，让调用者处理
    throw e
  }
}

export async function keepCoreAlive(): Promise<void> {
  try {
    if (!child) await startCore(true)
    if (child && child.pid) {
      await writeFile(path.join(dataDir(), 'core.pid'), child.pid.toString())
    }
  } catch (e) {
    safeShowErrorBox('mihomo.error.coreStartFailed', `${e}`)
  }
}

export async function quitWithoutCore(): Promise<void> {
  await keepCoreAlive()
  await startMonitor(true)
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

export async function checkAdminPrivileges(): Promise<boolean> {
  if (process.platform !== 'win32') {
    return true
  }

  const execPromise = promisify(exec)
  
  try {
    // 首先尝试 fltmc 命令检测管理员权限
    await execPromise('fltmc')
    await managerLogger.info('Admin privileges confirmed via fltmc')
    return true
  } catch (fltmcError) {
    await managerLogger.info('fltmc failed, trying net session as fallback', fltmcError)
    
    try {
      // 如果 fltmc 失败，尝试 net session 命令作为备用检测方法
      await execPromise('net session')
      await managerLogger.info('Admin privileges confirmed via net session')
      return true
    } catch (netSessionError) {
      await managerLogger.info('Both fltmc and net session failed, no admin privileges', netSessionError)
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

    await new Promise(resolve => setTimeout(resolve, 1500))

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
          const { stdout } = await execPromise(`tasklist /FI "IMAGENAME eq ${executable}" /FO CSV`)
          const lines = stdout.split('\n').filter(line => line.includes(executable))

          if (lines.length > 0) {
            await managerLogger.info(`Found ${lines.length} ${executable} processes running`)

            for (const line of lines) {
              const parts = line.split(',')
              if (parts.length >= 2) {
                const pid = parts[1].replace(/"/g, '').trim()
                try {
                  const { stdout: processInfo } = await execPromise(`powershell -Command "Get-Process -Id ${pid} | Select-Object Name,Id,Path,CommandLine | ConvertTo-Json"`)
                  const processJson  = JSON.parse(processInfo)
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
