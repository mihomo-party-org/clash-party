import { TitleBarOverlayOptions } from 'electron'

function checkIpcError<T>(response: unknown): T {
  if (response && typeof response === 'object' && 'invokeError' in response) {
    throw (response as { invokeError: unknown }).invokeError
  }
  return response as T
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const response = await window.electron.ipcRenderer.invoke(channel, ...args)
  return checkIpcError<T>(response)
}

// IPC API 类型定义
interface IpcApi {
  // Mihomo API
  mihomoVersion: () => Promise<IMihomoVersion>
  mihomoCloseConnection: (id: string) => Promise<void>
  mihomoCloseAllConnections: () => Promise<void>
  mihomoRules: () => Promise<IMihomoRulesInfo>
  mihomoProxies: () => Promise<IMihomoProxies>
  mihomoGroups: () => Promise<IMihomoMixedGroup[]>
  mihomoProxyProviders: () => Promise<IMihomoProxyProviders>
  mihomoUpdateProxyProviders: (name: string) => Promise<void>
  mihomoRuleProviders: () => Promise<IMihomoRuleProviders>
  mihomoUpdateRuleProviders: (name: string) => Promise<void>
  mihomoChangeProxy: (group: string, proxy: string) => Promise<IMihomoProxy>
  mihomoUnfixedProxy: (group: string) => Promise<IMihomoProxy>
  mihomoUpgradeGeo: () => Promise<void>
  mihomoUpgrade: () => Promise<void>
  mihomoUpgradeUI: () => Promise<void>
  mihomoUpgradeConfig: () => Promise<void>
  mihomoProxyDelay: (proxy: string, url?: string) => Promise<IMihomoDelay>
  mihomoGroupDelay: (group: string, url?: string) => Promise<IMihomoGroupDelay>
  patchMihomoConfig: (patch: Partial<IMihomoConfig>) => Promise<void>
  mihomoSmartGroupWeights: (groupName: string) => Promise<Record<string, number>>
  mihomoSmartFlushCache: (configName?: string) => Promise<void>
  getSmartOverrideContent: () => Promise<string | null>
  // AutoRun
  checkAutoRun: () => Promise<boolean>
  enableAutoRun: () => Promise<void>
  disableAutoRun: () => Promise<void>
  // Config
  getAppConfig: (force?: boolean) => Promise<IAppConfig>
  patchAppConfig: (patch: Partial<IAppConfig>) => Promise<void>
  getControledMihomoConfig: (force?: boolean) => Promise<Partial<IMihomoConfig>>
  patchControledMihomoConfig: (patch: Partial<IMihomoConfig>) => Promise<void>
  resetAppConfig: () => Promise<void>
  // Profile
  getProfileConfig: (force?: boolean) => Promise<IProfileConfig>
  setProfileConfig: (config: IProfileConfig) => Promise<void>
  getCurrentProfileItem: () => Promise<IProfileItem>
  getProfileItem: (id: string | undefined) => Promise<IProfileItem>
  getProfileStr: (id: string) => Promise<string>
  setProfileStr: (id: string, str: string) => Promise<void>
  addProfileItem: (item: Partial<IProfileItem>) => Promise<void>
  removeProfileItem: (id: string) => Promise<void>
  updateProfileItem: (item: IProfileItem) => Promise<void>
  changeCurrentProfile: (id: string) => Promise<void>
  addProfileUpdater: (item: IProfileItem) => Promise<void>
  removeProfileUpdater: (id: string) => Promise<void>
  // Override
  getOverrideConfig: (force?: boolean) => Promise<IOverrideConfig>
  setOverrideConfig: (config: IOverrideConfig) => Promise<void>
  getOverrideItem: (id: string) => Promise<IOverrideItem | undefined>
  addOverrideItem: (item: Partial<IOverrideItem>) => Promise<void>
  removeOverrideItem: (id: string) => Promise<void>
  updateOverrideItem: (item: IOverrideItem) => Promise<void>
  getOverride: (id: string, ext: 'js' | 'yaml' | 'log') => Promise<string>
  setOverride: (id: string, ext: 'js' | 'yaml', str: string) => Promise<void>
  // File
  getFileStr: (path: string) => Promise<string>
  setFileStr: (path: string, str: string) => Promise<void>
  convertMrsRuleset: (path: string, behavior: string) => Promise<string>
  getRuntimeConfig: () => Promise<IMihomoConfig>
  getRuntimeConfigStr: () => Promise<string>
  getRuleStr: (id: string) => Promise<string>
  setRuleStr: (id: string, str: string) => Promise<void>
  getFilePath: (ext: string[]) => Promise<string[] | undefined>
  readTextFile: (filePath: string) => Promise<string>
  openFile: (type: 'profile' | 'override', id: string, ext?: 'yaml' | 'js') => Promise<void>
  // Core
  restartCore: () => Promise<void>
  startMonitor: () => Promise<void>
  quitWithoutCore: () => Promise<void>
  // System
  triggerSysProxy: (enable: boolean) => Promise<void>
  checkTunPermissions: () => Promise<boolean>
  grantTunPermissions: () => Promise<void>
  manualGrantCorePermition: () => Promise<void>
  checkAdminPrivileges: () => Promise<boolean>
  restartAsAdmin: () => Promise<void>
  checkMihomoCorePermissions: () => Promise<boolean>
  checkHighPrivilegeCore: () => Promise<boolean>
  showTunPermissionDialog: () => Promise<boolean>
  showErrorDialog: (title: string, message: string) => Promise<void>
  openUWPTool: () => Promise<void>
  setupFirewall: () => Promise<void>
  getInterfaces: () => Promise<Record<string, NetworkInterfaceInfo[]>>
  setNativeTheme: (theme: 'system' | 'light' | 'dark') => Promise<void>
  copyEnv: (type: 'bash' | 'cmd' | 'powershell') => Promise<void>
  // Update
  checkUpdate: () => Promise<IAppVersion | undefined>
  downloadAndInstallUpdate: (version: string) => Promise<void>
  getVersion: () => Promise<string>
  platform: () => Promise<NodeJS.Platform>
  fetchMihomoTags: (
    forceRefresh?: boolean
  ) => Promise<{ name: string; zipball_url: string; tarball_url: string }[]>
  installSpecificMihomoCore: (version: string) => Promise<void>
  clearMihomoVersionCache: () => Promise<void>
  // Backup
  webdavBackup: () => Promise<boolean>
  webdavRestore: (filename: string) => Promise<void>
  listWebdavBackups: () => Promise<string[]>
  webdavDelete: (filename: string) => Promise<void>
  reinitWebdavBackupScheduler: () => Promise<void>
  exportLocalBackup: () => Promise<boolean>
  importLocalBackup: () => Promise<boolean>
  // SubStore
  startSubStoreFrontendServer: () => Promise<void>
  stopSubStoreFrontendServer: () => Promise<void>
  startSubStoreBackendServer: () => Promise<void>
  stopSubStoreBackendServer: () => Promise<void>
  downloadSubStore: () => Promise<void>
  subStorePort: () => Promise<number>
  subStoreFrontendPort: () => Promise<number>
  subStoreSubs: () => Promise<ISubStoreSub[]>
  subStoreCollections: () => Promise<ISubStoreSub[]>
  // Theme
  resolveThemes: () => Promise<{ key: string; label: string; content: string }[]>
  fetchThemes: () => Promise<void>
  importThemes: (files: string[]) => Promise<void>
  readTheme: (theme: string) => Promise<string>
  writeTheme: (theme: string, css: string) => Promise<void>
  // Tray
  showTrayIcon: () => Promise<void>
  closeTrayIcon: () => Promise<void>
  updateTrayIcon: () => Promise<void>
  // Window
  showMainWindow: () => Promise<void>
  closeMainWindow: () => Promise<void>
  triggerMainWindow: () => Promise<void>
  showFloatingWindow: () => Promise<void>
  closeFloatingWindow: () => Promise<void>
  showContextMenu: () => Promise<void>
  setAlwaysOnTop: (alwaysOnTop: boolean) => Promise<void>
  isAlwaysOnTop: () => Promise<boolean>
  openDevTools: () => Promise<void>
  createHeapSnapshot: () => Promise<void>
  // Shortcut
  registerShortcut: (oldShortcut: string, newShortcut: string, action: string) => Promise<boolean>
  // Misc
  getGistUrl: () => Promise<string>
  getImageDataURL: (url: string) => Promise<string>
  relaunchApp: () => Promise<void>
  quitApp: () => Promise<void>
}

