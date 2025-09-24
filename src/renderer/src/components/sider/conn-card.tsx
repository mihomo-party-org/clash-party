import { Button, Card, CardBody, CardFooter, Tooltip } from '@heroui/react'
import { FaCircleArrowDown, FaCircleArrowUp } from 'react-icons/fa6'
import { useLocation, useNavigate } from 'react-router-dom'
import { calcTraffic } from '@renderer/utils/calc'
import React, { useEffect, useState, useMemo } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { IoLink } from 'react-icons/io5'

import { useAppConfig } from '@renderer/hooks/use-app-config'
import { platform } from '@renderer/utils/init'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  ChartOptions,
  ScriptableContext
} from 'chart.js'
import { useTranslation } from 'react-i18next'

// 注册 Chart.js 组件
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler)

let currentUpload: number | undefined = undefined
let currentDownload: number | undefined = undefined
let hasShowTraffic = false
let drawing = false

interface Props {
  iconOnly?: boolean
}
const ConnCard: React.FC<Props> = (props) => {
  const { iconOnly } = props
  const { appConfig } = useAppConfig()
  const { showTraffic = false, connectionCardStatus = 'col-span-2', disableAnimations = false } = appConfig || {}
  const location = useLocation()
  const navigate = useNavigate()
  const match = location.pathname.includes('/connections')
  const { t } = useTranslation()

  const [upload, setUpload] = useState(0)
  const [download, setDownload] = useState(0)
  const {
    attributes,
    listeners,
    setNodeRef,
    transform: tf,
    transition,
    isDragging
  } = useSortable({
    id: 'connection'
  })
  const [series, setSeries] = useState(Array(10).fill(0))

  // Chart.js 配置
  const chartData = useMemo(() => {
    return {
      labels: Array(10).fill(''),
      datasets: [
        {
          data: series,
          fill: true,
          backgroundColor: (context: ScriptableContext<'line'>) => {
            const chart = context.chart
            const { ctx, chartArea } = chart
            if (!chartArea) {
              return 'transparent'
            }

            const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom)

            // 颜色处理
            const isMatch = location.pathname.includes('/connections')
            const baseColor = isMatch ? '6, 182, 212' : '161, 161, 170' // primary vs foreground 的近似 RGB 值

            gradient.addColorStop(0, `rgba(${baseColor}, 0.8)`)
            gradient.addColorStop(1, `rgba(${baseColor}, 0)`)
            return gradient
          },
          borderColor: 'transparent',
          pointRadius: 0,
          pointHoverRadius: 0,
          tension: 0.4
        }
      ]
    }
  }, [series, location.pathname])

  const chartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false
      }
    },
    scales: {
      x: {
        display: false
      },
      y: {
        display: false
      }
    },
    elements: {
      line: {
        borderWidth: 0
      }
    },
    interaction: {
      intersect: false
    },
    animation: {
      duration: 0
    }
  }

  const transform = tf ? { x: tf.x, y: tf.y, scaleX: 1, scaleY: 1 } : null
  useEffect(() => {
    window.electron.ipcRenderer.on('mihomoTraffic', async (_e, info: IMihomoTrafficInfo) => {
      setUpload(info.up)
      setDownload(info.down)
      const data = series
      data.shift()
      data.push(info.up + info.down)
      setSeries([...data])
      if (platform === 'darwin' && showTraffic) {
        if (drawing) return
        drawing = true
        try {
          await drawSvg(info.up, info.down)
          hasShowTraffic = true
        } catch {
          // ignore
        } finally {
          drawing = false
        }
      } else {
        if (!hasShowTraffic) return
        window.electron.ipcRenderer.send('trayIconUpdate', trayIconBase64)
        hasShowTraffic = false
      }
    })
    return (): void => {
      window.electron.ipcRenderer.removeAllListeners('mihomoTraffic')
    }
  }, [showTraffic])

  if (iconOnly) {
    return (
      <div className={`${connectionCardStatus} flex justify-center`}>
        <Tooltip content={t('sider.cards.connections')} placement="right">
          <Button
            size="sm"
            isIconOnly
            color={match ? 'primary' : 'default'}
            variant={match ? 'solid' : 'light'}
            onPress={() => {
              navigate('/connections')
            }}
          >
            <IoLink className="text-[20px]" />
          </Button>
        </Tooltip>
      </div>
    )
  }

  return (
    <div
      style={{
        position: 'relative',
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 'calc(infinity)' : undefined
      }}
      className={`${connectionCardStatus} conn-card`}
    >
      {connectionCardStatus === 'col-span-2' ? (
        <>
          <Card
            fullWidth
            ref={setNodeRef}
            {...attributes}
            {...listeners}
            className={`${match ? 'bg-primary' : 'hover:bg-primary/30'} ${isDragging ? `${disableAnimations ? '' : 'scale-[0.95] tap-highlight-transparent'}` : ''}`}
          >
            <CardBody className="pb-1 pt-0 px-0">
              <div className="flex justify-between">
                <Button
                  isIconOnly
                  className="bg-transparent pointer-events-none"
                  variant="flat"
                  color="default"
                >
                  <IoLink
                    color="default"
                    className={`${match ? 'text-primary-foreground' : 'text-foreground'} text-[24px]`}
                  />
                </Button>
                <div
                  className={`p-2 w-full ${match ? 'text-primary-foreground' : 'text-foreground'} `}
                >
                  <div className="flex justify-between">
                    <div className="w-full text-right mr-2">{calcTraffic(upload)}/s</div>
                    <FaCircleArrowUp className="h-[24px] leading-[24px]" />
                  </div>
                  <div className="flex justify-between">
                    <div className="w-full text-right mr-2">{calcTraffic(download)}/s</div>
                    <FaCircleArrowDown className="h-[24px] leading-[24px]" />
                  </div>
                </div>
              </div>
            </CardBody>
            <CardFooter className="pt-1">
              <h3
                className={`text-md font-bold sider-card-title ${match ? 'text-primary-foreground' : 'text-foreground'}`}
              >
                {t('sider.cards.connections')}
              </h3>
            </CardFooter>
          </Card>
          <div className="w-full h-full absolute top-0 left-0 pointer-events-none overflow-hidden rounded-[14px]">
            <Line data={chartData} options={chartOptions} />
          </div>
        </>
      ) : (
        <Card
          fullWidth
          ref={setNodeRef}
          {...attributes}
          {...listeners}
          className={`${match ? 'bg-primary' : 'hover:bg-primary/30'} ${isDragging ? `${disableAnimations ? '' : 'scale-[0.95] tap-highlight-transparent'}` : ''}`}
        >
          <CardBody className="pb-1 pt-0 px-0">
            <div className="flex justify-between">
              <Button
                isIconOnly
                className="bg-transparent pointer-events-none"
                variant="flat"
                color="default"
              >
                <IoLink
                  color="default"
                  className={`${match ? 'text-primary-foreground' : 'text-foreground'} text-[24px] font-bold`}
                />
              </Button>
            </div>
          </CardBody>
          <CardFooter className="pt-1">
            <h3
              className={`text-md font-bold ${match ? 'text-primary-foreground' : 'text-foreground'}`}
            >
              {t('sider.cards.connections')}
            </h3>
          </CardFooter>
        </Card>
      )}
    </div>
  )
}

export default ConnCard

const drawSvg = async (upload: number, download: number): Promise<void> => {
  if (upload === currentUpload && download === currentDownload) return
  currentUpload = upload
  currentDownload = download
  const svg = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 36"><image height="36" width="36" href="${trayIconBase64}"/><text x="140" y="15" font-size="18" font-family="PingFang SC" font-weight="bold" text-anchor="end">${calcTraffic(upload)}/s</text><text x="140" y="34" font-size="18" font-family="PingFang SC" font-weight="bold" text-anchor="end">${calcTraffic(download)}/s</text></svg>`
  const image = await loadImage(svg)
  window.electron.ipcRenderer.send('trayIconUpdate', image)
}

const loadImage = (url: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = (): void => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      canvas.width = 156
      canvas.height = 36
      ctx?.drawImage(img, 0, 0)
      const png = canvas.toDataURL('image/png')
      resolve(png)
    }
    img.onerror = (): void => {
      reject()
    }
    img.src = url
  })
}

const trayIconBase64 = `data:image/png;base64,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`
