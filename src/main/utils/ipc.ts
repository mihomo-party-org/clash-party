import path from 'path'
import v8 from 'v8'
import { readFile, writeFile } from 'fs/promises'
import { app, ipcMain } from 'electron'
import i18next from 'i18next'
import {
  mihomoChangeProxy,
  mihomoCloseAllConnections,
  mihomoCloseConnection,
  mihomoGroupDelay,
  mihomoGroups,
  mihomoProxies,
  mihomoProxyDelay,
  mihomoProxyProviders,
  mihomoRuleProviders,
  mihomoRules,
  mihomoUnfixedProxy,
  mihomoUpdateProxyProviders,
  mihomoUpdateRuleProviders,
  mihomoUpgrade,
  mihomoUpgradeGeo,
  mihomoUpgradeUI,
  mihomoUpgradeConfig,
  mihomoVersion,
  patchMihomoConfig,
  mihomoSmartGroupWeights,
  mihomoSmartFlushCache
} from '../core/mihomoApi'
import { checkAutoRun, disableAutoRun, enableAutoRun } from '../sys/autoRun'
import {
  getAppConfig,
  patchAppConfig,
  getControledMihomoConfig,
  patchControledMihomoConfig,
  getProfileConfig,
  getCurrentProfileItem,
  getProfileItem,
  addProfileItem,
  removeProfileItem,
  changeCurrentProfile,
  getProfileStr,
  getFileStr,
  setFileStr,
  setProfileStr,
  updateProfileItem,
  setProfileConfig,
  getOverrideConfig,
  setOverrideConfig,
  getOverrideItem,
  addOverrideItem,
  removeOverrideItem,
  getOverride,
  setOverride,
  updateOverrideItem,
  convertMrsRuleset
} from '../config'
import {
  startSubStoreFrontendServer,
  startSubStoreBackendServer,
  stopSubStoreFrontendServer,
  stopSubStoreBackendServer,
  downloadSubStore,
  subStoreFrontendPort,
  subStorePort
} from '../resolve/server'
import {
  quitWithoutCore,
  restartCore,
  checkTunPermissions,
  grantTunPermissions,
  manualGrantCorePermition,
  checkAdminPrivileges,
  restartAsAdmin,
  checkMihomoCorePermissions,
  requestTunPermissions,
  checkHighPrivilegeCore,
  showTunPermissionDialog,
  showErrorDialog
} from '../core/manager'
import { triggerSysProxy } from '../sys/sysproxy'
import { checkUpdate, downloadAndInstallUpdate } from '../resolve/autoUpdater'
import {
  getFilePath,
  openFile,
  openUWPTool,
  readTextFile,
  resetAppConfig,
  setNativeTheme,
  setupFirewall
} from '../sys/misc'
import { getRuntimeConfig, getRuntimeConfigStr } from '../core/factory'
import {
  listWebdavBackups,
  webdavBackup,
  webdavDelete,
  webdavRestore,
  exportLocalBackup,
  importLocalBackup,
  reinitScheduler
} from '../resolve/backup'
import { getInterfaces } from '../sys/interface'
import {
  closeTrayIcon,
  copyEnv,
  showTrayIcon,
  updateTrayIcon,
  updateTrayIconImmediate
} from '../resolve/tray'
import { registerShortcut } from '../resolve/shortcut'
import { closeMainWindow, mainWindow, showMainWindow, triggerMainWindow } from '../window'
import {
  applyTheme,
  fetchThemes,
  importThemes,
  readTheme,
  resolveThemes,
  writeTheme
} from '../resolve/theme'
import { subStoreCollections, subStoreSubs } from '../core/subStoreApi'
import { getGistUrl } from '../resolve/gistApi'
import { startMonitor } from '../resolve/trafficMonitor'
import { closeFloatingWindow, showContextMenu, showFloatingWindow } from '../resolve/floatingWindow'
import { addProfileUpdater, removeProfileUpdater } from '../core/profileUpdater'
import { getImageDataURL } from './image'
import { getIconDataURL } from './icon'
import { getAppName } from './appName'
import { logDir, rulePath } from './dirs'
import { installMihomoCore, getGitHubTags, clearVersionCache } from './github'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AsyncFn = (...args: any[]) => Promise<any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SyncFn = (...args: any[]) => any

function wrapAsync<T extends AsyncFn>(
  fn: T
): (...args: Parameters<T>) => Promise<ReturnType<T> | { invokeError: unknown }> {
  return async (...args) => {
    try {
      return await fn(...args)
    } catch (e) {
      if (e && typeof e === 'object' && 'message' in e) {
        return { invokeError: e.message }
      }
      return { invokeError: typeof e === 'string' ? e : 'Unknown Error' }
    }
  }
}

