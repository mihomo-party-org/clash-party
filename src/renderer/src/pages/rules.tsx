import BasePage from '@renderer/components/base/base-page'
import RuleItem from '@renderer/components/rules/rule-item'
import { Virtuoso } from 'react-virtuoso'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Divider, Input, Spinner } from '@heroui/react'
import { useRules } from '@renderer/hooks/use-rules'
import { includesIgnoreCase } from '@renderer/utils/includes'
import { useTranslation } from 'react-i18next'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import useSWR from 'swr'
import { MdAdd } from 'react-icons/md'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import SortableGroup from '@renderer/components/proxies/sortable-group'
import EditModeMenu from '@renderer/components/simple/edit-mode-menu'
import RuleEditorModal from '@renderer/components/rules/rule-editor-modal'
import { getSimpleRulesEditor, saveSimpleRules } from '@renderer/utils/ipc'
import { toast } from '@renderer/components/base/toast'
import { useImeSafeValueChange } from '@renderer/hooks/use-ime-safe-value-change'
import { parseSimpleRule } from '../../../shared/simple-rules'
import type { SimpleRuleEditor } from '../../../shared/simple-config'

const RULES_FILTER_KEY = 'rules-filter'

const Rules: React.FC = () => {
  const { rules, mutate } = useRules()
  const [filter, setFilter] = useState(() => localStorage.getItem(RULES_FILTER_KEY) || '')
  const filterIme = useImeSafeValueChange(setFilter)
  const { t } = useTranslation()
  const { appConfig } = useAppConfig()
  const simple = appConfig?.operationMode === 'simple'
  const [editMode, setEditMode] = useState(false)
  const editing = simple && editMode
  const {
    data,
    error,
    mutate: refresh
  } = useSWR(editing ? 'getSimpleRulesEditor' : null, getSimpleRulesEditor)
  const [editor, setEditor] = useState<{
    index: number | null
    insertAt?: number
    data: SimpleRuleEditor
  }>()
  const [savingOrder, setSavingOrder] = useState(false)
  useEffect(() => {
    if (!editing) return
    return window.electron.ipcRenderer.on('simpleConfigUpdated', () => {
      void refresh()
    })
  }, [editing, refresh])
  const [dragging, setDragging] = useState(false)
  const lastDragEnd = useRef(0)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const saved = (): void => {
    void refresh()
    mutate()
  }
  const open = (index: number | null, insertAt?: number): void => {
    if (data && !error && !savingOrder && !dragging && Date.now() - lastDragEnd.current > 250)
      setEditor({ index, insertAt, data })
  }
  const renderInsertion = (index: number, before = false): React.ReactNode => {
    if (!data || filter.trim() || savingOrder || dragging || editor || error) return null
    return (
      <div
        className={`group absolute inset-x-2 ${before ? '-top-1' : '-bottom-1'} z-10 flex h-4 items-center justify-center`}
      >
        <div className="pointer-events-none absolute inset-x-2 h-px bg-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" />
        <Button
          size="sm"
          color="primary"
          aria-label={index === 0 ? '在规则列表顶部新建规则' : `在第 ${index} 条规则后新建规则`}
          className={`h-6 min-w-0 gap-1 px-2 ${data.rules.length ? 'opacity-0' : 'opacity-100'} group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100`}
          startContent={<MdAdd className="text-base" />}
          onPress={() => open(null, index)}
        >
          新建
        </Button>
      </div>
    )
  }
  const reorder = async ({ active, over }: DragEndEvent): Promise<void> => {
    setDragging(false)
    lastDragEnd.current = Date.now()
    if (!data || !over || active.id === over.id || filter.trim() || savingOrder) return
    const indices = data.rules.map((_, index) => index)
    const from = indices.findIndex((index) => `rule:${index}` === active.id)
    const to = indices.findIndex((index) => `rule:${index}` === over.id)
    if (from < 0 || to < 0) return
    setSavingOrder(true)
    try {
      await saveSimpleRules({ action: 'reorder', order: arrayMove(indices, from, to) }, data.rules)
      await refresh()
      mutate()
    } catch (error) {
      toast.error(String(error))
    } finally {
      setSavingOrder(false)
    }
  }
  useEffect(() => {
    if (!simple) {
      setEditMode(false)
      setEditor(undefined)
    }
  }, [simple])

  useEffect(() => {
    localStorage.setItem(RULES_FILTER_KEY, filter)
  }, [filter])

  const filteredRules = useMemo<IMihomoRulesDetail[]>(() => {
    const entries = editing
      ? (data?.rules || []).map((rule, index) => {
          const parsed = parseSimpleRule(rule)
          return {
            index,
            type: parsed.type,
            payload: parsed.payload || parsed.type,
            proxy: parsed.target,
            size: -1
          }
        })
      : rules?.rules || []
    if (filter === '') return entries
    return entries.filter((rule) => {
      return (
        includesIgnoreCase(rule.payload, filter) ||
        includesIgnoreCase(rule.type, filter) ||
        includesIgnoreCase(rule.proxy, filter)
      )
    })
  }, [rules, filter, editing, data])

  return (
    <BasePage
      title={t('rules.title')}
      header={
        simple ? (
          <EditModeMenu
            enabled={editing}
            disabled={savingOrder}
            onChange={(enabled) => {
              setEditMode(enabled)
              setEditor(undefined)
            }}
          />
        ) : undefined
      }
    >
      {editing && editor && (
        <RuleEditorModal
          index={editor.index}
          insertAt={editor.insertAt}
          data={editor.data}
          onClose={() => setEditor(undefined)}
          onSaved={saved}
        />
      )}
      <div className="sticky top-0 z-40 bg-background">
        <div className="flex p-2">
          <Input
            size="sm"
            value={filter}
            placeholder={t('rules.filter')}
            isClearable
            onValueChange={filterIme.onValueChange}
            onCompositionStart={filterIme.onCompositionStart}
            onCompositionEnd={filterIme.onCompositionEnd}
          />
        </div>
        <Divider />
      </div>
      {editing ? (
        <>
          {!data && !error && (
            <div className="flex justify-center p-6">
              <Spinner aria-label="加载规则" />
            </div>
          )}
          {error && (
            <div role="alert" className="p-3 text-sm text-danger">
              {String(error)}
            </div>
          )}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[({ transform }) => ({ ...transform, x: 0 })]}
            onDragStart={() => {
              setDragging(true)
            }}
            onDragEnd={reorder}
            onDragCancel={() => {
              setDragging(false)
              lastDragEnd.current = Date.now()
            }}
          >
            <SortableContext
              items={filteredRules.map((rule) => `rule:${rule.index}`)}
              strategy={verticalListSortingStrategy}
            >
              <div className="py-3">
                {data?.rules.length === 0 && (
                  <div className="relative h-8">{renderInsertion(0, true)}</div>
                )}
                {filteredRules.map((rule, position) => (
                  <div key={`rule:${rule.index}`} className="relative">
                    {position === 0 && renderInsertion(0, true)}
                    <SortableGroup
                      name={`rule:${rule.index}`}
                      disabled={savingOrder || !!editor || !!filter.trim()}
                    >
                      <RuleItem
                        {...rule}
                        onEdit={() => open(rule.index)}
                        onDelete={
                          data && !savingOrder
                            ? async () => {
                                await saveSimpleRules(
                                  { action: 'remove', index: rule.index },
                                  data.rules
                                )
                                saved()
                              }
                            : undefined
                        }
                      />
                    </SortableGroup>
                    {renderInsertion(rule.index + 1)}
                  </div>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </>
      ) : (
        <div className="h-[calc(100vh-100px)] mt-px">
          <Virtuoso
            data={filteredRules}
            itemContent={(i, rule) => (
              <RuleItem
                index={rule.index ?? i}
                type={rule.type}
                payload={rule.payload}
                proxy={rule.proxy}
                size={rule.size}
                extra={rule.extra}
              />
            )}
          />
        </div>
      )}
    </BasePage>
  )
}

export default Rules
