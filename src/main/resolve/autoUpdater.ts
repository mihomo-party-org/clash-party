import axios from 'axios'
import yaml from 'yaml'
import { app, shell } from 'electron'
import { getControledMihomoConfig } from '../config'
import { dataDir, exeDir, exePath, isPortable, resourcesFilesDir } from '../utils/dirs'
import { copyFile, rm, writeFile } from 'fs/promises'
import path from 'path'
import { existsSync } from 'fs'
import os from 'os'
import { exec, execSync, spawn } from 'child_process'
import { promisify } from 'util'

export async function checkUpdate(): Promise<IAppVersion | undefined> {
  const { 'mixed-port': mixedPort = 7890 } = await getControledMihomoConfig()
  const res = await axios.get(
    'https://github.com/mihomo-party-org/mihomo-party/releases/latest/download/latest.yml',
    {
      headers: { 'Content-Type': 'application/octet-stream' },
      proxy: {
        protocol: 'http',
        host: '127.0.0.1',
        port: mixedPort
      },
      responseType: 'text'
    }
  )
  const latest = yaml.parse(res.data, { merge: true }) as IAppVersion
  const currentVersion = app.getVersion()
  if (compareVersions(latest.version, currentVersion) > 0) {
    return latest
  } else {
    return undefined
  }
}

// 1:新 -1:旧 0:相同
function compareVersions(a: string, b: string): number {
  const parsePart = (part: string) => {
    const numPart = part.split('-')[0]
    const num = parseInt(numPart, 10)
    return isNaN(num) ? 0 : num
  }
  const v1 = a.replace(/^v/, '').split('.').map(parsePart)
  const v2 = b.replace(/^v/, '').split('.').map(parsePart)
  for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
    const num1 = v1[i] || 0
    const num2 = v2[i] || 0
    if (num1 > num2) return 1
    if (num1 < num2) return -1
  }
  return 0
}

export async function downloadAndInstallUpdate(version: string): Promise<void> {
  const { 'mixed-port': mixedPort = 7890 } = await getControledMihomoConfig()
  const baseUrl = `https://github.com/mihomo-party-org/mihomo-party/releases/download/v${version}/`
  const fileMap = {
    'win32-x64': `mihomo-party-windows-${version}-x64-setup.exe`,
    'win32-ia32': `mihomo-party-windows-${version}-ia32-setup.exe`,
    'win32-arm64': `mihomo-party-windows-${version}-arm64-setup.exe`,
    'darwin-x64': `mihomo-party-macos-${version}-x64.pkg`,
    'darwin-arm64': `mihomo-party-macos-${version}-arm64.pkg`
  }
  let file = fileMap[`${process.platform}-${process.arch}`]
  if (isPortable()) {
    file = file.replace('-setup.exe', '-portable.7z')
  }
  if (!file) {
    throw new Error('不支持自动更新，请手动下载更新')
  }
  if (process.platform === 'win32' && parseInt(os.release()) < 10) {
    file = file.replace('windows', 'win7')
  }
  if (process.platform === 'darwin') {
    const productVersion = execSync('sw_vers -productVersion', { encoding: 'utf8' })
      .toString()
      .trim()
    if (parseInt(productVersion) < 11) {
      file = file.replace('macos', 'catalina')
    }
  }
  try {
    if (!existsSync(path.join(dataDir(), file))) {
      const res = await axios.get(`${baseUrl}${file}`, {
        responseType: 'arraybuffer',
        proxy: {
          protocol: 'http',
          host: '127.0.0.1',
          port: mixedPort
        },
        headers: {
          'Content-Type': 'application/octet-stream'
        }
      })
      await writeFile(path.join(dataDir(), file), res.data)
    }
    if (file.endsWith('.exe')) {
      spawn(path.join(dataDir(), file), ['/S', '--force-run'], {
        detached: true,
        stdio: 'ignore'
      }).unref()
    }
    if (file.endsWith('.7z')) {
      await copyFile(path.join(resourcesFilesDir(), '7za.exe'), path.join(dataDir(), '7za.exe'))
      spawn(
        'cmd',
        [
          '/C',
          `"timeout /t 2 /nobreak >nul && "${path.join(dataDir(), '7za.exe')}" x -o"${exeDir()}" -y "${path.join(dataDir(), file)}" & start "" "${exePath()}""`
        ],
        {
          shell: true,
          detached: true
        }
      ).unref()
      app.quit()
    }
    if (file.endsWith('.pkg')) {
      try {
        const execPromise = promisify(exec)
        const shell = `installer -pkg ${path.join(dataDir(), file).replace(' ', '\\\\ ')} -target /`
        const command = `do shell script "${shell}" with administrator privileges`
        await execPromise(`osascript -e '${command}'`)
        app.relaunch()
        app.quit()
      } catch {
        shell.openPath(path.join(dataDir(), file))
      }
    }
  } catch (e) {
    rm(path.join(dataDir(), file))
    throw e
  }
}