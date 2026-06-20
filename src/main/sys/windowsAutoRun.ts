export const windowsAutoRunAppName = 'mihomo-party'
export const windowsAutoRunRegistryPath = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'

export type ExecCommand = (command: string) => Promise<{ stdout: string }>
export type ExecFileCommand = (file: string, args: string[]) => Promise<{ stdout: string }>

export async function hasScheduledAutoRunTask(execCommand: ExecCommand): Promise<boolean> {
  try {
    const { stdout } = await execCommand(
      `chcp 437 && %SystemRoot%\\System32\\schtasks.exe /query /tn "${windowsAutoRunAppName}"`
    )
    return stdout.includes(windowsAutoRunAppName)
  } catch {
    return false
  }
}

export async function hasRegistryAutoRunEntry(execFileCommand: ExecFileCommand): Promise<boolean> {
  try {
    const { stdout } = await execFileCommand('reg', [
      'query',
      windowsAutoRunRegistryPath,
      '/v',
      windowsAutoRunAppName
    ])
    return stdout.includes(windowsAutoRunAppName)
  } catch {
    return false
  }
}

export async function removeRegistryAutoRunEntry(execFileCommand: ExecFileCommand): Promise<void> {
  try {
    await execFileCommand('reg', [
      'delete',
      windowsAutoRunRegistryPath,
      '/v',
      windowsAutoRunAppName,
      '/f'
    ])
  } catch {
    // 注册表项可能不存在，忽略错误
  }
}

export async function repairWindowsAutoRun(
  execCommand: ExecCommand,
  execFileCommand: ExecFileCommand
): Promise<boolean> {
  const hasScheduledTask = await hasScheduledAutoRunTask(execCommand)
  if (hasScheduledTask) {
    await removeRegistryAutoRunEntry(execFileCommand)
  }
  return hasScheduledTask
}
