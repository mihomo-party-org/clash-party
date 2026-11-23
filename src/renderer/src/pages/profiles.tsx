import {
  Button,
  Checkbox,
  Chip,
  Divider,
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
  Input
} from '@heroui/react'
import BasePage from '@renderer/components/base/base-page'
import { toast } from '@renderer/components/base/toast'
import ProfileItem from '@renderer/components/profiles/profile-item'
import PluginItem from '@renderer/components/plugins/plugin-item'
import PluginInstallModal from '@renderer/components/plugins/plugin-install-modal'
import EditInfoModal from '@renderer/components/profiles/edit-info-modal'
import { useProfileConfig } from '@renderer/hooks/use-profile-config'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { usePluginConfig } from '@renderer/hooks/use-plugin-config'
import {
  getFilePath,
  getLocalConfig,
  readTextFile,
  subStoreCollections,
  subStoreSubs,
  updatePluginProfile
} from '@renderer/utils/ipc'
import type { KeyboardEvent } from 'react'
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MdContentPaste } from 'react-icons/md'
import { TbPuzzle } from 'react-icons/tb'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core'
import { SortableContext } from '@dnd-kit/sortable'
import { FaPlus } from 'react-icons/fa6'
import { IoMdRefresh } from 'react-icons/io'
import SubStoreIcon from '@renderer/components/base/substore-icon'
import useSWR from 'swr'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { subscribePluginFile, takePendingPluginFile } from '@renderer/utils/plugin-file-open'
import { findProfileSource } from '../../../shared/profile-source'
import { DEFAULT_USE_SUB_STORE } from '../../../shared/appConfig'

