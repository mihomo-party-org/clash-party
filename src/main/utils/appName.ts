import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import plist from 'plist'
import { findBestAppPath, isIOSApp } from './icon'

export async function getAppName(appPath: string): Promise<string> {
  if (process.platform === 'darwin') {
    try {
      const targetPath = findBestAppPath(appPath)
      if (!targetPath) return ''

      if (isIOSApp(targetPath)) {
        const plistPath = path.join(targetPath, 'Info.plist')
        const xml = fs.readFileSync(plistPath, 'utf-8')
        const parsed = plist.parse(xml) as Record<string, unknown>
        return (parsed.CFBundleDisplayName as string) || (parsed.CFBundleName as string) || ''
      }

      try {
        const appName = getLocalizedAppName(targetPath)
        if (appName) return appName
      } catch {
        // ignore
      }

      const plistPath = path.join(targetPath, 'Contents', 'Info.plist')
      if (fs.existsSync(plistPath)) {
        const xml = fs.readFileSync(plistPath, 'utf-8')
        const parsed = plist.parse(xml) as Record<string, unknown>

        return (parsed.CFBundleDisplayName as string) || (parsed.CFBundleName as string) || ''
      } else {
        // ignore
      }
    } catch {
      // ignore
    }
  }
  return ''
}

function getLocalizedAppName(appPath: string): string {
  const escapedPath = appPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  const jxa = `
  ObjC.import('Foundation');
  const fm = $.NSFileManager.defaultManager;
  const name = fm.displayNameAtPath('${escapedPath}');
  name.js;
`
  const res = spawnSync('osascript', ['-l', 'JavaScript'], {
    input: jxa,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  })
  if (res.error) {
    throw res.error
  }
  if (res.status !== 0) {
    throw new Error(res.stderr.trim() || `osascript exited ${res.status}`)
  }
  return res.stdout.trim()
}
