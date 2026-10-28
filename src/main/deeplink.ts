import { Notification } from 'electron'
import i18next from 'i18next'
import { addProfileItem } from './config'
import { installRemotePlugin, loginPlugin } from './resolve/plugin'
import { setOperationMode } from './simple/mode'
import { mainWindow } from './window'
import { safeShowErrorBox } from './utils/init'

export function findDeepLink(args: string[]): string | undefined {
  return args.find((arg) => {
    const lower = arg.toLowerCase()
    return lower.startsWith('clash://') || lower.startsWith('mihomo://')
  })
}

export async function handleDeepLink(url: string): Promise<void> {
  if (!findDeepLink([url])) return

  const urlObj = new URL(url)
  switch (urlObj.host) {
    case 'install-config': {
      try {
        const profileUrl = urlObj.searchParams.get('url')
        const profileName = urlObj.searchParams.get('name')
        const operationMode = urlObj.searchParams.get('operation-mode')
        if (!profileUrl) {
          throw new Error(i18next.t('profiles.error.urlParamMissing'))
        }
        if (operationMode === 'standard' || operationMode === 'simple') {
          await setOperationMode(operationMode)
        }
        await addProfileItem({
          type: 'remote',
          name: profileName ?? undefined,
          url: profileUrl
        })
        mainWindow?.webContents.send('profileConfigUpdated')
        new Notification({ title: i18next.t('profiles.notification.importSuccess') }).show()
      } catch (e) {
        safeShowErrorBox('profiles.error.importFailed', `${url}\n${e}`)
      }
      break
    }
    case 'install-plugin': {
      let plugin: IPluginItem
      try {
        const pluginUrl = urlObj.searchParams.get('url')
        if (!pluginUrl) {
          throw new Error(i18next.t('profiles.error.urlParamMissing'))
        }
        plugin = await installRemotePlugin(pluginUrl)
        new Notification({ title: i18next.t('plugins.installed') }).show()
      } catch (e) {
        safeShowErrorBox('plugins.installFailed', `${e}`)
        break
      }

      try {
        await loginPlugin(plugin.id)
        new Notification({ title: i18next.t('plugins.loginSuccess') }).show()
      } catch (e) {
        safeShowErrorBox('plugins.loginFailed', `${e}`)
      }
      break
    }
  }
}
