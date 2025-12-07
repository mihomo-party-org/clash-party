import { trySendToRenderer } from './ipcEmitter'

export function emitToast(
  type: IToastPayload['type'],
  message: string,
  title?: string
): void {
  trySendToRenderer('app-toast', { type, message, title })
}
