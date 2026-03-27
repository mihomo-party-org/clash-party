import { spawn, exec } from 'child_process'
import { promisify } from 'util'
import { stat } from 'fs/promises'
import { existsSync } from 'fs'
import { app, powerMonitor } from 'electron'
import { stopCore, cleanupCoreWatcher } from './core/manager'
import { triggerSysProxy } from './sys/sysproxy'
import { exePath, mihomoWorkDir } from './utils/dirs'

export function customRelaunch(): void {
  const script = `while kill -0 ${process.pid} 2>/dev/null; do
  sleep 0.1
done
${process.argv.join(' ')} & disown
exit
`
  spawn('sh', ['-c', script], {
    detached: true,
    stdio: 'ignore'
  })
}

export async function fixUserDataPermissions(): Promise<void> {
  if (process.platform !== 'darwin') return

  const userDataPath = app.getPath('userData')
  if (!existsSync(userDataPath)) return

  const currentUid = process.getuid?.() || 0
  if (currentUid === 0) return

  const username = process.env.USER || process.env.LOGNAME
  if (!username) return

  const execPromise = promisify(exec)

  try {
    const stats = await stat(userDataPath)
    if (stats.uid === 0) {
      await execPromise(`chown -R "${username}:staff" "${userDataPath}"`)
      await execPromise(`chmod -R u+rwX "${userDataPath}"`)
      return
    }
  } catch {
    // ignore
  }

  // Fix root-owned files inside work directory even when top-level dir is user-owned.
  // mihomo core with setuid root (TUN mode) creates files as root in Providers/,
  // causing proxy-provider refresh to silently fail due to permission denied.
  const workDirPath = mihomoWorkDir()
  if (!existsSync(workDirPath)) return

  try {
    const { stdout } = await execPromise(
      `find "${workDirPath}" -user root -print -quit 2>/dev/null`
    )
    if (stdout.trim()) {
      await execPromise(`chown -R "${username}:staff" "${workDirPath}"`)
      await execPromise(`chmod -R u+rwX "${workDirPath}"`)
    }
  } catch {
    // ignore
  }
}

export function setupPlatformSpecifics(): void {
  if (process.platform === 'linux') {
    app.relaunch = customRelaunch
  }

  if (process.platform === 'win32' && !exePath().startsWith('C')) {
    app.commandLine.appendSwitch('in-process-gpu')
  }
}

export function setupAppLifecycle(): void {
  app.on('before-quit', async (e) => {
    e.preventDefault()
    cleanupCoreWatcher()
    await triggerSysProxy(false)
    await stopCore()
    app.exit()
  })

  powerMonitor.on('shutdown', async () => {
    cleanupCoreWatcher()
    triggerSysProxy(false)
    await stopCore()
    app.exit()
  })
}

export function getSystemLanguage(): 'zh-CN' | 'en-US' {
  const locale = app.getLocale()
  return locale.startsWith('zh') ? 'zh-CN' : 'en-US'
}
