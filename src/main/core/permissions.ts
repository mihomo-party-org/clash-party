import { exec, execFile } from 'child_process'
import { promisify } from 'util'
import { stat } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { app, dialog, ipcMain } from 'electron'
import { getAppConfig, getControledMihomoConfig, patchControledMihomoConfig } from '../config'
import { mihomoCorePath, mihomoCoreDir } from '../utils/dirs'
import { managerLogger } from '../utils/logger'
import { checkAutoRun, enableAutoRun } from '../sys/autoRun'
import { disableSysProxySync } from '../sys/sysproxy'
import i18next from '../../shared/i18n'
import { checkAdminPrivileges } from './admin'

const execPromise = promisify(exec)
const execFilePromise = promisify(execFile)

// 内核名称白名单
const ALLOWED_CORES = ['mihomo', 'mihomo-alpha', 'mihomo-smart'] as const
type AllowedCore = (typeof ALLOWED_CORES)[number]
type StopCoreBeforeAdminRestart = (force?: boolean) => Promise<void>

let stopCoreBeforeAdminRestart: StopCoreBeforeAdminRestart | null = null

export function setStopCoreBeforeAdminRestart(stopCore: StopCoreBeforeAdminRestart): void {
  stopCoreBeforeAdminRestart = stopCore
}

export function isValidCoreName(core: string): core is AllowedCore {
  return ALLOWED_CORES.includes(core as AllowedCore)
}

