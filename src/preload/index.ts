import { contextBridge, ipcRenderer, webUtils } from 'electron'

// 允许的 invoke channels 白名单
const validInvokeChannels = [
  // Mihomo API
  'mihomoVersion',
  'mihomoCloseConnection',
  'mihomoCloseAllConnections',
  'mihomoRules',
  'mihomoRulesDisable',
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
  'mihomoProxyDelay',
  'mihomoGroupDelay',
  'patchMihomoConfig',
  'mihomoSmartGroupWeights',
  'mihomoSmartFlushCache',
  'queryTrafficUsageOverview',
  'queryTrafficUsageBreakdown',
  'importTrafficUsage',
  'clearTrafficUsage',
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
  'readImageFileDataURL',
  'openFile',
  // Core
  'restartCore',
  'getSmartModelStatus',
  'downloadSmartModel',
  'mihomoHotReloadConfig',
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
  'ensureSubStoreServices',
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
  // Plugin
  'getPluginConfig',
  'previewPlugin',
  'installPlugin',
  'loginPlugin',
  'removePlugin',
  'updatePluginProfile',
  'patchPluginItem',
  // Misc
  'getGistUrl',
  'generateGistAgeKeyPair',
  'exportGistAgeSecretKey',
  'fetchIPInfo',
  'measureLatency',
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
  'rulesUpdated',
  'updateDownloadProgress',
  'pluginConfigUpdated',
  'openPluginFile'
] as const

// 允许的 send channels 白名单
const validSendChannels = [
  'updateTrayMenu',
  'updateFloatingWindow',
  'trayIconUpdate',
  'rendererFirstContentReady'
] as const

type InvokeChannel = (typeof validInvokeChannels)[number]
type ListenChannel = (typeof validListenChannels)[number]
type SendChannel = (typeof validSendChannels)[number]

type IpcListener = (event: Electron.IpcRendererEvent, ...args: unknown[]) => void
type IpcUnsubscribe = () => void

// contextBridge 每次把渲染层函数传进 preload 世界时都会生成一个新的代理包装，
// on() 与 removeListener() 收到的包装对象并不相同，跨调用按引用匹配永远无法移除监听器。
// 监听器残留后组件卸载仍在消费 IPC 消息（连接页每秒收到全量连接列表），
// 对已卸载组件持续 dispatch，update 挂在 React 内部队列上无人消费，内存无界增长。
// 因此 on() 返回一个取消闭包，闭包捕获本次实际注册进 ipcRenderer 的代理，跨调用移除可靠。
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
    on: (channel: ListenChannel, listener: IpcListener): IpcUnsubscribe => {
      if (validListenChannels.includes(channel)) {
        ipcRenderer.on(channel, listener)
        let byChannel = listenerMap.get(channel)
        if (!byChannel) {
          byChannel = new Set()
          listenerMap.set(channel, byChannel)
        }
        byChannel.add(listener)
        return () => {
          ipcRenderer.removeListener(channel, listener)
          byChannel.delete(listener)
          if (byChannel.size === 0) {
            listenerMap.delete(channel)
          }
        }
      }
      return () => {}
    },
    removeListener: (channel: ListenChannel, listener: IpcListener): void => {
      if (validListenChannels.includes(channel)) {
        // 仅移除同一次调用注册的监听器。跨调用场景请使用 on() 返回的取消闭包，
        // 因为 contextBridge 每次传函数都会生成新代理，这里无法匹配旧代理。
        ipcRenderer.removeListener(channel, listener)
        listenerMap.get(channel)?.delete(listener)
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
