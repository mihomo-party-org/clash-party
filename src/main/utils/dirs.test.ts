import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// dirs.ts 用 path.join 拼路径，在 Windows 上会得到反斜杠分隔符。
// 断言里不能写死 POSIX 字面量，否则整个用例只在类 Unix 平台通过。
const APP_DATA = path.join(path.sep, 'tmp', 'app-data')
const HOME = path.join(path.sep, 'tmp', 'home')
const EXE_DIR = path.join(path.sep, 'tmp', 'runtime', 'Electron.app', 'Contents', 'MacOS')
const EXE = path.join(EXE_DIR, 'Electron')

let packaged = false
let portable = false
let appName = 'mihomo-party'
const paths: Record<string, string> = {}
const setPath = vi.fn((name: string, value: string) => {
  paths[name] = value
})
const setName = vi.fn((value: string) => {
  appName = value
})

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return packaged
    },
    getPath: (name: string) => paths[name],
    setPath,
    setName,
    getName: () => appName
  }
}))

vi.mock('fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('fs')>()
  return {
    ...original,
    existsSync: (value: string) => portable && path.basename(value) === 'PORTABLE'
  }
})

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))

beforeEach(() => {
  packaged = false
  portable = false
  appName = 'mihomo-party'
  Object.assign(paths, {
    appData: APP_DATA,
    userData: path.join(APP_DATA, 'mihomo-party'),
    home: HOME,
    exe: EXE
  })
  setPath.mockClear()
  setName.mockClear()
  vi.resetModules()
})

afterEach(() => vi.restoreAllMocks())

describe('configureAppPaths', () => {
  it('isolates an unpackaged local development app', async () => {
    const { configureAppPaths } = await import('./dirs')
    configureAppPaths()

    expect(setName).toHaveBeenCalledWith('mihomo-party-dev')
    expect(paths.userData).toBe(path.join(APP_DATA, 'mihomo-party-dev'))
    expect(paths.sessionData).toBe(path.join(APP_DATA, 'mihomo-party-dev', 'cache'))
  })

  it('leaves packaged stable and dev-release builds on production paths', async () => {
    packaged = true
    const { configureAppPaths } = await import('./dirs')
    configureAppPaths()

    expect(setName).not.toHaveBeenCalled()
    expect(paths.userData).toBe(path.join(APP_DATA, 'mihomo-party'))
    expect(paths.sessionData).toBe(path.join(APP_DATA, 'mihomo-party', 'cache'))
  })

  it('keeps portable userData precedence over local development isolation', async () => {
    portable = true
    const { configureAppPaths } = await import('./dirs')
    configureAppPaths()

    expect(setName).toHaveBeenCalledWith('mihomo-party-dev')
    expect(paths.userData).toBe(path.join(EXE_DIR, 'data'))
    expect(paths.sessionData).toBe(path.join(EXE_DIR, 'data', 'cache'))
    expect(setPath).toHaveBeenLastCalledWith('sessionData', path.join(EXE_DIR, 'data', 'cache'))
  })
})
