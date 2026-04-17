import { calcTraffic } from '@renderer/utils/calc'
import type { AggregatedData } from '@renderer/utils/dataUsage'
import React from 'react'

interface Props {
  title: string
  data: AggregatedData[]
  selectedRow: string | null
  onSelect: (label: string) => void
}

const TrafficRankings: React.FC<Props> = ({ title, data, selectedRow, onSelect }) => {
  return (
    <div className="flex h-full w-full flex-col">
      <h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3>
      <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar">
        {data.length === 0 ? (
          <div className="py-8 text-center text-sm text-foreground/50">—</div>
        ) : (
          data.map((row) => (
            <div
              key={row.label}
              onClick={() => onSelect(row.label)}
              className={`mb-1.5 flex cursor-pointer flex-col gap-0.5 rounded-lg p-2 transition-colors hover:bg-foreground/5 ${
                selectedRow === row.label ? 'bg-primary/10' : ''
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`min-w-0 flex-1 truncate font-mono text-xs font-medium ${
                    selectedRow === row.label ? 'text-primary' : 'text-foreground'
                  }`}
                >
                  {row.label}
                </span>
                <span
                  className={`shrink-0 text-xs font-bold ${
                    selectedRow === row.label ? 'text-primary' : 'text-foreground/80'
                  }`}
                >
                  {calcTraffic(row.total)}
                </span>
              </div>
              <div className="flex items-center gap-3 text-[10px] font-bold text-foreground/50">
                <span>↑ {calcTraffic(row.upload)}</span>
                <span>↓ {calcTraffic(row.download)}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default TrafficRankings
