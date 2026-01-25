import { Avatar, Button, Card, CardFooter, CardHeader, Chip } from '@heroui/react'
import { calcTraffic } from '@renderer/utils/calc'
import dayjs from '@renderer/utils/dayjs'
import React, { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { CgClose, CgTrash } from 'react-icons/cg'

interface Props {
  index: number
  info: IMihomoConnectionDetail
  displayIcon?: boolean
  iconUrl: string
  displayName?: string
  selected: IMihomoConnectionDetail | undefined
  setSelected: React.Dispatch<React.SetStateAction<IMihomoConnectionDetail | undefined>>
  setIsDetailModalOpen: React.Dispatch<React.SetStateAction<boolean>>
  close: (id: string) => void
}

const ConnectionItemComponent: React.FC<Props> = ({
  index,
  info,
  displayIcon,
  iconUrl,
  displayName,
  close,
  setSelected,
  setIsDetailModalOpen
}) => {
  const fallbackProcessName = useMemo(
    () => info.metadata.process?.replace(/\.exe$/, '') || info.metadata.sourceIP,
    [info.metadata.process, info.metadata.sourceIP]
  )
  const processName = displayName || fallbackProcessName

  const destination = useMemo(
    () =>
      info.metadata.host ||
      info.metadata.sniffHost ||
      info.metadata.destinationIP ||
      info.metadata.remoteDestination,
    [
      info.metadata.host,
      info.metadata.sniffHost,
      info.metadata.destinationIP,
      info.metadata.remoteDestination
    ]
  )

  const [timeAgo, setTimeAgo] = useState(() => dayjs(info.start).fromNow())

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeAgo(dayjs(info.start).fromNow())
    }, 60000)

    return () => clearInterval(timer)
  }, [info.start])

  const uploadTraffic = useMemo(() => calcTraffic(info.upload), [info.upload])

  const downloadTraffic = useMemo(() => calcTraffic(info.download), [info.download])

  const uploadSpeed = useMemo(
    () => (info.uploadSpeed ? calcTraffic(info.uploadSpeed) : null),
    [info.uploadSpeed]
  )

  const downloadSpeed = useMemo(
    () => (info.downloadSpeed ? calcTraffic(info.downloadSpeed) : null),
    [info.downloadSpeed]
  )

  const hasSpeed = useMemo(
    () => Boolean(info.uploadSpeed || info.downloadSpeed),
    [info.uploadSpeed, info.downloadSpeed]
  )

  const handleCardPress = useCallback(() => {
    setSelected(info)
    setIsDetailModalOpen(true)
  }, [info, setSelected, setIsDetailModalOpen])

  const handleClose = useCallback(() => {
    close(info.id)
  }, [close, info.id])

  return (
    <div className={`px-2 pb-2 ${index === 0 ? 'pt-2' : ''}`} style={{ minHeight: 80 }}>
      <Card as="div" isPressable className="w-full" onPress={handleCardPress}>
        <div className="w-full flex justify-between items-center">
          {displayIcon && (
            <div>
              <Avatar
                size="lg"
                radius="sm"
                src={iconUrl}
                className="bg-transparent ml-2 w-14 h-14"
              />
            </div>
          )}
          <div
            className={`w-full flex flex-col justify-start truncate relative ${displayIcon ? '-ml-2' : ''}`}
          >
            <CardHeader className="pb-0 gap-1 flex items-center pr-12 relative">
              <div className="ml-2 flex-1 text-ellipsis whitespace-nowrap overflow-hidden text-left">
                <span style={{ textAlign: 'left' }}>
                  {processName} → {destination}
                </span>
              </div>
              <small className="ml-2 whitespace-nowrap text-foreground-500">{timeAgo}</small>
              <Button
                color={info.isActive ? 'warning' : 'danger'}
                variant="light"
                isIconOnly
                size="sm"
                className="absolute right-2 transform"
                onPress={handleClose}
              >
                {info.isActive ? <CgClose className="text-lg" /> : <CgTrash className="text-lg" />}
              </Button>
            </CardHeader>
            <CardFooter className="pt-2">
              <div className="flex gap-1 overflow-x-auto no-scrollbar">
                <Chip
                  color={info.isActive ? 'primary' : 'danger'}
                  size="sm"
                  radius="sm"
                  variant="dot"
                >
                  {info.metadata.type}({info.metadata.network.toUpperCase()})
                </Chip>
                <Chip
                  className="flag-emoji whitespace-nowrap overflow-hidden"
                  size="sm"
                  radius="sm"
                  variant="bordered"
                >
                  {info.chains[0]}
                </Chip>
                <Chip size="sm" radius="sm" variant="bordered">
                  ↑ {uploadTraffic} ↓ {downloadTraffic}
                </Chip>
                {hasSpeed && (
                  <Chip color="primary" size="sm" radius="sm" variant="bordered">
                    ↑ {uploadSpeed || '0 B'}/s ↓ {downloadSpeed || '0 B'}/s
                  </Chip>
                )}
              </div>
            </CardFooter>
          </div>
        </div>
      </Card>
    </div>
  )
}

const ConnectionItem = memo(ConnectionItemComponent, (prevProps, nextProps) => {
  return (
    prevProps.info.id === nextProps.info.id &&
    prevProps.info.upload === nextProps.info.upload &&
    prevProps.info.download === nextProps.info.download &&
    prevProps.info.uploadSpeed === nextProps.info.uploadSpeed &&
    prevProps.info.downloadSpeed === nextProps.info.downloadSpeed &&
    prevProps.info.isActive === nextProps.info.isActive &&
    prevProps.iconUrl === nextProps.iconUrl &&
    prevProps.displayIcon === nextProps.displayIcon &&
    prevProps.displayName === nextProps.displayName &&
    prevProps.selected?.id === nextProps.selected?.id
  )
})

export default ConnectionItem
