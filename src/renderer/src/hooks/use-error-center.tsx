import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import AppErrorModal from '@renderer/components/base/app-error-modal'

interface ErrorCenterContextValue {
  pushError: (error: unknown, extra?: Partial<IAppErrorPayload>) => void
  clear: () => void
}

const ErrorCenterContext = createContext<ErrorCenterContextValue | null>(null)

function buildPayload(error: unknown, extra: Partial<IAppErrorPayload> = {}): IAppErrorPayload {
  // 如果已经是完整的 payload，直接合并
  if (error && typeof error === 'object' && 'message' in error && 'timestamp' in error) {
    return { ...(error as IAppErrorPayload), ...extra }
  }

  const timestamp = Date.now()
  const id = extra.id || `${timestamp}-${Math.random().toString(16).slice(2)}`

  let message = 'Unknown error'
  let stack: string | undefined

  if (error instanceof Error) {
    message = error.message || message
    stack = error.stack
  } else if (typeof error === 'string') {
    message = error
  }

  return {
    id,
    timestamp,
    message: extra.message || message,
    title: extra.title,
    stack: extra.stack || stack,
    source: extra.source || 'renderer',
    tags: extra.tags
  }
}

interface Props {
  children: ReactNode
}

export function ErrorCenterProvider({ children }: Props): ReactElement {
  const [current, setCurrent] = useState<IAppErrorPayload | null>(null)

  const pushError = useCallback((error: unknown, extra?: Partial<IAppErrorPayload>) => {
    setCurrent(buildPayload(error, extra))
  }, [])

  const clear = useCallback(() => {
    setCurrent(null)
  }, [])

  useEffect(() => {
    const handler = (_event: unknown, payload: IAppErrorPayload): void => {
      pushError(payload)
    }

    if (window.electron?.ipcRenderer) {
      window.electron.ipcRenderer.on('app-error', handler)
    }

    return () => {
      if (window.electron?.ipcRenderer) {
        window.electron.ipcRenderer.removeListener('app-error', handler)
      }
    }
  }, [pushError])

  useEffect(() => {
    const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
      event.preventDefault()
      pushError(event.reason || 'Unhandled promise rejection', {
        title: 'Unhandled promise rejection',
        source: 'renderer'
      })
    }

    const onWindowError = (event: ErrorEvent): void => {
      event.preventDefault()
      pushError(event.error || event.message, {
        title: 'Unexpected error',
        source: 'renderer'
      })
    }

    window.addEventListener('unhandledrejection', onUnhandledRejection)
    window.addEventListener('error', onWindowError)

    return () => {
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
      window.removeEventListener('error', onWindowError)
    }
  }, [pushError])

  const contextValue = useMemo<ErrorCenterContextValue>(() => ({ pushError, clear }), [pushError, clear])

  return (
    <ErrorCenterContext.Provider value={contextValue}>
      {children}
      <AppErrorModal error={current} onClose={clear} />
    </ErrorCenterContext.Provider>
  )
}

export function useErrorCenter(): ErrorCenterContextValue {
  const ctx = useContext(ErrorCenterContext)
  if (!ctx) {
    throw new Error('useErrorCenter must be used within ErrorCenterProvider')
  }
  return ctx
}
