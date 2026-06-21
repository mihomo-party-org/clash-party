import { Notification } from 'electron'
import i18next from 'i18next'
import { addProfileItem } from './config'
import { restartCore } from './core/manager'
import { mainWindow } from './window'
import { safeShowErrorBox } from './utils/init'

function parseDeepLink(url: string): URL | undefined {
  if (!url.startsWith('clash://') && !url.startsWith('mihomo://')) return undefined

  try {
    return new URL(url)
  } catch {
    return undefined
  }
}

export function shouldShowWindowForDeepLink(url: string): boolean {
  const urlObj = parseDeepLink(url)
  if (!urlObj) return true
  return urlObj?.host === 'install-config'
}

export async function handleDeepLink(url: string): Promise<void> {
  const urlObj = parseDeepLink(url)
  if (!urlObj) return

  switch (urlObj.host) {
    case 'install-config': {
      try {
        const profileUrl = urlObj.searchParams.get('url')
        const profileName = urlObj.searchParams.get('name')
        if (!profileUrl) {
          throw new Error(i18next.t('profiles.error.urlParamMissing'))
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
    case 'restart-core': {
      try {
        await restartCore()
      } catch (e) {
        safeShowErrorBox('mihomo.error.coreStartFailed', `${e}`)
      }
      break
    }
  }
}
