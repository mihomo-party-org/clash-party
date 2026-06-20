import {
  Button,
  Card,
  CardBody,
  Chip,
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
  Switch
} from '@heroui/react'
import { toast } from '@renderer/components/base/toast'
import { IoMdMore, IoMdRefresh } from 'react-icons/io'
import dayjs from '@renderer/utils/dayjs'
import React, { Key, useMemo, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { openFile, mihomoHotReloadConfig } from '@renderer/utils/ipc'
import { useTranslation } from 'react-i18next'
import ExecLogModal from './exec-log-modal'
import EditInfoModal from './edit-info-modal'
import EditFileModal from './edit-file-modal'

interface Props {
  info: IOverrideItem
  addOverrideItem: (item: Partial<IOverrideItem>) => Promise<void>
  updateOverrideItem: (item: IOverrideItem) => Promise<void>
  removeOverrideItem: (id: string) => Promise<void>
  mutateOverrideConfig: () => void
}

interface MenuItem {
  key: string
  label: string
  showDivider: boolean
  color: 'default' | 'danger'
  className: string
}

const OverrideItem: React.FC<Props> = (props) => {
  const { t } = useTranslation()
  const { info, addOverrideItem, removeOverrideItem, mutateOverrideConfig, updateOverrideItem } =
    props
  const [updating, setUpdating] = useState(false)
  const [savingGlobal, setSavingGlobal] = useState(false)
  const [openInfoEditor, setOpenInfoEditor] = useState(false)
  const [openFileEditor, setOpenFileEditor] = useState(false)
  const [openLog, setOpenLog] = useState(false)
  const {
    attributes,
    listeners,
    setNodeRef,
    transform: tf,
    transition,
    isDragging
  } = useSortable({
    id: info.id
  })
  const transform = tf ? { x: tf.x, y: tf.y, scaleX: 1, scaleY: 1 } : null
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const menuItems: MenuItem[] = useMemo(() => {
    const list = [
      {
        key: 'edit-info',
        label: t('override.menuItems.editInfo'),
        showDivider: false,
        color: 'default',
        className: ''
      } as MenuItem,
      {
        key: 'edit-file',
        label: t('override.menuItems.editFile'),
        showDivider: false,
        color: 'default',
        className: ''
      } as MenuItem,
      {
        key: 'open-file',
        label: t('override.menuItems.openFile'),
        showDivider: false,
        color: 'default',
        className: ''
      } as MenuItem,
      {
        key: 'exec-log',
        label: t('override.menuItems.execLog'),
        showDivider: true,
        color: 'default',
        className: ''
      } as MenuItem,
      {
        key: 'delete',
        label: t('override.menuItems.delete'),
        showDivider: false,
        color: 'danger',
        className: 'text-danger'
      } as MenuItem
    ]
    if (info.ext === 'yaml') {
      list.splice(3, 1)
    }
    return list
  }, [info, t])
  const onMenuAction = (key: Key): void => {
    switch (key) {
      case 'edit-info': {
        setOpenInfoEditor(true)
        break
      }
      case 'edit-file': {
        setOpenFileEditor(true)
        break
      }
      case 'open-file': {
        openFile('override', info.id, info.ext)
        break
      }
      case 'exec-log': {
        setOpenLog(true)
        break
      }
      case 'delete': {
        removeOverrideItem(info.id)
        mutateOverrideConfig()
        break
      }
    }
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDropdownOpen(true)
  }

  const stopCardInteraction = (e: React.SyntheticEvent): void => {
    e.stopPropagation()
  }

  const handleGlobalChange = async (global: boolean): Promise<void> => {
    setSavingGlobal(true)
    try {
      await updateOverrideItem({ ...info, global })
      await mihomoHotReloadConfig()
    } catch (e) {
      toast.error(String(e))
    } finally {
      setSavingGlobal(false)
    }
  }

  return (
    <div
      className="grid col-span-1"
      style={{
        position: 'relative',
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 'calc(infinity)' : undefined
      }}
    >
      {openFileEditor && (
        <EditFileModal
          id={info.id}
          language={info.ext === 'yaml' ? 'yaml' : 'javascript'}
          onClose={() => setOpenFileEditor(false)}
        />
      )}
      {openInfoEditor && (
        <EditInfoModal
          item={info}
          onClose={() => setOpenInfoEditor(false)}
          updateOverrideItem={updateOverrideItem}
        />
      )}
      {openLog && <ExecLogModal id={info.id} onClose={() => setOpenLog(false)} />}
      <Card
        as="div"
        fullWidth
        className="cursor-pointer"
        onContextMenu={handleContextMenu}
        onDoubleClick={(e) => {
          if (
            (e.target as Element)?.closest(
              '[data-interactive="true"], button, [role="menu"], [role="menuitem"]'
            )
          ) {
            return
          }
          setOpenFileEditor(true)
        }}
      >
        <div ref={setNodeRef} {...attributes} {...listeners} className="h-full w-full">
          <CardBody>
            <div className="flex justify-between h-[32px]">
              <h3
                title={info?.name}
                className={`text-ellipsis whitespace-nowrap overflow-hidden text-md font-bold leading-[32px] text-foreground`}
              >
                {info?.name}
              </h3>
              <div className="flex">
                {info.type === 'remote' && (
                  <Button
                    isIconOnly
                    size="sm"
                    variant="light"
                    color="default"
                    disabled={updating || savingGlobal}
                    onPress={async () => {
                      setUpdating(true)
                      try {
                        await addOverrideItem(info)
                        await mihomoHotReloadConfig()
                      } catch (e) {
                        toast.error(String(e))
                      } finally {
                        setUpdating(false)
                      }
                    }}
                  >
                    <IoMdRefresh
                      color="default"
                      className={`text-[24px] ${updating ? 'animate-spin' : ''}`}
                    />
                  </Button>
                )}

                <Dropdown isOpen={dropdownOpen} onOpenChange={setDropdownOpen}>
                  <DropdownTrigger>
                    <Button isIconOnly size="sm" variant="light" color="default">
                      <IoMdMore color="default" className={`text-[24px]`} />
                    </Button>
                  </DropdownTrigger>
                  <DropdownMenu onAction={onMenuAction}>
                    {menuItems.map((item) => (
                      <DropdownItem
                        showDivider={item.showDivider}
                        key={item.key}
                        color={item.color}
                        className={item.className}
                      >
                        {item.label}
                      </DropdownItem>
                    ))}
                  </DropdownMenu>
                </Dropdown>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="flex items-center justify-start">
                <Chip size="sm" variant="bordered">
                  {info.ext === 'yaml' ? 'YAML' : 'JavaScript'}
                </Chip>
              </div>
              <div className="flex items-center justify-end gap-3">
                {info.type === 'remote' && <small>{dayjs(info.updated).fromNow()}</small>}
                <div
                  data-interactive="true"
                  className="flex items-center gap-2"
                  onClick={stopCardInteraction}
                  onDoubleClick={stopCardInteraction}
                  onPointerDown={stopCardInteraction}
                >
                  <span className="text-xs text-default-500">{t('override.editInfo.global')}</span>
                  <Switch
                    size="sm"
                    aria-label={t('override.editInfo.global')}
                    isSelected={Boolean(info.global)}
                    isDisabled={updating || savingGlobal}
                    onValueChange={handleGlobalChange}
                  />
                </div>
              </div>
            </div>
          </CardBody>
        </div>
      </Card>
    </div>
  )
}

export default OverrideItem
