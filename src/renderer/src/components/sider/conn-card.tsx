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
                className={`text-md font-bold ${match ? 'text-primary-foreground' : 'text-foreground'}`}
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

const trayIconBase64 = `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAABGdBTUEAALGPC/xhBQAACklpQ0NQc1JHQiBJRUM2MTk2Ni0yLjEAAEiJnVN3WJP3Fj7f92UPVkLY8LGXbIEAIiOsCMgQWaIQkgBhhBASQMWFiApWFBURnEhVxILVCkidiOKgKLhnQYqIWotVXDjuH9yntX167+3t+9f7vOec5/zOec8PgBESJpHmomoAOVKFPDrYH49PSMTJvYACFUjgBCAQ5svCZwXFAADwA3l4fnSwP/wBr28AAgBw1S4kEsfh/4O6UCZXACCRAOAiEucLAZBSAMguVMgUAMgYALBTs2QKAJQAAGx5fEIiAKoNAOz0ST4FANipk9wXANiiHKkIAI0BAJkoRyQCQLsAYFWBUiwCwMIAoKxAIi4EwK4BgFm2MkcCgL0FAHaOWJAPQGAAgJlCLMwAIDgCAEMeE80DIEwDoDDSv+CpX3CFuEgBAMDLlc2XS9IzFLiV0Bp38vDg4iHiwmyxQmEXKRBmCeQinJebIxNI5wNMzgwAABr50cH+OD+Q5+bk4eZm52zv9MWi/mvwbyI+IfHf/ryMAgQAEE7P79pf5eXWA3DHAbB1v2upWwDaVgBo3/ldM9sJoFoK0Hr5i3k4/EAenqFQyDwdHAoLC+0lYqG9MOOLPv8z4W/gi372/EAe/tt68ABxmkCZrcCjg/1xYW52rlKO58sEQjFu9+cj/seFf/2OKdHiNLFcLBWK8ViJuFAiTcd5uVKRRCHJleIS6X8y8R+W/QmTdw0ArIZPwE62B7XLbMB+7gECiw5Y0nYAQH7zLYwaC5EAEGc0Mnn3AACTv/mPQCsBAM2XpOMAALzoGFyolBdMxggAAESggSqwQQcMwRSswA6cwR28wBcCYQZEQAwkwDwQQgbkgBwKoRiWQRlUwDrYBLWwAxqgEZrhELTBMTgN5+ASXIHrcBcGYBiewhi8hgkEQcgIE2EhOogRYo7YIs4IF5mOBCJhSDSSgKQg6YgUUSLFyHKkAqlCapFdSCPyLXIUOY1cQPqQ28ggMor8irxHMZSBslED1AJ1QLmoHxqKxqBz0XQ0D12AlqJr0Rq0Hj2AtqKn0UvodXQAfYqOY4DRMQ5mjNlhXIyHRWCJWBomxxZj5Vg1Vo81Yx1YN3YVG8CeYe8IJAKLgBPsCF6EEMJsgpCQR1hMWEOoJewjtBK6CFcJg4Qxwicik6hPtCV6EvnEeGI6sZBYRqwm7iEeIZ4lXicOE1+TSCQOyZLkTgohJZAySQtJa0jbSC2kU6Q+0hBpnEwm65Btyd7kCLKArCCXkbeQD5BPkvvJw+S3FDrFiOJMCaIkUqSUEko1ZT/lBKWfMkKZoKpRzame1AiqiDqfWkltoHZQL1OHqRM0dZolzZsWQ8ukLaPV0JppZ2n3aC/pdLoJ3YMeRZfQl9Jr6Afp5+mD9HcMDYYNg8dIYigZaxl7GacYtxkvmUymBdOXmchUMNcyG5lnmA+Yb1VYKvYqfBWRyhKVOpVWlX6V56pUVXNVP9V5qgtUq1UPq15WfaZGVbNQ46kJ1Bar1akdVbupNq7OUndSj1DPUV+jvl/9gvpjDbKGhUaghkijVGO3xhmNIRbGMmXxWELWclYD6yxrmE1iW7L57Ex2Bfsbdi97TFNDc6pmrGaRZp3mcc0BDsax4PA52ZxKziHODc57LQMtPy2x1mqtZq1+rTfaetq+2mLtcu0W7eva73VwnUCdLJ31Om0693UJuja6UbqFutt1z+o+02PreekJ9cr1Dund0Uf1bfSj9Rfq79bv0R83MDQINpAZbDE4Y/DMkGPoa5hpuNHwhOGoEctoupHEaKPRSaMnuCbuh2fjNXgXPmasbxxirDTeZdxrPGFiaTLbpMSkxeS+Kc2Ua5pmutG003TMzMgs3KzYrMnsjjnVnGueYb7ZvNv8jYWlRZzFSos2i8eW2pZ8ywWWTZb3rJhWPlZ5VvVW16xJ1lzrLOtt1ldsUBtXmwybOpvLtqitm63Edptt3xTiFI8p0in1U27aMez87ArsmuwG7Tn2YfYl9m32zx3MHBId1jt0O3xydHXMdmxwvOuk4TTDqcSpw+lXZxtnoXOd8zUXpkuQyxKXdpcXU22niqdun3rLleUa7rrStdP1o5u7m9yt2W3U3cw9xX2r+00umxvJXcM970H08PdY4nHM452nm6fC85DnL152Xlle+70eT7OcJp7WMG3I28Rb4L3Le2A6Pj1l+s7pAz7GPgKfep+Hvqa+It89viN+1n6Zfgf8nvs7+sv9j/i/4XnyFvFOBWABwQHlAb2BGoGzA2sDHwSZBKUHNQWNBbsGLww+FUIMCQ1ZH3KTb8AX8hv5YzPcZyya0RXKCJ0VWhv6MMwmTB7WEY6GzwjfEH5vpvlM6cy2CIjgR2yIuB9pGZkX+X0UKSoyqi7qUbRTdHF09yzWrORZ+2e9jvGPqYy5O9tqtnJ2Z6xqbFJsY+ybuIC4qriBeIf4RfGXEnQTJAntieTE2MQ9ieNzAudsmjOc5JpUlnRjruXcorkX5unOy553PFk1WZB8OIWYEpeyP+WDIEJQLxhP5aduTR0T8oSbhU9FvqKNolGxt7hKPJLmnVaV9jjdO31D+miGT0Z1xjMJT1IreZEZkrkj801WRNberM/ZcdktOZSclJyjUg1plrQr1zC3KLdPZisrkw3keeZtyhuTh8r35CP5c/PbFWyFTNGjtFKuUA4WTC+oK3hbGFt4uEi9SFrUM99m/ur5IwuCFny9kLBQuLCz2Lh4WfHgIr9FuxYji1MXdy4xXVK6ZHhp8NJ9y2jLspb9UOJYUlXyannc8o5Sg9KlpUMrglc0lamUycturvRauWMVYZVkVe9ql9VbVn8qF5VfrHCsqK74sEa45uJXTl/VfPV5bdra3kq3yu3rSOuk626s91m/r0q9akHV0IbwDa0b8Y3lG19tSt50oXpq9Y7NtM3KzQM1YTXtW8y2rNvyoTaj9nqdf13LVv2tq7e+2Sba1r/dd3vzDoMdFTve75TsvLUreFdrvUV99W7S7oLdjxpiG7q/5n7duEd3T8Wej3ulewf2Re/ranRvbNyvv7+yCW1SNo0eSDpw5ZuAb9qb7Zp3tXBaKg7CQeXBJ9+mfHvjUOihzsPcw83fmX+39QjrSHkr0jq/dawto22gPaG97+iMo50dXh1Hvrf/fu8x42N1xzWPV56gnSg98fnkgpPjp2Snnp1OPz3Umdx590z8mWtdUV29Z0PPnj8XdO5Mt1/3yfPe549d8Lxw9CL3Ytslt0utPa49R35w/eFIr1tv62X3y+1XPK509E3rO9Hv03/6asDVc9f41y5dn3m978bsG7duJt0cuCW69fh29u0XdwruTNxdeo94r/y+2v3qB/oP6n+0/rFlwG3g+GDAYM/DWQ/vDgmHnv6U/9OH4dJHzEfVI0YjjY+dHx8bDRq98mTOk+GnsqcTz8p+Vv9563Or59/94vtLz1j82PAL+YvPv655qfNy76uprzrHI8cfvM55PfGm/K3O233vuO+638e9H5ko/ED+UPPR+mPHp9BP9z7nfP78L/eE8/stRzjPAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAJcEhZcwAAFiUAABYlAUlSJPAAAATuaVRYdFhNTDpjb20uYWRvYmUueG1wAAAAAAA8P3hwYWNrZXQgYmVnaW49Iu+7vyIgaWQ9Ilc1TTBNcENlaGlIenJlU3pOVGN6a2M5ZCI/PiA8eDp4bXBtZXRhIHhtbG5zOng9ImFkb2JlOm5zOm1ldGEvIiB4OnhtcHRrPSJBZG9iZSBYTVAgQ29yZSA5LjEtYzAwMiA3OS5kYmEzZGEzLCAyMDIzLzEyLzEzLTA1OjA2OjQ5ICAgICAgICAiPiA8cmRmOlJERiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiPiA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIiB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iIHhtbG5zOmRjPSJodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyIgeG1sbnM6cGhvdG9zaG9wPSJodHRwOi8vbnMuYWRvYmUuY29tL3Bob3Rvc2hvcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RFdnQ9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZUV2ZW50IyIgeG1wOkNyZWF0b3JUb29sPSJBZG9iZSBQaG90b3Nob3AgMjUuNiAoV2luZG93cykiIHhtcDpDcmVhdGVEYXRlPSIyMDI0LTA4LTE0VDIyOjE4OjAwKzA4OjAwIiB4bXA6TW9kaWZ5RGF0ZT0iMjAyNC0wOC0yOFQyMTo1NzozMCswODowMCIgeG1wOk1ldGFkYXRhRGF0ZT0iMjAyNC0wOC0yOFQyMTo1NzozMCswODowMCIgZGM6Zm9ybWF0PSJpbWFnZS9wbmciIHBob3Rvc2hvcDpDb2xvck1vZGU9IjMiIHhtcE1NOkluc3RhbmNlSUQ9InhtcC5paWQ6ODA3N2Y1ZGYtYTg4YS0zYzQ2LWE4NjktOTEwN2M5YTYwYzg0IiB4bXBNTTpEb2N1bWVu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`
