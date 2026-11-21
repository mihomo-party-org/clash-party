import React, { ReactNode, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { showError } from '@renderer/utils/error-display'
import {
  addProfileItem as add,
  changeCurrentProfile as change,
  getProfileConfig,
  removeProfileItem as remove,
  setProfileConfig as set
} from '@renderer/utils/ipc'
import { createConfigContext } from './create-config-context'

const { Provider, useConfig } = createConfigContext<IProfileConfig>({
  swrKey: 'getProfileConfig',
  fetcher: getProfileConfig,
  ipcEvent: 'profileConfigUpdated'
})

interface ProfileConfigContextType {
  profileConfig: IProfileConfig | undefined
  setProfileConfig: (config: IProfileConfig) => Promise<void>
  mutateProfileConfig: () => void
  addProfileItem: (item: Partial<IProfileItem>) => Promise<void>
  removeProfileItem: (id: string) => Promise<void>
  changeCurrentProfile: (id: string) => Promise<void>
}

const ProfileConfigContext = React.createContext<ProfileConfigContextType | undefined>(undefined)

export const ProfileConfigProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  return (
    <Provider>
      <ProfileConfigContextWrapper>{children}</ProfileConfigContextWrapper>
    </Provider>
  )
}

const ProfileConfigContextWrapper: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { config, mutate } = useConfig()
  const { t } = useTranslation()
  const targetProfileId = useRef<string | null>(null)
  const pendingTask = useRef<Promise<void> | null>(null)

  const withErrorHandling = useCallback(
    (action: () => Promise<void>, errorKey: string, updateTray = true) =>
      async () => {
        try {
          await action()
        } catch (e) {
          await showError(e, t(errorKey))
        } finally {
          mutate()
          if (updateTray) {
            window.electron.ipcRenderer.send('updateTrayMenu')
          }
        }
      },
    [mutate, t]
  )

  const setProfileConfig = useCallback(
    (cfg: IProfileConfig) =>
      withErrorHandling(() => set(cfg), 'common.error.saveProfileConfigFailed')(),
    [withErrorHandling]
  )

  const addProfileItem = useCallback(
    (item: Partial<IProfileItem>) =>
      withErrorHandling(async () => {
        await add(item)
      }, 'common.error.addProfileFailed')(),
    [withErrorHandling]
  )

  const removeProfileItem = useCallback(
    (id: string) => withErrorHandling(() => remove(id), 'common.error.deleteProfileFailed')(),
    [withErrorHandling]
  )

  const processChange = useCallback(async () => {
    if (pendingTask.current) return

    while (targetProfileId.current) {
      const targetId = targetProfileId.current
      targetProfileId.current = null

      pendingTask.current = change(targetId)
      try {
        await pendingTask.current
      } catch (e) {
        const errorMsg = (e as { message?: string })?.message || String(e)
        if (errorMsg.includes('reply was never sent')) {
          setTimeout(() => mutate(), 1000)
        } else {
          await showError(errorMsg, t('common.error.switchProfileFailed'))
          mutate()
        }
      } finally {
        pendingTask.current = null
      }
    }
  }, [mutate, t])

  const changeCurrentProfile = useCallback(
    async (id: string) => {
      if (targetProfileId.current === id) return

      mutate((prev) => (prev ? { ...prev, current: id } : prev), false)
      window.electron.ipcRenderer.send('updateTrayMenu')

      targetProfileId.current = id
      await processChange()
    },
    [mutate, processChange]
  )

  React.useEffect(() => {
    return () => {
      targetProfileId.current = null
    }
  }, [])

  return (
    <ProfileConfigContext.Provider
      value={{
        profileConfig: config,
        setProfileConfig,
        mutateProfileConfig: mutate,
        addProfileItem,
        removeProfileItem,
        changeCurrentProfile
      }}
    >
      {children}
    </ProfileConfigContext.Provider>
  )
}

export const useProfileConfig = (): ProfileConfigContextType => {
  const context = React.useContext(ProfileConfigContext)
  if (!context) {
    throw new Error('useProfileConfig must be used within a ProfileConfigProvider')
  }
  return context
}
