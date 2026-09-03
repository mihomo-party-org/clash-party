import React, { createContext, useContext, ReactNode, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { showError } from '@renderer/utils/error-display'
import useSWR, { KeyedMutator } from 'swr'

interface ConfigContextValue<T> {
  config: T | undefined
  mutate: KeyedMutator<T>
}

interface CreateConfigContextOptions<T> {
  swrKey: string
  fetcher: () => Promise<T>
  ipcEvent: string
}

export function createConfigContext<T>(options: CreateConfigContextOptions<T>) {
  const { swrKey, fetcher, ipcEvent } = options
  const Context = createContext<ConfigContextValue<T> | undefined>(undefined)

  const Provider: React.FC<{ children: ReactNode }> = ({ children }) => {
    // 用箭头函数包一层，避免 SWR 把 key 字符串当作参数传给 fetcher（会让 force 参数恒为真）
    const { data: config, mutate } = useSWR(swrKey, () => fetcher())

    useEffect(() => {
      const handler = (): void => {
        mutate()
      }
      return window.electron.ipcRenderer.on(ipcEvent, handler)
    }, [mutate])

    return <Context.Provider value={{ config, mutate }}>{children}</Context.Provider>
  }

  const useConfig = (): ConfigContextValue<T> => {
    const context = useContext(Context)
    if (!context) {
      throw new Error(`useConfig must be used within Provider`)
    }
    return context
  }

  return { Provider, useConfig, Context }
}

interface ActionOptions {
  errorKey: string
  updateTray?: boolean
}

export function useConfigAction<T>(
  mutate: KeyedMutator<T>,
  action: () => Promise<void>,
  options: ActionOptions
): () => Promise<void> {
  const { t } = useTranslation()

  return useCallback(async () => {
    try {
      await action()
    } catch (e) {
      await showError(e, t(options.errorKey))
    } finally {
      mutate()
      if (options.updateTray) {
        window.electron.ipcRenderer.send('updateTrayMenu')
      }
    }
  }, [mutate, action, t, options.errorKey, options.updateTray])
}
