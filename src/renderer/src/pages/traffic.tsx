import BasePage from '@renderer/components/base/base-page'
import TrafficRankings from '@renderer/components/traffic/traffic-rankings'
import TrafficTrendChart from '@renderer/components/traffic/traffic-trend-chart'
import TrafficDetailsTable from '@renderer/components/traffic/traffic-details-table'
import {
  getAggregatedData,
  getSubStatsByHost,
  getDevicesByHost,
  getProxyStatsByHost,
  getTrafficTrend,
  type AggregatedData,
  type DataUsageType
} from '@renderer/utils/dataUsage'
import { db } from '@renderer/utils/db'
import { Button, Tab, Tabs } from '@heroui/react'
import dayjs from '@renderer/utils/dayjs'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { calcTraffic } from '@renderer/utils/calc'
import { CgTrash } from 'react-icons/cg'

type TimeRange = '1h' | '24h' | '7d' | '30d'

const TIME_RANGES: TimeRange[] = ['1h', '24h', '7d', '30d']

function getTimeRange(range: TimeRange): { start: number; end: number; bucketSizeMs: number } {
  const end = Date.now()
  const ms: Record<TimeRange, number> = {
    '1h': 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000
  }
  const bucket: Record<TimeRange, number> = {
    '1h': 5 * 60 * 1000,
    '24h': 60 * 60 * 1000,
    '7d': 6 * 60 * 60 * 1000,
    '30d': 24 * 60 * 60 * 1000
  }
  return { start: end - ms[range], end, bucketSizeMs: bucket[range] }
}

