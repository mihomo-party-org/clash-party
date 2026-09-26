import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { execFile } from 'child_process'
import { findConnectionPid, getProcessIdentity } from './linux-process'

type Entry = Record<string, string>
let snapshot:
  | { expires: number; value: Promise<{ entries: Map<string, Entry>; iconDirs: string[] }> }
  | undefined
const appInfo = new Map<string, Promise<IAppInfo>>()

async function read(file: string): Promise<string> {
  return fs.readFile(file, 'utf8').catch(() => '')
}

function getIniSection(content: string, section: string): Record<string, string> {
  const escapedSection = section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const start = content.search(new RegExp(`^\\s*\\[${escapedSection}\\]\\s*$`, 'm'))
  if (start === -1) return {}
  const remaining = content.slice(content.indexOf('\n', start) + 1)
  const end = remaining.search(/^\s*\[/m)
  const values: Record<string, string> = {}
  for (const line of (end === -1 ? remaining : remaining.slice(0, end)).split(/\r?\n/)) {
    const match = line.match(/^\s*([^=\s]+)\s*=\s*(.*?)\s*$/)
    if (match) values[match[1]] = match[2]
  }
  return values
}

function getDataRoots(): string[] {
  return [
    process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'),
    ...(process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':')
  ].filter(Boolean)
}

function getIconRoots(): string[] {
  const roots = getDataRoots().map((directory) => path.join(directory, 'icons'))
  roots.push(path.join(os.homedir(), '.icons'))
  return roots
}

async function getCurrentIconTheme(): Promise<string> {
  const gsettingsTheme = await new Promise<string>((resolve) => {
    execFile(
      'gsettings',
      ['get', 'org.gnome.desktop.interface', 'icon-theme'],
      { encoding: 'utf8', timeout: 1000 },
      (error, stdout) => resolve(error ? '' : stdout.trim().replace(/^['"]|['"]$/g, ''))
    )
  })
  if (gsettingsTheme) return gsettingsTheme

  for (const version of ['4.0', '3.0']) {
    try {
      const settings = await fs.readFile(
        path.join(
          process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
          `gtk-${version}`,
          'settings.ini'
        ),
        'utf8'
      )
      const theme = getIniSection(settings, 'Settings')['gtk-icon-theme-name']
      if (theme) return theme
    } catch {
      // Try the next GTK settings source.
    }
  }
  return 'hicolor'
}

// One shared snapshot replaces separate caches for entries, paths, themes and launchers.
async function loadSnapshot(): Promise<{ entries: Map<string, Entry>; iconDirs: string[] }> {
  const entries = new Map<string, Entry>()
  for (const root of getDataRoots()) {
    const directory = path.join(root, 'applications')
    const files = await fs.readdir(directory, { recursive: true }).catch(() => [])
    for (const file of files.filter((file) => file.endsWith('.desktop'))) {
      const id = file.replaceAll(path.sep, '-').slice(0, -8)
      if (entries.has(id)) continue
      entries.set(id, getIniSection(await read(path.join(directory, file)), 'Desktop Entry'))
    }
  }
  for (const [id, entry] of entries) {
    if (entry.Hidden === 'true' || (entry.Type && entry.Type !== 'Application')) {
      entries.delete(id)
      continue
    }
    const command = getDesktopExecPath(entry.Exec)
    entry.executable = command ? await resolveCommand(command) : ''
    entry.targets = entry.executable ? (await getLauncherTargets(entry.executable)).join('\0') : ''
  }

  const iconDirs: string[] = []
  const visited = new Set<string>()
  const visit = async (theme: string): Promise<void> => {
    if (!theme || visited.has(theme)) return
    visited.add(theme)
    let inherits = ''
    for (const root of getIconRoots()) {
      const themeRoot = path.join(root, theme)
      const content = await read(path.join(themeRoot, 'index.theme'))
      const index = getIniSection(content, 'Icon Theme')
      inherits ||= index.Inherits || ''
      const dirs = [index.Directories, index.ScaledDirectories].filter(Boolean).join(',')
      iconDirs.push(
        ...(dirs
          ? dirs
              .split(',')
              .map((dir) => {
                dir = dir.trim()
                return { dir, section: getIniSection(content, dir) }
              })
              .filter(
                ({ dir, section }) =>
                  section.Context === 'Applications' || /(^|\/)apps(\/|$)/.test(dir)
              )
              .sort(
                (a, b) =>
                  Math.abs(Number(a.section.Size || 64) - 64) -
                  Math.abs(Number(b.section.Size || 64) - 64)
              )
              .map(({ dir }) => dir)
          : [
              '64x64',
              '48x48',
              'scalable',
              '256x256',
              '128x128',
              '32x32',
              '16x16',
              '512x512'
            ].flatMap((size) => [`${size}/apps`, `apps/${size}`])
        ).map((dir) => path.join(themeRoot, dir))
      )
    }
    for (const parent of inherits.split(',')) await visit(parent.trim())
  }
  await visit(await getCurrentIconTheme())
  await visit('hicolor')
  iconDirs.push(...getIconRoots(), ...getDataRoots().map((root) => path.join(root, 'pixmaps')))
  return { entries, iconDirs }
}

function getSnapshot(): Promise<{ entries: Map<string, Entry>; iconDirs: string[] }> {
  if (!snapshot || snapshot.expires < Date.now()) {
    appInfo.clear()
    const current = { expires: Infinity, value: loadSnapshot() }
    snapshot = current
    void current.value
      .finally(() => {
        current.expires = Date.now() + 300_000
      })
      .catch(() => {})
  }
  return snapshot.value
}

async function realpath(file: string): Promise<string> {
  return fs.realpath(file).catch(() => file)
}

async function resolveCommand(command: string): Promise<string> {
  if (path.isAbsolute(command)) return realpath(command)
  for (const directory of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, command)
    if (
      await fs.access(candidate, fs.constants.X_OK).then(
        () => true,
        () => false
      )
    ) {
      return realpath(candidate)
    }
  }
  return command
}

async function getLauncherTargets(launcherPath: string): Promise<string[]> {
  const stat = await fs.stat(launcherPath).catch(() => undefined)
  if (!stat?.isFile() || stat.size > 256 * 1024) return []
  const content = await read(launcherPath)
  if (!content.startsWith('#!') || content.includes('\0')) return []
  const targets: string[] = []
  // Only inspect direct exec and $HERE launchers; never execute desktop entries or scripts.
  for (const match of content.matchAll(
    /\bexec\s+(?:-a\s+\S+\s+)?["']?(\$\{?HERE\}?\/[^\s"']+|\/[^\s"']+)/g
  )) {
    targets.push(await realpath(match[1].replace(/^\$\{?HERE\}?/, path.dirname(launcherPath))))
  }
  return targets
}

function getDesktopExecPath(execLine?: string): string | undefined {
  if (!execLine) return undefined

  const tokens = Array.from(execLine.matchAll(/"([^"]+)"|'([^']+)'|(\S+)/g), (match) =>
    match.slice(1).find(Boolean)
  ).filter((token): token is string => Boolean(token))

  if (tokens[0] !== 'env') return tokens[0]

  return tokens.slice(1).find((token) => !token.startsWith('-') && !token.includes('='))
}

async function findEntry(
  entries: Map<string, Entry>,
  appPath: string,
  processName?: string
): Promise<Entry | undefined> {
  if (!appPath && !processName) return undefined
  const executable = appPath ? await resolveCommand(appPath) : ''
  let hidden: Entry | undefined
  for (const entry of entries.values()) {
    if (
      (executable &&
        (entry.executable === executable || entry.targets.split('\0').includes(executable))) ||
      (processName &&
        (entry.StartupWMClass === processName || entry['X-GNOME-WMClass'] === processName))
    ) {
      // File handlers can share the executable with the app's normal launcher.
      if (entry.NoDisplay !== 'true') return entry
      hidden ||= entry
    }
  }
  return hidden
}

export async function getLinuxAppInfo(
  metadata: Partial<IMihomoConnectionDetail['metadata']>
): Promise<IAppInfo> {
  if (process.platform !== 'linux') return { name: '', icon: '' }
  const { entries, iconDirs } = await getSnapshot()
  let entry: Entry | undefined
  const pid = await findConnectionPid(metadata)
  let currentPid = pid || 0
  for (let depth = 0; currentPid > 1 && depth < 16; depth++) {
    const identity = await getProcessIdentity(currentPid)
    if (!identity) break
    // Same app scope convention used by Resources (lib/process_data/src/cgroup.rs).
    const id = identity.cgroup
      .match(
        /\/(?:app|background)\.slice\/(?:app-|dbus-:)(?:[^-]+-)??([^-]+?)(?:-\d+|@\d+)?\.(?:scope|service)(?:\s|$)/
      )?.[1]
      ?.replace(/\\x([\da-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    entry = id
      ? entries.get(id) || [...entries.values()].find((item) => item['X-Flatpak'] === id)
      : undefined
    entry ||= identity.appImagePath ? await findEntry(entries, identity.appImagePath) : undefined
    entry ||= await findEntry(entries, identity.executablePath)
    if (entry) break
    currentPid = identity.parentPid
  }
  entry ||= await findEntry(entries, metadata.processPath || '', metadata.process)
  if (!entry) return { name: '', icon: '' }
  const locale = (process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '').replace(
    /\.[^@]*/,
    ''
  )
  const [language, modifier] = locale.split('@')
  const locales = [
    locale,
    language,
    modifier ? `${language.split('_')[0]}@${modifier}` : '',
    language.split('_')[0]
  ]
  const name = locales.map((locale) => entry?.[`Name[${locale}]`]).find(Boolean) || entry.Name || ''
  const key = `${name}\0${entry.Icon || ''}`
  let info = appInfo.get(key)
  if (!info) {
    if (appInfo.size >= 256) appInfo.delete(appInfo.keys().next().value as string)
    info = readIcon(entry.Icon, iconDirs).then((icon) => ({ name, icon }))
    appInfo.set(key, info)
  }
  return info
}

async function readIcon(icon: string | undefined, directories: string[]): Promise<string> {
  if (!icon) return ''
  const candidates = path.isAbsolute(icon)
    ? [icon]
    : directories.flatMap((dir) =>
        (/\.(png|svg|jpe?g)$/i.test(icon) ? [icon] : [`${icon}.png`, `${icon}.svg`]).map((file) =>
          path.join(dir, file)
        )
      )
  for (const file of candidates) {
    try {
      const data = await fs.readFile(file)
      if (/\.xpm$/i.test(file)) continue // Chromium cannot decode XPM icons.
      const mime = /\.svg$/i.test(file)
        ? 'image/svg+xml'
        : /\.jpe?g$/i.test(file)
          ? 'image/jpeg'
          : 'image/png'
      return `data:${mime};base64,${data.toString('base64')}`
    } catch {
      /* Try the next theme directory. */
    }
  }
  return ''
}
