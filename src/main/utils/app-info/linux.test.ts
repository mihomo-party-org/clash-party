import fs from 'fs'
import path from 'path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('child_process', () => ({
  execFile: (
    _file: string,
    _args: string[],
    _options: unknown,
    callback: (error: Error | null, stdout: string) => void
  ) => callback(null, "'Custom'\n")
}))

let root: string
const procLinks = new Map<string, string>()
function procLink(target: string, file: string): void {
  // procfs links contain Linux-specific values, not host filesystem symlink targets.
  write(file, '')
  procLinks.set(path.join(root, file), target)
}
const platform = Object.getOwnPropertyDescriptor(process, 'platform') as PropertyDescriptor
function write(file: string, content: string): string {
  const target = path.join(root, file)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
  return target
}
function desktop(id: string, fields: string, location = 'data'): string {
  return write(`${location}/applications/${id}.desktop`, `[Desktop Entry]\n${fields}\n`)
}

beforeEach(() => {
  vi.resetModules()
  // Stay on the checkout drive so XDG_DATA_DIRS can be relative on Windows.
  root = fs.mkdtempSync(path.join(process.cwd(), '.linux-app-test-'))
  Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' })
  vi.stubEnv('XDG_DATA_HOME', path.join(root, 'data'))
  // XDG uses ':' as its separator, so keep Windows drive letters out of this list.
  vi.stubEnv('XDG_DATA_DIRS', path.relative(process.cwd(), path.join(root, 'system')))
  procLinks.clear()
  const readlink = fs.promises.readlink.bind(fs.promises)
  vi.spyOn(fs.promises, 'readlink').mockImplementation((file, options) => {
    const target = procLinks.get(String(file))
    return target === undefined ? readlink(file, options) : Promise.resolve(target)
  })
  vi.stubEnv('HOME', root)
  vi.stubEnv('PATH', path.join(root, 'bin'))
  vi.stubEnv('LC_ALL', 'zh_CN.UTF-8')
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.useRealTimers()
  Object.defineProperty(process, 'platform', platform)
  fs.rmSync(root, { recursive: true, force: true })
})

it('resolves quoted env launchers, symlinks, localized names and inherited SVG icons', async () => {
  const executable = write('opt/browser/chrome', '')
  const launcher = write(
    'opt/browser/google-chrome',
    '#!/bin/sh\nexec -a "$0" "$HERE/chrome" "$@"\n'
  )
  fs.mkdirSync(path.join(root, 'bin'))
  fs.symlinkSync(launcher, path.join(root, 'bin/google-chrome'))
  fs.chmodSync(launcher, 0o755)
  desktop(
    'browser',
    'Name=Browser\nName[zh_CN]=浏览器\nNoDisplay=true\nExec=env FLAG=1 "google-chrome" %U\nIcon=browser\n[Desktop Action New]\nName=Wrong'
  )
  write('data/icons/Custom/index.theme', '[Icon Theme]\nInherits=Parent\nDirectories=\n')
  write('system/icons/Parent/index.theme', '[Icon Theme]\nDirectories=scalable/apps\n')
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>'
  write('system/icons/Parent/scalable/apps/browser.svg', svg)
  write('data/icons/hicolor/64x64/apps/browser.png', 'wrong theme')
  const { getLinuxAppInfo } = await import('./linux')
  await expect(getLinuxAppInfo({ processPath: executable })).resolves.toEqual({
    name: '浏览器',
    icon: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  })
})

it('prefers the visible application over hidden file handlers sharing its executable', async () => {
  desktop(
    'gnome-software-local-file-flatpak',
    'Name=Software Install\nExec=/usr/bin/gnome-software --local-filename %f\nNoDisplay=true'
  )
  desktop('org.gnome.Software', 'Name=Software\nExec=/usr/bin/gnome-software %U')
  const { getLinuxAppInfo } = await import('./linux')
  expect(await getLinuxAppInfo({ processPath: '/usr/bin/gnome-software' })).toEqual({
    name: 'Software',
    icon: ''
  })
})

