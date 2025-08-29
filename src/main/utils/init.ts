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
  subStoreDir,
  themesDir
} from './dirs'
import {
  defaultConfig,
  defaultControledMihomoConfig,
  defaultOverrideConfig,
  defaultProfile,
  defaultProfileConfig
} from './template'
import yaml from 'yaml'
import { mkdir, writeFile, rm, readdir, cp, stat, rename } from 'fs/promises'
import { existsSync } from 'fs'
import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
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
import { app, dialog } from 'electron'
import { startSSIDCheck } from '../sys/ssid'
import i18next from '../../shared/i18n'
import { initLogger } from './logger'

// 安全错误处理
export function safeShowErrorBox(titleKey: string, message: string): void {
  let title: string
  try {
    title = i18next.t(titleKey)
    if (!title || title === titleKey) throw new Error('Translation not ready')
  } catch {
    const isZh = process.env.LANG?.startsWith('zh') || process.env.LC_ALL?.startsWith('zh')
    const fallbacks: Record<string, { zh: string; en: string }> = {
      'mihomo.error.coreStartFailed': { zh: '内核启动出错', en: 'Core start failed' }
    }
    title = fallbacks[titleKey] ? (isZh ? fallbacks[titleKey].zh : fallbacks[titleKey].en) : (isZh ? '错误' : 'Error')
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

  // 比较修改geodata文件修改时间
async function isSourceNewer(sourcePath: string, targetPath: string): Promise<boolean> {
  try {
    const sourceStats = await stat(sourcePath)
    const targetStats = await stat(targetPath)

    return sourceStats.mtime > targetStats.mtime
  } catch {
    return true
  }
}

async function initDirs(): Promise<void> {
  await fixDataDirPermissions()

  // 按依赖顺序创建目录
  const dirsToCreate = [
    dataDir(),
    themesDir(),
    profilesDir(),
    overrideDir(),
    mihomoWorkDir(),
    logDir(),
    mihomoTestDir(),
    subStoreDir()
  ]

  for (const dir of dirsToCreate) {
    try {
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true })
      }
    } catch (error) {
      await initLogger.error(`Failed to create directory ${dir}`, error)
      throw new Error(`Failed to create directory ${dir}: ${error}`)
    }
  }
}

async function initConfig(): Promise<void> {
  const configs = [
    { path: appConfigPath(), content: defaultConfig, name: 'app config' },
    { path: profileConfigPath(), content: defaultProfileConfig, name: 'profile config' },
    { path: overrideConfigPath(), content: defaultOverrideConfig, name: 'override config' },
    { path: profilePath('default'), content: defaultProfile, name: 'default profile' },
    { path: controledMihomoConfigPath(), content: defaultControledMihomoConfig, name: 'mihomo config' }
  ]

  for (const config of configs) {
    try {
      if (!existsSync(config.path)) {
        await writeFile(config.path, yaml.stringify(config.content))
      }
    } catch (error) {
      await initLogger.error(`Failed to create ${config.name} at ${config.path}`, error)
      throw new Error(`Failed to create ${config.name}: ${error}`)
    }
  }
}

async function initFiles(): Promise<void> {
  const copy = async (file: string): Promise<void> => {
    const targetPath = path.join(mihomoWorkDir(), file)
    const testTargetPath = path.join(mihomoTestDir(), file)
    const sourcePath = path.join(resourcesFilesDir(), file)

    try {
      // 检查是否需要复制
      if (existsSync(sourcePath)) {
        const shouldCopyToWork = !existsSync(targetPath) || await isSourceNewer(sourcePath, targetPath)
        if (shouldCopyToWork) {
          await cp(sourcePath, targetPath, { recursive: true })
        }
      }
      if (existsSync(sourcePath)) {
        const shouldCopyToTest = !existsSync(testTargetPath) || await isSourceNewer(sourcePath, testTargetPath)
        if (shouldCopyToTest) {
          await cp(sourcePath, testTargetPath, { recursive: true })
        }
      }
    } catch (error) {
      await initLogger.error(`Failed to copy ${file}`, error)
      if (['country.mmdb', 'geoip.dat', 'geosite.dat'].includes(file)) {
        throw new Error(`Failed to copy critical file ${file}: ${error}`)
      }
    }
  }

  // 确保工作目录存在
  if (!existsSync(mihomoWorkDir())) {
    await mkdir(mihomoWorkDir(), { recursive: true })
  }
  if (!existsSync(mihomoTestDir())) {
    await mkdir(mihomoTestDir(), { recursive: true })
  }

  await Promise.all([
    copy('country.mmdb'),
    copy('geoip.metadb'),
    copy('geoip.dat'),
    copy('geosite.dat'),
    copy('ASN.mmdb'),
    copy('sub-store.bundle.cjs'),
    copy('sub-store-frontend')
  ])
}

