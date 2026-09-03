import React, { createContext, useContext, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { showError } from '@renderer/utils/error-display'
import useSWR from 'swr'
import { getControledMihomoConfig, patchControledMihomoConfig as patch } from '@renderer/utils/ipc'

interface ControledMihomoConfigContextType {
  controledMihomoConfig: Partial<IMihomoConfig> | undefined
  mutateControledMihomoConfig: () => void
  patchControledMihomoConfig: (value: Partial<IMihomoConfig>) => Promise<void>
}

const ControledMihomoConfigContext = createContext<ControledMihomoConfigContextType | undefined>(
  undefined
)

export const ControledMihomoConfigProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { t } = useTranslation()
  const { data: controledMihomoConfig, mutate: mutateControledMihomoConfig } = useSWR(
    'getControledMihomoConfig',
    () => getControledMihomoConfig()
  )

  const patchControledMihomoConfig = async (value: Partial<IMihomoConfig>): Promise<void> => {
    try {
      await patch(value)
    } catch (e) {
      await showError(e, t('common.error.updateCoreConfigFailed'))
    } finally {
      mutateControledMihomoConfig()
    }
  }

  React.useEffect(() => {
    const handler = (): void => {
      mutateControledMihomoConfig()
    }
    return window.electron.ipcRenderer.on('controledMihomoConfigUpdated', handler)
  }, [mutateControledMihomoConfig])

  return (
    <ControledMihomoConfigContext.Provider
      value={{ controledMihomoConfig, mutateControledMihomoConfig, patchControledMihomoConfig }}
    >
      {children}
    </ControledMihomoConfigContext.Provider>
  )
}

export const useControledMihomoConfig = (): ControledMihomoConfigContextType => {
  const context = useContext(ControledMihomoConfigContext)
  if (context === undefined) {
    throw new Error('useControledMihomoConfig must be used within a ControledMihomoConfigProvider')
  }
  return context
}
