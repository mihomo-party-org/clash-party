import { contextBridge, ipcRenderer, webUtils } from 'electron'

// 允许的 invoke channels 白名单
const validInvokeChannels = [
  // Mihomo API
  'mihomoVersion',
  'mihomoCloseConnection',
  'mihomoCloseAllConnections',
  'mihomoRules',
  'mihomoProxies',
  'mihomoGroups',
  'mihomoProxyProviders',
  'mihomoUpdateProxyProviders',
  'mihomoRuleProviders',
  'mihomoUpdateRuleProviders',
  'mihomoChangeProxy',
  'mihomoUnfixedProxy',
  'mihomoUpgradeGeo',
  'mihomoUpgrade',
  'mihomoUpgradeUI',
  'mihomoUpgradeConfig',
  'mihomoProxyDelay',
  'mihomoGroupDelay',
  'patchMihomoConfig',
  'mihomoSmartGroupWeights',
  'mihomoSmartFlushCache',
  // AutoRun
  'checkAutoRun',
  'enableAutoRun',
  'disableAutoRun',
  // Config
  'getAppConfig',
  'patchAppConfig',
  'getControledMihomoConfig',
  'patchControledMihomoConfig',
  'resetAppConfig',
  // Profile
  'getProfileConfig',
  'setProfileConfig',
  'getCurrentProfileItem',
  'getProfileItem',
  'getProfileStr',
  'setProfileStr',
  'addProfileItem',
  'removeProfileItem',
  'updateProfileItem',
  'changeCurrentProfile',
  'addProfileUpdater',
  'removeProfileUpdater',
  // Override
  'getOverrideConfig',
  'setOverrideConfig',
  'getOverrideItem',
  'addOverrideItem',
  'removeOverrideItem',
  'updateOverrideItem',
  'getOverride',
  'setOverride',
  // File
  'getFileStr',
  'setFileStr',
  'convertMrsRuleset',
  'getRuntimeConfig',
  'getRuntimeConfigStr',
  'getSmartOverrideContent',
  'getRuleStr',
  'setRuleStr',
  'getFilePath',
  'readTextFile',
  'openFile',
  // Core
  'restartCore',
  'startMonitor',
  'quitWithoutCore',
  // System
  'triggerSysProxy',
  'checkTunPermissions',
  'grantTunPermissions',
  'manualGrantCorePermition',
  'checkAdminPrivileges',
  'restartAsAdmin',
  'checkMihomoCorePermissions',
  'requestTunPermissions',
  'checkHighPrivilegeCore',
  'showTunPermissionDialog',
  'showErrorDialog',
  'openUWPTool',
  'setupFirewall',
  'getInterfaces',
  'setNativeTheme',
  'copyEnv',
  // Update
  'checkUpdate',
  'downloadAndInstallUpdate',
  'getVersion',
  'platform',
  'fetchMihomoTags',
  'installSpecificMihomoCore',
  'clearMihomoVersionCache',
  // Backup
  'webdavBackup',
  'webdavRestore',
  'listWebdavBackups',
  'webdavDelete',
  'reinitWebdavBackupScheduler',
  'exportLocalBackup',
  'importLocalBackup',
  // SubStore
  'startSubStoreFrontendServer',
  'stopSubStoreFrontendServer',
  'startSubStoreBackendServer',
  'stopSubStoreBackendServer',
  'downloadSubStore',
  'subStorePort',
  'subStoreFrontendPort',
  'subStoreSubs',
  'subStoreCollections',
  // Theme
  'resolveThemes',
  'fetchThemes',
  'importThemes',
  'readTheme',
  'writeTheme',
  'applyTheme',
  // Tray
  'showTrayIcon',
  'closeTrayIcon',
  'updateTrayIcon',
  'updateTrayIconImmediate',
  // Window
  'showMainWindow',
  'closeMainWindow',
  'triggerMainWindow',
  'showFloatingWindow',
  'closeFloatingWindow',
  'showContextMenu',
  'setTitleBarOverlay',
  'setAlwaysOnTop',
  'isAlwaysOnTop',
  'openDevTools',
  'createHeapSnapshot',
  'relaunchApp',
  'quitApp',
  // Shortcut
  'registerShortcut',
  // Misc
  'getGistUrl',
  'getImageDataURL',
  'getIconDataURL',
  'getAppName',
  'changeLanguage'
] as const

// 允许的 on/removeListener channels 白名单
const validListenChannels = [
  'mihomoLogs',
  'mihomoConnections',
  'mihomoTraffic',
  'mihomoMemory',
  'appConfigUpdated',
  'controledMihomoConfigUpdated',
  'profileConfigUpdated',
  'groupsUpdated',
  'rulesUpdated'
] as const

// 允许的 send channels 白名单
const validSendChannels = ['updateTrayMenu', 'updateFloatingWindow', 'trayIconUpdate'] as const

type InvokeChannel = (typeof validInvokeChannels)[number]
type ListenChannel = (typeof validListenChannels)[number]
type SendChannel = (typeof validSendChannels)[number]

type IpcListener = (event: Electron.IpcRendererEvent, ...args: unknown[]) => void
const listenerMap = new Map<ListenChannel, Set<IpcListener>>()

// 安全的 IPC API，只暴露白名单内的 channels
const electronAPI = {
  ipcRenderer: {
    invoke: (channel: InvokeChannel, ...args: unknown[]): Promise<unknown> => {
      if (validInvokeChannels.includes(channel)) {
        return ipcRenderer.invoke(channel, ...args)
      }
      return Promise.reject(new Error(`Invalid invoke channel: ${channel}`))
    },
    send: (channel: SendChannel, ...args: unknown[]): void => {
      if (validSendChannels.includes(channel)) {
        ipcRenderer.send(channel, ...args)
      }
    },
    on: (channel: ListenChannel, listener: IpcListener): void => {
      if (validListenChannels.includes(channel)) {
        if (!listenerMap.has(channel)) {
          listenerMap.set(channel, new Set())
        }
        listenerMap.get(channel)?.add(listener)
        ipcRenderer.on(channel, listener)
      }
    },
    removeListener: (channel: ListenChannel, listener: IpcListener): void => {
      if (validListenChannels.includes(channel)) {
        listenerMap.get(channel)?.delete(listener)
        ipcRenderer.removeListener(channel, listener)
      }
    },
    removeAllListeners: (channel: ListenChannel): void => {
      if (validListenChannels.includes(channel)) {
        const listeners = listenerMap.get(channel)
        if (listeners) {
          listeners.forEach((listener) => {
            ipcRenderer.removeListener(channel, listener)
          })
          listeners.clear()
        }
      }
    }
  },
  process: {
    platform: process.platform
  }
}

const api = {
  webUtils: webUtils
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
