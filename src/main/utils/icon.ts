import { exec } from 'child_process'
import fs, { existsSync } from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import axios from 'axios'
import { getIcon } from 'file-icon-info'
import { app } from 'electron'
import { getControledMihomoConfig } from '../config'
import { windowsDefaultIcon, darwinDefaultIcon, otherDevicesIcon } from './defaultIcon'

export function isIOSApp(appPath: string): boolean {
  const appDir = appPath.endsWith('.app')
    ? appPath
    : appPath.includes('.app')
      ? appPath.substring(0, appPath.indexOf('.app') + 4)
      : path.dirname(appPath)

  return !fs.existsSync(path.join(appDir, 'Contents'))
}

function hasIOSAppIcon(appPath: string): boolean {
  try {
    const items = fs.readdirSync(appPath)
    return items.some((item) => {
      const lower = item.toLowerCase()
      const ext = path.extname(item).toLowerCase()
      return lower.startsWith('appicon') && (ext === '.png' || ext === '.jpg' || ext === '.jpeg')
    })
  } catch {
    return false
  }
}

function hasMacOSAppIcon(appPath: string): boolean {
  const resourcesDir = path.join(appPath, 'Contents', 'Resources')
  if (!fs.existsSync(resourcesDir)) {
    return false
  }

  try {
    const items = fs.readdirSync(resourcesDir)
    return items.some((item) => path.extname(item).toLowerCase() === '.icns')
  } catch {
    return false
  }
}

export function findBestAppPath(appPath: string): string | null {
  if (!appPath.includes('.app') && !appPath.includes('.xpc')) {
    return null
  }

  const parts = appPath.split(path.sep)
  const appPaths: string[] = []

  for (let i = 0; i < parts.length; i++) {
    if (parts[i].endsWith('.app') || parts[i].endsWith('.xpc')) {
      const fullPath = parts.slice(0, i + 1).join(path.sep)
      appPaths.push(fullPath)
    }
  }
  if (appPaths.length === 0) {
    return null
  }
  if (appPaths.length === 1) {
    return appPaths[0]
  }
  for (let i = appPaths.length - 1; i >= 0; i--) {
    const appDir = appPaths[i]
    if (isIOSApp(appDir)) {
      if (hasIOSAppIcon(appDir)) {
        return appDir
      }
    } else {
      if (hasMacOSAppIcon(appDir)) {
        return appDir
      }
    }
  }
  return appPaths[0]
}

async function findDesktopFile(appPath: string): Promise<string | null> {
  try {
    const execName = path.isAbsolute(appPath) ? path.basename(appPath) : appPath
    const desktopDirs = ['/usr/share/applications', `${process.env.HOME}/.local/share/applications`]

    for (const dir of desktopDirs) {
      if (!existsSync(dir)) continue

      const files = fs.readdirSync(dir)
      const desktopFiles = files.filter((file) => file.endsWith('.desktop'))

      for (const file of desktopFiles) {
        const fullPath = path.join(dir, file)
        try {
          const content = fs.readFileSync(fullPath, 'utf-8')

          const execMatch = content.match(/^Exec\s*=\s*(.+?)$/m)
          if (execMatch) {
            const execLine = execMatch[1].trim()
            const execCmd = execLine.split(/\s+/)[0]
            const execBasename = path.basename(execCmd)

            if (
              execCmd === appPath ||
              execBasename === execName ||
              execCmd.endsWith(appPath) ||
              appPath.endsWith(execBasename)
            ) {
              return fullPath
            }
          }

          const nameRegex = new RegExp(`^Name\\s*=\\s*${appPath}\\s*$`, 'im')
          const genericNameRegex = new RegExp(`^GenericName\\s*=\\s*${appPath}\\s*$`, 'im')

          if (nameRegex.test(content) || genericNameRegex.test(content)) {
            return fullPath
          }
        } catch {
          continue
        }
      }
    }
  } catch {
    // ignore
  }

  return null
}

function parseIconNameFromDesktopFile(content: string): string | null {
  const match = content.match(/^Icon\s*=\s*(.+?)$/m)
  return match ? match[1].trim() : null
}

