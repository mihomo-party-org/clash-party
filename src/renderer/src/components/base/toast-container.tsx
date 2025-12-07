import { useToast, ToastMessage } from '@renderer/hooks/use-toast'
import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { IoClose, IoCheckmarkCircle, IoWarning, IoInformationCircle, IoAlertCircle } from 'react-icons/io5'

const iconMap = {
  success: IoCheckmarkCircle,
  error: IoAlertCircle,
  warning: IoWarning,
  info: IoInformationCircle
}

const colorMap = {
  success: 'bg-success-100 border-success-500 text-success-700 dark:bg-success-900/30 dark:text-success-400',
  error: 'bg-danger-100 border-danger-500 text-danger-700 dark:bg-danger-900/30 dark:text-danger-400',
  warning: 'bg-warning-100 border-warning-500 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400',
  info: 'bg-primary-100 border-primary-500 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400'
}

const iconColorMap = {
  success: 'text-success-500',
  error: 'text-danger-500',
  warning: 'text-warning-500',
  info: 'text-primary-500'
}

interface ToastItemProps {
  toast: ToastMessage
  onClose: () => void
}

function ToastItem({ toast, onClose }: ToastItemProps): ReactElement {
  const [isVisible, setIsVisible] = useState(false)
  const Icon = iconMap[toast.type]

  useEffect(() => {
    // 触发进入动画
    requestAnimationFrame(() => setIsVisible(true))
  }, [])

  const handleClose = (): void => {
    setIsVisible(false)
    setTimeout(onClose, 200) // 等待退出动画完成
  }

  return (
    <div
      className={`
        flex items-start gap-3 px-4 py-3 rounded-lg border shadow-lg backdrop-blur-sm
        transition-all duration-200 ease-out max-w-sm
        ${colorMap[toast.type]}
        ${isVisible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4'}
      `}
    >
      <Icon className={`text-lg flex-shrink-0 mt-0.5 ${iconColorMap[toast.type]}`} />
      <div className="flex-1 min-w-0 overflow-hidden">
        {toast.title && (
          <div className="font-medium text-sm truncate">{toast.title}</div>
        )}
        <div
          className={`text-sm break-words line-clamp-3 ${toast.title ? 'opacity-80' : ''}`}
          title={toast.message}
        >
          {toast.message}
        </div>
      </div>
      <button
        onClick={handleClose}
        className="flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity"
      >
        <IoClose className="text-lg" />
      </button>
    </div>
  )
}

export default function ToastContainer(): ReactElement | null {
  const { toasts, removeToast } = useToast()

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-14 right-4 z-[9999] flex flex-col gap-2">
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onClose={() => removeToast(toast.id)}
        />
      ))}
    </div>
  )
}