const TrafficPage: React.FC = () => {
  const { t } = useTranslation()
  const [activeView, setActiveView] = useState<DataUsageType>('host')
  const [timeRange, setTimeRange] = useState<TimeRange>('24h')
  const [rankings, setRankings] = useState<AggregatedData[]>([])
  const [trendData, setTrendData] = useState<{ timestamp: number; upload: number; download: number }[]>([])
  const [selectedRow, setSelectedRow] = useState<string | null>(null)
  const [subStats, setSubStats] = useState<AggregatedData[]>([])
  const [proxyStatsMap, setProxyStatsMap] = useState<Record<string, AggregatedData[]>>({})
  const [selectedSubRow, setSelectedSubRow] = useState<string | null>(null)
  const [totalStats, setTotalStats] = useState({ upload: 0, download: 0, total: 0, count: 0 })
  const [bucketSizeMs, setBucketSizeMs] = useState(60 * 60 * 1000)

  const load = useCallback(async () => {
    const { start, end, bucketSizeMs: bms } = getTimeRange(timeRange)
    setBucketSizeMs(bms)

    const [agg, trend] = await Promise.all([
      getAggregatedData(activeView, start, end),
      getTrafficTrend(start, end, bms)
    ])

    setRankings(agg)
    setTrendData(trend)
    setTotalStats(
      agg.reduce(
        (acc, r) => ({
          upload: acc.upload + r.upload,
          download: acc.download + r.download,
          total: acc.total + r.total,
          count: acc.count + r.count
        }),
        { upload: 0, download: 0, total: 0, count: 0 }
      )
    )

    setSelectedRow(null)
    setSubStats([])
    setProxyStatsMap({})
    setSelectedSubRow(null)
  }, [activeView, timeRange])

  useEffect(() => {
    load()
  }, [load])

  const handleSelectRow = useCallback(
    async (label: string) => {
      if (selectedRow === label) {
        setSelectedRow(null)
        setSubStats([])
        setProxyStatsMap({})
        setSelectedSubRow(null)
        return
      }
      setSelectedRow(label)
      setSelectedSubRow(null)
      setProxyStatsMap({})

      const { start, end } = getTimeRange(timeRange)
      let subs: AggregatedData[]
      if (activeView === 'host') {
        subs = await getDevicesByHost(label, start, end)
      } else {
        subs = await getSubStatsByHost(activeView, label, start, end)
      }
      setSubStats(subs)
    },
    [selectedRow, activeView, timeRange]
  )

  const handleSubRowClick = useCallback(
    async (parentLabel: string, subLabel: string) => {
      const compositeKey = `${parentLabel}:${subLabel}`
      if (selectedSubRow === compositeKey) {
        setSelectedSubRow(null)
        return
      }
      setSelectedSubRow(compositeKey)

      if (proxyStatsMap[compositeKey]) return
      const { start, end } = getTimeRange(timeRange)
      const proxies = await getProxyStatsByHost(activeView, parentLabel, subLabel, start, end)
      setProxyStatsMap((prev) => ({ ...prev, [compositeKey]: proxies }))
    },
    [selectedSubRow, proxyStatsMap, activeView, timeRange]
  )

  const handleClearAll = useCallback(async () => {
    await db.clearAll()
    await load()
  }, [load])

  const timeRangeLabel: Record<TimeRange, string> = {
    '1h': t('traffic.timeRange.1h'),
    '24h': t('traffic.timeRange.24h'),
    '7d': t('traffic.timeRange.7d'),
    '30d': t('traffic.timeRange.30d')
  }

  const viewLabels: Record<DataUsageType, string> = {
    sourceIP: t('traffic.view.sourceIP'),
    host: t('traffic.view.host'),
    outbound: t('traffic.view.outbound'),
    process: t('traffic.view.process')
  }

  return (
    <BasePage
      title={t('sider.cards.traffic')}
      header={
        <div className="app-nodrag flex items-center gap-2">
          <Tabs
            size="sm"
            selectedKey={timeRange}
            onSelectionChange={(k) => setTimeRange(k as TimeRange)}
          >
            {TIME_RANGES.map((r) => (
              <Tab key={r} title={timeRangeLabel[r]} />
            ))}
          </Tabs>
          <Button
            size="sm"
            variant="light"
            color="danger"
            isIconOnly
            title={t('traffic.clearAll')}
            onPress={handleClearAll}
          >
            <CgTrash className="text-[16px]" />
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 p-2">
        {/* Summary stats */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: t('traffic.sessions'), value: totalStats.count.toString() },
            { label: t('traffic.upload'), value: calcTraffic(totalStats.upload) },
            { label: t('traffic.download'), value: calcTraffic(totalStats.download) },
            { label: t('traffic.total'), value: calcTraffic(totalStats.total) }
          ].map(({ label, value }) => (
            <div
              key={label}
              className="flex flex-col items-center rounded-xl border border-foreground/10 bg-content1 py-3 shadow-sm"
            >
              <span className="text-[11px] text-foreground/50 uppercase tracking-wide">{label}</span>
              <span className="mt-0.5 text-sm font-bold text-foreground">{value}</span>
            </div>
          ))}
        </div>

        {/* View tabs */}
        <Tabs
          size="sm"
          selectedKey={activeView}
          onSelectionChange={(k) => setActiveView(k as DataUsageType)}
        >
          {(Object.keys(viewLabels) as DataUsageType[]).map((v) => (
            <Tab key={v} title={viewLabels[v]} />
          ))}
        </Tabs>

        {/* Rankings + Chart */}
        <div className="grid grid-cols-4 gap-3">
          <div className="col-span-1 h-52 overflow-hidden rounded-xl border border-foreground/10 bg-content1 p-3 shadow-sm">
            <TrafficRankings
              title={viewLabels[activeView]}
              data={rankings}
              selectedRow={selectedRow}
              onSelect={handleSelectRow}
            />
          </div>
          <div className="col-span-3 h-52 overflow-hidden rounded-xl border border-foreground/10 bg-content1 p-3 shadow-sm">
            <TrafficTrendChart data={trendData} bucketSizeMs={bucketSizeMs} />
          </div>
        </div>

        {/* Detail table */}
        {selectedRow && (
          <TrafficDetailsTable
            selectedRow={selectedRow}
            activeView={activeView}
            subStats={subStats}
            proxyStatsMap={proxyStatsMap}
            selectedSubRow={selectedSubRow}
            onSubRowClick={handleSubRowClick}
          />
        )}
      </div>
    </BasePage>
  )
}

export default TrafficPage
