import fs from 'fs'
import { posix as path } from 'path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const { execFile, getFileIcon, settings } = vi.hoisted(() => ({
  execFile: vi.fn(),
  getFileIcon: vi.fn(),
  settings: { packaged: false, root: '', platform: 'darwin' }
}))
// The simulated macOS host must use POSIX paths even when Vitest runs on Windows.
vi.mock('path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('path')>()
  return { ...actual, default: actual.posix }
})
vi.mock('child_process', () => ({ execFile }))
vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return settings.packaged
    },
    getAppPath: () => settings.root,
    getPath: () => `${settings.root}/Browser.app/Contents/MacOS/Browser`,
    getFileIcon
  }
}))
let root: string
let executable: string
const files = new Map<string, string>()
const directories = new Set<string>()
function mkdir(directory: string): void {
  directories.add(directory)
  const parent = path.dirname(directory)
  if (parent !== directory) mkdir(parent)
}
function write(file: string, content: string): void {
  mkdir(path.dirname(file))
  files.set(file, content)
}
const platform = Object.getOwnPropertyDescriptor(process, 'platform') as PropertyDescriptor
const resources = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
function setPlatform(value: string): void {
  Object.defineProperty(process, 'platform', { configurable: true, value })
}
beforeEach(() => {
  vi.resetModules()
  execFile.mockReset()
  getFileIcon.mockReset()
  settings.packaged = false
  root = '/app-info'
  files.clear()
  directories.clear()
  vi.spyOn(fs.promises, 'stat').mockImplementation(async (file) => {
    if (!directories.has(String(file)) && !files.has(String(file))) throw new Error('ENOENT')
    return {
      isDirectory: () => directories.has(String(file)),
      isFile: () => files.has(String(file))
    } as fs.Stats
  })
  vi.spyOn(fs.promises, 'access').mockImplementation(async (file) => {
    if (!directories.has(String(file)) && !files.has(String(file))) throw new Error('ENOENT')
  })
  vi.spyOn(fs.promises, 'readdir').mockImplementation(async (directory) => {
    if (!directories.has(String(directory))) throw new Error('ENOENT')
    return [...directories, ...files.keys()]
      .filter((file) => file !== String(directory) && path.dirname(file) === String(directory))
      .map((file) => path.basename(file)) as never
  })
  vi.spyOn(fs.promises, 'readFile').mockImplementation(async (file) => {
    const content = files.get(String(file))
    if (content === undefined) throw new Error('ENOENT')
    return content
  })
  settings.root = root
  setPlatform('darwin')
  Object.defineProperty(process, 'resourcesPath', { configurable: true, value: '/resources' })
  executable = path.join(root, 'Browser.app/Contents/Frameworks/Helper.app/Contents/MacOS/Helper')
  mkdir(path.dirname(executable))
  mkdir(path.join(root, 'Browser.app/Contents/Resources'))
  write(path.join(root, 'Browser.app/Contents/Resources/browser.icns'), '')
  execFile.mockImplementation((file, _args, _options, callback) => {
    callback(null, file === '/usr/bin/osascript' ? '浏览器\n' : Buffer.from('icon'))
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  Object.defineProperty(process, 'platform', platform)
  if (resources) Object.defineProperty(process, 'resourcesPath', resources)
  else delete process.resourcesPath
})

it.each([false, true])(
  'shares macOS bundle work across helpers (packaged=%s) with bounded 64px extraction',
  async (packaged) => {
    settings.packaged = packaged
    const { getAppInfo } = await import('./index')
    const paths = [executable, `${root}/Browser.app/Contents/MacOS/Browser`, executable]
    const results = await Promise.all(paths.map((processPath) => getAppInfo({ processPath })))
    expect(results).toEqual(
      Array(3).fill({
        name: '浏览器',
        icon: `data:image/png;base64,${Buffer.from('icon').toString('base64')}`
      })
    )
    expect(execFile).toHaveBeenCalledTimes(2)
    expect(execFile).toHaveBeenCalledWith(
      packaged
        ? '/resources/app.asar.unpacked/node_modules/file-icon/file-icon'
        : `${root}/node_modules/file-icon/file-icon`,
      [JSON.stringify([{ appOrPID: `${root}/Browser.app`, size: 64 }])],
      expect.objectContaining({ timeout: 5000, maxBuffer: 2 * 1024 * 1024 }),
      expect.any(Function)
    )
    expect(execFile.mock.calls.find(([file]) => file === '/usr/bin/osascript')?.[1].at(-1)).toBe(
      `${root}/Browser.app`
    )
  }
)

it('keeps inner bundles with their own icons and falls back to Info.plist asynchronously', async () => {
  const helper = path.dirname(path.dirname(path.dirname(executable)))
  mkdir(path.join(helper, 'Contents/Resources'))
  write(path.join(helper, 'Contents/Resources/helper.icns'), '')
  write(
    path.join(helper, 'Contents/Info.plist'),
    '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleDisplayName</key><string>Helper Name</string></dict></plist>'
  )
  execFile.mockImplementation((file, _args, _options, callback) =>
    callback(file === '/usr/bin/osascript' ? new Error('timeout') : null, Buffer.from('icon'))
  )
  const { getAppInfo } = await import('./index')
  expect((await getAppInfo({ processPath: executable })).name).toBe('Helper Name')
  expect(execFile.mock.calls.find(([file]) => file !== '/usr/bin/osascript')?.[1][0]).toContain(
    helper
  )
})

it('handles iOS-style root plists and avoids subprocesses for non-app or missing paths', async () => {
  const bundle = path.join(root, 'iOS.app')
  mkdir(bundle)
  write(
    path.join(bundle, 'Info.plist'),
    '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleName</key><string>iOS App</string></dict></plist>'
  )
  execFile.mockImplementation((_file, _args, _options, callback) =>
    callback(new Error('unavailable'), '')
  )
  const { getAppInfo } = await import('./index')
  expect((await getAppInfo({ processPath: `${bundle}/binary` })).name).toBe('iOS App')
  execFile.mockClear()
  for (const processPath of [
    '',
    '/usr/bin/curl',
    `${root}/missing.app/binary`,
    '/tmp/not.app.backup/bin'
  ]) {
    expect(await getAppInfo({ processPath })).toEqual({ name: '', icon: '' })
  }
  expect(execFile).not.toHaveBeenCalled()
})

it.each([
  [['Friendly Browser', 'Product'], 'Friendly Browser'],
  [['  ', '产品名称'], '产品名称'],
  [[null, null], '']
])('extracts Windows friendly names with product fallback: %j', async (names, expected) => {
  setPlatform('win32')
  vi.spyOn(fs.promises, 'stat').mockResolvedValue({ isFile: () => true } as fs.Stats)
  getFileIcon.mockResolvedValue({ isEmpty: () => false, toDataURL: () => 'data:icon' })
  execFile.mockImplementation((_file, _args, _options, callback) => {
    callback(null, JSON.stringify(names))
  })
  const { getAppInfo } = await import('./index')
  const file = "C:\\应用\\A '& $name.exe"
  const results = await Promise.all([
    getAppInfo({ processPath: file }),
    getAppInfo({ processPath: file.toUpperCase() })
  ])
  expect(results).toEqual(Array(2).fill({ name: expected, icon: 'data:icon' }))
  expect(execFile).toHaveBeenCalledTimes(1)
  expect(getFileIcon).toHaveBeenCalledTimes(1)
  expect(getFileIcon).toHaveBeenCalledWith(file, { size: 'normal' })
  expect(execFile.mock.calls[0][2]).toMatchObject({
    env: { MIHOMO_APP_PATH: file },
    windowsHide: true,
    timeout: 3000
  })
  expect(execFile.mock.calls[0][1].join(' ')).not.toContain(file)
})

it('caches Windows failures, expires them and skips invalid files', async () => {
  vi.useFakeTimers()
  setPlatform('win32')
  const stat = vi.spyOn(fs.promises, 'stat').mockResolvedValue({ isFile: () => true } as fs.Stats)
  getFileIcon.mockRejectedValue(new Error('no icon'))
  execFile.mockImplementation((_file, _args, _options, callback) => {
    callback(new Error('timeout'), '')
  })
  const { getAppInfo } = await import('./index')
  const metadata = { processPath: 'C:\\app.exe' }
  for (let i = 0; i < 10; i++) expect(await getAppInfo(metadata)).toEqual({ name: '', icon: '' })
  expect(execFile).toHaveBeenCalledTimes(1)
  vi.advanceTimersByTime(30_001)
  await getAppInfo(metadata)
  expect(execFile).toHaveBeenCalledTimes(2)
  execFile.mockClear()
  getFileIcon.mockClear()
  stat.mockResolvedValue({ isFile: () => false } as fs.Stats)
  for (const processPath of ['relative.exe', 'C:\\readme.txt', 'C:\\directory.exe'])
    await getAppInfo({ processPath })
  expect(execFile).not.toHaveBeenCalled()
  expect(getFileIcon).not.toHaveBeenCalled()
})