export function validateCorePath(corePath: string): void {
  if (corePath.includes('..')) {
    throw new Error('Invalid core path: directory traversal detected')
  }

  const dangerousChars = /[;&|`$(){}[\]<>'"\\]/
  if (dangerousChars.test(path.basename(corePath))) {
    throw new Error('Invalid core path: contains dangerous characters')
  }

  const normalizedPath = path.normalize(path.resolve(corePath))
  const expectedDir = path.normalize(path.resolve(mihomoCoreDir()))

  if (!normalizedPath.startsWith(expectedDir + path.sep) && normalizedPath !== expectedDir) {
    throw new Error('Invalid core path: not in expected directory')
  }
}

function shellEscape(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'"
}

// 会话管理员状态缓存
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

export { checkAdminPrivileges } from './admin'

async function isSetuidRoot(corePath: string): Promise<boolean> {
  try {
    const stats = await stat(corePath)
    return (stats.mode & 0o4000) !== 0 && stats.uid === 0
  } catch {
    return false
  }
}

export async function checkMihomoCorePermissions(): Promise<boolean> {
  const { core = 'mihomo' } = await getAppConfig()
  const corePath = mihomoCorePath(core)

  try {
    if (process.platform === 'win32') {
      return await checkAdminPrivileges()
    }

    if (process.platform === 'darwin' || process.platform === 'linux') {
      return await isSetuidRoot(corePath)
    }
  } catch {
    return false
  }

  return false
}

export async function checkHighPrivilegeCore(): Promise<boolean> {
  try {
    const { core = 'mihomo' } = await getAppConfig()
    const corePath = mihomoCorePath(core)

    managerLogger.info(`Checking high privilege core: ${corePath}`)

    if (process.platform === 'win32') {
      if (!existsSync(corePath)) {
        managerLogger.info('Core file does not exist')
        return false
      }

      const hasHighPrivilegeProcess = await checkHighPrivilegeMihomoProcess()
      if (hasHighPrivilegeProcess) {
        managerLogger.info('Found high privilege mihomo process running')
        return true
      }

      const isAdmin = await checkAdminPrivileges()
      managerLogger.info(`Current process admin privileges: ${isAdmin}`)
      return isAdmin
    }

    if (process.platform === 'darwin' || process.platform === 'linux') {
      managerLogger.info('Non-Windows platform, skipping high privilege core check')
      return false
    }
  } catch (error) {
    managerLogger.error('Failed to check high privilege core', error)
    return false
  }

  return false
}

async function checkHighPrivilegeMihomoProcess(): Promise<boolean> {
  const mihomoExecutables =
    process.platform === 'win32'
      ? ['mihomo.exe', 'mihomo-alpha.exe', 'mihomo-smart.exe']
      : ['mihomo', 'mihomo-alpha', 'mihomo-smart']

  try {
    if (process.platform === 'win32') {
      let stdout = ''
      try {
        const result = await execFilePromise('tasklist', ['/FO', 'CSV', '/NH'], {
          windowsHide: true,
          timeout: 3000,
          maxBuffer: 4 * 1024 * 1024
        })
        stdout = result.stdout
      } catch (error) {
        managerLogger.error('Failed to list processes via tasklist', error)
        return false
      }

      const candidatePids: { pid: string; image: string }[] = []
      for (const line of stdout.split('\n')) {
        const match = line.match(/^"([^"]+)","(\d+)"/)
        if (!match) continue
        const image = match[1].toLowerCase()
        if (mihomoExecutables.includes(image)) {
          candidatePids.push({ pid: match[2], image })
        }
      }

      if (candidatePids.length === 0) {
        managerLogger.info('No mihomo processes found running')
        return false
      }

      managerLogger.info(`Found ${candidatePids.length} mihomo processes running`)

      const pidArgs = candidatePids.map(({ pid }) => pid).join(',')
      try {
        const { stdout: processInfo } = await execFilePromise(
          'powershell',
          [
            '-NoProfile',
            '-Command',
            `Get-Process -Id ${pidArgs} -ErrorAction SilentlyContinue | Select-Object Name,Id,Path | ConvertTo-Json -Compress`
          ],
          { windowsHide: true, timeout: 4000, maxBuffer: 4 * 1024 * 1024 }
        )

        if (!processInfo.trim()) return false

        const parsed = JSON.parse(processInfo)
        const list = Array.isArray(parsed) ? parsed : [parsed]
        for (const proc of list) {
          if (
            proc &&
            typeof proc.Name === 'string' &&
            proc.Name.toLowerCase().includes('mihomo') &&
            proc.Path === null
          ) {
            return true
          }
        }
      } catch (error) {
        managerLogger.info('PowerShell process inspection failed', error)
      }
    } else {
      let foundProcesses = false

      for (const executable of mihomoExecutables) {
        try {
          const { stdout } = await execPromise(`ps aux | grep ${executable} | grep -v grep`)
          const lines = stdout
            .split('\n')
            .filter((line) => line.trim() && line.includes(executable))

          if (lines.length > 0) {
            foundProcesses = true
            managerLogger.info(`Found ${lines.length} ${executable} processes running`)

            for (const line of lines) {
              const parts = line.trim().split(/\s+/)
              if (parts.length >= 1) {
                const user = parts[0]
                managerLogger.info(`${executable} process running as user: ${user}`)

                if (user === 'root') {
                  return true
                }
              }
            }
          }
        } catch {
          // ignore
        }
      }

      if (!foundProcesses) {
        managerLogger.info('No mihomo processes found running')
      }
    }
  } catch (error) {
    managerLogger.error('Failed to check high privilege mihomo process', error)
  }

  return false
}

export async function grantTunPermissions(): Promise<void> {
  const { core = 'mihomo' } = await getAppConfig()

  if (!isValidCoreName(core)) {
    throw new Error(`Invalid core name: ${core}. Allowed values: ${ALLOWED_CORES.join(', ')}`)
  }

  const corePath = mihomoCorePath(core)
  validateCorePath(corePath)

  // macOS 安装包已经把内核设为 setuid root，而系统不允许修改 App 包内的文件（root 也不行），
  // 再执行 chown 只会报 Operation not permitted
  if (process.platform !== 'win32' && (await isSetuidRoot(corePath))) {
    managerLogger.info('Core is already setuid root, skipping permission grant')
    return
  }

  if (process.platform === 'darwin') {
    const escapedPath = shellEscape(corePath)
    const script = `do shell script "chown root:admin ${escapedPath} && chmod +sx ${escapedPath}" with administrator privileges`
    await execFilePromise('osascript', ['-e', script])
  }

  if (process.platform === 'linux') {
    await execFilePromise('pkexec', ['chown', 'root:root', corePath])
    await execFilePromise('pkexec', ['chmod', '+sx', corePath])
  }

  if (process.platform === 'win32') {
    throw new Error('Windows platform requires running as administrator')
  }
}

export async function restartAsAdmin(forTun: boolean = true): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error('This function is only available on Windows')
  }

  const quote = (value: string): string => `'${value.replace(/'/g, "''")}'`
  const args = process.argv.slice(1).filter((arg) => arg !== '--admin-restart-for-tun')
  const restartArgs = forTun ? [...args, '--admin-restart-for-tun'] : args
  const argumentList =
    restartArgs.length > 0 ? ` -ArgumentList ${restartArgs.map(quote).join(', ')}` : ''

  // 提权后的 PowerShell 先等当前进程退出、释放单实例锁，再以管理员身份启动应用
  const relaunch = `Wait-Process -Id ${process.pid} -Timeout 15 -ErrorAction SilentlyContinue; Start-Process -FilePath ${quote(process.execPath)}${argumentList}`
  const encodedRelaunch = Buffer.from(relaunch, 'utf16le').toString('base64')

  // UAC 要趁应用还在前台时请求：应用退出后再请求，Windows 会当作后台请求，只在任务栏闪烁。
  // 用户拒绝时 Start-Process 报错，退出码为 1。
  const elevate = `try { Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -ArgumentList '-NoProfile', '-NonInteractive', '-EncodedCommand', '${encodedRelaunch}' -ErrorAction Stop } catch { exit 1 }`

  managerLogger.info('Requesting admin rights for restart with script', relaunch)
  try {
    await execFilePromise(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', elevate],
      {
        windowsHide: true
      }
    )
  } catch (error) {
    managerLogger.warn('Admin restart was cancelled or failed', error)
    throw new Error('Administrator permission was not granted')
  }

  // 用户已同意，新实例会在本进程退出后启动。先停止 Core，避免新旧进程冲突
  try {
    managerLogger.info('Stopping core before admin restart...')
    await stopCoreBeforeAdminRestart?.(true)
  } catch (error) {
    managerLogger.warn('Failed to stop core before restart:', error)
  }

  // app.exit() 会跳过 before-quit 清理，系统代理会一直指向已停止的 Core；先关掉，新实例启动后会重新开启
  disableSysProxySync()
  managerLogger.info('Admin rights granted, quitting app for restart')
  app.exit(0)
}

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