it('honors user Hidden overrides and rejects suffix or AppImage mount guesses', async () => {
  desktop('hidden', 'Hidden=true')
  desktop('hidden', 'Name=Hidden\nExec=/opt/hidden', 'system')
  desktop('browser', 'Name=Browser\nExec=/usr/bin/not-firefox')
  desktop('image', 'Name=Image\nExec=/opt/Image.AppImage')
  const { getLinuxAppInfo } = await import('./linux')
  for (const processPath of [
    '/opt/hidden',
    '/usr/bin/firefox',
    '/tmp/.mount_Image/usr/bin/electron'
  ]) {
    await expect(getLinuxAppInfo({ processPath })).resolves.toEqual({ name: '', icon: '' })
  }
})

it('supports recursive desktop IDs, locale modifiers and absolute or pixmap icons', async () => {
  vi.stubEnv('LC_ALL', 'sr_RS.UTF-8@latin')
  const icon = write('absolute.svg', '<svg/>')
  desktop('nested/app', `Name=App\nName[sr@latin]=Latin App\nExec=/opt/app\nIcon=${icon}`)
  desktop('pixmap', 'Name=Pixmap\nExec=/opt/pixmap\nIcon=pixmap')
  write('data/pixmaps/pixmap.png', 'png')
  const { getLinuxAppInfo } = await import('./linux')
  expect(await getLinuxAppInfo({ processPath: '/opt/app' })).toEqual({
    name: 'Latin App',
    icon: `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`
  })
  expect((await getLinuxAppInfo({ processPath: '/opt/pixmap' })).icon).toMatch(/^data:image\/png;/)
})

it('shares concurrent desktop scans and refreshes installed entries and missing icons', async () => {
  vi.useFakeTimers()
  desktop('app', 'Name=App\nExec=/opt/app\nIcon=app')
  const readdir = vi.spyOn(fs.promises, 'readdir')
  const { getLinuxAppInfo } = await import('./linux')
  const results = await Promise.all(
    Array.from({ length: 8 }, () => getLinuxAppInfo({ processPath: '/opt/app' }))
  )
  expect(results.every((info) => info.name === 'App' && !info.icon)).toBe(true)
  expect(
    readdir.mock.calls.filter(([dir]) => dir === path.join(root, 'data/applications'))
  ).toHaveLength(1)
  write('data/pixmaps/app.png', 'new icon')
  vi.advanceTimersByTime(300_001)
  expect((await getLinuxAppInfo({ processPath: '/opt/app' })).icon).toMatch(/^data:image\/png;/)
})

