import React, { ReactNode, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { showError } from '@renderer/utils/error-display'
import {
  getOverrideConfig,
  setOverrideConfig as set,
  addOverrideItem as add,
  removeOverrideItem as remove,
  updateOverrideItem as update
} from '@renderer/utils/ipc'
import { createConfigContext } from './create-config-context'

const { Provider, useConfig } = createConfigContext<IOverrideConfig>({
  swrKey: 'getOverrideConfig',
  fetcher: getOverrideConfig,
  ipcEvent: 'overrideConfigUpdated'
})

interface OverrideConfigContextType {
  overrideConfig: IOverrideConfig | undefined
  setOverrideConfig: (config: IOverrideConfig) => Promise<void>
  mutateOverrideConfig: () => void
  addOverrideItem: (item: Partial<IOverrideItem>) => Promise<void>
  updateOverrideItem: (item: IOverrideItem) => Promise<void>
  removeOverrideItem: (id: string) => Promise<void>
}

const OverrideConfigContext = React.createContext<OverrideConfigContextType | undefined>(undefined)

export const OverrideConfigProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  return (
    <Provider>
      <OverrideConfigContextWrapper>{children}</OverrideConfigContextWrapper>
    </Provider>
  )
}

const OverrideConfigContextWrapper: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { config, mutate } = useConfig()
  const { t } = useTranslation()

  const withErrorHandling = useCallback(
    (action: () => Promise<void>, errorKey: string) => async () => {
      try {
        await action()
      } catch (e) {
        await showError(e, t(errorKey))
      } finally {
        mutate()
      }
    },
    [mutate, t]
  )

  const setOverrideConfig = useCallback(
    (cfg: IOverrideConfig) =>
      withErrorHandling(() => set(cfg), 'common.error.saveOverrideConfigFailed')(),
    [withErrorHandling]
  )

  const addOverrideItem = useCallback(
    (item: Partial<IOverrideItem>) =>
      withErrorHandling(() => add(item), 'common.error.addOverrideFailed')(),
    [withErrorHandling]
  )

  const removeOverrideItem = useCallback(
    (id: string) => withErrorHandling(() => remove(id), 'common.error.deleteOverrideFailed')(),
    [withErrorHandling]
  )

  const updateOverrideItem = useCallback(
    (item: IOverrideItem) =>
      withErrorHandling(() => update(item), 'common.error.updateOverrideFailed')(),
    [withErrorHandling]
  )

  return (
    <OverrideConfigContext.Provider
      value={{
        overrideConfig: config,
        setOverrideConfig,
        mutateOverrideConfig: mutate,
        addOverrideItem,
        removeOverrideItem,
        updateOverrideItem
      }}
    >
      {children}
    </OverrideConfigContext.Provider>
  )
}

export const useOverrideConfig = (): OverrideConfigContextType => {
  const context = React.useContext(OverrideConfigContext)
  if (!context) {
    throw new Error('useOverrideConfig must be used within an OverrideConfigProvider')
  }
  return context
}