export async function showTunPermissionDialog(): Promise<boolean> {
  managerLogger.info('Preparing TUN permission dialog...')

  const title = i18next.t('tun.permissions.title') || '需要管理员权限'
  const message =
    i18next.t('tun.permissions.message') ||
    '启用 TUN 模式需要管理员权限，是否现在重启应用获取权限？'
  const confirmText = i18next.t('common.confirm') || '确认'
  const cancelText = i18next.t('common.cancel') || '取消'

  const choice = dialog.showMessageBoxSync({
    type: 'warning',
    title,
    message,
    buttons: [confirmText, cancelText],
    defaultId: 0,
    cancelId: 1
  })

  managerLogger.info(`TUN permission dialog choice: ${choice}`)
  return choice === 0
}

export async function showErrorDialog(title: string, message: string): Promise<void> {
  const okText = i18next.t('common.confirm') || '确认'

  dialog.showMessageBoxSync({
    type: 'error',
    title,
    message,
    buttons: [okText],
    defaultId: 0
  })
}

export async function validateTunPermissionsOnStartup(
  _restartCore: () => Promise<void>
): Promise<void> {
  const { tun } = await getControledMihomoConfig()

  if (!tun?.enable) {
    return
  }

  const hasPermissions = await checkMihomoCorePermissions()

  if (!hasPermissions) {
    // 启动时没有权限，静默禁用 TUN，不弹窗打扰用户
    managerLogger.warn(
      'TUN is enabled but insufficient permissions detected, auto-disabling TUN...'
    )
    await patchControledMihomoConfig({ tun: { enable: false } })

    const { mainWindow } = await import('../index')
    mainWindow?.webContents.send('controledMihomoConfigUpdated')
    ipcMain.emit('updateTrayMenu')

    managerLogger.info('TUN auto-disabled due to insufficient permissions on startup')
  } else {
    managerLogger.info('TUN permissions validated successfully')
  }
}

export async function checkAdminRestartForTun(restartCore: () => Promise<void>): Promise<void> {
  if (process.argv.includes('--admin-restart-for-tun')) {
    managerLogger.info('Detected admin restart for TUN mode, auto-enabling TUN...')

    try {
      if (process.platform === 'win32') {
        const hasAdminPrivileges = await checkAdminPrivileges()
        if (hasAdminPrivileges) {
          await patchControledMihomoConfig({ tun: { enable: true }, dns: { enable: true } })

          const autoRunEnabled = await checkAutoRun()
          if (autoRunEnabled) {
            await enableAutoRun()
          }

          await restartCore()

          managerLogger.info('TUN mode auto-enabled after admin restart')

          const { mainWindow } = await import('../index')
          mainWindow?.webContents.send('controledMihomoConfigUpdated')
          ipcMain.emit('updateTrayMenu')
        } else {
          managerLogger.warn('Admin restart detected but no admin privileges found')
        }
      }
    } catch (error) {
      managerLogger.error('Failed to auto-enable TUN after admin restart', error)
    }
  } else {
    await validateTunPermissionsOnStartup(restartCore)
  }
}

export function checkTunPermissions(): Promise<boolean> {
  return checkMihomoCorePermissions()
}

export function manualGrantCorePermition(): Promise<void> {
  return grantTunPermissions()
}
