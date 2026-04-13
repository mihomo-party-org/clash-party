import { Button, Card, CardBody, CardFooter, Tooltip } from '@heroui/react'
import { FaCircleArrowDown, FaCircleArrowUp } from 'react-icons/fa6'
import { useLocation, useNavigate } from 'react-router-dom'
import { calcTraffic } from '@renderer/utils/calc'
import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react'
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

interface Props {
  iconOnly?: boolean
}
const ConnCard: React.FC<Props> = (props) => {
  const { iconOnly } = props
  const { appConfig } = useAppConfig()
  const {
    showTraffic = false,
    connectionCardStatus = 'col-span-2',
    disableAnimations = false,
    hideConnectionCardWave = false
  } = appConfig || {}
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

  // 使用 useRef 替代模块级变量
  const currentUploadRef = useRef<number | undefined>(undefined)
  const currentDownloadRef = useRef<number | undefined>(undefined)
  const hasShowTrafficRef = useRef(false)
  const showTrafficRef = useRef(showTraffic)
  showTrafficRef.current = showTraffic

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

  // 使用 useCallback 创建稳定的 handler 引用，通过 ref 读取 showTraffic 避免重建
  const handleTraffic = useCallback((_e: unknown, ...args: unknown[]) => {
    const info = args[0] as IMihomoTrafficInfo
    setUpload(info.up)
    setDownload(info.down)
    setSeries((prev) => {
      const data = [...prev]
      data.shift()
      data.push(info.up + info.down)
      return data
    })
    if (platform === 'darwin' && showTrafficRef.current) {
      const up = info.up
      const down = info.down
      if (up !== currentUploadRef.current || down !== currentDownloadRef.current) {
        currentUploadRef.current = up
        currentDownloadRef.current = down
        const png = renderTrafficIcon(up, down)
        window.electron.ipcRenderer.send('trayIconUpdate', png, true)
      }
    }
  }, [])

  useEffect(() => {
    window.electron.ipcRenderer.on('mihomoTraffic', handleTraffic)
    return (): void => {
      window.electron.ipcRenderer.removeListener('mihomoTraffic', handleTraffic)
    }
  }, [handleTraffic])

  // showTraffic 开关切换时统一管理托盘图标
  useEffect(() => {
    if (platform !== 'darwin') return
    if (showTraffic) {
      // 开启：立即显示默认流量图标，重置缓存以确保下次流量事件触发更新
      currentUploadRef.current = undefined
      currentDownloadRef.current = undefined
      const png = renderTrafficIcon(0, 0)
      window.electron.ipcRenderer.send('trayIconUpdate', png, true)
      hasShowTrafficRef.current = true
    } else if (hasShowTrafficRef.current) {
      // 关闭：恢复原始图标
      window.electron.ipcRenderer.send('trayIconUpdate', trayIconBase64, false)
      hasShowTrafficRef.current = false
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
            className={`${match ? 'bg-primary' : 'hover:bg-primary/30'} ${disableAnimations ? '' : `motion-reduce:transition-transform-background ${isDragging ? 'scale-[0.95] tap-highlight-transparent' : ''}`}`}
          >
            {!hideConnectionCardWave && (
              <div className="w-full h-full absolute top-0 left-0 pointer-events-none overflow-hidden rounded-[14px]">
                <Line data={chartData} options={chartOptions} />
              </div>
            )}
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
        </>
      ) : (
        <Card
          fullWidth
          ref={setNodeRef}
          {...attributes}
          {...listeners}
          className={`${match ? 'bg-primary' : 'hover:bg-primary/30'} ${disableAnimations ? '' : `motion-reduce:transition-transform-background ${isDragging ? 'scale-[0.95] tap-highlight-transparent' : ''}`}`}
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

const trayIconBase64 = `data:image/png;base64,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`

// 固定宽高，同步渲染避免闪烁
const ICON_W = 156
const ICON_H = 36
let trafficCanvas: HTMLCanvasElement | null = null
let trafficCtx: CanvasRenderingContext2D | null = null
const trafficIcon = new Image()
let trafficIconLoaded = false
trafficIcon.onload = () => {
  trafficIconLoaded = true
}
trafficIcon.src = trayIconBase64

function renderTrafficIcon(upload: number, download: number): string {
  if (!trafficCanvas) {
    trafficCanvas = document.createElement('canvas')
    trafficCanvas.width = ICON_W
    trafficCanvas.height = ICON_H
    trafficCtx = trafficCanvas.getContext('2d')
  }
  if (!trafficCtx) {
    return trayIconBase64
  }
  const ctx = trafficCtx
  ctx.clearRect(0, 0, ICON_W, ICON_H)
  if (trafficIconLoaded) {
    ctx.drawImage(trafficIcon, 0, 0, ICON_H, ICON_H)
  }
  ctx.font = 'bold 18px "PingFang SC"'
  ctx.fillStyle = 'black'
  ctx.textAlign = 'right'
  ctx.fillText(`${calcTraffic(upload)}/s`, ICON_W, 15)
  ctx.fillText(`${calcTraffic(download)}/s`, ICON_W, 34)
  return trafficCanvas.toDataURL('image/png')
}
