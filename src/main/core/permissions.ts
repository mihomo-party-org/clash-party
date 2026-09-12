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

export async function checkMihomoCorePermissions(): Promise<boolean> {
  const { core = 'mihomo' } = await getAppConfig()
  const corePath = mihomoCorePath(core)

  try {
    if (process.platform === 'win32') {
      return await checkAdminPrivileges()
    }

    if (process.platform === 'darwin' || process.platform === 'linux') {
      const stats = await stat(corePath)
      return (stats.mode & 0o4000) !== 0 && stats.uid === 0
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

  // 先停止 Core，避免新旧进程冲突
  try {
    managerLogger.info('Stopping core before admin restart...')
    await stopCoreBeforeAdminRestart?.(true)
    await new Promise((resolve) => setTimeout(resolve, 500))
  } catch (error) {
    managerLogger.warn('Failed to stop core before restart:', error)
  }

  const exePath = process.execPath
  const args = process.argv.slice(1).filter((arg) => arg !== '--admin-restart-for-tun')
  const restartArgs = forTun ? [...args, '--admin-restart-for-tun'] : args

  const escapedExePath = exePath.replace(/'/g, "''")
  const argsString = restartArgs.map((arg) => arg.replace(/'/g, "''")).join("', '")

  const startProcess =
    restartArgs.length > 0
      ? `Start-Process -FilePath '${escapedExePath}' -ArgumentList '${argsString}' -Verb RunAs`
      : `Start-Process -FilePath '${escapedExePath}' -Verb RunAs`
  // 用户取消 UAC 时 Start-Process 只写非终止错误，这里强制成终止错误并返回非零退出码，才能捕获失败
  const command = `$ErrorActionPreference='Stop'; try { ${startProcess} } catch { exit 1 }`

  managerLogger.info('Restarting as administrator with command', command)

  // UAC 同意框只会为前台进程链切到安全桌面。旧实现让 PowerShell 延迟 1 秒后才提权、
  // 本进程却已退出，提权由一个后台进程发起，弹窗只会在任务栏闪烁甚至被压制；
  // 因此必须在本进程仍在前台时同步发起提权，成功后再退出。
  try {
    const { mainWindow } = await import('../index')
    mainWindow?.focus()
  } catch {
    // ignore
  }

  try {
    await execFilePromise('powershell', ['-NoProfile', '-Command', command], {
      windowsHide: true,
      timeout: 180000
    })
  } catch (error) {
    managerLogger.error('Failed to restart as administrator', error)
    // 提权被取消或失败时应用不再退出，把前面停掉的内核恢复回去，避免用户断网
    try {
      const { restartCore } = await import('./manager')
      await restartCore(true)
    } catch (recoverError) {
      managerLogger.error('Failed to recover core after admin restart failure', recoverError)
    }
    throw new Error(`Failed to restart as administrator: ${error}`)
  }

  managerLogger.info('Elevated instance launched, quitting app')
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
