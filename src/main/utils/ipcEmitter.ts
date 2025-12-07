import { BrowserWindow } from 'electron'

let windowGetter: (() => BrowserWindow | null) | null = null

export function registerIpcTarget(getter: () => BrowserWindow | null): void {
  windowGetter = getter
}

export function getIpcTarget(): BrowserWindow | null {
  return windowGetter?.() ?? null
}

export function trySendToRenderer(channel: string, payload: unknown): boolean {
  const target = getIpcTarget()
  if (target?.webContents) {
    target.webContents.send(channel, payload)
    return true
  }
  return false
}
