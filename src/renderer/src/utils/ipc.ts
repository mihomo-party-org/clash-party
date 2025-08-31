import { TitleBarOverlayOptions } from 'electron'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ipcErrorWrapper(response: any): any {
  if (typeof response === 'object' && 'invokeError' in response) {
    throw response.invokeError
  } else {
    return response
  }
}

export async function mihomoVersion(): Promise<IMihomoVersion> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('mihomoVersion'))
}

export async function mihomoCloseConnection(id: string): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('mihomoCloseConnection', id))
}

export async function mihomoCloseAllConnections(): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('mihomoCloseAllConnections'))
}

export async function mihomoRules(): Promise<IMihomoRulesInfo> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('mihomoRules'))
}

export async function mihomoProxies(): Promise<IMihomoProxies> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('mihomoProxies'))
}

export async function mihomoGroups(): Promise<IMihomoMixedGroup[]> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('mihomoGroups'))
}

export async function mihomoProxyProviders(): Promise<IMihomoProxyProviders> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('mihomoProxyProviders'))
}

export async function mihomoUpdateProxyProviders(name: string): Promise<void> {
  return ipcErrorWrapper(
    await window.electron.ipcRenderer.invoke('mihomoUpdateProxyProviders', name)
  )
}

export async function mihomoRuleProviders(): Promise<IMihomoRuleProviders> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('mihomoRuleProviders'))
}

export async function mihomoUpdateRuleProviders(name: string): Promise<void> {
  return ipcErrorWrapper(
    await window.electron.ipcRenderer.invoke('mihomoUpdateRuleProviders', name)
  )
}

export async function mihomoChangeProxy(group: string, proxy: string): Promise<IMihomoProxy> {
  return ipcErrorWrapper(
    await window.electron.ipcRenderer.invoke('mihomoChangeProxy', group, proxy)
  )
}

export async function mihomoUnfixedProxy(group: string): Promise<IMihomoProxy> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('mihomoUnfixedProxy', group))
}

export async function mihomoUpgradeGeo(): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('mihomoUpgradeGeo'))
}

export async function mihomoUpgrade(): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('mihomoUpgrade'))
}

export async function mihomoProxyDelay(proxy: string, url?: string): Promise<IMihomoDelay> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('mihomoProxyDelay', proxy, url))
}

export async function mihomoGroupDelay(group: string, url?: string): Promise<IMihomoGroupDelay> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('mihomoGroupDelay', group, url))
}

export async function mihomoSmartGroupWeights(groupName: string): Promise<Record<string, number>> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('mihomoSmartGroupWeights', groupName))
}

export async function mihomoSmartFlushCache(configName?: string): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('mihomoSmartFlushCache', configName))
}

export async function showDetailedError(title: string, message: string): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('showDetailedError', title, message))
}

export async function getSmartOverrideContent(): Promise<string | null> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('getSmartOverrideContent'))
}

export async function patchMihomoConfig(patch: Partial<IMihomoConfig>): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('patchMihomoConfig', patch))
}

export async function checkAutoRun(): Promise<boolean> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('checkAutoRun'))
}

export async function enableAutoRun(): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('enableAutoRun'))
}

export async function disableAutoRun(): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('disableAutoRun'))
}

export async function getAppConfig(force = false): Promise<IAppConfig> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('getAppConfig', force))
}

export async function patchAppConfig(patch: Partial<IAppConfig>): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('patchAppConfig', patch))
}

export async function getControledMihomoConfig(force = false): Promise<Partial<IMihomoConfig>> {
  return ipcErrorWrapper(
    await window.electron.ipcRenderer.invoke('getControledMihomoConfig', force)
  )
}

export async function patchControledMihomoConfig(patch: Partial<IMihomoConfig>): Promise<void> {
  return ipcErrorWrapper(
    await window.electron.ipcRenderer.invoke('patchControledMihomoConfig', patch)
  )
}

export async function getProfileConfig(force = false): Promise<IProfileConfig> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('getProfileConfig', force))
}

export async function setProfileConfig(config: IProfileConfig): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('setProfileConfig', config))
}

export async function getCurrentProfileItem(): Promise<IProfileItem> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('getCurrentProfileItem'))
}

export async function getProfileItem(id: string | undefined): Promise<IProfileItem> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('getProfileItem', id))
}

