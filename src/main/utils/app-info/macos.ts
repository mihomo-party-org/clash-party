import fs from 'fs/promises'
import path from 'path'
import { execFile } from 'child_process'
import { app } from 'electron'
import { parse } from 'plist'

export async function findMacAppPath(executable: string): Promise<string> {
  if (!path.posix.isAbsolute(executable)) return ''
  const parts = executable.split('/')
  const bundles = parts.flatMap((part, i) =>
    /\.(app|xpc)$/.test(part) ? [parts.slice(0, i + 1).join('/')] : []
  )
  if (bundles.length < 2) return bundles[0] || ''
  for (const bundle of [...bundles].reverse()) {
    const [resources, root] = await Promise.all([
      fs.readdir(path.join(bundle, 'Contents', 'Resources')).catch(() => []),
      fs.readdir(bundle).catch(() => [])
    ])
    if (
      resources.some((file) => /\.icns$/i.test(file)) ||
      root.some((file) => /^appicon.*\.(png|jpe?g)$/i.test(file))
    )
      return bundle
  }
  return bundles[0]
}

async function getName(bundle: string): Promise<string> {
  const ios = await fs.access(path.join(bundle, 'Contents')).then(
    () => false,
    () => true
  )
  const localized = ios
    ? ''
    : await new Promise<string>((resolve) => {
        execFile(
          '/usr/bin/osascript',
          [
            '-l',
            'JavaScript',
            '-e',
            "function run(argv) { ObjC.import('Foundation'); return $.NSFileManager.defaultManager.displayNameAtPath(argv[0]).js; }",
            bundle
          ],
          { encoding: 'utf8', timeout: 3000, maxBuffer: 64 * 1024 },
          (error, stdout) => resolve(error ? '' : stdout.trim())
        )
      })
  if (localized) return localized
  for (const file of [ios ? 'Info.plist' : 'Contents/Info.plist']) {
    try {
      const info = parse(await fs.readFile(path.join(bundle, file), 'utf8')) as Record<
        string,
        unknown
      >
      const name = info.CFBundleDisplayName || info.CFBundleName
      if (typeof name === 'string' && name) return name
    } catch {
      /* Try the iOS bundle layout. */
    }
  }
  return ''
}

export async function getMacAppInfo(bundle: string): Promise<IAppInfo> {
  const stat = await fs.stat(bundle).catch(() => undefined)
  if (!stat?.isDirectory()) return { name: '', icon: '' }
  const binary = app.isPackaged
    ? path.join(
        process.resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        'file-icon',
        'file-icon'
      )
    : path.join(app.getAppPath(), 'node_modules', 'file-icon', 'file-icon')
  const [name, icon] = await Promise.all([
    getName(bundle),
    new Promise<string>((resolve) => {
      execFile(
        binary,
        [JSON.stringify([{ appOrPID: bundle, size: 64 }])],
        { encoding: null, timeout: 5000, maxBuffer: 2 * 1024 * 1024 },
        (error, data) =>
          resolve(error || !data.length ? '' : `data:image/png;base64,${data.toString('base64')}`)
      )
    })
  ])
  return { name, icon }
}
