import {
  Button,
  Divider,
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
  Input
} from '@heroui/react'
import BasePage from '@renderer/components/base/base-page'
import { toast } from '@renderer/components/base/toast'
import { getFilePath, readTextFile } from '@renderer/utils/ipc'
import { useEffect, useRef, useState } from 'react'
import { MdContentPaste } from 'react-icons/md'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core'
import { SortableContext } from '@dnd-kit/sortable'
import { useOverrideConfig } from '@renderer/hooks/use-override-config'
import OverrideItem from '@renderer/components/override/override-item'
import { FaPlus } from 'react-icons/fa6'
import { HiOutlineDocumentText } from 'react-icons/hi'
import { RiArchiveLine } from 'react-icons/ri'
import { useTranslation } from 'react-i18next'

const Override: React.FC = () => {
  const { t } = useTranslation()
  const {
    overrideConfig,
    setOverrideConfig,
    addOverrideItem,
    updateOverrideItem,
    removeOverrideItem,
    mutateOverrideConfig
  } = useOverrideConfig()
  const { items = [] } = overrideConfig || {}
  const [sortedItems, setSortedItems] = useState(items)
  const [importing, setImporting] = useState(false)
  const [fileOver, setFileOver] = useState(false)
  const [url, setUrl] = useState('')
  const sensors = useSensors(useSensor(PointerSensor))
  const handleImport = async (): Promise<void> => {
    setImporting(true)
    try {
      const urlObj = new URL(url)
      const name = urlObj.pathname.split('/').pop()
      await addOverrideItem({
        name: name ? decodeURIComponent(name) : undefined,
        type: 'remote',
        url,
        ext: urlObj.pathname.endsWith('.js') ? 'js' : 'yaml'
      })
    } catch (e) {
      toast.error(t('override.error.importFailed', { error: String(e) }))
    } finally {
      setImporting(false)
    }
  }
  const pageRef = useRef<HTMLDivElement>(null)

  const onDragEnd = async (event: DragEndEvent): Promise<void> => {
    const { active, over } = event
    if (over) {
      if (active.id !== over.id) {
        const newOrder = sortedItems.slice()
        const activeIndex = newOrder.findIndex((item) => item.id === active.id)
        const overIndex = newOrder.findIndex((item) => item.id === over.id)
        newOrder.splice(activeIndex, 1)
        newOrder.splice(overIndex, 0, items[activeIndex])
        setSortedItems(newOrder)
        await setOverrideConfig({ items: newOrder })
      }
    }
  }

  const addOverrideItemRef = useRef(addOverrideItem)
  addOverrideItemRef.current = addOverrideItem

  const tRef = useRef(t)
  tRef.current = t

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
        if (file.name.endsWith('.js') || file.name.endsWith('.yaml')) {
          const content = await readTextFile((file as File & { path: string }).path)
          try {
            await addOverrideItemRef.current({
              name: file.name,
              type: 'local',
              file: content,
              ext: file.name.endsWith('.js') ? 'js' : 'yaml'
            })
          } finally {
            setFileOver(false)
          }
        } else {
          toast.warning(tRef.current('override.unsupportedFileType'))
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
    setSortedItems(items)
  }, [items])

  return (
    <BasePage
      ref={pageRef}
      title={t('override.title')}
      header={
        <>
          <Button
            size="sm"
            variant="light"
            title={t('override.docs')}
            isIconOnly
            className="app-nodrag"
            onPress={() => {
              open('https://mihomo.party/docs/guide/override')
            }}
          >
            <HiOutlineDocumentText className="text-lg" />
          </Button>
          <Button
            className="app-nodrag"
            title={t('override.repository')}
            isIconOnly
            variant="light"
            size="sm"
            onPress={() => {
              open('https://github.com/mihomo-party-org/override-hub')
            }}
          >
            <RiArchiveLine className="text-lg" />
          </Button>
        </>
      }
    >
      <div className="sticky top-0 z-40 bg-background">
        <div className="flex p-2">
          <Input
            size="sm"
            placeholder={t('override.input.placeholder')}
            value={url}
            onValueChange={setUrl}
            endContent={
              <Button
                size="sm"
                isIconOnly
                variant="light"
                onPress={() => {
                  navigator.clipboard.readText().then((text) => {
                    setUrl(text)
                  })
                }}
              >
                <MdContentPaste className="text-lg" />
              </Button>
            }
          />
          <Button
            size="sm"
            color="primary"
            className="ml-2"
            isDisabled={url === ''}
            isLoading={importing}
            onPress={handleImport}
          >
            {t('override.import')}
          </Button>
          <Dropdown>
            <DropdownTrigger>
              <Button className="ml-2" size="sm" isIconOnly color="primary">
                <FaPlus />
              </Button>
            </DropdownTrigger>
            <DropdownMenu
              onAction={async (key) => {
                if (key === 'open') {
                  try {
                    const files = await getFilePath(['js', 'yaml'])
                    if (files?.length) {
                      const content = await readTextFile(files[0])
                      const fileName = files[0].split('/').pop()?.split('\\').pop()
                      await addOverrideItem({
                        name: fileName,
                        type: 'local',
                        file: content,
                        ext: fileName?.endsWith('.js') ? 'js' : 'yaml'
                      })
                    }
                  } catch (e) {
                    toast.error(String(e))
                  }
                } else if (key === 'new-yaml') {
                  await addOverrideItem({
                    name: t('override.newFile.yaml'),
                    type: 'local',
                    file: t('override.defaultContent.yaml'),
                    ext: 'yaml'
                  })
                } else if (key === 'new-js') {
                  await addOverrideItem({
                    name: t('override.newFile.js'),
                    type: 'local',
                    file: t('override.defaultContent.js'),
                    ext: 'js'
                  })
                }
              }}
            >
              <DropdownItem key="open">{t('override.actions.open')}</DropdownItem>
              <DropdownItem key="new-yaml">{t('override.actions.newYaml')}</DropdownItem>
              <DropdownItem key="new-js">{t('override.actions.newJs')}</DropdownItem>
            </DropdownMenu>
          </Dropdown>
        </div>
        <Divider />
      </div>
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
              <OverrideItem
                key={item.id}
                addOverrideItem={addOverrideItem}
                removeOverrideItem={removeOverrideItem}
                mutateOverrideConfig={mutateOverrideConfig}
                updateOverrideItem={updateOverrideItem}
                info={item}
              />
            ))}
          </SortableContext>
        </div>
      </DndContext>
    </BasePage>
  )
}

export default Override
