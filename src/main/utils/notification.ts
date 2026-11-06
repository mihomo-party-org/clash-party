import { Notification, shell } from 'electron'

export interface AppNotificationPayload {
  id?: string
  title: string
  body?: string
  persistent?: boolean
  url?: string
}

const systemNotifications = new Map<string, Notification>()

export function showNotification(payload: AppNotificationPayload): void {
  const notification = new Notification({
    title: payload.title,
    body: payload.body,
    timeoutType: payload.persistent ? 'never' : 'default'
  })

  const url = payload.url
  if (url) {
    notification.on('click', () => {
      void shell.openExternal(url)
    })
  }

  const id = payload.id
  if (id) {
    systemNotifications.get(id)?.close()
    systemNotifications.set(id, notification)
    notification.on('close', () => {
      if (systemNotifications.get(id) === notification) {
        systemNotifications.delete(id)
      }
    })
  }

  notification.show()
}

export function dismissNotification(id: string): void {
  const notification = systemNotifications.get(id)
  if (!notification) return

  notification.close()
  systemNotifications.delete(id)
}