function registerHandlers(handlers: Record<string, AsyncFn | SyncFn>, async = true): void {
  for (const [channel, handler] of Object.entries(handlers)) {
    if (async) {
      ipcMain.handle(channel, (_e, ...args) => wrapAsync(handler as AsyncFn)(...args))
    } else {
      ipcMain.handle(channel, (_e, ...args) => (handler as SyncFn)(...args))
    }
  }
}

async function fetchMihomoTags(
  forceRefresh = false
): Promise<{ name: string; zipball_url: string; tarball_url: string }[]> {
  return await getGitHubTags('MetaCubeX', 'mihomo', forceRefresh)
}

async function installSpecificMihomoCore(version: string): Promise<void> {
  clearVersionCache('MetaCubeX', 'mihomo')
  return await installMihomoCore(version)
}

async function clearMihomoVersionCache(): Promise<void> {
  clearVersionCache('MetaCubeX', 'mihomo')
}

async function getRuleStr(id: string): Promise<string> {
  return await readFile(rulePath(id), 'utf-8')
}

async function setRuleStr(id: string, str: string): Promise<void> {
  await writeFile(rulePath(id), str, 'utf-8')
}

async function getSmartOverrideContent(): Promise<string | null> {
  try {
    const override = await getOverrideItem('smart-core-override')
    return override?.file || null
  } catch {
    return null
  }
}

async function changeLanguage(lng: string): Promise<void> {
  await i18next.changeLanguage(lng)
  ipcMain.emit('updateTrayMenu')
}

async function setTitleBarOverlay(overlay: Electron.TitleBarOverlayOptions): Promise<void> {
  if (mainWindow && typeof mainWindow.setTitleBarOverlay === 'function') {
    mainWindow.setTitleBarOverlay(overlay)
  }
}

const asyncHandlers: Record<string, AsyncFn> = {
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
  // AutoRun
  checkAutoRun,
  enableAutoRun,
  disableAutoRun,
  // Config
  getAppConfig,
  patchAppConfig,
  getControledMihomoConfig,
  patchControledMihomoConfig,
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
  getSmartOverrideContent,
  getRuleStr,
  setRuleStr,
  readTextFile,
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
  requestTunPermissions,
  checkHighPrivilegeCore,
  showTunPermissionDialog,
  showErrorDialog,
  openUWPTool,
  setupFirewall,
  copyEnv,
  // Update
  checkUpdate,
  downloadAndInstallUpdate,
  fetchMihomoTags,
  installSpecificMihomoCore,
  clearMihomoVersionCache,
  // Backup
  webdavBackup,
  webdavRestore,
  listWebdavBackups,
  webdavDelete,
  reinitWebdavBackupScheduler: reinitScheduler,
  exportLocalBackup,
  importLocalBackup,
  // SubStore
  startSubStoreFrontendServer,
  stopSubStoreFrontendServer,
  startSubStoreBackendServer,
  stopSubStoreBackendServer,
  downloadSubStore,
  subStoreSubs,
  subStoreCollections,
  // Theme
  resolveThemes,
  fetchThemes,
  importThemes,
  readTheme,
  writeTheme,
  applyTheme,
  // Tray
  showTrayIcon,
  closeTrayIcon,
  updateTrayIcon,
  // Floating Window
  showFloatingWindow,
  closeFloatingWindow,
  showContextMenu,
  // Misc
  getGistUrl,
  getImageDataURL,
  getIconDataURL,
  getAppName,
  changeLanguage,
  setTitleBarOverlay,
  registerShortcut
}

const syncHandlers: Record<string, SyncFn> = {
  resetAppConfig,
  getFilePath,
  openFile,
  getInterfaces,
  setNativeTheme,
  getVersion: () => app.getVersion(),
  platform: () => process.platform,
  subStorePort: () => subStorePort,
  subStoreFrontendPort: () => subStoreFrontendPort,
  updateTrayIconImmediate,
  showMainWindow,
  closeMainWindow,
  triggerMainWindow,
  setAlwaysOnTop: (alwaysOnTop: boolean) => mainWindow?.setAlwaysOnTop(alwaysOnTop),
  isAlwaysOnTop: () => mainWindow?.isAlwaysOnTop(),
  openDevTools: () => mainWindow?.webContents.openDevTools(),
  createHeapSnapshot: () => v8.writeHeapSnapshot(path.join(logDir(), `${Date.now()}.heapsnapshot`)),
  relaunchApp: () => {
    app.relaunch()
    app.quit()
  },
  quitApp: () => app.quit()
}

export function registerIpcMainHandlers(): void {
  registerHandlers(asyncHandlers, true)
  registerHandlers(syncHandlers, false)
}
