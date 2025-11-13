import React, { useMemo, useRef, useState, useCallback } from 'react'
import { Button, Chip } from '@heroui/react'
import { calcTraffic } from '@renderer/utils/calc'
import dayjs from '@renderer/utils/dayjs'
import { useTranslation } from 'react-i18next'
import { CgClose, CgTrash } from 'react-icons/cg'

interface Props {
  connections: IMihomoConnectionDetail[]
  setSelected: React.Dispatch<React.SetStateAction<IMihomoConnectionDetail | undefined>>
  setIsDetailModalOpen: React.Dispatch<React.SetStateAction<boolean>>
  close: (id: string) => void
  visibleColumns: Set<string>
  onColumnWidthChange?: (widths: Record<string, number>) => void
  onSortChange?: (column: string | null, direction: 'asc' | 'desc') => void
  initialColumnWidths?: Record<string, number>
  initialSortColumn?: string
  initialSortDirection?: 'asc' | 'desc'
}

interface ColumnConfig {
  key: string
  label: string
  width: number
  minWidth: number
  visible: boolean
  getValue: (connection: IMihomoConnectionDetail) => string | number
  render?: (connection: IMihomoConnectionDetail) => React.ReactNode
  sortValue?: (connection: IMihomoConnectionDetail) => string | number
}

const DEFAULT_COLUMNS: Omit<ColumnConfig, 'label'>[] = [
  {
    key: 'status',
    width: 80,
    minWidth: 60,
    visible: true,
    getValue: (conn) => conn.isActive ? 'active' : 'closed',
    sortValue: (conn) => conn.isActive ? 1 : 0
  },
  {
    key: 'establishTime',
    width: 105,
    minWidth: 80,
    visible: true,
    getValue: (conn) => dayjs(conn.start).fromNow(),
    sortValue: (conn) => dayjs(conn.start).unix()
  },
  {
    key: 'type',
    width: 120,
    minWidth: 100,
    visible: true,
    getValue: (conn) => `${conn.metadata.type}(${conn.metadata.network})`,
    render: (conn) => (
      <span className="text-xs">{conn.metadata.type}({conn.metadata.network.toUpperCase()})</span>
    )
  },
  {
    key: 'host',
    width: 200,
    minWidth: 150,
    visible: true,
    getValue: (conn) => conn.metadata.host || '-'
  },
  {
    key: 'sniffHost',
    width: 200,
    minWidth: 150,
    visible: false,
    getValue: (conn) => conn.metadata.sniffHost || '-'
  },
  {
    key: 'process',
    width: 150,
    minWidth: 120,
    visible: true,
    getValue: (conn) =>
      conn.metadata.process
        ? `${conn.metadata.process}${conn.metadata.uid ? `(${conn.metadata.uid})` : ''}`
        : '-'
  },
  {
    key: 'processPath',
    width: 250,
    minWidth: 200,
    visible: false,
    getValue: (conn) => conn.metadata.processPath || '-'
  },
  {
    key: 'rule',
    width: 150,
    minWidth: 120,
    visible: true,
    getValue: (conn) => `${conn.rule}${conn.rulePayload ? `(${conn.rulePayload})` : ''}`
  },
  {
    key: 'proxyChain',
    width: 150,
    minWidth: 120,
    visible: true,
    getValue: (conn) => [...conn.chains].reverse().join('>>')
  },
  {
    key: 'sourceIP',
    width: 140,
    minWidth: 120,
    visible: false,
    getValue: (conn) => conn.metadata.sourceIP || '-'
  },
  {
    key: 'sourcePort',
    width: 100,
    minWidth: 80,
    visible: false,
    getValue: (conn) => conn.metadata.sourcePort || '-'
  },
  {
    key: 'destinationPort',
    width: 100,
    minWidth: 80,
    visible: true,
    getValue: (conn) => conn.metadata.destinationPort || '-'
  },
  {
    key: 'inboundIP',
    width: 140,
    minWidth: 120,
    visible: false,
    getValue: (conn) => conn.metadata.inboundIP || '-'
  },
  {
    key: 'inboundPort',
    width: 100,
    minWidth: 80,
    visible: false,
    getValue: (conn) => conn.metadata.inboundPort || '-'
  },
  {
    key: 'uploadSpeed',
    width: 110,
    minWidth: 90,
    visible: true,
    getValue: (conn) => `${calcTraffic(conn.uploadSpeed || 0)}/s`,
    sortValue: (conn) => conn.uploadSpeed || 0
  },
  {
    key: 'downloadSpeed',
    width: 110,
    minWidth: 90,
    visible: true,
    getValue: (conn) => `${calcTraffic(conn.downloadSpeed || 0)}/s`,
    sortValue: (conn) => conn.downloadSpeed || 0
  },
  {
    key: 'upload',
    width: 100,
    minWidth: 80,
    visible: true,
    getValue: (conn) => calcTraffic(conn.upload),
    sortValue: (conn) => conn.upload
  },
  {
    key: 'download',
    width: 100,
    minWidth: 80,
    visible: true,
    getValue: (conn) => calcTraffic(conn.download),
    sortValue: (conn) => conn.download
  },
  {
    key: 'dscp',
    width: 80,
    minWidth: 60,
    visible: false,
    getValue: (conn) => conn.metadata.dscp.toString()
  },
  {
    key: 'remoteDestination',
    width: 200,
    minWidth: 150,
    visible: false,
    getValue: (conn) => conn.metadata.remoteDestination || '-'
  },
  {
    key: 'dnsMode',
    width: 120,
    minWidth: 100,
    visible: false,
    getValue: (conn) => conn.metadata.dnsMode || '-'
  }
]

