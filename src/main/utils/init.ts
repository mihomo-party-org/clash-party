import { mkdir, writeFile, rm, readdir, cp, stat, rename } from 'fs/promises'
import { existsSync } from 'fs'
import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { app, dialog } from 'electron'
import {
  startPacServer,
  startSubStoreBackendServer,
  startSubStoreFrontendServer
} from '../resolve/server'
import { triggerSysProxy } from '../sys/sysproxy'
import {
  getAppConfig,
  getControledMihomoConfig,
  patchAppConfig,
  patchControledMihomoConfig
} from '../config'
import { startSSIDCheck } from '../sys/ssid'
import i18next, { resources } from '../../shared/i18n'
import { stringify } from './yaml'
import {
  defaultConfig,
  defaultControledMihomoConfig,
  defaultOverrideConfig,
  defaultProfile,
  defaultProfileConfig
} from './template'
import {
  appConfigPath,
  controledMihomoConfigPath,
  dataDir,
  logDir,
  mihomoTestDir,
  mihomoWorkDir,
  overrideConfigPath,
  overrideDir,
  profileConfigPath,
  profilePath,
  profilesDir,
  resourcesFilesDir,
  rulesDir,
  subStoreDir,
  themesDir
} from './dirs'
import { initLogger } from './logger'

let isInitBasicCompleted = false

export function safeShowErrorBox(titleKey: string, message: string): void {
  let title: string
  try {
    title = i18next.t(titleKey)
    if (!title || title === titleKey) throw new Error('Translation not ready')
  } catch {
    const isZh = app.getLocale().startsWith('zh')
    const lang = isZh ? resources['zh-CN'].translation : resources['en-US'].translation
    title = lang[titleKey] || (isZh ? '错误' : 'Error')
  }
  dialog.showErrorBox(title, message)
}

async function fixDataDirPermissions(): Promise<void> {
  if (process.platform !== 'darwin') return

  const dataDirPath = dataDir()
  if (!existsSync(dataDirPath)) return

  try {
    const stats = await stat(dataDirPath)
    const currentUid = process.getuid?.() || 0

    if (stats.uid === 0 && currentUid !== 0) {
      const execPromise = promisify(exec)
      const username = process.env.USER || process.env.LOGNAME
      if (username) {
        await execPromise(`chown -R "${username}:staff" "${dataDirPath}"`)
        await execPromise(`chmod -R u+rwX "${dataDirPath}"`)
      }
    }
  } catch {
    // ignore
  }
}

async function isSourceNewer(sourcePath: string, targetPath: string): Promise<boolean> {
  try {
    const [sourceStats, targetStats] = await Promise.all([stat(sourcePath), stat(targetPath)])
    return sourceStats.mtime > targetStats.mtime
  } catch {
    return true
  }
}

async function initDirs(): Promise<void> {
  await fixDataDirPermissions()

  const dirsToCreate = [
    dataDir(),
    themesDir(),
    profilesDir(),
    overrideDir(),
    rulesDir(),
    mihomoWorkDir(),
    logDir(),
    mihomoTestDir(),
    subStoreDir()
  ]

  await Promise.all(
    dirsToCreate.map(async (dir) => {
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true })
      }
    })
  )
}

async function initConfig(): Promise<void> {
  const configs = [
    { path: appConfigPath(), content: defaultConfig, name: 'app config' },
    { path: profileConfigPath(), content: defaultProfileConfig, name: 'profile config' },
    { path: overrideConfigPath(), content: defaultOverrideConfig, name: 'override config' },
    { path: profilePath('default'), content: defaultProfile, name: 'default profile' },
    {
      path: controledMihomoConfigPath(),
      content: defaultControledMihomoConfig,
      name: 'mihomo config'
    }
  ]

  await Promise.all(
    configs.map(async (config) => {
      if (!existsSync(config.path)) {
        await writeFile(config.path, stringify(config.content))
      }
    })
  )
}

