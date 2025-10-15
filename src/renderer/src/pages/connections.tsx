import BasePage from '@renderer/components/base/base-page'
import { mihomoCloseAllConnections, mihomoCloseConnection } from '@renderer/utils/ipc'
import { Key, useEffect, useMemo, useState } from 'react'
import { Badge, Button, Divider, Input, Select, SelectItem, Tab, Tabs } from '@heroui/react'
import { calcTraffic } from '@renderer/utils/calc'
import ConnectionItem from '@renderer/components/connections/connection-item'
import { Virtuoso } from 'react-virtuoso'
import dayjs from '@renderer/utils/dayjs'
import ConnectionDetailModal from '@renderer/components/connections/connection-detail-modal'
import { CgClose, CgTrash } from 'react-icons/cg'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { HiSortAscending, HiSortDescending } from 'react-icons/hi'
import { includesIgnoreCase } from '@renderer/utils/includes'
import { differenceWith, unionWith } from 'lodash'
import { useTranslation } from 'react-i18next'
import { IoMdPause, IoMdPlay } from 'react-icons/io'

let cachedConnections: IMihomoConnectionDetail[] = []

const Connections: React.FC = () => {
  const { t } = useTranslation()
  const [filter, setFilter] = useState('')
  const { appConfig, patchAppConfig } = useAppConfig()
  const { connectionDirection = 'asc', connectionOrderBy = 'time' } = appConfig || {}
  const [connectionsInfo, setConnectionsInfo] = useState<IMihomoConnectionsInfo>()
  const [allConnections, setAllConnections] = useState<IMihomoConnectionDetail[]>(cachedConnections)
  const [activeConnections, setActiveConnections] = useState<IMihomoConnectionDetail[]>([])
  const [closedConnections, setClosedConnections] = useState<IMihomoConnectionDetail[]>([])
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false)
  const [selected, setSelected] = useState<IMihomoConnectionDetail>()
  const [tab, setTab] = useState('active')
  const [isPaused, setIsPaused] = useState(false)

  const filteredConnections = useMemo(() => {
    const connections = tab === 'active' ? activeConnections : closedConnections
    if (connectionOrderBy) {
      connections.sort((a, b) => {
        if (connectionDirection === 'asc') {
          switch (connectionOrderBy) {
            case 'time':
              return dayjs(b.start).unix() - dayjs(a.start).unix()
            case 'upload':
              return a.upload - b.upload
            case 'download':
              return a.download - b.download
            case 'uploadSpeed':
              return (a.uploadSpeed || 0) - (b.uploadSpeed || 0)
            case 'downloadSpeed':
              return (a.downloadSpeed || 0) - (b.downloadSpeed || 0)
          }
        } else {
          switch (connectionOrderBy) {
            case 'time':
              return dayjs(a.start).unix() - dayjs(b.start).unix()
            case 'upload':
              return b.upload - a.upload
            case 'download':
              return b.download - a.download
            case 'uploadSpeed':
              return (b.uploadSpeed || 0) - (a.uploadSpeed || 0)
            case 'downloadSpeed':
              return (b.downloadSpeed || 0) - (a.downloadSpeed || 0)
          }
        }
      })
    }
    if (filter === '') return connections
    return connections?.filter((connection) => {
      const raw = JSON.stringify(connection)
      return includesIgnoreCase(raw, filter)
    })
  }, [activeConnections, closedConnections, filter, connectionDirection, connectionOrderBy])

  const closeAllConnections = (): void => {
    tab === 'active' ? mihomoCloseAllConnections() : trashAllClosedConnection()
  }

  const closeConnection = (id: string): void => {
    tab === 'active' ? mihomoCloseConnection(id) : trashClosedConnection(id)
  }

  const trashAllClosedConnection = (): void => {
    const trashIds = closedConnections.map((conn) => conn.id)
    setAllConnections((allConns) => allConns.filter((conn) => !trashIds.includes(conn.id)))
    setClosedConnections([])

    cachedConnections = allConnections
  }

  const trashClosedConnection = (id: string): void => {
    setAllConnections((allConns) => allConns.filter((conn) => conn.id != id))
    setClosedConnections((closedConns) => closedConns.filter((conn) => conn.id != id))

    cachedConnections = allConnections
  }

  useEffect(() => {
    if (isPaused) return
    window.electron.ipcRenderer.on('mihomoConnections', (_e, info: IMihomoConnectionsInfo) => {
      setConnectionsInfo(info)

      if (!info.connections) return
      const allConns = unionWith(activeConnections, allConnections, (a, b) => a.id === b.id)

      const activeConns = info.connections.map((conn) => {
        const preConn = activeConnections.find((c) => c.id === conn.id)
        const downloadSpeed = preConn ? conn.download - preConn.download : 0
        const uploadSpeed = preConn ? conn.upload - preConn.upload : 0
        return {
          ...conn,
          isActive: true,
          downloadSpeed: downloadSpeed,
          uploadSpeed: uploadSpeed
        }
      })
      const closedConns = differenceWith(allConns, activeConns, (a, b) => a.id === b.id).map(
        (conn) => {
          return {
            ...conn,
            isActive: false,
            downloadSpeed: 0,
            uploadSpeed: 0
          }
        }
      )

      setActiveConnections(activeConns)
      setClosedConnections(closedConns)
      setAllConnections(allConns.slice(-(activeConns.length + 200)))

      cachedConnections = allConnections
    })

    return (): void => {
      window.electron.ipcRenderer.removeAllListeners('mihomoConnections')
    }
  }, [allConnections, activeConnections, closedConnections, isPaused])
  const togglePause = () => {
    setIsPaused(!isPaused)
  }

  return (
    <BasePage
      title={t('connections.title')}
      header={
        <div className="flex">
          <div className="flex items-center">
            <span className="mx-1 text-gray-400">
              ↑ {calcTraffic(connectionsInfo?.uploadTotal ?? 0)}{' '}
            </span>
            <span className="mx-1 text-gray-400">
              ↓ {calcTraffic(connectionsInfo?.downloadTotal ?? 0)}{' '}
            </span>
          </div>
          <Badge
            className="mt-2"
            color="primary"
            variant="flat"
            showOutline={false}
            content={`${filteredConnections.length}`}
          >
            <Button
              className="app-nodrag ml-1"
              title={isPaused ? t('connections.resume') : t('connections.pause')}
              isIconOnly
              size="sm"
              variant="light"
              onPress={togglePause}
            >
              {isPaused ? <IoMdPlay className="text-lg" /> : <IoMdPause className="text-lg" />}
            </Button>
            <Button
              className="app-nodrag ml-1"
              title={t('connections.closeAll')}
              isIconOnly
              size="sm"
              variant="light"
              onPress={() => {
                if (filter === '') {
                  closeAllConnections()
                } else {
                  filteredConnections.forEach((conn) => {
                    closeConnection(conn.id)
                  })
                }
              }}
            >
              {tab === 'active' ? <CgClose className="text-lg" /> : <CgTrash className="text-lg" />}
            </Button>
          </Badge>
        </div>
      }
    >
      {isDetailModalOpen && selected && (
        <ConnectionDetailModal onClose={() => setIsDetailModalOpen(false)} connection={selected} />
      )}
      <div className="overflow-x-auto sticky top-0 z-40">
        <div className="flex p-2 gap-2">
          <Tabs
            size="sm"
            color={`${tab === 'active' ? 'primary' : 'danger'}`}
            selectedKey={tab}
            variant="underlined"
            className="w-fit h-[32px]"
            onSelectionChange={(key: Key) => {
              setTab(key as string)
            }}
          >
            <Tab
              key="active"
              title={
                <Badge
                  color={`${tab === 'active' ? 'primary' : 'default'}`}
                  size="sm"
                  shape="circle"
                  variant="flat"
                  content={activeConnections.length}
                  showOutline={false}
                >
                  <span className="p-1">{t('connections.active')}</span>
                </Badge>
              }
            />
            <Tab
              key="closed"
              title={
                <Badge
                  color={`${tab === 'closed' ? 'danger' : 'default'}`}
                  size="sm"
                  shape="circle"
                  variant="flat"
                  content={closedConnections.length}
                  showOutline={false}
                >
                  <span className="p-1">{t('connections.closed')}</span>
                </Badge>
              }
            />
          </Tabs>
          <Input
            variant="flat"
            size="sm"
            value={filter}
            placeholder={t('connections.filter')}
            isClearable
            onValueChange={setFilter}
          />

          <Select
            classNames={{ trigger: 'data-[hover=true]:bg-default-200' }}
            size="sm"
            className="w-[180px] min-w-[131px]"
            aria-label={t('connections.orderBy')}
            selectedKeys={new Set([connectionOrderBy])}
            disallowEmptySelection={true}
            onSelectionChange={async (v) => {
              await patchAppConfig({
                connectionOrderBy: v.currentKey as
                  | 'time'
                  | 'upload'
                  | 'download'
                  | 'uploadSpeed'
                  | 'downloadSpeed'
              })
            }}
          >
            <SelectItem key="time">{t('connections.time')}</SelectItem>
            <SelectItem key="upload">{t('connections.uploadAmount')}</SelectItem>
            <SelectItem key="download">{t('connections.downloadAmount')}</SelectItem>
            <SelectItem key="uploadSpeed">{t('connections.uploadSpeed')}</SelectItem>
            <SelectItem key="downloadSpeed">{t('connections.downloadSpeed')}</SelectItem>
          </Select>
          <Button
            size="sm"
            isIconOnly
            className="bg-content2"
            onPress={async () => {
              patchAppConfig({
                connectionDirection: connectionDirection === 'asc' ? 'desc' : 'asc'
              })
            }}
          >
            {connectionDirection === 'asc' ? (
              <HiSortAscending className="text-lg" />
            ) : (
              <HiSortDescending className="text-lg" />
            )}
          </Button>
        </div>
        <Divider />
      </div>
      <div className="h-[calc(100vh-100px)] mt-px">
        <Virtuoso
          data={filteredConnections}
          itemContent={(i, connection) => (
            <ConnectionItem
              setSelected={setSelected}
              setIsDetailModalOpen={setIsDetailModalOpen}
              selected={selected}
              close={closeConnection}
              index={i}
              key={connection.id}
              info={connection}
            />
          )}
        />
      </div>
    </BasePage>
  )
}

export default Connections