// 使用 Proxy 自动生成 IPC 调用
const ipc = new Proxy({} as IpcApi, {
  get:
    <K extends keyof IpcApi>(_: IpcApi, channel: K) =>
    (...args: Parameters<IpcApi[K]>) =>
      invoke(channel, ...args)
})

// 导出所有 IPC 方法
export const {
  // Mihomo API
  mihomoVersion,
  mihomoCloseConnection,
  mihomoCloseAllConnections,
  mihomoRules,
  mihomoProxies,
  mihomoGroups,
  mihomoProxyProviders,
  mihomoUpdateProxyProviders,
  mihomoRuleProviders,
  mihomoUpdateRuleProviders,
  mihomoChangeProxy,
  mihomoUnfixedProxy,
  mihomoUpgradeGeo,
  mihomoUpgrade,
  mihomoUpgradeUI,
  mihomoUpgradeConfig,
  mihomoProxyDelay,
  mihomoGroupDelay,
  patchMihomoConfig,
  mihomoSmartGroupWeights,
  mihomoSmartFlushCache,
  getSmartOverrideContent,
  // AutoRun
  checkAutoRun,
  enableAutoRun,
  disableAutoRun,
  // Config
  getAppConfig,
  patchAppConfig,
  getControledMihomoConfig,
  patchControledMihomoConfig,
  resetAppConfig,
  // Profile
  getProfileConfig,
  setProfileConfig,
  getCurrentProfileItem,
  getProfileItem,
  getProfileStr,
  setProfileStr,
  addProfileItem,
  removeProfileItem,
  updateProfileItem,
  changeCurrentProfile,
  addProfileUpdater,
  removeProfileUpdater,
  // Override
  getOverrideConfig,
  setOverrideConfig,
  getOverrideItem,
  addOverrideItem,
  removeOverrideItem,
  updateOverrideItem,
  getOverride,
  setOverride,
  // File
  getFileStr,
  setFileStr,
  convertMrsRuleset,
  getRuntimeConfig,
  getRuntimeConfigStr,
  getRuleStr,
  setRuleStr,
  getFilePath,
  readTextFile,
  openFile,
  // Core
  restartCore,
  startMonitor,
  quitWithoutCore,
  // System
  triggerSysProxy,
  checkTunPermissions,
  grantTunPermissions,
  manualGrantCorePermition,
  checkAdminPrivileges,
  restartAsAdmin,
  checkMihomoCorePermissions,
  checkHighPrivilegeCore,
  showTunPermissionDialog,
  showErrorDialog,
  openUWPTool,
  setupFirewall,
  getInterfaces,
  setNativeTheme,
  copyEnv,
  // Update
  checkUpdate,
  downloadAndInstallUpdate,
  getVersion,
  fetchMihomoTags,
  installSpecificMihomoCore,
  clearMihomoVersionCache,
  // Backup
  webdavBackup,
  webdavRestore,
  listWebdavBackups,
  webdavDelete,
  reinitWebdavBackupScheduler,
  exportLocalBackup,
  importLocalBackup,
  // SubStore
  startSubStoreFrontendServer,
  stopSubStoreFrontendServer,
  startSubStoreBackendServer,
  stopSubStoreBackendServer,
  downloadSubStore,
  subStorePort,
  subStoreFrontendPort,
  subStoreSubs,
  subStoreCollections,
  // Theme
  resolveThemes,
  fetchThemes,
  importThemes,
  readTheme,
  writeTheme,
  // Tray
  showTrayIcon,
  closeTrayIcon,
  updateTrayIcon,
  // Window
  showMainWindow,
  closeMainWindow,
  triggerMainWindow,
  showFloatingWindow,
  closeFloatingWindow,
  showContextMenu,
  setAlwaysOnTop,
  isAlwaysOnTop,
  openDevTools,
  createHeapSnapshot,
  // Shortcut
  registerShortcut,
  // Misc
  getGistUrl,
  getImageDataURL,
  relaunchApp,
  quitApp
} = ipc

