import BasePage from '@renderer/components/base/base-page'
import LogItem from '@renderer/components/logs/log-item'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Divider, Input } from '@heroui/react'
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso'
import { IoLocationSharp } from 'react-icons/io5'
import { CgTrash } from 'react-icons/cg'
import { useTranslation } from 'react-i18next'

import { includesIgnoreCase } from '@renderer/utils/includes'

const LOGS_FILTER_KEY = 'logs-filter'

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

window.electron.ipcRenderer.on('mihomoLogs', (_e, log: IMihomoLogInfo) => {
  log.time = new Date().toLocaleString()
  cachedLogs.log.push(log)
  if (cachedLogs.log.length >= 500) {
    cachedLogs.log.shift()
  }
  if (cachedLogs.trigger !== null) {
    cachedLogs.trigger(cachedLogs.log)
  }
})

const Logs: React.FC = () => {
  const { t } = useTranslation()
  const [logs, setLogs] = useState<IMihomoLogInfo[]>(cachedLogs.log)
  const [filter, setFilter] = useState(() => {
    return localStorage.getItem(LOGS_FILTER_KEY) || ''
  })
  const [trace, setTrace] = useState(true)

  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const filteredLogs = useMemo(() => {
    if (filter === '') return logs
    return logs.filter((log) => {
      return includesIgnoreCase(log.payload, filter) || includesIgnoreCase(log.type, filter)
    })
  }, [logs, filter])

  useEffect(() => {
    localStorage.setItem(LOGS_FILTER_KEY, filter)
  }, [filter])

  useEffect(() => {
    if (!trace) return
    virtuosoRef.current?.scrollToIndex({
      index: filteredLogs.length - 1,
      behavior: 'smooth',
      align: 'end',
      offset: 0
    })
  }, [filteredLogs, trace])

  useEffect(() => {
    const old = cachedLogs.trigger
    cachedLogs.trigger = (a): void => {
      setLogs([...a])
    }
    return (): void => {
      cachedLogs.trigger = old
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
          itemContent={(i, log) => {
            return (
              <LogItem
                index={i}
                key={log.payload + i}
                time={log.time}
                type={log.type}
                payload={log.payload}
              />
            )
          }}
        />
      </div>
    </BasePage>
  )
}

export default Logs