export async function changeCurrentProfile(id: string): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('changeCurrentProfile', id))
}

export async function addProfileItem(item: Partial<IProfileItem>): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('addProfileItem', item))
}

export async function removeProfileItem(id: string): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('removeProfileItem', id))
}

export async function updateProfileItem(item: IProfileItem): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('updateProfileItem', item))
}

export async function addProfileUpdater(item: IProfileItem): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('addProfileUpdater', item))
}

export async function removeProfileUpdater(id: string): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('removeProfileUpdater', id))
}

export async function getProfileStr(id: string): Promise<string> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('getProfileStr', id))
}

export async function getFileStr(id: string): Promise<string> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('getFileStr', id))
}

export async function setFileStr(id: string, str: string): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('setFileStr', id, str))
}

export async function setProfileStr(id: string, str: string): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('setProfileStr', id, str))
}

export async function getOverrideConfig(force = false): Promise<IOverrideConfig> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('getOverrideConfig', force))
}

export async function setOverrideConfig(config: IOverrideConfig): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('setOverrideConfig', config))
}

export async function getOverrideItem(id: string): Promise<IOverrideItem | undefined> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('getOverrideItem', id))
}

export async function addOverrideItem(item: Partial<IOverrideItem>): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('addOverrideItem', item))
}

export async function removeOverrideItem(id: string): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('removeOverrideItem', id))
}

export async function updateOverrideItem(item: IOverrideItem): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('updateOverrideItem', item))
}

export async function getOverride(id: string, ext: 'js' | 'yaml' | 'log'): Promise<string> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('getOverride', id, ext))
}

export async function setOverride(id: string, ext: 'js' | 'yaml', str: string): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('setOverride', id, ext, str))
}

export async function restartCore(): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('restartCore'))
}

export async function startMonitor(): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('startMonitor'))
}

export async function triggerSysProxy(enable: boolean): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('triggerSysProxy', enable))
}



export async function checkTunPermissions(): Promise<boolean> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('checkTunPermissions'))
}

export async function grantTunPermissions(): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('grantTunPermissions'))
}

export async function manualGrantCorePermition(): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('manualGrantCorePermition'))
}

export async function checkHighPrivilegeCore(): Promise<boolean> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('checkHighPrivilegeCore'))
}

export async function checkAdminPrivileges(): Promise<boolean> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('checkAdminPrivileges'))
}

export async function restartAsAdmin(): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('restartAsAdmin'))
}

export async function showTunPermissionDialog(): Promise<boolean> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('showTunPermissionDialog'))
}

export async function showErrorDialog(title: string, message: string): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('showErrorDialog', title, message))
}

export async function getFilePath(ext: string[]): Promise<string[] | undefined> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('getFilePath', ext))
}

export async function readTextFile(filePath: string): Promise<string> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('readTextFile', filePath))
}

export async function getRuntimeConfigStr(): Promise<string> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('getRuntimeConfigStr'))
}

export async function getRuntimeConfig(): Promise<IMihomoConfig> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('getRuntimeConfig'))
}

export async function checkUpdate(): Promise<IAppVersion | undefined> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('checkUpdate'))
}

export async function downloadAndInstallUpdate(version: string): Promise<void> {
  return ipcErrorWrapper(
    await window.electron.ipcRenderer.invoke('downloadAndInstallUpdate', version)
  )
}

export async function getVersion(): Promise<string> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('getVersion'))
}

export async function getPlatform(): Promise<NodeJS.Platform> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('platform'))
}

export async function openUWPTool(): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('openUWPTool'))
}

export async function setupFirewall(): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('setupFirewall'))
}

export async function getInterfaces(): Promise<Record<string, NetworkInterfaceInfo[]>> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('getInterfaces'))
}

export async function webdavBackup(): Promise<boolean> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('webdavBackup'))
}

export async function webdavRestore(filename: string): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('webdavRestore', filename))
}

export async function listWebdavBackups(): Promise<string[]> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('listWebdavBackups'))
}

export async function webdavDelete(filename: string): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('webdavDelete', filename))
}

export async function setTitleBarOverlay(overlay: TitleBarOverlayOptions): Promise<void> {
  try {
    return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('setTitleBarOverlay', overlay))
  } catch (error) {
    console.debug('setTitleBarOverlay not supported on this platform')
  }
}