const ConnectionTable: React.FC<Props> = ({
  connections,
  setSelected,
  setIsDetailModalOpen,
  close,
  visibleColumns,
  onColumnWidthChange,
  onSortChange,
  initialColumnWidths,
  initialSortColumn,
  initialSortDirection
}) => {
  const { t } = useTranslation()
  const tableRef = useRef<HTMLDivElement>(null)
  const [resizingColumn, setResizingColumn] = useState<string | null>(null)
  const [sortColumn, setSortColumn] = useState<string | null>(initialSortColumn || null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(initialSortDirection || 'asc')

  // 状态列渲染函数
  const renderStatus = useCallback((conn: IMihomoConnectionDetail) => (
    <Chip
      color={conn.isActive ? 'primary' : 'danger'}
      size="sm"
      radius="sm"
      variant="dot"
    >
      {conn.isActive ? t('connections.active') : t('connections.closed')}
    </Chip>
  ), [t])

  // 连接类型渲染函数
  const renderType = useCallback((conn: IMihomoConnectionDetail) => (
    <span className="text-xs">{conn.metadata.type}({conn.metadata.network.toUpperCase()})</span>
  ), [])

  // 翻译标签映射
  const getLabelForColumn = useCallback((key: string): string => {
    const translationMap: Record<string, string> = {
      status: t('connections.detail.status'),
      establishTime: t('connections.detail.establishTime'),
      type: t('connections.detail.connectionType'),
      host: t('connections.detail.host'),
      sniffHost: t('connections.detail.sniffHost'),
      process: t('connections.detail.processName'),
      processPath: t('connections.detail.processPath'),
      rule: t('connections.detail.rule'),
      proxyChain: t('connections.detail.proxyChain'),
      sourceIP: t('connections.detail.sourceIP'),
      sourcePort: t('connections.detail.sourcePort'),
      destinationPort: t('connections.detail.destinationPort'),
      inboundIP: t('connections.detail.inboundIP'),
      inboundPort: t('connections.detail.inboundPort'),
      uploadSpeed: t('connections.uploadSpeed'),
      downloadSpeed: t('connections.downloadSpeed'),
      upload: t('connections.uploadAmount'),
      download: t('connections.downloadAmount'),
      dscp: t('connections.detail.dscp'),
      remoteDestination: t('connections.detail.remoteDestination'),
      dnsMode: t('connections.detail.dnsMode')
    }
    return translationMap[key] || key
  }, [t])

  // 初始化列配置（保留宽度状态）
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    const widths: Record<string, number> = {}
    DEFAULT_COLUMNS.forEach(col => {
      widths[col.key] = initialColumnWidths?.[col.key] || col.width
    })
    return widths
  })

  // 更新列标签和可见性
  const columnsWithLabels = useMemo(() =>
    DEFAULT_COLUMNS.map(col => ({
      ...col,
      label: getLabelForColumn(col.key),
      visible: visibleColumns.has(col.key),
      width: columnWidths[col.key] || col.width
    }))
  , [getLabelForColumn, visibleColumns, columnWidths])

  // 处理列宽度调整
  const handleMouseDown = useCallback((e: React.MouseEvent, columnKey: string) => {
    e.preventDefault()
    setResizingColumn(columnKey)

    const startX = e.clientX
    const column = DEFAULT_COLUMNS.find(c => c.key === columnKey)
    if (!column) return

    let currentWidth = column.width
    setColumnWidths(prev => {
      currentWidth = prev[columnKey] || column.width
      return prev
    })

    const handleMouseMove = (e: MouseEvent) => {
      const diff = e.clientX - startX
      const newWidth = Math.max(column.minWidth, currentWidth + diff)

      setColumnWidths(prev => ({
        ...prev,
        [columnKey]: newWidth
      }))
    }

    const handleMouseUp = () => {
      setResizingColumn(null)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      // 保存列宽度
      if (onColumnWidthChange) {
        setColumnWidths(currentWidths => {
          onColumnWidthChange(currentWidths)
          return currentWidths
        })
      }
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [onColumnWidthChange])

  // 处理排序
  const handleSort = useCallback((columnKey: string) => {
    let newDirection: 'asc' | 'desc' = 'asc'
    let newColumn = columnKey

    if (sortColumn === columnKey) {
      newDirection = sortDirection === 'asc' ? 'desc' : 'asc'
      setSortDirection(newDirection)
    } else {
      setSortColumn(columnKey)
      setSortDirection('asc')
    }

    // 保存排序状态
    if (onSortChange) {
      onSortChange(newColumn, newDirection)
    }
  }, [sortColumn, sortDirection, onSortChange])

  // 排序连接
  const sortedConnections = useMemo(() => {
    if (!sortColumn) return connections

    const column = columnsWithLabels.find(c => c.key === sortColumn)
    if (!column) return connections

    return [...connections].sort((a, b) => {
      const getSortValue = column.sortValue || column.getValue
      const aValue = getSortValue(a)
      const bValue = getSortValue(b)

      let comparison = 0
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        comparison = aValue.localeCompare(bValue)
      } else if (typeof aValue === 'number' && typeof bValue === 'number') {
        comparison = aValue - bValue
      }

      return sortDirection === 'asc' ? comparison : -comparison
    })
  }, [connections, sortColumn, sortDirection, columnsWithLabels])

  const visibleColumnsFiltered = columnsWithLabels.filter(col => col.visible)

  return (
    <div className="h-full flex flex-col">
      {/* 表格容器 */}
      <div ref={tableRef} className="flex-1 overflow-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10 bg-content2">
            <tr>
              {visibleColumnsFiltered.map(col => (
                <th
                  key={col.key}
                  className="relative border-b border-divider text-left text-xs font-semibold text-foreground-600 px-3 h-10"
                  style={{ width: col.width, minWidth: col.minWidth }}
                >
                  <div className="flex items-center justify-between gap-1">
                    <button
                      className="flex-1 text-left hover:text-foreground"
                      onClick={() => handleSort(col.key)}
                    >
                      {col.label}
                      {sortColumn === col.key && (
                        <span className="ml-1">
                          {sortDirection === 'asc' ? '↑' : '↓'}
                        </span>
                      )}
                    </button>
                    <div
                      className="absolute right-0 top-0 h-full w-2 cursor-col-resize flex items-center justify-center group"
                      onMouseDown={(e) => handleMouseDown(e, col.key)}
                    >
                      <div
                        className="w-px h-full bg-divider group-hover:bg-primary transition-colors"
                        style={{
                          backgroundColor: resizingColumn === col.key ? 'var(--primary)' : undefined
                        }}
                      />
                    </div>
                  </div>
                </th>
              ))}
              <th className="sticky right-0 border-b border-divider w-12 bg-content2" />
            </tr>
          </thead>
          <tbody>
            {sortedConnections.map((connection) => (
              <tr
                key={connection.id}
                className="border-b border-divider hover:bg-content2 cursor-pointer transition-colors h-12"
                onClick={() => {
                  setSelected(connection)
                  setIsDetailModalOpen(true)
                }}
              >
                {visibleColumnsFiltered.map(col => {
                  let content: React.ReactNode
                  // 根据列类型选择渲染方式
                  if (col.key === 'status') {
                    content = renderStatus(connection)
                  } else if (col.key === 'type') {
                    content = renderType(connection)
                  } else if (col.render) {
                    content = col.render(connection)
                  } else {
                    content = col.getValue(connection)
                  }

                  return (
                    <td
                      key={col.key}
                      className="px-3 text-sm text-foreground truncate"
                      style={{ maxWidth: col.width }}
                      title={typeof col.getValue(connection) === 'string' ? col.getValue(connection) as string : ''}
                    >
                      {content}
                    </td>
                  )
                })}
                <td className="sticky right-0 bg-inherit" onClick={(e) => e.stopPropagation()}>
                  <Button
                    color={connection.isActive ? 'warning' : 'danger'}
                    variant="light"
                    isIconOnly
                    size="sm"
                    onPress={() => {
                      close(connection.id)
                    }}
                  >
                    {connection.isActive ? <CgClose className="text-lg" /> : <CgTrash className="text-lg" />}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {sortedConnections.length === 0 && (
          <div className="flex items-center justify-center h-32 text-foreground-400">
            {t('connections.table.noData')}
          </div>
        )}
      </div>
    </div>
  )
}

export default ConnectionTable
