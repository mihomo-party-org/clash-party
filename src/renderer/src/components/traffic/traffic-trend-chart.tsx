import { calcTraffic } from '@renderer/utils/calc'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
  type ChartOptions,
  type ScriptableContext
} from 'chart.js'
import dayjs from '@renderer/utils/dayjs'
import React, { useMemo } from 'react'
import { Line } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend)

interface TrendPoint {
  timestamp: number
  upload: number
  download: number
}

interface Props {
  data: TrendPoint[]
  bucketSizeMs: number
}

const TrafficTrendChart: React.FC<Props> = ({ data, bucketSizeMs }) => {
  const labels = useMemo(
    () =>
      data.map((d) => {
        if (bucketSizeMs >= 86400000) return dayjs(d.timestamp).format('MM-DD')
        if (bucketSizeMs >= 3600000) return dayjs(d.timestamp).format('MM-DD HH:mm')
        return dayjs(d.timestamp).format('HH:mm')
      }),
    [data, bucketSizeMs]
  )

  const chartData = useMemo(
    () => ({
      labels,
      datasets: [
        {
          label: '↑',
          data: data.map((d) => d.upload),
          fill: true,
          backgroundColor: (ctx: ScriptableContext<'line'>) => {
            const { ctx: c, chartArea } = ctx.chart
            if (!chartArea) return 'transparent'
            const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom)
            g.addColorStop(0, 'rgba(34,197,94,0.4)')
            g.addColorStop(1, 'rgba(34,197,94,0)')
            return g
          },
          borderColor: 'rgba(34,197,94,0.8)',
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.4
        },
        {
          label: '↓',
          data: data.map((d) => d.download),
          fill: true,
          backgroundColor: (ctx: ScriptableContext<'line'>) => {
            const { ctx: c, chartArea } = ctx.chart
            if (!chartArea) return 'transparent'
            const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom)
            g.addColorStop(0, 'rgba(59,130,246,0.4)')
            g.addColorStop(1, 'rgba(59,130,246,0)')
            return g
          },
          borderColor: 'rgba(59,130,246,0.8)',
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.4
        }
      ]
    }),
    [data, labels]
  )

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: true,
        position: 'top',
        labels: { boxWidth: 12, font: { size: 11 } }
      },
      tooltip: {
        callbacks: {
          label: (ctx) => ` ${ctx.dataset.label} ${calcTraffic(ctx.parsed.y)}`
        }
      }
    },
    scales: {
      x: {
        ticks: {
          maxTicksLimit: 8,
          maxRotation: 0,
          font: { size: 10 }
        },
        grid: { display: false }
      },
      y: {
        ticks: {
          callback: (v) => calcTraffic(Number(v)),
          font: { size: 10 }
        },
        grid: { color: 'rgba(128,128,128,0.1)' },
        min: 0
      }
    },
    animation: { duration: 0 }
  }

  if (data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-foreground/40">—</div>
    )
  }

  return <Line data={chartData} options={options} />
}

export default TrafficTrendChart