async function killOldMihomoProcesses(): Promise<void> {
  if (process.platform !== 'win32') return

  const execPromise = promisify(exec)
  try {
    const { stdout } = await execPromise(
      'powershell -NoProfile -Command "Get-Process | Where-Object {$_.ProcessName -like \'*mihomo*\'} | Select-Object Id | ConvertTo-Json"',
      { encoding: 'utf8' }
    )

    if (!stdout.trim()) return

    const processes = JSON.parse(stdout)
    const processArray = Array.isArray(processes) ? processes : [processes]

    for (const proc of processArray) {
      const pid = proc.Id
      if (pid && pid !== process.pid) {
        try {
          process.kill(pid, 'SIGTERM')
          await initLogger.info(`Terminated old mihomo process ${pid}`)
        } catch {
          // 进程可能退出
        }
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 500))
  } catch {
    // 忽略错误
  }
}

async function initFiles(): Promise<void> {
  await killOldMihomoProcesses()

  const copyFile = async (file: string): Promise<void> => {
    const sourcePath = path.join(resourcesFilesDir(), file)
    if (!existsSync(sourcePath)) return

    const targets = [path.join(mihomoWorkDir(), file), path.join(mihomoTestDir(), file)]

    await Promise.all(
      targets.map(async (targetPath) => {
        const shouldCopy = !existsSync(targetPath) || (await isSourceNewer(sourcePath, targetPath))
        if (!shouldCopy) return

        try {
          await cp(sourcePath, targetPath, { recursive: true, force: true })
        } catch (error: unknown) {
          const code = (error as NodeJS.ErrnoException).code
          // 文件被占用或权限问题，如果目标已存在则跳过
          if (
            (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') &&
            existsSync(targetPath)
          ) {
            await initLogger.warn(`Skipping ${file}: file is in use or permission denied`)
            return
          }
          throw error
        }
      })
    )
  }

  const files = [
    'country.mmdb',
    'geoip.metadb',
    'geoip.dat',
    'geosite.dat',
    'ASN.mmdb',
    'sub-store.bundle.cjs',
    'sub-store-frontend'
  ]

  const criticalFiles = ['country.mmdb', 'geoip.dat', 'geosite.dat']

  const results = await Promise.allSettled(files.map(copyFile))

  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    if (result.status === 'rejected') {
      const file = files[i]
      await initLogger.error(`Failed to copy ${file}`, result.reason)
      if (criticalFiles.includes(file)) {
        throw new Error(`Failed to copy critical file ${file}: ${result.reason}`)
      }
    }
  }
}

async function cleanup(): Promise<void> {
  const [dataFiles, logFiles] = await Promise.all([readdir(dataDir()), readdir(logDir())])

  // 清理更新缓存
  const cacheExtensions = ['.exe', '.pkg', '.7z']
  const cacheCleanup = dataFiles
    .filter((file) => cacheExtensions.some((ext) => file.endsWith(ext)))
    .map((file) => rm(path.join(dataDir(), file)).catch(() => {}))

  // 清理过期日志
  const { maxLogDays = 7 } = await getAppConfig()
  const maxAge = maxLogDays * 24 * 60 * 60 * 1000
  const datePattern = /^\d{4}-\d{2}-\d{2}/

  const logCleanup = logFiles
    .filter((log) => {
      const match = log.match(datePattern)
      if (!match) return false
      const date = new Date(match[0])
      return !isNaN(date.getTime()) && Date.now() - date.getTime() > maxAge
    })
    .map((log) => rm(path.join(logDir(), log)).catch(() => {}))

  await Promise.all([...cacheCleanup, ...logCleanup])
}

async function migrateSubStoreFiles(): Promise<void> {
  const oldJsPath = path.join(mihomoWorkDir(), 'sub-store.bundle.js')
  const newCjsPath = path.join(mihomoWorkDir(), 'sub-store.bundle.cjs')

  if (existsSync(oldJsPath) && !existsSync(newCjsPath)) {
    try {
      await rename(oldJsPath, newCjsPath)
    } catch (error) {
      await initLogger.error('Failed to rename sub-store.bundle.js to sub-store.bundle.cjs', error)
    }
  }
}

// 迁移：添加 substore 到侧边栏
async function migrateSiderOrder(): Promise<void> {
  const { siderOrder = [], useSubStore = true } = await getAppConfig()
  if (useSubStore && !siderOrder.includes('substore')) {
    await patchAppConfig({ siderOrder: [...siderOrder, 'substore'] })
  }
}