function resolveIconPath(iconName: string): string | null {
  if (path.isAbsolute(iconName) && existsSync(iconName)) {
    return iconName
  }

  const searchPaths: string[] = []
  const sizes = ['512x512', '256x256', '128x128', '64x64', '48x48', '32x32', '24x24', '16x16']
  const extensions = ['png', 'svg', 'xpm']
  const iconDirs = [
    '/usr/share/icons/hicolor',
    '/usr/share/pixmaps',
    '/usr/share/icons/Adwaita',
    `${process.env.HOME}/.local/share/icons`
  ]

  for (const dir of iconDirs) {
    for (const size of sizes) {
      for (const ext of extensions) {
        searchPaths.push(path.join(dir, size, 'apps', `${iconName}.${ext}`))
      }
    }
  }
  for (const ext of extensions) {
    searchPaths.push(`/usr/share/pixmaps/${iconName}.${ext}`)
  }
  for (const dir of iconDirs) {
    for (const ext of extensions) {
      searchPaths.push(path.join(dir, `${iconName}.${ext}`))
    }
  }

  return searchPaths.find((iconPath) => existsSync(iconPath)) || null
}

export async function getIconDataURL(appPath: string): Promise<string> {
  if (!appPath) {
    return otherDevicesIcon
  }
  if (appPath === 'mihomo') {
    appPath = app.getPath('exe')
  }

  if (process.platform === 'darwin') {
    if (!appPath.includes('.app') && !appPath.includes('.xpc')) {
      return darwinDefaultIcon
    }
    const { fileIconToBuffer } = await import('file-icon')
    const targetPath = findBestAppPath(appPath)
    if (!targetPath) {
      return darwinDefaultIcon
    }
    const iconBuffer = await fileIconToBuffer(targetPath, { size: 512 })
    const base64Icon = Buffer.from(iconBuffer).toString('base64')
    return `data:image/png;base64,${base64Icon}`
  }

  if (process.platform === 'win32') {
    if (fs.existsSync(appPath) && /\.(exe|dll)$/i.test(appPath)) {
      try {
        let targetPath = appPath
        let tempLinkPath: string | null = null

        if (/[\u4e00-\u9fff]/.test(appPath)) {
          const tempDir = os.tmpdir()
          const randomName = crypto.randomBytes(8).toString('hex')
          const fileExt = path.extname(appPath)
          tempLinkPath = path.join(tempDir, `${randomName}${fileExt}`)

          try {
            await new Promise<void>((resolve) => {
              exec(`mklink "${tempLinkPath}" "${appPath}"`, (error) => {
                if (!error && tempLinkPath && fs.existsSync(tempLinkPath)) {
                  targetPath = tempLinkPath
                }
                resolve()
              })
            })
          } catch {
            // ignore mklink errors
          }
        }

        try {
          const iconBuffer = await new Promise<Buffer>((resolve, reject) => {
            getIcon(targetPath, (b64d) => {
              try {
                resolve(Buffer.from(b64d, 'base64'))
              } catch (error) {
                reject(error)
              }
            })
          })

          return `data:image/png;base64,${iconBuffer.toString('base64')}`
        } finally {
          if (tempLinkPath && fs.existsSync(tempLinkPath)) {
            try {
              fs.unlinkSync(tempLinkPath)
            } catch {
              // ignore cleanup errors
            }
          }
        }
      } catch {
        return windowsDefaultIcon
      }
    } else {
      return windowsDefaultIcon
    }
  } else if (process.platform === 'linux') {
    const desktopFile = await findDesktopFile(appPath)
    if (desktopFile) {
      const content = fs.readFileSync(desktopFile, 'utf-8')
      const iconName = parseIconNameFromDesktopFile(content)
      if (iconName) {
        const iconPath = resolveIconPath(iconName)
        if (iconPath) {
          try {
            const iconBuffer = fs.readFileSync(iconPath)
            return `data:image/png;base64,${iconBuffer.toString('base64')}`
          } catch {
            return darwinDefaultIcon
          }
        }
      }
    } else {
      return darwinDefaultIcon
    }
  }

  return ''
}

export async function getImageDataURL(url: string): Promise<string> {
  const { 'mixed-port': port = 7890 } = await getControledMihomoConfig()
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    ...(port !== 0 && {
      proxy: {
        protocol: 'http',
        host: '127.0.0.1',
        port
      }
    })
  })
  const mimeType = res.headers['content-type']
  const dataURL = `data:${mimeType};base64,${Buffer.from(res.data).toString('base64')}`
  return dataURL
}
