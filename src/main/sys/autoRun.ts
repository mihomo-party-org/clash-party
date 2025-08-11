import { exePath, homeDir } from '../utils/dirs'
import { tmpdir } from 'os'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { exec } from 'child_process'
import { existsSync } from 'fs'
import { promisify } from 'util'
import path from 'path'

const appName = 'mihomo-party'

function getTaskXml(): string {
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
      <RunLevel>LeastPrivilege</RunLevel>
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
    try {
      const { stdout } = await execPromise(
        `chcp 437 && %SystemRoot%\\System32\\schtasks.exe /query /tn "${appName}"`
      )
      return stdout.includes(appName)
    } catch (e) {
      return false
    }
  }

  if (process.platform === 'darwin') {
    const execPromise = promisify(exec)
    const { stdout } = await execPromise(
      `osascript -e 'tell application "System Events" to get the name of every login item'`
    )
    return stdout.includes(exePath().split('.app')[0].replace('/Applications/', ''))
  }

  if (process.platform === 'linux') {
    return existsSync(path.join(homeDir, '.config', 'autostart', `${appName}.desktop`))
  }
  return false
}

export async function enableAutoRun(): Promise<void> {
  if (process.platform === 'win32') {
    const execPromise = promisify(exec)
    const taskFilePath = path.join(tmpdir(), `${appName}.xml`)
    await writeFile(taskFilePath, Buffer.from(`\ufeff${getTaskXml()}`, 'utf-16le'))
    await execPromise(
      `powershell Start-Process schtasks -Verb RunAs -ArgumentList '/create', '/tn', '${appName}', '/xml', '${taskFilePath}', '/f'`
    )
  }
  if (process.platform === 'darwin') {
    const execPromise = promisify(exec)
    await execPromise(
      `osascript -e 'tell application "System Events" to make login item at end with properties {path:"${exePath().split('.app')[0]}.app", hidden:false}'`
    )
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
Comment=Mihomo Party
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
    await execPromise(`powershell Start-Process schtasks -Verb RunAs -ArgumentList '/delete', '/tn', '${appName}', '/f'`)
  }
  if (process.platform === 'darwin') {
    const execPromise = promisify(exec)
    await execPromise(
      `osascript -e 'tell application "System Events" to delete login item "${exePath().split('.app')[0].replace('/Applications/', '')}"'`
    )
  }
  if (process.platform === 'linux') {
    const desktopFilePath = path.join(homeDir, '.config', 'autostart', `${appName}.desktop`)
    await rm(desktopFilePath)
  }
}