export async function setAlwaysOnTop(alwaysOnTop: boolean): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('setAlwaysOnTop', alwaysOnTop))
}

export async function isAlwaysOnTop(): Promise<boolean> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('isAlwaysOnTop'))
}

export async function relaunchApp(): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('relaunchApp'))
}

export async function quitWithoutCore(): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('quitWithoutCore'))
}

export async function quitApp(): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('quitApp'))
}

export async function setNativeTheme(theme: 'system' | 'light' | 'dark'): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('setNativeTheme', theme))
}

export async function getGistUrl(): Promise<string> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('getGistUrl'))
}

export async function startSubStoreFrontendServer(): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('startSubStoreFrontendServer'))
}

export async function stopSubStoreFrontendServer(): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('stopSubStoreFrontendServer'))
}

export async function startSubStoreBackendServer(): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('startSubStoreBackendServer'))
}

export async function stopSubStoreBackendServer(): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('stopSubStoreBackendServer'))
}
export async function downloadSubStore(): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('downloadSubStore'))
}

export async function subStorePort(): Promise<number> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('subStorePort'))
}

export async function subStoreFrontendPort(): Promise<number> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('subStoreFrontendPort'))
}

export async function subStoreSubs(): Promise<ISubStoreSub[]> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('subStoreSubs'))
}

export async function subStoreCollections(): Promise<ISubStoreSub[]> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('subStoreCollections'))
}

export async function showTrayIcon(): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('showTrayIcon'))
}

export async function closeTrayIcon(): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('closeTrayIcon'))
}

export async function updateTrayIcon(): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('updateTrayIcon'))
}

export function updateTrayIconImmediate(sysProxyEnabled: boolean, tunEnabled: boolean): void {
  window.electron.ipcRenderer.invoke('updateTrayIconImmediate', sysProxyEnabled, tunEnabled)
}

export async function showMainWindow(): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('showMainWindow'))
}

export async function closeMainWindow(): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('closeMainWindow'))
}

export async function triggerMainWindow(): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('triggerMainWindow'))
}

export async function showFloatingWindow(): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('showFloatingWindow'))
}

export async function closeFloatingWindow(): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('closeFloatingWindow'))
}

export async function showContextMenu(): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('showContextMenu'))
}

export async function openFile(
  type: 'profile' | 'override',
  id: string,
  ext?: 'yaml' | 'js'
): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('openFile', type, id, ext))
}

export async function openDevTools(): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('openDevTools'))
}

export async function resetAppConfig(): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('resetAppConfig'))
}

export async function createHeapSnapshot(): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('createHeapSnapshot'))
}

export async function getImageDataURL(url: string): Promise<string> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('getImageDataURL', url))
}

export async function resolveThemes(): Promise<{ key: string; label: string; content: string }[]> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('resolveThemes'))
}

export async function fetchThemes(): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('fetchThemes'))
}

export async function importThemes(files: string[]): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('importThemes', files))
}

export async function readTheme(theme: string): Promise<string> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('readTheme', theme))
}

export async function writeTheme(theme: string, css: string): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('writeTheme', theme, css))
}

let applyThemeRunning = false
const waitList: string[] = []
export async function applyTheme(theme: string): Promise<void> {
  if (applyThemeRunning) {
    waitList.push(theme)
    return
  }
  applyThemeRunning = true
  try {
    return await ipcErrorWrapper(window.electron.ipcRenderer.invoke('applyTheme', theme))
  } finally {
    applyThemeRunning = false
    if (waitList.length > 0) {
      await applyTheme(waitList.shift() || '')
    }
  }
}

export async function registerShortcut(
  oldShortcut: string,
  newShortcut: string,
  action: string
): Promise<boolean> {
  return ipcErrorWrapper(
    await window.electron.ipcRenderer.invoke('registerShortcut', oldShortcut, newShortcut, action)
  )
}

export async function copyEnv(type: 'bash' | 'cmd' | 'powershell'): Promise<void> {
  return ipcErrorWrapper(await window.electron.ipcRenderer.invoke('copyEnv', type))
}

async function alert<T>(msg: T): Promise<void> {
  const msgStr = typeof msg === 'string' ? msg : JSON.stringify(msg)
  return await window.electron.ipcRenderer.invoke('alert', msgStr)
}

window.alert = alert