// platform 需要重命名导出
export const getPlatform = ipc.platform

// 需要特殊处理的函数

// applyTheme: 防抖处理，避免频繁调用
let applyThemeRunning = false
let pendingTheme: string | null = null

export async function applyTheme(theme: string): Promise<void> {
  if (applyThemeRunning) {
    pendingTheme = theme
    return
  }
  applyThemeRunning = true
  try {
    await invoke<void>('applyTheme', theme)
  } finally {
    applyThemeRunning = false
    if (pendingTheme !== null) {
      const nextTheme = pendingTheme
      pendingTheme = null
      await applyTheme(nextTheme)
    }
  }
}

// setTitleBarOverlay: 需要静默处理不支持的平台
export async function setTitleBarOverlay(overlay: TitleBarOverlayOptions): Promise<void> {
  try {
    await invoke<void>('setTitleBarOverlay', overlay)
  } catch {
    // Not supported on this platform
  }
}

// updateTrayIconImmediate: 同步调用，不等待结果
export function updateTrayIconImmediate(sysProxyEnabled: boolean, tunEnabled: boolean): void {
  window.electron.ipcRenderer.invoke('updateTrayIconImmediate', sysProxyEnabled, tunEnabled)
}

// getAppName: 获取应用程序名称
export async function getAppName(appPath: string): Promise<string> {
  return invoke<string>('getAppName', appPath)
}

// getIconDataURL: 获取应用图标的Base64数据
export async function getIconDataURL(appPath: string): Promise<string> {
  return invoke<string>('getIconDataURL', appPath)
}
