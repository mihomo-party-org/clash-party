import { Button } from '@heroui/react'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { checkUpdate } from '@renderer/utils/ipc'
import React, { lazy, Suspense, useState } from 'react'
import useSWR from 'swr'
import { platform } from '@renderer/utils/init'
import { MdNewReleases } from 'react-icons/md'

const UpdaterModal = lazy(() => import('./updater-modal'))

interface Props {
  iconOnly?: boolean
}

const UpdaterButton: React.FC<Props> = (props) => {
  const { appConfig } = useAppConfig()
  const { iconOnly } = props
  const { autoCheckUpdate, useWindowFrame = false } = appConfig || {}
  const [openModal, setOpenModal] = useState(false)
  const { data: latest } = useSWR(
    autoCheckUpdate ? 'checkUpdate' : undefined,
    autoCheckUpdate ? checkUpdate : (): undefined => {},
    {
      refreshInterval: 1000 * 60 * 10
    }
  )
  if (!latest) return null

  return (
    <>
      {openModal && (
        <Suspense fallback={null}>
          <UpdaterModal
            version={latest.version}
            changelog={latest.changelog}
            onClose={() => {
              setOpenModal(false)
            }}
          />
        </Suspense>
      )}
      {iconOnly ? (
        <Button
          isIconOnly
          variant="flat"
          className="rounded-full app-nodrag"
          color="danger"
          size="md"
          onPress={() => {
            setOpenModal(true)
          }}
        >
          <MdNewReleases className="text-[35px]" />
        </Button>
      ) : (
        <Button
          className={`fixed left-[85px] app-nodrag ${!useWindowFrame && platform === 'darwin' ? 'ml-[60px]' : ''}`}
          color="danger"
          size="sm"
          onPress={() => {
            setOpenModal(true)
          }}
        >
          v{latest.version}
        </Button>
      )}
    </>
  )
}

export default UpdaterButton
