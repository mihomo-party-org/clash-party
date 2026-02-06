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
  const drawingRef = useRef(false)
  // 保存待绘制的流量数据，避免跳过更新导致图标闪烁
  const pendingTrafficRef = useRef<{ up: number; down: number } | null>(null)

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

  // 使用 useCallback 创建稳定的 handler 引用
  const handleTraffic = useCallback(
    async (_e: unknown, ...args: unknown[]) => {
      const info = args[0] as IMihomoTrafficInfo
      setUpload(info.up)
      setDownload(info.down)
      setSeries((prev) => {
        const data = [...prev]
        data.shift()
        data.push(info.up + info.down)
        return data
      })
      if (platform === 'darwin') {
        if (showTraffic) {
          // 保存最新流量数据，确保绘制完成后使用最新值
          pendingTrafficRef.current = { up: info.up, down: info.down }
          if (drawingRef.current) return
          drawingRef.current = true
          try {
            // 循环处理待绘制数据，直到没有新数据
            while (pendingTrafficRef.current) {
              const { up, down } = pendingTrafficRef.current
              pendingTrafficRef.current = null
              await drawSvg(up, down, currentUploadRef, currentDownloadRef)
            }
            hasShowTrafficRef.current = true
          } catch {
            // ignore
          } finally {
            drawingRef.current = false
          }
        } else if (hasShowTrafficRef.current) {
          // 只在从 showTraffic=true 切换到 false 时恢复一次原始图标
          window.electron.ipcRenderer.send('trayIconUpdate', trayIconBase64, false)
          hasShowTrafficRef.current = false
        }
      }
    },
    [showTraffic]
  )

  useEffect(() => {
    window.electron.ipcRenderer.on('mihomoTraffic', handleTraffic)
    return (): void => {
      window.electron.ipcRenderer.removeListener('mihomoTraffic', handleTraffic)
    }
  }, [handleTraffic])

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
            className={`${match ? 'bg-primary' : 'hover:bg-primary/30'} ${disableAnimations ? '' : `motion-reduce:transition-transform-background ${isDragging  ? 'scale-[0.95] tap-highlight-transparent' : ''}`}`}
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
          {!hideConnectionCardWave && (
            <div className="w-full h-full absolute top-0 left-0 pointer-events-none overflow-hidden rounded-[14px]">
              <Line data={chartData} options={chartOptions} />
            </div>
          )}
        </>
      ) : (
        <Card
          fullWidth
          ref={setNodeRef}
          {...attributes}
          {...listeners}
          className={`${match ? 'bg-primary' : 'hover:bg-primary/30'} ${disableAnimations ? '' : `motion-reduce:transition-transform-background ${isDragging  ? 'scale-[0.95] tap-highlight-transparent' : ''}`}`}
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

const drawSvg = async (
  upload: number,
  download: number,
  currentUploadRef: React.RefObject<number | undefined>,
  currentDownloadRef: React.RefObject<number | undefined>
): Promise<void> => {
  if (upload === currentUploadRef.current && download === currentDownloadRef.current) return
  currentUploadRef.current = upload
  currentDownloadRef.current = download
  const svg = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 156 36"><image height="36" width="36" href="${trayIconBase64}"/><text x="156" y="15" font-size="18" font-family="PingFang SC" font-weight="bold" text-anchor="end" fill="black">${calcTraffic(upload)}/s</text><text x="156" y="34" font-size="18" font-family="PingFang SC" font-weight="bold" text-anchor="end" fill="black">${calcTraffic(download)}/s</text></svg>`
  const image = await loadImage(svg)
  window.electron.ipcRenderer.send('trayIconUpdate', image, true)
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
