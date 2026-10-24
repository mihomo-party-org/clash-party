import BasePage from '@renderer/components/base/base-page'
import LogItem from '@renderer/components/logs/log-item'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Divider, Input, Select, SelectItem } from '@heroui/react'
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso'
import { IoLocationSharp } from 'react-icons/io5'
import { CgTrash } from 'react-icons/cg'
import { useTranslation } from 'react-i18next'
import { includesIgnoreCase } from '@renderer/utils/includes'

const LOGS_FILTER_KEY = 'logs-filter'
const LOGS_LEVEL_FILTER_KEY = 'logs-level-filter'
const MAX_CACHED_LOGS = 500
const LOG_RENDER_INTERVAL_MS = 100
const logLevelOrder: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warning: 2,
  info: 3,
  debug: 4
}

const cachedLogs: {
  log: IMihomoLogInfo[]
  trigger: ((i: IMihomoLogInfo[]) => void) | null
  clean: () => void
} = {
  log: [],
  trigger: null,
  clean(): void {
    this.log = []
    if (this.trigger !== null) {
      this.trigger(this.log)
    }
  }
}

const onLog = (_e: unknown, ...args: unknown[]): void => {
  const logs = args[0] as IMihomoLogInfo[]
  const time = new Date().toLocaleString()
  for (const log of logs) {
    log.time = time
    cachedLogs.log.push(log)
  }
  if (cachedLogs.log.length > MAX_CACHED_LOGS) {
    cachedLogs.log.splice(0, cachedLogs.log.length - MAX_CACHED_LOGS)
  }
  cachedLogs.trigger?.(cachedLogs.log)
}

// Keep streaming while this page is hidden so returning users can see intervening logs.
// The session cache is bounded by MAX_CACHED_LOGS, so stopping on unmount hurts UX
// without providing meaningful memory savings.
const unsubscribeLogs = window.electron.ipcRenderer.on('mihomoLogsBatch', onLog)

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unsubscribeLogs()
  })
}

const Logs: React.FC = () => {
  const { t } = useTranslation()
  const [logs, setLogs] = useState<IMihomoLogInfo[]>(cachedLogs.log)
  const [filter, setFilter] = useState(() => {
    return localStorage.getItem(LOGS_FILTER_KEY) || ''
  })
  const [levelFilter, setLevelFilter] = useState<LogLevel>(() => {
    const savedLevel = localStorage.getItem(LOGS_LEVEL_FILTER_KEY)
    return savedLevel && savedLevel in logLevelOrder ? (savedLevel as LogLevel) : 'debug'
  })
  const [trace, setTrace] = useState(true)

  const virtuosoRef = useRef<VirtuosoHandle>(null)

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      return (
        logLevelOrder[log.type] <= logLevelOrder[levelFilter] &&
        (filter === '' ||
          includesIgnoreCase(log.payload, filter) ||
          includesIgnoreCase(log.type, filter))
      )
    })
  }, [logs, filter, levelFilter])

  useEffect(() => {
    localStorage.setItem(LOGS_FILTER_KEY, filter)
  }, [filter])

  useEffect(() => {
    localStorage.setItem(LOGS_LEVEL_FILTER_KEY, levelFilter)
  }, [levelFilter])

  useEffect(() => {
    const old = cachedLogs.trigger
    let renderTimer: ReturnType<typeof setTimeout> | null = null

    cachedLogs.trigger = (): void => {
      if (renderTimer !== null) return
      renderTimer = setTimeout(() => {
        renderTimer = null
        setLogs([...cachedLogs.log])
      }, LOG_RENDER_INTERVAL_MS)
    }

    return (): void => {
      cachedLogs.trigger = old
      if (renderTimer !== null) {
        clearTimeout(renderTimer)
      }
    }
  }, [])

  return (
    <BasePage title={t('logs.title')}>
      <div className="sticky top-0 z-40">
        <div className="w-full flex p-2">
          <Input
            size="sm"
            value={filter}
            placeholder={t('logs.filter')}
            isClearable
            onValueChange={setFilter}
          />
          <Select
            size="sm"
            className="ml-2 w-28 shrink-0"
            aria-label={t('mihomo.selectLogLevel')}
            selectedKeys={[levelFilter]}
            disallowEmptySelection
            onSelectionChange={(selection) => {
              const level = selection.currentKey
              if (level && level in logLevelOrder) setLevelFilter(level as LogLevel)
            }}
          >
            <SelectItem key="silent">{t('mihomo.silent')}</SelectItem>
            <SelectItem key="error">{t('mihomo.error')}</SelectItem>
            <SelectItem key="warning">{t('mihomo.warning')}</SelectItem>
            <SelectItem key="info">{t('mihomo.info')}</SelectItem>
            <SelectItem key="debug">{t('mihomo.debug')}</SelectItem>
          </Select>
          <Button
            size="sm"
            isIconOnly
            className="ml-2"
            color={trace ? 'primary' : 'default'}
            variant={trace ? 'solid' : 'bordered'}
            title={t('logs.autoScroll')}
            onPress={() => {
              setTrace((prev) => !prev)
            }}
          >
            <IoLocationSharp className="text-lg" />
          </Button>
          <Button
            size="sm"
            isIconOnly
            title={t('logs.clear')}
            className="ml-2"
            variant="light"
            color="danger"
            onPress={() => {
              cachedLogs.clean()
            }}
          >
            <CgTrash className="text-lg" />
          </Button>
        </div>
        <Divider />
      </div>
      <div className="h-[calc(100vh-100px)] mt-px">
        <Virtuoso
          ref={virtuosoRef}
          data={filteredLogs}
          initialTopMostItemIndex={filteredLogs.length - 1}
          followOutput={trace}
          itemContent={(i, log) => (
            <LogItem index={i} time={log.time} type={log.type} payload={log.payload} />
          )}
        />
      </div>
    </BasePage>
  )
}

export default Logs
