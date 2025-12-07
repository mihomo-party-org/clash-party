import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'

export interface ToastMessage extends IToastPayload {
  id: string
  duration?: number
}

interface ToastContextValue {
  toasts: ToastMessage[]
  addToast: (toast: Omit<ToastMessage, 'id'>) => void
  removeToast: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

interface Props {
  children: ReactNode
}

export function ToastProvider({ children }: Props): ReactElement {
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const timersRef = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // 清理所有定时器
  useEffect(() => {
    const timers = timersRef.current
    return () => {
      timers.forEach((timer) => clearTimeout(timer))
      timers.clear()
    }
  }, [])

  const addToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const duration = toast.duration ?? 4000

    setToasts((prev) => [...prev, { ...toast, id }])

    if (duration > 0) {
      const timer = setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
        timersRef.current.delete(id)
      }, duration)
      timersRef.current.set(id, timer)
    }
  }, [])

  const removeToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  // 监听来自主进程的 toast 消息
  useEffect(() => {
    const handler = (_event: unknown, payload: IToastPayload): void => {
      addToast(payload)
    }

    if (window.electron?.ipcRenderer) {
      window.electron.ipcRenderer.on('app-toast', handler)
    }

    return () => {
      if (window.electron?.ipcRenderer) {
        window.electron.ipcRenderer.removeListener('app-toast', handler)
      }
    }
  }, [addToast])

  const contextValue = useMemo<ToastContextValue>(() => ({ toasts, addToast, removeToast }), [toasts, addToast, removeToast])

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider')
  }
  return ctx
}
