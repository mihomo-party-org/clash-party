import BasePage from '@renderer/components/base/base-page'
import { mihomoCloseAllConnections, mihomoCloseConnection } from '@renderer/utils/ipc'
import { Key, useCallback, useEffect, useMemo, useState } from 'react'
import { Badge, Button, Divider, Input, Select, SelectItem, Tab, Tabs } from '@heroui/react'
import { calcTraffic } from '@renderer/utils/calc'
import ConnectionItem from '@renderer/components/connections/connection-item'
import ConnectionTable from '@renderer/components/connections/connection-table'
import { Virtuoso } from 'react-virtuoso'
import dayjs from '@renderer/utils/dayjs'
import ConnectionDetailModal from '@renderer/components/connections/connection-detail-modal'
import { CgClose, CgTrash } from 'react-icons/cg'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { HiSortAscending, HiSortDescending } from 'react-icons/hi'
import { MdViewList, MdTableChart } from 'react-icons/md'
import { HiOutlineAdjustmentsHorizontal } from 'react-icons/hi2'
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from '@heroui/react'
import { includesIgnoreCase } from '@renderer/utils/includes'
import { differenceWith, unionWith } from 'lodash'
import { useTranslation } from 'react-i18next'
import { IoMdPause, IoMdPlay } from 'react-icons/io'

let cachedConnections: IMihomoConnectionDetail[] = []

