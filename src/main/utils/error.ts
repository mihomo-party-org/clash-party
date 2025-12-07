import { trySendToRenderer } from './ipcEmitter'
import { logger } from './logger'

const pendingErrors: IAppErrorPayload[] = []

function normalizeError(error: unknown): { message: string; stack?: string; detail?: string } {
  if (error instanceof Error) {
    return { message: error.message || 'Unknown error', stack: error.stack || undefined }
  }

  if (typeof error === 'string') {
    return { message: error }
  }

  if (error && typeof error === 'object') {
    try {
      return { message: JSON.stringify(error), detail: JSON.stringify(error, null, 2) }
    } catch {
      return { message: 'Unknown error' }
    }
  }

  return { message: 'Unknown error' }
}

function sendErrorToRenderer(payload: IAppErrorPayload): boolean {
  return trySendToRenderer('app-error', payload)
}

function createPayload(error: unknown, extra: Partial<IAppErrorPayload>): IAppErrorPayload {
  const normalized = normalizeError(error)
  const timestamp = Date.now()

  return {
    id: extra.id || `${timestamp}-${Math.random().toString(16).slice(2)}`,
    title: extra.title,
    message: extra.message || normalized.message,
    detail: extra.detail || normalized.detail,
    stack: extra.stack || normalized.stack,
    timestamp,
    source: extra.source || 'main',
    tags: extra.tags
  }
}

export function flushPendingErrors(): void {
  if (!pendingErrors.length) return
  const remaining = [...pendingErrors]
  pendingErrors.length = 0

  for (const payload of remaining) {
    if (!sendErrorToRenderer(payload)) {
      pendingErrors.push(payload)
    }
  }
}

export function emitAppError(
  error: unknown,
  extra: Partial<IAppErrorPayload> = {}
): IAppErrorPayload {
  const payload = createPayload(error, extra)

  if (!sendErrorToRenderer(payload)) {
    pendingErrors.push(payload)
  }

  void logger.error(payload.title ? `${payload.title}: ${payload.message}` : payload.message, error)
  return payload
}

export function installMainErrorHandlers(): void {
  process.on('uncaughtException', (error: Error) => {
    emitAppError(error, { title: 'Uncaught exception', tags: ['process'] })
  })

  process.on('unhandledRejection', (reason: unknown) => {
    emitAppError(reason, { title: 'Unhandled promise rejection', tags: ['process'] })
  })
}
