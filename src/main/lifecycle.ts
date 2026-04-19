import { spawn, exec } from 'child_process'
import { promisify } from 'util'
import { stat } from 'fs/promises'
import { existsSync } from 'fs'
import { app, powerMonitor } from 'electron'
import { stopCore, cleanupCoreWatcher } from './core/manager'
import { triggerSysProxy, disableSysProxySync } from './sys/sysproxy'
import { exePath } from './utils/dirs'

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

  try {
    const stats = await stat(userDataPath)
    const currentUid = process.getuid?.() || 0

    if (stats.uid === 0 && currentUid !== 0) {
      const execPromise = promisify(exec)
      const username = process.env.USER || process.env.LOGNAME
      if (username) {
        await execPromise(`chown -R "${username}:staff" "${userDataPath}"`)
        await execPromise(`chmod -R u+rwX "${userDataPath}"`)
      }
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
  let sysProxyDisabled = false

  app.on('before-quit', async (e) => {
    e.preventDefault()
    cleanupCoreWatcher()
    await triggerSysProxy(false)
    sysProxyDisabled = true
    await stopCore()
    app.exit()
  })

  powerMonitor.on('shutdown', async () => {
    cleanupCoreWatcher()
    await triggerSysProxy(false)
    sysProxyDisabled = true
    await stopCore()
    app.exit()
  })

  app.on('will-quit', () => {
    if (!sysProxyDisabled) {
      disableSysProxySync()
    }
  })
}

export function getSystemLanguage(): 'zh-CN' | 'en-US' {
  const locale = app.getLocale()
  return locale.startsWith('zh') ? 'zh-CN' : 'en-US'
}
