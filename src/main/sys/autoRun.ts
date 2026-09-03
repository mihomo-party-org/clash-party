import { tmpdir } from 'os'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { exec, execFile } from 'child_process'
import { existsSync } from 'fs'
import { promisify } from 'util'
import path from 'path'
import { app } from 'electron'
import { exePath, homeDir } from '../utils/dirs'
import { managerLogger } from '../utils/logger'
import { checkAdminPrivileges } from '../core/admin'

const appName = 'mihomo-party'
// 1.x 通过 AppleScript 往 System Events 写登录项，这些旧条目不受 Service Management 管理，
// 升级后必须单独清理，否则会与新登录项同时生效导致开机启动两次。
const darwinLegacyLoginItemNames = ['Clash Party', 'Mihomo Party']

// 旧登录项清理属于尽力而为：条目不存在、或系统未授予自动化权限时都直接忽略。
async function removeDarwinLegacyLoginItems(): Promise<void> {
  const names = [
    ...new Set([path.basename(exePath().split('.app')[0]), ...darwinLegacyLoginItemNames])
  ]
  const condition = names.map((name) => `name is ${JSON.stringify(name)}`).join(' or ')
  const script = `tell application "System Events" to delete (every login item where ${condition})`
  try {
    await promisify(execFile)('/usr/bin/osascript', ['-e', script])
  } catch (error) {
    await managerLogger.info('No legacy macOS login item removed', error)
  }
}

function getTaskXml(asAdmin: boolean): string {
  const runLevel = asAdmin ? 'HighestAvailable' : 'LeastPrivilege'
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <Delay>PT3S</Delay>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>${runLevel}</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>Parallel</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>false</AllowHardTerminate>
    <StartWhenAvailable>false</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>3</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>"${exePath()}"</Command>
    </Exec>
  </Actions>
</Task>
`
}

export async function checkAutoRun(): Promise<boolean> {
  if (process.platform === 'win32') {
    const execPromise = promisify(exec)
    const execFilePromise = promisify(execFile)
    // 先检查任务计划程序
    try {
      const { stdout } = await execPromise(
        `chcp 437 && %SystemRoot%\\System32\\schtasks.exe /query /tn "${appName}"`
      )
      if (stdout.includes(appName)) {
        return true
      }
    } catch {
      // 任务计划程序中不存在，继续检查注册表
    }

    // 检查注册表备用方案
    try {
      const regPath = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
      const { stdout } = await execFilePromise('reg', ['query', regPath, '/v', appName])
      return stdout.includes(appName)
    } catch {
      return false
    }
  }

  if (process.platform === 'darwin') {
    return app.getLoginItemSettings().openAtLogin
  }

  if (process.platform === 'linux') {
    return existsSync(path.join(homeDir, '.config', 'autostart', `${appName}.desktop`))
  }
  return false
}

export async function enableAutoRun(): Promise<void> {
  if (process.platform === 'win32') {
    const execPromise = promisify(exec)
    const execFilePromise = promisify(execFile)
    const regPath = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
    const taskFilePath = path.join(tmpdir(), `${appName}.xml`)
    const isAdmin = await checkAdminPrivileges()
    await writeFile(taskFilePath, Buffer.from(`\ufeff${getTaskXml(isAdmin)}`, 'utf-16le'))

    let taskCreated = false

    try {
      await execFilePromise('reg', ['delete', regPath, '/v', appName, '/f'])
    } catch {
      // ignore
    }

    if (isAdmin) {
      try {
        await execPromise(
          `%SystemRoot%\\System32\\schtasks.exe /create /tn "${appName}" /xml "${taskFilePath}" /f`
        )
        taskCreated = true
      } catch (error) {
        await managerLogger.warn('Failed to create scheduled task as admin:', error)
      }
    } else {
      try {
        await execPromise(
          `powershell -NoProfile -Command "Start-Process schtasks -Verb RunAs -ArgumentList '/create', '/tn', '${appName}', '/xml', '${taskFilePath}', '/f' -WindowStyle Hidden -Wait"`
        )
        // 验证任务是否创建成功
        await new Promise((resolve) => setTimeout(resolve, 1000))
      } catch {
        await managerLogger.info('Scheduled task creation failed, trying registry fallback')
      }
    }

    if (!taskCreated) {
      try {
        const { stdout } = await execPromise(
          `chcp 437 && %SystemRoot%\\System32\\schtasks.exe /query /tn "${appName}"`
        )
        const created = stdout.includes(appName)
        taskCreated = created
        if (!created) {
          await managerLogger.warn('Scheduled task creation may have failed or been rejected')
        }
      } catch {
        // ignore
      }
    }

    // 任务计划程序失败时使用注册表备用方案（适用于 Windows IoT LTSC 等受限环境）
    if (!taskCreated) {
      await managerLogger.info('Using registry fallback for auto-run')
      try {
        const regValue = `"${exePath()}"`
        await execFilePromise('reg', [
          'add',
          regPath,
          '/v',
          appName,
          '/t',
          'REG_SZ',
          '/d',
          regValue,
          '/f'
        ])
        await managerLogger.info('Registry auto-run entry created successfully')
      } catch (regError) {
        await managerLogger.error('Failed to create registry auto-run entry:', regError)
      }
    }
  }
  if (process.platform === 'darwin') {
    await removeDarwinLegacyLoginItems()
    app.setLoginItemSettings({ openAtLogin: true })
    const { openAtLogin, status } = app.getLoginItemSettings()
    if (!openAtLogin) {
      throw new Error(`Failed to register login item${status ? ` (${status})` : ''}`)
    }
  }
  if (process.platform === 'linux') {
    let desktop = `
[Desktop Entry]
Name=mihomo-party
Exec=${exePath()} %U
Terminal=false
Type=Application
Icon=mihomo-party
StartupWMClass=mihomo-party
Comment=Clash Party
Categories=Utility;
`

    if (existsSync(`/usr/share/applications/${appName}.desktop`)) {
      desktop = await readFile(`/usr/share/applications/${appName}.desktop`, 'utf8')
    }
    const autostartDir = path.join(homeDir, '.config', 'autostart')
    if (!existsSync(autostartDir)) {
      await mkdir(autostartDir, { recursive: true })
    }
    const desktopFilePath = path.join(autostartDir, `${appName}.desktop`)
    await writeFile(desktopFilePath, desktop)
  }
}

export async function disableAutoRun(): Promise<void> {
  if (process.platform === 'win32') {
    const execPromise = promisify(exec)
    const execFilePromise = promisify(execFile)
    const isAdmin = await checkAdminPrivileges()

    // 删除任务计划程序中的任务
    try {
      if (isAdmin) {
        await execPromise(`%SystemRoot%\\System32\\schtasks.exe /delete /tn "${appName}" /f`)
      } else {
        await execPromise(
          `powershell -NoProfile -Command "Start-Process schtasks -Verb RunAs -ArgumentList '/delete', '/tn', '${appName}', '/f' -WindowStyle Hidden -Wait"`
        )
      }
    } catch {
      // 任务可能不存在，忽略错误
    }

    // 同时删除注册表备用方案
    try {
      const regPath = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
      await execFilePromise('reg', ['delete', regPath, '/v', appName, '/f'])
    } catch {
      // 注册表项可能不存在，忽略错误
    }
  }
  if (process.platform === 'darwin') {
    app.setLoginItemSettings({ openAtLogin: false })
    await removeDarwinLegacyLoginItems()
  }
  if (process.platform === 'linux') {
    const desktopFilePath = path.join(homeDir, '.config', 'autostart', `${appName}.desktop`)
    await rm(desktopFilePath)
  }
}
