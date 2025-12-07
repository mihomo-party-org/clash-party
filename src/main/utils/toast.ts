import { BrowserWindow } from 'electron'

let windowGetter: (() => BrowserWindow | null) | null = null

export function registerToastTarget(getter: () => BrowserWindow | null): void {
  windowGetter = getter
}

function trySendToast(payload: IToastPayload): boolean {
  const target = windowGetter?.()
  if (target?.webContents) {
    target.webContents.send('app-toast', payload)
    return true
  }
  return false
}

export function emitToast(
  type: IToastPayload['type'],
  message: string,
  title?: string
): void {
  trySendToast({ type, message, title })
}
