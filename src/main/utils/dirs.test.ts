import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tmpRoot = ''
let appDataDir = ''
let exeDir = ''
let packaged = false
let appName = 'mihomo-party'
let paths: Record<string, string> = {}
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

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))

function writeFixture(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content)
}

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), 'clash-party-dirs-'))
  appDataDir = path.join(tmpRoot, 'app-data')
  exeDir = path.join(tmpRoot, 'runtime', 'Electron.app', 'Contents', 'MacOS')
  packaged = false
  appName = 'mihomo-party'
  paths = {
    appData: appDataDir,
    userData: path.join(appDataDir, 'mihomo-party'),
    home: path.join(tmpRoot, 'home'),
    exe: path.join(exeDir, 'Electron')
  }
  setPath.mockReset().mockImplementation((name: string, value: string) => {
    paths[name] = value
  })
  setName.mockReset().mockImplementation((value: string) => {
    appName = value
  })
  vi.resetModules()
})

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('configureAppPaths', () => {
  it('isolates an unpackaged local development app', async () => {
    const { configureAppPaths } = await import('./dirs')
    configureAppPaths()

    expect(setName).toHaveBeenCalledWith('mihomo-party-dev')
    expect(paths.userData).toBe(path.join(appDataDir, 'mihomo-party-dev'))
    expect(paths.sessionData).toBe(path.join(appDataDir, 'mihomo-party-dev', 'cache'))
  })

  it('leaves packaged stable and dev-release builds on production paths', async () => {
    packaged = true
    const { configureAppPaths } = await import('./dirs')
    configureAppPaths()

    expect(setName).not.toHaveBeenCalled()
    expect(paths.userData).toBe(path.join(appDataDir, 'mihomo-party'))
    expect(paths.sessionData).toBe(path.join(appDataDir, 'mihomo-party', 'cache'))
  })

  it('keeps portable userData precedence over local development isolation', async () => {
    writeFixture(path.join(exeDir, 'PORTABLE'), '')
    const { configureAppPaths } = await import('./dirs')
    configureAppPaths()

    expect(setName).toHaveBeenCalledWith('mihomo-party-dev')
    expect(paths.userData).toBe(path.join(exeDir, 'data'))
    expect(paths.sessionData).toBe(path.join(exeDir, 'data', 'cache'))
    expect(setPath).toHaveBeenLastCalledWith('sessionData', path.join(exeDir, 'data', 'cache'))
  })

  it('migrates legacy IndexedDB and Network into cache before setting sessionData', async () => {
    packaged = true
    const dataRoot = paths.userData
    const legacyIdbSubpath = path.join('IndexedDB', 'file__0.indexeddb.leveldb', '000001.ldb')
    const legacyNetworkSubpath = path.join('Network', 'Cookies')
    writeFixture(path.join(dataRoot, legacyIdbSubpath), 'legacy-idb-data')
    writeFixture(path.join(dataRoot, legacyNetworkSubpath), 'legacy-cookie-data')

    const expectedCacheDir = path.join(dataRoot, 'cache')
    let migratedBeforeSetSessionData = false
    setPath.mockImplementation((name: string, value: string) => {
      if (name === 'sessionData') {
        migratedBeforeSetSessionData =
          existsSync(path.join(value, legacyIdbSubpath)) &&
          existsSync(path.join(value, legacyNetworkSubpath)) &&
          !existsSync(path.join(dataRoot, 'IndexedDB')) &&
          !existsSync(path.join(dataRoot, 'Network'))
      }
      paths[name] = value
    })

    const { configureAppPaths } = await import('./dirs')
    configureAppPaths()

    expect(setPath).toHaveBeenCalledWith('sessionData', expectedCacheDir)
    expect(migratedBeforeSetSessionData).toBe(true)
    expect(existsSync(path.join(dataRoot, 'IndexedDB'))).toBe(false)
    expect(existsSync(path.join(dataRoot, 'Network'))).toBe(false)
    expect(readFileSync(path.join(expectedCacheDir, legacyIdbSubpath), 'utf8')).toBe(
      'legacy-idb-data'
    )
    expect(readFileSync(path.join(expectedCacheDir, legacyNetworkSubpath), 'utf8')).toBe(
      'legacy-cookie-data'
    )
  })

  it('preserves existing cache IndexedDB and Network without overwriting', async () => {
    packaged = true
    const dataRoot = paths.userData
    const cacheDir = path.join(dataRoot, 'cache')

    writeFixture(path.join(dataRoot, 'IndexedDB', 'legacy.txt'), 'legacy-idb')
    writeFixture(path.join(dataRoot, 'Network', 'Cookies'), 'legacy-cookies')
    writeFixture(path.join(cacheDir, 'IndexedDB', 'current.txt'), 'current-idb')
    writeFixture(path.join(cacheDir, 'Network', 'Cookies'), 'current-cookies')

    const { configureAppPaths } = await import('./dirs')
    configureAppPaths()

    expect(readFileSync(path.join(cacheDir, 'IndexedDB', 'current.txt'), 'utf8')).toBe(
      'current-idb'
    )
    expect(existsSync(path.join(cacheDir, 'IndexedDB', 'legacy.txt'))).toBe(false)
    expect(readFileSync(path.join(cacheDir, 'Network', 'Cookies'), 'utf8')).toBe('current-cookies')
    expect(readFileSync(path.join(dataRoot, 'IndexedDB', 'legacy.txt'), 'utf8')).toBe('legacy-idb')
    expect(readFileSync(path.join(dataRoot, 'Network', 'Cookies'), 'utf8')).toBe('legacy-cookies')
  })
})