// 迁移：修复 appTheme
async function migrateAppTheme(): Promise<void> {
  const { appTheme = 'system' } = await getAppConfig()
  if (!['system', 'light', 'dark'].includes(appTheme)) {
    await patchAppConfig({ appTheme: 'system' })
  }
}

// 迁移：envType 字符串转数组
async function migrateEnvType(): Promise<void> {
  const { envType } = await getAppConfig()
  if (typeof envType === 'string') {
    await patchAppConfig({ envType: [envType] })
  }
}

// 迁移：禁用托盘时必须显示悬浮窗
async function migrateTraySettings(): Promise<void> {
  const { showFloatingWindow = false, disableTray = false } = await getAppConfig()
  if (!showFloatingWindow && disableTray) {
    await patchAppConfig({ disableTray: false })
  }
}

// 迁移：移除加密密码
async function migrateRemovePassword(): Promise<void> {
  const { encryptedPassword } = await getAppConfig()
  if (encryptedPassword) {
    await patchAppConfig({ encryptedPassword: undefined })
  }
}

// 迁移：mihomo 配置默认值
async function migrateMihomoConfig(): Promise<void> {
  const config = await getControledMihomoConfig()
  const patches: Partial<IMihomoConfig> = {}

  // skip-auth-prefixes
  if (!config['skip-auth-prefixes']) {
    patches['skip-auth-prefixes'] = ['127.0.0.1/32', '::1/128']
  } else if (
    config['skip-auth-prefixes'].length >= 1 &&
    config['skip-auth-prefixes'][0] === '127.0.0.1/32' &&
    !config['skip-auth-prefixes'].includes('::1/128')
  ) {
    patches['skip-auth-prefixes'] = [
      '127.0.0.1/32',
      '::1/128',
      ...config['skip-auth-prefixes'].slice(1)
    ]
  }

  // 其他默认值
  if (!config.authentication) patches.authentication = []
  if (!config['bind-address']) patches['bind-address'] = '*'
  if (!config['lan-allowed-ips']) patches['lan-allowed-ips'] = ['0.0.0.0/0', '::/0']
  if (!config['lan-disallowed-ips']) patches['lan-disallowed-ips'] = []

  // tun device
  if (!config.tun?.device || (process.platform === 'darwin' && config.tun.device === 'Mihomo')) {
    patches.tun = {
      ...config.tun,
      device: process.platform === 'darwin' ? 'utun1500' : 'Mihomo'
    }
  }

  // 移除废弃配置
  if (config['external-controller-unix']) patches['external-controller-unix'] = undefined
  if (config['external-controller-pipe']) patches['external-controller-pipe'] = undefined
  if (config['external-controller'] === undefined) patches['external-controller'] = ''

  if (Object.keys(patches).length > 0) {
    await patchControledMihomoConfig(patches)
  }
}

async function migration(): Promise<void> {
  await Promise.all([
    migrateSiderOrder(),
    migrateAppTheme(),
    migrateEnvType(),
    migrateTraySettings(),
    migrateRemovePassword(),
    migrateMihomoConfig()
  ])
}

function initDeeplink(): void {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('clash', process.execPath, [path.resolve(process.argv[1])])
      app.setAsDefaultProtocolClient('mihomo', process.execPath, [path.resolve(process.argv[1])])
    }
  } else {
    app.setAsDefaultProtocolClient('clash')
    app.setAsDefaultProtocolClient('mihomo')
  }
}

export async function initBasic(): Promise<void> {
  if (isInitBasicCompleted) return

  await initDirs()
  await initConfig()
  await migration()
  await migrateSubStoreFiles()
  await initFiles()
  await cleanup()

  isInitBasicCompleted = true
}

export async function init(): Promise<void> {
  await startSubStoreFrontendServer()
  await startSubStoreBackendServer()

  const { sysProxy } = await getAppConfig()
  try {
    if (sysProxy.enable) {
      await startPacServer()
    }
    await triggerSysProxy(sysProxy.enable)
  } catch {
    // ignore
  }

  await startSSIDCheck()
  initDeeplink()
}
