import {
  Button,
  Card,
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
  Tooltip
} from '@heroui/react'
import { IoMdMore, IoMdRefresh } from 'react-icons/io'
import dayjs from '@renderer/utils/dayjs'
import React, { Key, useMemo, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { openFile, mihomoHotReloadConfig, updatePluginProfile } from '@renderer/utils/ipc'
import { useTranslation } from 'react-i18next'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import BaseConfirmModal from '../base/base-confirm-modal'
import EditRulesModal from './edit-rules-modal'
import EditTunnelsModal from './edit-tunnels-modal'
import EditInfoModal from './edit-info-modal'
import EditFileModal from './edit-file-modal'
import QrCodeModal from './qr-code-modal'
import ProfileCardContent from './profile-card-content'

interface Props {
  info: IProfileItem
  isCurrent: boolean
  addProfileItem: (item: Partial<IProfileItem>) => Promise<void>
  updateProfileItem: (item: IProfileItem) => Promise<void>
  removeProfileItem: (id: string) => Promise<void>
  mutateProfileConfig: () => void
  onPress?: () => Promise<void>
}

interface MenuItem {
  key: string
  label: string
  showDivider: boolean
  color: 'default' | 'danger'
  className: string
}
const ProfileItem: React.FC<Props> = (props) => {
  const { t } = useTranslation()
  const { appConfig } = useAppConfig()
  const simpleMode = appConfig?.operationMode === 'simple'
  const {
    info,
    addProfileItem,
    removeProfileItem,
    mutateProfileConfig,
    updateProfileItem,
    onPress,
    isCurrent
  } = props
  const [updating, setUpdating] = useState(false)
  const [openInfoEditor, setOpenInfoEditor] = useState(false)
  const [openFileEditor, setOpenFileEditor] = useState(false)
  const [openRulesEditor, setOpenRulesEditor] = useState(false)
  const [openTunnelsEditor, setOpenTunnelsEditor] = useState(false)
  const [openQrCode, setOpenQrCode] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
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
  const [isActuallyDragging, setIsActuallyDragging] = useState(false)
  const [clickStartPos, setClickStartPos] = useState<{ x: number; y: number } | null>(null)

  const menuItems: MenuItem[] = useMemo(() => {
    const list = [
      {
        key: 'edit-info',
        label: t('profiles.editInfo.title'),
        showDivider: false,
        color: 'default',
        className: ''
      } as MenuItem,
      {
        key: 'edit-file',
        label: t('profiles.editFile.title'),
        showDivider: false,
        color: 'default',
        className: ''
      } as MenuItem,
      {
        key: 'edit-rules',
        label: t('profiles.editRules.title'),
        showDivider: false,
        color: 'default',
        className: ''
      } as MenuItem,
      {
        key: 'edit-tunnels',
        label: t('profiles.editTunnels.title'),
        showDivider: false,
        color: 'default',
        className: ''
      } as MenuItem,
      {
        key: 'open-file',
        label: t('profiles.openFile'),
        showDivider: true,
        color: 'default',
        className: ''
      } as MenuItem,
      {
        key: 'delete',
        label: t('common.delete'),
        showDivider: false,
        color: 'danger',
        className: 'text-danger'
      } as MenuItem
    ]
    if (info.type === 'remote' && info.url) {
      list.unshift({
        key: 'show-qrcode',
        label: t('profiles.qrCode.show'),
        showDivider: false,
        color: 'default',
        className: ''
      } as MenuItem)
    }
    if (info.home) {
      list.unshift({
        key: 'home',
        label: t('profiles.home'),
        showDivider: false,
        color: 'default',
        className: ''
      } as MenuItem)
    }
    return simpleMode
      ? list.filter((item) => !['edit-rules', 'edit-tunnels'].includes(item.key))
      : list
  }, [info, t, simpleMode])

  const onMenuAction = async (key: Key): Promise<void> => {
    switch (key) {
      case 'edit-info': {
        setOpenInfoEditor(true)
        break
      }
      case 'edit-file': {
        setOpenFileEditor(true)
        break
      }
      case 'edit-rules': {
        setOpenRulesEditor(true)
        break
      }
      case 'edit-tunnels': {
        setOpenTunnelsEditor(true)
        break
      }
      case 'open-file': {
        openFile('profile', info.id)
        break
      }
      case 'delete': {
        setShowDeleteConfirm(true)
        break
      }

      case 'show-qrcode': {
        setOpenQrCode(true)
        break
      }
      case 'home': {
        open(info.home)
        break
      }
    }
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDropdownOpen(true)
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      setClickStartPos({ x: e.clientX, y: e.clientY })
      setIsActuallyDragging(false)
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!clickStartPos) return

    const dx = e.clientX - clickStartPos.x
    const dy = e.clientY - clickStartPos.y
    if (dx * dx + dy * dy > 25) {
      setIsActuallyDragging(true)
    }
  }

  const handleMouseUp = (e: React.MouseEvent) => {
    const cleanup = () => {
      setClickStartPos(null)
      setTimeout(() => setIsActuallyDragging(false), 100)
    }

    // 只处理左键点击
    if (e.button !== 0) return cleanup()

    // 检查功能按钮点击
    const target = e.target as Element
    if (target?.closest('button, [role="menu"], [role="menuitem"], [data-slot="trigger"]')) {
      return cleanup()
    }

    // 处理卡片选中
    if (!isActuallyDragging && !isDragging && clickStartPos) {
      onPress?.()
    }

    cleanup()
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
      {openFileEditor && <EditFileModal id={info.id} onClose={() => setOpenFileEditor(false)} />}
      {!simpleMode && openRulesEditor && (
        <EditRulesModal id={info.id} onClose={() => setOpenRulesEditor(false)} />
      )}
      {!simpleMode && openTunnelsEditor && (
        <EditTunnelsModal id={info.id} onClose={() => setOpenTunnelsEditor(false)} />
      )}
      {openQrCode && info.url && (
        <QrCodeModal title={info.name} url={info.url} onClose={() => setOpenQrCode(false)} />
      )}
      {openInfoEditor && (
        <EditInfoModal
          item={info}
          onClose={() => setOpenInfoEditor(false)}
          updateProfileItem={updateProfileItem}
        />
      )}
      {showDeleteConfirm && (
        <BaseConfirmModal
          isOpen={showDeleteConfirm}
          title={t('profiles.deleteConfirm.title')}
          content={t('profiles.deleteConfirm.content', { name: info.name })}
          onCancel={() => setShowDeleteConfirm(false)}
          onConfirm={async () => {
            await removeProfileItem(info.id)
            mutateProfileConfig()
            setShowDeleteConfirm(false)
          }}
        />
      )}

      <Card
        as="div"
        fullWidth
        isPressable={false}
        onContextMenu={handleContextMenu}
        className={`${isCurrent ? 'bg-primary' : ''} ${onPress ? 'cursor-pointer' : 'cursor-default'} transition-colors duration-150`}
      >
        <div
          ref={setNodeRef}
          {...attributes}
          {...listeners}
          className="w-full h-full"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        >
          <ProfileCardContent
            info={info}
            isCurrent={isCurrent}
            actions={
              <div className="flex">
                {(info.type === 'remote' || info.type === 'plugin' || info.type === 'local') && (
                  <Tooltip
                    placement="left"
                    content={
                      info.type === 'local' ? (
                        t('profiles.reloadLocal')
                      ) : (
                        <div className="flex flex-col gap-0.5 text-xs">
                          <span>
                            {t('profiles.updateStatus.lastUpdate', {
                              time: dayjs(info.lastUpdateAt ?? info.updated).format(
                                'YYYY-MM-DD HH:mm'
                              )
                            })}
                          </span>
                          {info.lastUpdateOk === true && (
                            <span className="text-success">
                              {t('profiles.updateStatus.success')}
                            </span>
                          )}
                          {info.lastUpdateOk === false && (
                            <span className="text-danger">
                              {t('profiles.updateStatus.failed', {
                                error: (info.lastUpdateError ?? '').slice(0, 120)
                              })}
                            </span>
                          )}
                        </div>
                      )
                    }
                  >
                    <Button
                      isIconOnly
                      size="sm"
                      variant="light"
                      color="default"
                      disabled={
                        updating ||
                        (info.type === 'plugin' && !info.pluginId) ||
                        // 本地配置仅当前订阅可热重载；非当前项切换时会自然读盘
                        (info.type === 'local' && !isCurrent)
                      }
                      onPress={async () => {
                        try {
                          setUpdating(true)
                          if (info.type === 'remote') await addProfileItem(info)
                          else if (info.type === 'plugin' && info.pluginId)
                            await updatePluginProfile(info.pluginId, true)
                          else if (info.type === 'local' && isCurrent) await mihomoHotReloadConfig()
                        } finally {
                          setUpdating(false)
                        }
                      }}
                    >
                      <IoMdRefresh
                        color="default"
                        className={`${isCurrent ? 'text-primary-foreground' : 'text-foreground'} text-[24px] ${updating ? 'animate-spin' : ''}`}
                      />
                    </Button>
                  </Tooltip>
                )}

                <Dropdown isOpen={dropdownOpen} onOpenChange={setDropdownOpen}>
                  <DropdownTrigger>
                    <Button isIconOnly size="sm" variant="light" color="default">
                      <IoMdMore
                        color="default"
                        className={`text-[24px] ${isCurrent ? 'text-primary-foreground' : 'text-foreground'}`}
                      />
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
            }
          />
        </div>
      </Card>
    </div>
  )
}

export default ProfileItem
