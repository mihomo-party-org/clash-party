import { webUtils } from 'electron'

type IpcListener = (event: Electron.IpcRendererEvent, ...args: unknown[]) => void
type IpcUnsubscribe = () => void

interface SafeIpcRenderer {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  send: (channel: string, ...args: unknown[]) => void
  on: (channel: string, listener: IpcListener) => IpcUnsubscribe
  removeListener: (channel: string, listener: IpcListener) => void
  removeAllListeners: (channel: string) => void
}

interface ElectronAPI {
  ipcRenderer: SafeIpcRenderer
  process: {
    platform: NodeJS.Platform
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: { webUtils: typeof webUtils }
  }
}
