import fs from 'fs/promises'
import path from 'path'
import { execFile } from 'child_process'
import { app } from 'electron'

// The executable path is data, never PowerShell source (including quotes and Unicode).
const versionScript = `
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$v = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($env:MIHOMO_APP_PATH)
[Console]::Write((ConvertTo-Json -Compress -InputObject @($v.FileDescription, $v.ProductName)))
`

export async function getWindowsAppInfo(file: string): Promise<IAppInfo> {
  if (!path.win32.isAbsolute(file) || !/\.(exe|dll)$/i.test(file)) return { name: '', icon: '' }
  const stat = await fs.stat(file).catch(() => undefined)
  if (!stat?.isFile()) return { name: '', icon: '' }
  const [name, icon] = await Promise.all([
    new Promise<string>((resolve) => {
      execFile(
        path.win32.join(
          process.env.SystemRoot || 'C:\\Windows',
          'System32',
          'WindowsPowerShell',
          'v1.0',
          'powershell.exe'
        ),
        ['-NoProfile', '-NonInteractive', '-Command', versionScript],
        {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 3000,
          maxBuffer: 64 * 1024,
          env: { ...process.env, MIHOMO_APP_PATH: file }
        },
        (error, stdout) => {
          try {
            const names: unknown = error ? [] : JSON.parse(stdout)
            resolve(
              Array.isArray(names)
                ? names.find((name) => typeof name === 'string' && name.trim())?.trim() || ''
                : ''
            )
          } catch {
            resolve('')
          }
        }
      )
    }),
    app.getFileIcon(file, { size: 'normal' }).then(
      (image) => (image.isEmpty() ? '' : image.toDataURL()),
      () => ''
    )
  ])
  return { name, icon }
}