const Connections: React.FC = () => {
  const { t } = useTranslation()
  const [filter, setFilter] = useState('')
  const { appConfig, patchAppConfig } = useAppConfig()
  const {
    connectionDirection = 'asc',
    connectionOrderBy = 'time',
    connectionViewMode = 'list',
    connectionTableColumns = [
      'status', 'establishTime', 'type', 'host', 'process', 'rule',
      'proxyChain', 'remoteDestination', 'uploadSpeed', 'downloadSpeed', 'upload', 'download'
    ],
    connectionTableColumnWidths,
    connectionTableSortColumn,
    connectionTableSortDirection
  } = appConfig || {}
  const [connectionsInfo, setConnectionsInfo] = useState<IMihomoConnectionsInfo>()
  const [allConnections, setAllConnections] = useState<IMihomoConnectionDetail[]>(cachedConnections)
  const [activeConnections, setActiveConnections] = useState<IMihomoConnectionDetail[]>([])
  const [closedConnections, setClosedConnections] = useState<IMihomoConnectionDetail[]>([])
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false)
  const [selected, setSelected] = useState<IMihomoConnectionDetail>()
  const [tab, setTab] = useState('active')
  const [isPaused, setIsPaused] = useState(false)
  const [viewMode, setViewMode] = useState<'list' | 'table'>(connectionViewMode)
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set(connectionTableColumns))

  const handleColumnWidthChange = useCallback(async (widths: Record<string, number>) => {
    await patchAppConfig({ connectionTableColumnWidths: widths })
  }, [patchAppConfig])

  const handleSortChange = useCallback(async (column: string | null, direction: 'asc' | 'desc') => {
    await patchAppConfig({
      connectionTableSortColumn: column || undefined,
      connectionTableSortDirection: direction
    })
  }, [patchAppConfig])

  const filteredConnections = useMemo(() => {
    const connections = tab === 'active' ? activeConnections : closedConnections

    const filtered = filter === ''
      ? connections
      : connections.filter((connection) => {
          const raw = JSON.stringify(connection)
          return includesIgnoreCase(raw, filter)
        })

    if (viewMode === 'list' && connectionOrderBy) {
      return [...filtered].sort((a, b) => {
        let comparison = 0
        switch (connectionOrderBy) {
          case 'time':
            comparison = dayjs(a.start).unix() - dayjs(b.start).unix()
            break
          case 'upload':
            comparison = a.upload - b.upload
            break
          case 'download':
            comparison = a.download - b.download
            break
          case 'uploadSpeed':
            comparison = (a.uploadSpeed || 0) - (b.uploadSpeed || 0)
            break
          case 'downloadSpeed':
            comparison = (a.downloadSpeed || 0) - (b.downloadSpeed || 0)
            break
        }
        return connectionDirection === 'asc' ? comparison : -comparison
      })
    }

    return filtered
  }, [activeConnections, closedConnections, tab, filter, connectionDirection, connectionOrderBy, viewMode])

  const closeAllConnections = useCallback((): void => {
    tab === 'active' ? mihomoCloseAllConnections() : trashAllClosedConnection()
  }, [tab, closedConnections])

  const closeConnection = useCallback((id: string): void => {
    tab === 'active' ? mihomoCloseConnection(id) : trashClosedConnection(id)
  }, [tab])

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
              title={viewMode === 'list' ? t('connections.table.switchToTable') : t('connections.table.switchToList')}
              isIconOnly
              size="sm"
              variant="light"
              onPress={async () => {
                const newMode = viewMode === 'list' ? 'table' : 'list'
                setViewMode(newMode)
                await patchAppConfig({ connectionViewMode: newMode })
              }}
            >
              {viewMode === 'list' ? <MdTableChart className="text-lg" /> : <MdViewList className="text-lg" />}
            </Button>
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

          {viewMode === 'table' && (
            <Dropdown>
              <DropdownTrigger>
                <Button
                  size="sm"
                  variant="flat"
                  startContent={<HiOutlineAdjustmentsHorizontal className="text-2xl" />}
                >
                  {t('connections.table.columns')}
                </Button>
              </DropdownTrigger>
              <DropdownMenu
                aria-label="Column visibility"
                closeOnSelect={false}
                selectionMode="multiple"
                selectedKeys={visibleColumns}
                onSelectionChange={async (keys) => {
                  const newColumns = Array.from(keys) as string[]
                  setVisibleColumns(new Set(newColumns))
                  await patchAppConfig({ connectionTableColumns: newColumns })
                }}
              >
                <DropdownItem key="status">{t('connections.detail.status')}</DropdownItem>
                <DropdownItem key="establishTime">{t('connections.detail.establishTime')}</DropdownItem>
                <DropdownItem key="type">{t('connections.detail.connectionType')}</DropdownItem>
                <DropdownItem key="host">{t('connections.detail.host')}</DropdownItem>
                <DropdownItem key="sniffHost">{t('connections.detail.sniffHost')}</DropdownItem>
                <DropdownItem key="process">{t('connections.detail.processName')}</DropdownItem>
                <DropdownItem key="processPath">{t('connections.detail.processPath')}</DropdownItem>
                <DropdownItem key="rule">{t('connections.detail.rule')}</DropdownItem>
                <DropdownItem key="proxyChain">{t('connections.detail.proxyChain')}</DropdownItem>
                <DropdownItem key="sourceIP">{t('connections.detail.sourceIP')}</DropdownItem>
                <DropdownItem key="sourcePort">{t('connections.detail.sourcePort')}</DropdownItem>
                <DropdownItem key="destinationPort">{t('connections.detail.destinationPort')}</DropdownItem>
                <DropdownItem key="inboundIP">{t('connections.detail.inboundIP')}</DropdownItem>
                <DropdownItem key="inboundPort">{t('connections.detail.inboundPort')}</DropdownItem>
                <DropdownItem key="uploadSpeed">{t('connections.uploadSpeed')}</DropdownItem>
                <DropdownItem key="downloadSpeed">{t('connections.downloadSpeed')}</DropdownItem>
                <DropdownItem key="upload">{t('connections.uploadAmount')}</DropdownItem>
                <DropdownItem key="download">{t('connections.downloadAmount')}</DropdownItem>
                <DropdownItem key="dscp">{t('connections.detail.dscp')}</DropdownItem>
                <DropdownItem key="remoteDestination">{t('connections.detail.remoteDestination')}</DropdownItem>
                <DropdownItem key="dnsMode">{t('connections.detail.dnsMode')}</DropdownItem>
              </DropdownMenu>
            </Dropdown>
          )}

          {viewMode === 'list' && (
            <>
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
            </>
          )}
        </div>
        <Divider />
      </div>
      <div className="h-[calc(100vh-100px)] mt-px">
        {viewMode === 'list' ? (
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
        ) : (
          <ConnectionTable
            connections={filteredConnections}
            setSelected={setSelected}
            setIsDetailModalOpen={setIsDetailModalOpen}
            close={closeConnection}
            visibleColumns={visibleColumns}
            initialColumnWidths={connectionTableColumnWidths}
            initialSortColumn={connectionTableSortColumn}
            initialSortDirection={connectionTableSortDirection}
            onColumnWidthChange={handleColumnWidthChange}
            onSortChange={handleSortChange}
          />
        )}
      </div>
    </BasePage>
  )
}

export default Connections
