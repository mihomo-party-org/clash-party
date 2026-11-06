import { existsSync, mkdirSync, renameSync } from 'fs'
import path from 'path'
import { is } from '@electron-toolkit/utils'
import { app } from 'electron'

export const homeDir = app.getPath('home')

export function isPortable(): boolean {
  return existsSync(path.join(exeDir(), 'PORTABLE'))
}

function portableDataDir(): string {
  return path.join(exeDir(), 'data')
}

// 本地 Electron.app 使用独立的应用名和数据目录，避免开发时访问正式版的
// `mihomo-party Safe Storage` Keychain item 或修改正式配置。已打包的 dev 预发行版
// 仍与正式版共享身份和数据，保持原有滚动升级路径。
export function configureAppPaths(): void {
  if (!app.isPackaged) {
    app.setName('mihomo-party-dev')
    app.setPath('userData', path.join(app.getPath('appData'), 'mihomo-party-dev'))
  }

  // portable 模式始终拥有最高优先级。
  if (isPortable()) {
    app.setPath('userData', portableDataDir())
  }

  // Electron stores Chromium session data (including Cache, Code Cache and
  // GPUCache) in userData by default. Keep those generated files together so
  // the application data directory remains easy to manage.
  const sessionDataDir = path.join(dataDir(), 'cache')
  mkdirSync(sessionDataDir, { recursive: true })
  const sessionDataEntries = [
    'Cache',
    'Code Cache',
    'GPUCache',
    'DawnGraphiteCache',
    'DawnWebGPUCache',
    'Cookies',
    'Cookies-journal',
    'Local Storage',
    'Session Storage',
    'Sessions',
    'Network Persistent State',
    'Preferences',
    'Shared Dictionary',
    'TransportSecurity',
    'Service Worker',
    'databases',
    'blob_storage',
    'File System',
    'WebStorage'
  ]
  for (const entry of sessionDataEntries) {
    const legacyPath = path.join(dataDir(), entry)
    const targetPath = path.join(sessionDataDir, entry)
    if (!existsSync(legacyPath) || existsSync(targetPath)) continue
    try {
      renameSync(legacyPath, targetPath)
    } catch {
      // A locked cache can be recreated in the new location on the next launch.
    }
  }
  app.setPath('sessionData', sessionDataDir)
}

export function dataDir(): string {
  if (isPortable()) {
    return portableDataDir()
  } else {
    return app.getPath('userData')
  }
}

export function taskDir(): string {
  const baseDir = dataDir()
  if (!existsSync(baseDir)) {
    mkdirSync(baseDir, { recursive: true })
  }

  const dir = path.join(baseDir, 'tasks')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function subStoreDir(): string {
  return path.join(dataDir(), 'substore')
}

export function exeDir(): string {
  return path.dirname(exePath())
}

export function exePath(): string {
  return app.getPath('exe')
}

export function resourcesDir(): string {
  if (is.dev) {
    return path.join(__dirname, '../../extra')
  } else {
    if (app.getAppPath().endsWith('asar')) {
      return process.resourcesPath
    } else {
      return path.join(app.getAppPath(), 'resources')
    }
  }
}

export function resourcesFilesDir(): string {
  return path.join(resourcesDir(), 'files')
}

export function themesDir(): string {
  return path.join(dataDir(), 'themes')
}

export function mihomoCoreDir(): string {
  return path.join(resourcesDir(), 'sidecar')
}

export function mihomoCorePath(core: string): string {
  const isWin = process.platform === 'win32'
  // 处理 Smart 内核
  if (core === 'mihomo-smart') {
    return path.join(mihomoCoreDir(), `mihomo-smart${isWin ? '.exe' : ''}`)
  }
  return path.join(mihomoCoreDir(), `${core}${isWin ? '.exe' : ''}`)
}

export function appConfigPath(): string {
  return path.join(dataDir(), 'config.yaml')
}

export function trafficUsageDatabasePath(): string {
  return path.join(dataDir(), 'traffic-usage.db')
}

export function controledMihomoConfigPath(): string {
  return path.join(dataDir(), 'mihomo.yaml')
}

export function profileConfigPath(): string {
  return path.join(dataDir(), 'profile.yaml')
}

export function profilesDir(): string {
  return path.join(dataDir(), 'profiles')
}

export function profilePath(id: string): string {
  return path.join(profilesDir(), `${id}.yaml`)
}

export function pluginConfigPath(): string {
  return path.join(dataDir(), 'plugin.yaml')
}

export function pluginVaultDir(): string {
  return path.join(dataDir(), 'plugin-vault')
}

export function pluginVaultPath(id: string): string {
  return path.join(pluginVaultDir(), `${id}.bin`)
}

export function overrideDir(): string {
  return path.join(dataDir(), 'override')
}

export function overrideConfigPath(): string {
  return path.join(dataDir(), 'override.yaml')
}

export function overridePath(id: string, ext: 'js' | 'yaml' | 'log'): string {
  return path.join(overrideDir(), `${id}.${ext}`)
}

export function mihomoWorkDir(): string {
  return path.join(dataDir(), 'work')
}

export function mihomoProfileWorkDir(id: string | undefined): string {
  return path.join(mihomoWorkDir(), id || 'default')
}

export function mihomoTestDir(): string {
  return path.join(dataDir(), 'test')
}

export function mihomoWorkConfigPath(id: string | undefined): string {
  if (id === 'work') {
    return path.join(mihomoWorkDir(), 'config.yaml')
  } else {
    return path.join(mihomoProfileWorkDir(id), 'config.yaml')
  }
}

export function localConfigPath(): string {
  return path.join(dataDir(), 'local-config.yaml')
}

export function localOutputPath(): string {
  return path.join(dataDir(), 'local-config.generated.yaml')
}

export function logDir(): string {
  return path.join(dataDir(), 'logs')
}

export function logPath(): string {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const name = `clash-party-${year}-${month}-${day}`
  return path.join(logDir(), `${name}.log`)
}

export function substoreLogPath(): string {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const name = `sub-store-${year}-${month}-${day}`
  return path.join(logDir(), `${name}.log`)
}

export function coreLogPath(): string {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const name = `core-${year}-${month}-${day}`
  return path.join(logDir(), `${name}.log`)
}

export function rulesDir(): string {
  return path.join(dataDir(), 'rules')
}

export function rulePath(id: string): string {
  return path.join(rulesDir(), `${id}.yaml`)
}
