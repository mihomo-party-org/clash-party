import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let packaged = false
const execFile = vi.fn()
const fileIconToBuffer = vi.fn()

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return packaged
    },
    getPath: vi.fn(() => '')
  }
}))

vi.mock('child_process', () => ({
  exec: vi.fn(),
  execFile
}))

vi.mock('file-icon', () => ({ fileIconToBuffer }))
vi.mock('file-icon-info', () => ({ getIcon: vi.fn() }))
vi.mock('../config', () => ({ getControledMihomoConfig: vi.fn() }))

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
const resourcesPathDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
let tempDir: string
let outerApp: string
let helperExecutable: string

beforeEach(() => {
  packaged = false
  execFile.mockReset()
  fileIconToBuffer.mockReset()
  vi.resetModules()

  Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' })
  Object.defineProperty(process, 'resourcesPath', {
    configurable: true,
    value: '/tmp/clash-party-resources'
  })

  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clash-party-icon-'))
  outerApp = path.join(tempDir, 'Browser.app')
  helperExecutable = path.join(
    outerApp,
    'Contents',
    'Frameworks',
    'Browser Helper.app',
    'Contents',
    'MacOS',
    'Browser Helper'
  )
  fs.mkdirSync(path.join(outerApp, 'Contents', 'Resources'), { recursive: true })
  fs.mkdirSync(path.dirname(helperExecutable), { recursive: true })
  fs.writeFileSync(path.join(outerApp, 'Contents', 'Resources', 'Browser.icns'), '')
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
  if (platformDescriptor) {
    Object.defineProperty(process, 'platform', platformDescriptor)
  }
  if (resourcesPathDescriptor) {
    Object.defineProperty(process, 'resourcesPath', resourcesPathDescriptor)
  } else {
    delete process.resourcesPath
  }
  vi.restoreAllMocks()
})

describe('getIconDataURL on macOS', () => {
  it('executes the unpacked file-icon helper in packaged builds', async () => {
    packaged = true
    execFile.mockImplementation((_file, _args, _options, callback) => {
      callback(null, Buffer.from('packaged-icon'), Buffer.alloc(0))
    })

    const { getIconDataURL } = await import('./icon')
    const result = await getIconDataURL(helperExecutable)

    expect(execFile).toHaveBeenCalledWith(
      path.join(
        '/tmp/clash-party-resources',
        'app.asar.unpacked',
        'node_modules',
        'file-icon',
        'file-icon'
      ),
      [JSON.stringify([{ appOrPID: outerApp, size: 512 }])],
      { encoding: null, maxBuffer: 100 * 1024 * 1024 },
      expect.any(Function)
    )
    expect(fileIconToBuffer).not.toHaveBeenCalled()
    expect(result).toBe(`data:image/png;base64,${Buffer.from('packaged-icon').toString('base64')}`)
  })

  it('uses the file-icon module directly during development', async () => {
    fileIconToBuffer.mockResolvedValue(Buffer.from('development-icon'))

    const { getIconDataURL } = await import('./icon')
    const result = await getIconDataURL(helperExecutable)

    expect(fileIconToBuffer).toHaveBeenCalledWith(outerApp, { size: 512 })
    expect(execFile).not.toHaveBeenCalled()
    expect(result).toBe(
      `data:image/png;base64,${Buffer.from('development-icon').toString('base64')}`
    )
  })
})
