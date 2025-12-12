import React, { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { IoCheckmark, IoClose, IoAlertSharp, IoInformationSharp, IoCopy } from 'react-icons/io5'

type ToastType = 'success' | 'error' | 'warning' | 'info'

interface ToastData {
  id: string
  type: ToastType
  title?: string
  message: string
  duration?: number
  exiting?: boolean
  detailed?: boolean
}

type ToastListener = (toasts: ToastData[]) => void

let toasts: ToastData[] = []
let listeners: ToastListener[] = []

const notifyListeners = (): void => {
  listeners.forEach((listener) => listener([...toasts]))
}

const addToast = (type: ToastType, message: string, title?: string, duration = 1500): void => {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  toasts = [...toasts.slice(-4), { id, type, message, title, duration }]
  notifyListeners()
}

const markExiting = (id: string): void => {
  toasts = toasts.map((t) => (t.id === id ? { ...t, exiting: true } : t))
  notifyListeners()
}

const removeToast = (id: string): void => {
  toasts = toasts.filter((t) => t.id !== id)
  notifyListeners()
}

const addDetailedToast = (type: ToastType, message: string, title?: string): void => {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  toasts = [...toasts.slice(-4), { id, type, message, title, duration: 8000, detailed: true }]
  notifyListeners()
}

export const toast = {
  success: (message: string, title?: string): void => addToast('success', message, title),
  error: (message: string, title?: string): void => addToast('error', message, title, 1800),
  warning: (message: string, title?: string): void => addToast('warning', message, title),
  info: (message: string, title?: string): void => addToast('info', message, title),
  detailedError: (message: string, title?: string): void =>
    addDetailedToast('error', message, title)
}

const ToastItem: React.FC<{
  data: ToastData
  onRemove: (id: string) => void
}> = ({ data, onRemove }) => {
  useEffect(() => {
    if (data.detailed) return
    const duration = data.duration || 3500
    const exitTimer = setTimeout(() => markExiting(data.id), duration - 200)
    const removeTimer = setTimeout(() => onRemove(data.id), duration)
    return () => {
      clearTimeout(exitTimer)
      clearTimeout(removeTimer)
    }
  }, [data.id, data.duration, data.detailed, onRemove])

  const theme: Record<ToastType, { icon: React.ReactNode; bg: string; iconBg: string }> = {
    success: {
      icon: <IoCheckmark className="text-white text-sm" />,
      bg: 'bg-content1',
      iconBg: 'bg-success'
    },
    error: {
      icon: <IoClose className="text-white text-sm" />,
      bg: 'bg-content1',
      iconBg: 'bg-danger'
    },
    warning: {
      icon: <IoAlertSharp className="text-white text-sm" />,
      bg: 'bg-content1',
      iconBg: 'bg-warning'
    },
    info: {
      icon: <IoInformationSharp className="text-white text-sm" />,
      bg: 'bg-content1',
      iconBg: 'bg-primary'
    }
  }

  const { icon, iconBg } = theme[data.type]
  const duration = data.duration || 3500

  const handleClose = (): void => {
    markExiting(data.id)
    setTimeout(() => onRemove(data.id), 150)
  }

  const [copied, setCopied] = useState(false)
  const handleCopy = async (): Promise<void> => {
    await navigator.clipboard.writeText(data.message)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (data.detailed) {
    return (
      <div
        className={`
          relative flex flex-col gap-3 p-4
          bg-content1 rounded-xl
          shadow-xl border border-danger/30
          ${data.exiting ? 'toast-exit' : 'toast-enter'}
        `}
        style={{ width: 480 }}
      >
        <div className="flex items-center justify-between overflow-visible">
          <div className="flex items-center gap-3">
            <div
              className={`flex-shrink-0 w-8 h-8 ${iconBg} rounded-full flex items-center justify-center`}
            >
              {icon}
            </div>
            <p className="text-base font-semibold text-foreground">{data.title || '错误'}</p>
          </div>
          <div className="relative" style={{ zIndex: 99999 }}>
            <button
              onClick={handleCopy}
              className="p-2 rounded-lg hover:bg-default-200 transition-colors"
            >
              <div className="relative w-4 h-4">
                <IoCopy
                  className={`absolute inset-0 text-base text-foreground-500 transition-all duration-200 ${copied ? 'opacity-0 scale-50' : 'opacity-100 scale-100'}`}
                />
                <IoCheckmark
                  className={`absolute inset-0 text-base text-success transition-all duration-200 ${copied ? 'opacity-100 scale-100' : 'opacity-0 scale-50'}`}
                />
              </div>
            </button>
            <div
              className={`absolute top-full mt-1 left-1/2 -translate-x-1/2 px-2 py-1 text-xs text-foreground bg-content2 border border-default-200 rounded shadow-md whitespace-nowrap transition-all duration-200 ${copied ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-1 pointer-events-none'}`}
              style={{ zIndex: 99999 }}
            >
              已复制
            </div>
          </div>
        </div>
        <div className="bg-default-100 rounded-lg p-3 max-h-60 overflow-y-auto scrollbar-thin">
          <pre className="text-xs text-foreground-600 whitespace-pre-wrap break-words font-mono select-text leading-relaxed">
            {data.message}
          </pre>
        </div>
        <button
          onClick={handleClose}
          className="self-end px-4 py-1.5 text-sm font-medium text-white bg-danger rounded-lg hover:bg-danger/90 transition-colors"
        >
          确定
        </button>
      </div>
    )
  }

  return (
    <div
      className={`
        relative overflow-hidden
        flex items-center gap-3 p-3
        bg-content1/80 rounded-large
        shadow-large border border-default-200/50
        backdrop-blur-xl backdrop-saturate-150
        ${data.exiting ? 'toast-exit' : 'toast-enter'}
      `}
      style={{ width: 340 }}
    >
      <div
        className={`flex-shrink-0 w-7 h-7 ${iconBg} rounded-full flex items-center justify-center`}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        {data.title && <p className="text-sm font-medium text-foreground">{data.title}</p>}
        <p className="text-sm text-foreground-500 break-words select-text">{data.message}</p>
      </div>
      <button
        onClick={handleClose}
        className="flex-shrink-0 p-1 rounded-full hover:bg-default-200/60 transition-colors"
      >
        <IoClose className="text-base text-foreground-400" />
      </button>
      <div
        className={`absolute bottom-0 left-0 h-[2px] ${iconBg} toast-progress`}
        style={{ animationDuration: `${duration}ms` }}
      />
    </div>
  )
}

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentToasts, setCurrentToasts] = useState<ToastData[]>([])

  const handleRemove = useCallback((id: string) => {
    removeToast(id)
  }, [])

  useEffect(() => {
    const listener: ToastListener = (newToasts) => setCurrentToasts(newToasts)
    listeners.push(listener)
    return () => {
      listeners = listeners.filter((l) => l !== listener)
    }
  }, [])

  return (
    <>
      {children}
      {currentToasts.length > 0 &&
        createPortal(
          <div className="fixed top-[60px] right-4 z-[9999] flex flex-col gap-2">
            {currentToasts.map((t) => (
              <ToastItem key={t.id} data={t} onRemove={handleRemove} />
            ))}
          </div>,
          document.body
        )}
    </>
  )
}