it('distinguishes shared helper connections by socket owner and parent cgroup', async () => {
  const procRoot = path.join(root, 'proc')
  desktop('org.example.One', 'Name=One\nExec=/opt/one')
  desktop('org.example.Two', 'Name=Two\nExec=/opt/two')
  desktop('image', `Name=AppImage\nExec=${root}/Example.AppImage`)
  desktop(
    'flatpak-export',
    'Name=Flatpak\nX-Flatpak=org.example.Sandbox\nExec=flatpak run org.example.Sandbox'
  )
  write(
    'proc/net/tcp',
    'header\n0: 0100007F:C350 00000000:0000 01 0 0 0 1000 0 4242\n1: 0100007F:C351 00000000:0000 01 0 0 0 1000 0 4243\n'
  )
  for (const [pid, parent, inode, id] of [
    [123, 100, 4242, 'One'],
    [124, 101, 4243, 'Two']
  ] as const) {
    write(`proc/${pid}/stat`, `${pid} (WebKitNetworkProcess) S ${parent}`)
    write(`proc/${pid}/status`, 'Uid:\t1000\t1000\t1000\t1000\n')
    write(`proc/${pid}/cgroup`, '0::/user.slice\n')
    fs.mkdirSync(path.join(procRoot, String(pid), 'fd'))
    procLink(`socket:[${inode}]`, `proc/${pid}/fd/8`)
    procLink('/usr/libexec/WebKitNetworkProcess', `proc/${pid}/exe`)
    write(`proc/${parent}/stat`, `${parent} (app) S 1`)
    write(
      `proc/${parent}/cgroup`,
      `0::/user.slice/app.slice/app-gnome-org.example.${id}-123.scope\n`
    )
    procLink(`/opt/${id.toLowerCase()}`, `proc/${parent}/exe`)
  }
  const processes = await import('./linux-process')
  const findPid = processes.findConnectionPid
  const identity = processes.getProcessIdentity
  vi.spyOn(processes, 'findConnectionPid').mockImplementation((metadata) =>
    findPid(metadata, procRoot)
  )
  vi.spyOn(processes, 'getProcessIdentity').mockImplementation((pid) => identity(pid, procRoot))
  const { getLinuxAppInfo } = await import('./linux')
  const metadata = {
    network: 'tcp',
    sourceIP: '127.0.0.1',
    sourcePort: '50000',
    uid: 1000,
    processPath: '/usr/libexec/WebKitNetworkProcess'
  }
  const results = await Promise.all([
    getLinuxAppInfo(metadata),
    getLinuxAppInfo({ ...metadata, sourcePort: '50001' })
  ])
  expect(results.map((info) => info.name)).toEqual(['One', 'Two'])
  write('proc/100/cgroup', '')
  write('proc/100/environ', `APPIMAGE=${root}/Example.AppImage\0`)
  expect((await getLinuxAppInfo(metadata)).name).toBe('AppImage')
  write('proc/100/cgroup', '0::/user.slice/app.slice/app-flatpak-org.example.Sandbox-42.scope\n')
  expect((await getLinuxAppInfo(metadata)).name).toBe('Flatpak')
  expect(await findPid({ ...metadata, uid: 1001 }, procRoot)).toBeUndefined()
  expect(await findPid({ ...metadata, sourceIP: '192.168.0.1' }, procRoot)).toBeUndefined()
})

it('falls back safely for inaccessible processes, missing entries and non-Linux hosts', async () => {
  const { getLinuxAppInfo } = await import('./linux')
  expect(await getLinuxAppInfo({})).toEqual({ name: '', icon: '' })
  Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
  expect(await getLinuxAppInfo({ processPath: '/opt/app' })).toEqual({ name: '', icon: '' })
})

it('does not enumerate processes for missing sockets and skips unrelated file descriptors', async () => {
  const procRoot = path.join(root, 'proc')
  write('proc/net/tcp', 'header\n0: 0100007F:C350 00000000:0000 01 0 0 0 1000 0 4242\n')
  for (let pid = 100; pid < 151; pid++) {
    write(`proc/${pid}/status`, 'Uid:\t1000\n')
    procLink(pid === 150 ? '/opt/browser' : '/opt/unrelated', `proc/${pid}/exe`)
    fs.mkdirSync(path.join(procRoot, `${pid}/fd`))
    for (let fd = 0; fd < 20; fd++) {
      procLink(pid === 150 && fd === 0 ? 'socket:[4242]' : '/dev/null', `proc/${pid}/fd/${fd}`)
    }
  }
  const readdir = vi.spyOn(fs.promises, 'readdir')
  const readlink = vi.spyOn(fs.promises, 'readlink')
  const { findConnectionPid } = await import('./linux-process')
  const metadata = {
    network: 'tcp',
    sourceIP: '127.0.0.1',
    sourcePort: '50001',
    uid: 1000,
    processPath: '/opt/browser'
  }
  expect(await findConnectionPid(metadata, procRoot)).toBeUndefined()
  expect(readdir).not.toHaveBeenCalled()
  expect(readlink).not.toHaveBeenCalled()
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      findConnectionPid({ ...metadata, sourcePort: '50000' }, procRoot)
    )
  )
  expect(results).toEqual(Array(8).fill(150))
  expect(readdir.mock.calls.filter(([dir]) => dir === procRoot)).toHaveLength(1)
  expect(
    readlink.mock.calls.filter(([file]) => String(file).includes(`${path.sep}fd${path.sep}`))
  ).toHaveLength(20)
  expect(
    readlink.mock.calls.filter(([file]) => path.basename(String(file)) === 'exe')
  ).toHaveLength(51)
})
