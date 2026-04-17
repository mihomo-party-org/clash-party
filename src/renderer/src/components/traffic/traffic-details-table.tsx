import { calcTraffic } from '@renderer/utils/calc'
import type { AggregatedData, DataUsageType } from '@renderer/utils/dataUsage'
import { Button, Input } from '@heroui/react'
import { IoChevronDown, IoChevronForward, IoSearch } from 'react-icons/io5'
import React, { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  selectedRow: string
  activeView: DataUsageType
  subStats: AggregatedData[]
  proxyStatsMap: Record<string, AggregatedData[]>
  selectedSubRow: string | null
  onSubRowClick: (parentLabel: string, subLabel: string) => void
}

type SortField = 'label' | 'upload' | 'download' | 'total'

const TrafficDetailsTable: React.FC<Props> = ({
  selectedRow,
  activeView,
  subStats,
  proxyStatsMap,
  selectedSubRow,
  onSubRowClick
}) => {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<SortField>('total')
  const [sortAsc, setSortAsc] = useState(false)
  const [page, setPage] = useState(0)
  const pageSize = 50

  const subColLabel = activeView === 'host' ? t('traffic.devices') : t('traffic.host')

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    const list = q ? subStats.filter((s) => s.label.toLowerCase().includes(q)) : [...subStats]
    return list.sort((a, b) => {
      const cmp = sortField === 'label' ? a.label.localeCompare(b.label) : a[sortField] - b[sortField]
      return sortAsc ? cmp : -cmp
    })
  }, [subStats, search, sortField, sortAsc])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, totalPages - 1)
  const paged = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize)

  const handleSort = (field: SortField): void => {
    if (field === sortField) setSortAsc((v) => !v)
    else { setSortField(field); setSortAsc(false) }
  }

  const SortIcon: React.FC<{ field: SortField }> = ({ field }) => (
    <span className={`ml-0.5 text-[10px] ${sortField === field ? 'text-primary' : 'opacity-30'}`}>
      {sortField === field ? (sortAsc ? '▲' : '▼') : '⇅'}
    </span>
  )

  return (
    <div className="flex h-[520px] flex-col overflow-hidden rounded-xl border border-foreground/10 bg-content1 shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-foreground/5 bg-content2/50 px-4 py-2.5">
        <span className="text-sm font-semibold text-foreground truncate max-w-[200px]" title={selectedRow}>
          {selectedRow}
        </span>
        <div className="flex-1" />
        <Input
          size="sm"
          className="w-52"
          placeholder={t('traffic.search')}
          value={search}
          onValueChange={(v) => { setSearch(v); setPage(0) }}
          startContent={<IoSearch className="text-foreground/40" size={14} />}
          isClearable
        />
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-content2/80">
            <tr>
              <th
                className="cursor-pointer px-4 py-2 text-left font-semibold text-foreground/60 uppercase tracking-wide hover:text-foreground"
                onClick={() => handleSort('label')}
              >
                {subColLabel}<SortIcon field="label" />
              </th>
              <th
                className="hidden cursor-pointer px-4 py-2 text-left font-semibold text-foreground/60 uppercase tracking-wide hover:text-foreground lg:table-cell"
                onClick={() => handleSort('upload')}
              >
                {t('traffic.upload')}<SortIcon field="upload" />
              </th>
              <th
                className="hidden cursor-pointer px-4 py-2 text-left font-semibold text-foreground/60 uppercase tracking-wide hover:text-foreground lg:table-cell"
                onClick={() => handleSort('download')}
              >
                {t('traffic.download')}<SortIcon field="download" />
              </th>
              <th
                className="cursor-pointer px-4 py-2 text-right font-semibold text-foreground/60 uppercase tracking-wide hover:text-foreground lg:text-left"
                onClick={() => handleSort('total')}
              >
                {t('traffic.total')}<SortIcon field="total" />
              </th>
            </tr>
          </thead>
          <tbody>
            {paged.map((sub, idx) => {
              const compositeKey = `${selectedRow}:${sub.label}`
              const isExpanded = selectedSubRow === compositeKey
              return (
                <React.Fragment key={sub.label}>
                  <tr
                    className={`cursor-pointer border-b border-foreground/5 transition-colors hover:bg-foreground/5 ${isExpanded ? 'bg-primary/10' : idx % 2 === 1 ? 'bg-foreground/[0.02]' : ''}`}
                    onClick={() => onSubRowClick(selectedRow, sub.label)}
                  >
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1.5 font-mono">
                        {isExpanded
                          ? <IoChevronDown size={12} className="shrink-0 text-foreground/40" />
                          : <IoChevronForward size={12} className="shrink-0 text-foreground/40" />}
                        <span className="truncate max-w-[200px]" title={sub.label}>{sub.label}</span>
                      </div>
                      <div className="mt-0.5 flex gap-3 pl-5 text-[10px] text-foreground/40 lg:hidden">
                        <span>↑ {calcTraffic(sub.upload)}</span>
                        <span>↓ {calcTraffic(sub.download)}</span>
                      </div>
                    </td>
                    <td className="hidden px-4 py-2 text-foreground/70 lg:table-cell">{calcTraffic(sub.upload)}</td>
                    <td className="hidden px-4 py-2 text-foreground/70 lg:table-cell">{calcTraffic(sub.download)}</td>
                    <td className="px-4 py-2 text-right font-bold text-primary lg:text-left">{calcTraffic(sub.total)}</td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={4} className="px-4 pb-3 pt-1">
                        {(proxyStatsMap[compositeKey] ?? []).length === 0 ? (
                          <div className="py-3 text-center text-xs text-foreground/40">—</div>
                        ) : (
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                            {(proxyStatsMap[compositeKey] ?? []).map((item) => (
                              <div
                                key={item.label}
                                className="flex flex-col gap-1 rounded-lg border border-foreground/10 bg-content2/50 p-2.5 text-[10px]"
                              >
                                <span className="truncate font-mono font-bold text-secondary text-[10px]" title={item.label}>
                                  {item.label}
                                </span>
                                <div className="flex items-center justify-between border-b border-foreground/5 pb-1">
                                  <span className="text-foreground/40">×{item.count}</span>
                                  <span className="font-black text-primary">{calcTraffic(item.total)}</span>
                                </div>
                                <div className="flex justify-between text-foreground/50">
                                  <span>↑ {calcTraffic(item.upload)}</span>
                                  <span>↓ {calcTraffic(item.download)}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
        {paged.length === 0 && (
          <div className="flex items-center justify-center py-12 text-sm text-foreground/40 italic">
            {t('traffic.noData')}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex shrink-0 items-center justify-between border-t border-foreground/10 bg-content2/50 px-4 py-2">
        <span className="text-xs text-foreground/50">
          {filtered.length > 0
            ? `${safePage * pageSize + 1}–${Math.min((safePage + 1) * pageSize, filtered.length)} / ${filtered.length}`
            : '0 / 0'}
        </span>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="light"
            isDisabled={safePage === 0}
            onPress={() => setPage((p) => Math.max(0, p - 1))}
            className="min-w-0 px-2"
          >
            ‹
          </Button>
          {Array.from({ length: totalPages }, (_, i) => i)
            .filter((i) => i === 0 || i === totalPages - 1 || Math.abs(i - safePage) <= 1)
            .map((i, arrIdx, arr) => (
              <React.Fragment key={i}>
                {arrIdx > 0 && arr[arrIdx - 1] !== i - 1 && (
                  <span className="text-xs text-foreground/30">…</span>
                )}
                <Button
                  size="sm"
                  variant={safePage === i ? 'solid' : 'light'}
                  color={safePage === i ? 'primary' : 'default'}
                  onPress={() => setPage(i)}
                  className="min-w-0 px-2"
                >
                  {i + 1}
                </Button>
              </React.Fragment>
            ))}
          <Button
            size="sm"
            variant="light"
            isDisabled={safePage >= totalPages - 1}
            onPress={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            className="min-w-0 px-2"
          >
            ›
          </Button>
        </div>
      </div>
    </div>
  )
}

export default TrafficDetailsTable