async function cleanup(): Promise<void> {
  // update cache
  const files = await readdir(dataDir())
  for (const file of files) {
    if (file.endsWith('.exe') || file.endsWith('.pkg') || file.endsWith('.7z')) {
      try {
        await rm(path.join(dataDir(), file))
      } catch {
        // ignore
      }
    }
  }
  // logs
  const { maxLogDays = 7 } = await getAppConfig()
  const logs = await readdir(logDir())
  for (const log of logs) {
    const date = new Date(log.split('.')[0])
    const diff = Date.now() - date.getTime()
    if (diff > maxLogDays * 24 * 60 * 60 * 1000) {
      try {
        await rm(path.join(logDir(), log))
      } catch {
        // ignore
      }
    }
  }
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

async function migration(): Promise<void> {
  const {
    siderOrder = [
      'sysproxy',
      'tun',
      'profile',
      'proxy',
      'rule',
      'resource',
      'override',
      'connection',
      'mihomo',
      'dns',
      'sniff',
      'log',
      'substore'
    ],
    appTheme = 'system',
    envType = [process.platform === 'win32' ? 'powershell' : 'bash'],
    useSubStore = true,
    showFloatingWindow = false,
    disableTray = false,
    encryptedPassword
  } = await getAppConfig()
  const {
    'external-controller-pipe': externalControllerPipe,
    'external-controller-unix': externalControllerUnix,
    'external-controller': externalController,
    'skip-auth-prefixes': skipAuthPrefixes,
    authentication,
    'bind-address': bindAddress,
    'lan-allowed-ips': lanAllowedIps,
    'lan-disallowed-ips': lanDisallowedIps,
    tun
  } = await getControledMihomoConfig()
  // add substore sider card
  if (useSubStore && !siderOrder.includes('substore')) {
    await patchAppConfig({ siderOrder: [...siderOrder, 'substore'] })
  }
  // add default skip auth prefix
  if (!skipAuthPrefixes) {
    await patchControledMihomoConfig({ 'skip-auth-prefixes': ['127.0.0.1/32', '::1/128'] })
  } else if (skipAuthPrefixes.length >= 1 && skipAuthPrefixes[0] === '127.0.0.1/32') {
    const filteredPrefixes = skipAuthPrefixes.filter(ip => ip !== '::1/128')
    const newPrefixes = [filteredPrefixes[0], '::1/128', ...filteredPrefixes.slice(1)]
    if (JSON.stringify(newPrefixes) !== JSON.stringify(skipAuthPrefixes)) {
      await patchControledMihomoConfig({ 'skip-auth-prefixes': newPrefixes })
    }
  }
  // add default authentication
  if (!authentication) {
    await patchControledMihomoConfig({ authentication: [] })
  }
  // add default bind address
  if (!bindAddress) {
    await patchControledMihomoConfig({ 'bind-address': '*' })
  }
  // add default lan allowed ips
  if (!lanAllowedIps) {
    await patchControledMihomoConfig({ 'lan-allowed-ips': ['0.0.0.0/0', '::/0'] })
  }
  // add default lan disallowed ips
  if (!lanDisallowedIps) {
    await patchControledMihomoConfig({ 'lan-disallowed-ips': [] })
  }
  // default tun device
  if (!tun?.device || (process.platform === 'darwin' && tun.device === 'Mihomo')) {
    const defaultDevice = process.platform === 'darwin' ? 'utun1500' : 'Mihomo'
    await patchControledMihomoConfig({
      tun: {
        ...tun,
        device: defaultDevice
      }
    })
  }
  // remove custom app theme
  if (!['system', 'light', 'dark'].includes(appTheme)) {
    await patchAppConfig({ appTheme: 'system' })
  }
  // change env type
  if (typeof envType === 'string') {
    await patchAppConfig({ envType: [envType] })
  }
  // use unix socket
  if (externalControllerUnix) {
    await patchControledMihomoConfig({ 'external-controller-unix': undefined })
  }
  // use named pipe
  if (externalControllerPipe) {
    await patchControledMihomoConfig({
      'external-controller-pipe': undefined
    })
  }
  if (externalController === undefined) {
    await patchControledMihomoConfig({ 'external-controller': '' })
  }
  if (!showFloatingWindow && disableTray) {
    await patchAppConfig({ disableTray: false })
  }
  // remove password
  if (encryptedPassword) {
    await patchAppConfig({ encryptedPassword: undefined })
  }
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

// 基础初始化
export async function initBasic(): Promise<void> {
  await initDirs()
  await initConfig()
  await migration()
  await migrateSubStoreFiles()
  await initFiles()
  await cleanup()
}

export async function init(): Promise<void> {
  await initBasic()
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