const Profiles: React.FC = () => {
  const { t } = useTranslation()
  const {
    profileConfig,
    setProfileConfig,
    addProfileItem,
    removeProfileItem,
    changeCurrentProfile,
    mutateProfileConfig
  } = useProfileConfig()
  const { appConfig } = useAppConfig()
  const {
    useSubStore = DEFAULT_USE_SUB_STORE,
    useCustomSubStore = false,
    customSubStoreUrl = ''
  } = appConfig || {}
  const { current, items = [] } = profileConfig || {}
  const navigate = useNavigate()
  const [sortedItems, setSortedItems] = useState(items)
  const [useProxy, setUseProxy] = useState(false)
  const [importItem, setImportItem] = useState<Partial<IProfileItem> | null>(null)
  const [subStoreImporting, setSubStoreImporting] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [fileOver, setFileOver] = useState(false)
  const [url, setUrl] = useState('')
  const [, setNow] = useState(new Date())
  const { pluginConfig, mutatePluginConfig } = usePluginConfig()
  const localIds = [
    ...new Set(items.flatMap((item) => (item.nodeSource ? [item.nodeSource.localProfileId] : [])))
  ].sort()
  const { data: localConfigs, mutate: mutateLocalConfigs } = useSWR(
    localIds.length ? (['profileSourceConfigs', localIds] as const) : null,
    async ([, ids]) => {
      const results = await Promise.allSettled(
        ids.map(async (id) => [id, await getLocalConfig(id)] as const)
      )
      return new Map(
        results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
      )
    }
  )
  useEffect(
    () =>
      window.electron.ipcRenderer.on('localConfigUpdated', () => {
        void mutateLocalConfigs()
      }),
    [mutateLocalConfigs]
  )
  const localSources = useMemo(
    () =>
      new Map(
        items.map((item) => {
          const localConfig = item.nodeSource
            ? localConfigs?.get(item.nodeSource.localProfileId)
            : undefined
          return [item.id, localConfig ? findProfileSource(localConfig, item) : undefined]
        })
      ),
    [items, localConfigs]
  )
  const [showPluginImport, setShowPluginImport] = useState(false)
  const [pluginDropFile, setPluginDropFile] = useState<File | null>(null)
  const [pluginFileData, setPluginFileData] = useState<IPluginFilePayload | null>(null)
  // bump per .cpx drop -> remount modal so it loads the new file even when open
  const [pluginDropSeq, setPluginDropSeq] = useState(0)
  const isUrlEmpty = url.trim() === ''
  const sensors = useSensors(useSensor(PointerSensor))
  const { data: subs = [], mutate: mutateSubs } = useSWR(
    useSubStore ? 'subStoreSubs' : undefined,
    useSubStore ? subStoreSubs : (): undefined => {}
  )
  const { data: collections = [], mutate: mutateCollections } = useSWR(
    useSubStore ? 'subStoreCollections' : undefined,
    useSubStore ? subStoreCollections : (): undefined => {}
  )
  const subStoreMenuItems = useMemo(() => {
    const items: { icon?: ReactNode; key: string; children: ReactNode; divider: boolean }[] = [
      {
        key: 'open-substore',
        children: t('profiles.substore.visit'),
        icon: <SubStoreIcon className="text-lg" />,
        divider:
          (Boolean(subs) && subs.length > 0) || (Boolean(collections) && collections.length > 0)
      }
    ]
    if (subs) {
      subs.forEach((sub, index) => {
        items.push({
          key: `sub-${sub.name}`,
          children: (
            <div className="flex justify-between">
              <div>{sub.displayName || sub.name}</div>
              <div>
                {sub.tag?.map((tag) => {
                  return (
                    <Chip key={tag} size="sm" className="ml-1" radius="sm">
                      {tag}
                    </Chip>
                  )
                })}
              </div>
            </div>
          ),
          icon: sub.icon ? <img src={sub.icon} className="h-4.5 w-4.5" /> : null,
          divider: index === subs.length - 1 && Boolean(collections) && collections.length > 0
        })
      })
    }
    if (collections) {
      collections.forEach((sub) => {
        items.push({
          key: `collection-${sub.name}`,
          children: (
            <div className="flex justify-between">
              <div>{sub.displayName || sub.name}</div>
              <div>
                {sub.tag?.map((tag) => {
                  return (
                    <Chip key={tag} size="sm" className="ml-1" radius="sm">
                      {tag}
                    </Chip>
                  )
                })}
              </div>
            </div>
          ),
          icon: sub.icon ? <img src={sub.icon} className="h-4.5 w-4.5" /> : null,
          divider: false
        })
      })
    }
    return items
  }, [subs, collections, t])
  const handleImport = async (): Promise<void> => {
    setImportItem({
      name: '',
      type: 'remote',
      url,
      useProxy
    })
  }
  const pageRef = useRef<HTMLDivElement>(null)

  const onDragEnd = async (event: DragEndEvent): Promise<void> => {
    const { active, over } = event
    if (over) {
      if (active.id !== over.id) {
        const newOrder = sortedItems.slice()
        const activeIndex = newOrder.findIndex((item) => item.id === active.id)
        const overIndex = newOrder.findIndex((item) => item.id === over.id)
        const [movedItem] = newOrder.splice(activeIndex, 1)
        newOrder.splice(overIndex, 0, movedItem)
        setSortedItems(newOrder)
        await setProfileConfig({ current, items: newOrder })
      }
    }
  }

  const handleImportRef = useRef(handleImport)
  handleImportRef.current = handleImport

  const tRef = useRef(t)
  tRef.current = t

  const handleInputKeyUp = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.currentTarget.value.trim() === '') return
    handleImportRef.current()
  }, [])

  const openPendingPluginFile = useCallback((): void => {
    const payload = takePendingPluginFile()
    if (!payload) return
    setPluginDropFile(null)
    setPluginFileData(payload)
    setPluginDropSeq((n) => n + 1)
    setShowPluginImport(true)
  }, [])

  useEffect(() => {
    openPendingPluginFile()
    return subscribePluginFile(openPendingPluginFile)
  }, [openPendingPluginFile])

  useEffect(() => {
    const element = pageRef.current
    if (!element) return

    const handleDragOver = (e: DragEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      setFileOver(true)
    }

    const handleDragLeave = (e: DragEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      setFileOver(false)
    }

    const handleDrop = async (event: DragEvent): Promise<void> => {
      event.preventDefault()
      event.stopPropagation()
      if (event.dataTransfer?.files) {
        const file = event.dataTransfer.files[0]
        const name = file?.name.toLowerCase() ?? ''
        if (name.endsWith('.yml') || name.endsWith('.yaml')) {
          try {
            const path = window.api.webUtils.getPathForFile(file)
            const content = await readTextFile(path)
            const item = { name: file.name, type: 'local' as const, file: content }
            setImportItem(item)
          } catch (e) {
            toast.error(String(e))
          }
        } else if (name.endsWith('.cpx')) {
          // .cpx -> plugin install modal (preview + confirm)
          setPluginFileData(null)
          setPluginDropFile(file)
          setPluginDropSeq((n) => n + 1)
          setShowPluginImport(true)
        } else if (file) {
          toast.warning(tRef.current('profiles.error.unsupportedFileType'))
        }
      }
      setFileOver(false)
    }

    element.addEventListener('dragover', handleDragOver)
    element.addEventListener('dragleave', handleDragLeave)
    element.addEventListener('drop', handleDrop)

    return (): void => {
      element.removeEventListener('dragover', handleDragOver)
      element.removeEventListener('dragleave', handleDragLeave)
      element.removeEventListener('drop', handleDrop)
    }
  }, [])

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    setSortedItems(items)
  }, [items])

  return (
    <BasePage
      ref={pageRef}
      title={t('profiles.title')}
      header={
        <>
          <Button
            size="sm"
            title={t('plugins.title')}
            isIconOnly
            variant="light"
            className="app-nodrag"
            onPress={() => {
              setPluginDropFile(null)
              setPluginFileData(null)
              setShowPluginImport(true)
            }}
          >
            <TbPuzzle className="text-lg" />
          </Button>
          <Button
            size="sm"
            title={t('profiles.updateAll')}
            className="app-nodrag"
            variant="light"
            isIconOnly
            onPress={async () => {
              setUpdating(true)
              for (const item of items) {
                if (item.id === current) continue
                if (item.type === 'remote') await addProfileItem(item)
                else if (item.pluginId) await updatePluginProfile(item.pluginId, true)
              }
              const currentItem = items.find((item) => item.id === current)
              if (currentItem && currentItem.type === 'remote') {
                await addProfileItem(currentItem)
              } else if (currentItem?.pluginId) {
                await updatePluginProfile(currentItem.pluginId, true)
              }
              setUpdating(false)
            }}
          >
            <IoMdRefresh className={`text-lg ${updating ? 'animate-spin' : ''}`} />
          </Button>
        </>
      }
    >
      {importItem && (
        <EditInfoModal
          mode="import"
          item={importItem as IProfileItem}
          onImported={() => {
            setUrl('')
          }}
          onClose={() => {
            setImportItem(null)
          }}
        />
      )}
      <div className="sticky profiles-sticky top-0 z-40 bg-background">
        <div className="flex flex-col gap-2 p-2">
          <div className="flex gap-2">
            <Input
              size="sm"
              placeholder={t('profiles.input.placeholder')}
              value={url}
              onValueChange={setUrl}
              onKeyUp={handleInputKeyUp}
              className="flex-1"
              endContent={
                <>
                  <Button
                    size="md"
                    isIconOnly
                    variant="light"
                    onPress={() => {
                      navigator.clipboard.readText().then((text) => {
                        setUrl(text)
                      })
                    }}
                    className="mr-2"
                  >
                    <MdContentPaste className="text-lg" />
                  </Button>
                  {/* p-0 m-0 覆盖 HeroUI 默认的 `p-2 -m-2`：负外边距会把点击热区外扩 8px，
                      正好盖住左边只有 mr-2 间距的粘贴按钮，导致点按钮变成切换代理开关 */}
                  <Checkbox
                    className="whitespace-nowrap p-0 m-0"
                    isSelected={useProxy}
                    onValueChange={setUseProxy}
                  >
                    {t('profiles.useProxy')}
                  </Checkbox>
                </>
              }
            />

            <Button size="sm" color="primary" isDisabled={isUrlEmpty} onPress={handleImport}>
              {t('profiles.import')}
            </Button>
            {useSubStore && (
              <Dropdown
                onOpenChange={() => {
                  mutateSubs()
                  mutateCollections()
                }}
              >
                <DropdownTrigger>
                  <Button
                    isLoading={subStoreImporting}
                    title="Sub-Store"
                    className="substore-import"
                    size="sm"
                    isIconOnly
                    color="primary"
                  >
                    <SubStoreIcon className="text-lg" />
                  </Button>
                </DropdownTrigger>
                <DropdownMenu
                  className="max-h-[calc(100vh-200px)] overflow-y-auto"
                  onAction={async (key) => {
                    if (key === 'open-substore') {
                      navigate('/substore')
                    } else if (key.toString().startsWith('sub-')) {
                      setSubStoreImporting(true)
                      try {
                        const sub = subs.find(
                          (sub) => sub.name === key.toString().replace('sub-', '')
                        )
                        const item: Partial<IProfileItem> = {
                          name: sub?.displayName || sub?.name || '',
                          substore: !useCustomSubStore,
                          type: 'remote',
                          url: useCustomSubStore
                            ? `${customSubStoreUrl}/download/${key.toString().replace('sub-', '')}?target=ClashMeta`
                            : `/download/${key.toString().replace('sub-', '')}`,
                          useProxy
                        }
                        setImportItem(item)
                      } catch (e) {
                        toast.error(String(e))
                      } finally {
                        setSubStoreImporting(false)
                      }
                    } else if (key.toString().startsWith('collection-')) {
                      setSubStoreImporting(true)
                      try {
                        const collection = collections.find(
                          (collection) =>
                            collection.name === key.toString().replace('collection-', '')
                        )
                        const item: Partial<IProfileItem> = {
                          name: collection?.displayName || collection?.name || '',
                          type: 'remote',
                          substore: !useCustomSubStore,
                          url: useCustomSubStore
                            ? `${customSubStoreUrl}/download/collection/${key.toString().replace('collection-', '')}?target=ClashMeta`
                            : `/download/collection/${key.toString().replace('collection-', '')}`,
                          useProxy
                        }
                        setImportItem(item)
                      } catch (e) {
                        toast.error(String(e))
                      } finally {
                        setSubStoreImporting(false)
                      }
                    }
                  }}
                >
                  {subStoreMenuItems.map((item) => (
                    <DropdownItem
                      startContent={item?.icon}
                      key={item.key}
                      showDivider={item.divider}
                    >
                      {item.children}
                    </DropdownItem>
                  ))}
                </DropdownMenu>
              </Dropdown>
            )}
            <Dropdown>
              <DropdownTrigger>
                <Button className="new-profile" size="sm" isIconOnly color="primary">
                  <FaPlus />
                </Button>
              </DropdownTrigger>
              <DropdownMenu
                onAction={async (key) => {
                  if (key === 'open') {
                    try {
                      const files = await getFilePath(['yml', 'yaml'])
                      if (files?.length) {
                        const content = await readTextFile(files[0])
                        const fileName = files[0].split('/').pop()?.split('\\').pop()
                        const item = { name: fileName, type: 'local' as const, file: content }
                        setImportItem(item)
                      }
                    } catch (e) {
                      toast.error(String(e))
                    }
                  } else if (key === 'new') {
                    await addProfileItem({
                      name: t('profiles.newProfile'),
                      type: 'local',
                      file: 'proxies: []\nproxy-groups: []\nrules: []'
                    })
                  } else if (key === 'import') {
                    setImportItem({
                      id: '',
                      name: '',
                      type: 'remote',
                      url: '',
                      override: [],
                      useProxy
                    })
                  }
                }}
              >
                <DropdownItem key="import">{t('profiles.import')}</DropdownItem>
                <DropdownItem key="open">{t('profiles.open')}</DropdownItem>
                <DropdownItem key="new">{t('profiles.new')}</DropdownItem>
              </DropdownMenu>
            </Dropdown>
          </div>
        </div>
        <Divider />
      </div>

      {showPluginImport && (
        <PluginInstallModal
          key={pluginDropSeq}
          initialFile={pluginDropFile ?? undefined}
          initialData={pluginFileData ?? undefined}
          onClose={() => {
            setShowPluginImport(false)
            setPluginDropFile(null)
            setPluginFileData(null)
            mutatePluginConfig()
          }}
        />
      )}
      {(pluginConfig?.items?.length ?? 0) > 0 && (
        <div className="px-2 mt-2 mb-3 grid grid-cols-1 gap-2">
          {pluginConfig?.items?.map((p) => (
            <PluginItem key={p.id} item={p} onChanged={mutatePluginConfig} />
          ))}
        </div>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <div
          className={`${fileOver ? 'blur-sm' : ''} grid sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 m-2`}
        >
          <SortableContext
            items={sortedItems.map((item) => {
              return item.id
            })}
          >
            {sortedItems.map((item) => (
              <ProfileItem
                key={item.id}
                isCurrent={item.id === current}
                source={localSources.get(item.id)}
                addProfileItem={addProfileItem}
                removeProfileItem={removeProfileItem}
                mutateProfileConfig={mutateProfileConfig}
                info={item}
                onPress={async () => {
                  await changeCurrentProfile(item.id)
                }}
              />
            ))}
          </SortableContext>
        </div>
      </DndContext>
    </BasePage>
  )
}

export default Profiles
