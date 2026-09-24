import {
  Avatar,
  Button,
  Card,
  CardBody,
  Chip,
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownSection,
  DropdownTrigger,
  Switch,
  Spinner
} from '@heroui/react'
import BasePage from '@renderer/components/base/base-page'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import {
  getImageDataURL,
  mihomoChangeProxy,
  mihomoCloseAllConnections,
  mihomoProxyDelay,
  getSimpleConfig,
  reorderSimpleProxyGroups,
  removeSimpleProxyGroup
} from '@renderer/utils/ipc'
import { FaLocationCrosshairs } from 'react-icons/fa6'
import { CgDetailsLess, CgDetailsMore } from 'react-icons/cg'
import { TbCircleLetterD } from 'react-icons/tb'
import { RxLetterCaseCapitalize } from 'react-icons/rx'
import {
  MdCheck,
  MdAdd,
  MdDoubleArrow,
  MdFilterAlt,
  MdOutlineSpeed,
  MdEdit,
  MdVisibilityOff
} from 'react-icons/md'
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { GroupedVirtuoso, GroupedVirtuosoHandle } from 'react-virtuoso'
import ProxyItem from '@renderer/components/proxies/proxy-item'
import { IoIosArrowBack } from 'react-icons/io'
import { useGroups } from '@renderer/hooks/use-groups'
import CollapseInput from '@renderer/components/base/collapse-input'
import { includesIgnoreCase } from '@renderer/utils/includes'
import { loadProxiesSearch, saveProxiesSearch } from '@renderer/utils/proxies-search'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'
import { useTranslation } from 'react-i18next'
import { HiOutlineAdjustmentsHorizontal } from 'react-icons/hi2'
import useSWR from 'swr'
import { parse } from 'yaml'
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import GroupEditorModal from '@renderer/components/proxies/group-editor-modal'
import DeleteResourceButton from '@renderer/components/simple/delete-resource-button'
import SortableGroup from '@renderer/components/proxies/sortable-group'
import { toast } from '@renderer/components/base/toast'
import type { SimpleObject } from '../../../shared/simple-config'

const GROUP_EXPAND_STATE_KEY = 'proxy_group_expand_state'
const EMPTY_GROUPS: IMihomoMixedGroup[] = []
const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 })

interface GroupExpandState {
  byName: Record<string, boolean>
  legacy?: boolean[]
}

const loadGroupExpandState = (): GroupExpandState => {
  try {
    const savedState = localStorage.getItem(GROUP_EXPAND_STATE_KEY)
    if (!savedState) return { byName: {} }

    const parsed: unknown = JSON.parse(savedState)
    if (Array.isArray(parsed)) {
      return { byName: {}, legacy: parsed.map((isOpen) => isOpen === true) }
    }
    if (typeof parsed === 'object' && parsed !== null) {
      const byName: Record<string, boolean> = {}
      Object.entries(parsed).forEach(([name, isOpen]) => {
        if (typeof isOpen === 'boolean') {
          byName[name] = isOpen
        }
      })
      return { byName }
    }
  } catch (error) {
    console.error('Failed to load group expand state:', error)
  }
  return { byName: {} }
}

function getProviderName(proxy: IMihomoProxy | IMihomoGroup): string | undefined {
  return 'provider-name' in proxy ? proxy['provider-name'] : undefined
}

// 自定义 hook 用于管理展开状态
const useProxyState = (
  groups: IMihomoMixedGroup[] | undefined
): {
  virtuosoRef: React.RefObject<GroupedVirtuosoHandle | null>
  isOpen: boolean[]
  setIsOpen: React.Dispatch<React.SetStateAction<boolean[]>>
} => {
  const virtuosoRef = useRef<GroupedVirtuosoHandle | null>(null)
  const [expandState, setExpandState] = useState<GroupExpandState>(loadGroupExpandState)

  const isOpen = useMemo(
    () =>
      groups?.map(
        (group, index) => expandState.byName[group.name] ?? expandState.legacy?.[index] ?? false
      ) ?? [],
    [groups, expandState]
  )

  // 旧数组格式按当前加载的分组顺序迁移一次。
  useEffect(() => {
    if (!groups || expandState.legacy === undefined) return
    setExpandState((prev) => {
      if (prev.legacy === undefined) return prev
      const byName = { ...prev.byName }
      groups.forEach((group, index) => {
        byName[group.name] = prev.legacy?.[index] ?? false
      })
      return { byName }
    })
  }, [groups, expandState.legacy])

  useEffect(() => {
    if (expandState.legacy !== undefined) return
    try {
      localStorage.setItem(GROUP_EXPAND_STATE_KEY, JSON.stringify(expandState.byName))
    } catch (error) {
      console.error('Failed to save group expand state:', error)
    }
  }, [expandState])

  const setIsOpen = useCallback<React.Dispatch<React.SetStateAction<boolean[]>>>(
    (value) => {
      if (!groups) return
      setExpandState((prev) => {
        const current = groups.map(
          (group, index) => prev.byName[group.name] ?? prev.legacy?.[index] ?? false
        )
        const next = typeof value === 'function' ? value(current) : value
        const byName = { ...prev.byName }
        groups.forEach((group, index) => {
          byName[group.name] = next[index] ?? false
        })
        return { byName }
      })
    },
    [groups]
  )

  return {
    virtuosoRef,
    isOpen,
    setIsOpen
  }
}

const Proxies: React.FC = () => {
  const { t } = useTranslation()
  const { controledMihomoConfig } = useControledMihomoConfig()
  const { mode = 'rule' } = controledMihomoConfig || {}
  const { groups: groupData, mutate, showHidden, setShowHidden } = useGroups()
  const { appConfig, patchAppConfig } = useAppConfig()
  const simpleMode = appConfig?.operationMode === 'simple'
  const [editMode, setEditMode] = useState(false)
  const editing = simpleMode && editMode
  const [editingGroup, setEditingGroup] = useState<string>()
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [savingOrder, setSavingOrder] = useState(false)
  const [groupOrder, setGroupOrder] = useState<string[]>()
  const dragging = useRef(false)
  const lastDragEnd = useRef(0)
  const {
    data: simpleState,
    error: simpleError,
    mutate: mutateSimple
  } = useSWR(editing ? 'getSimpleConfig' : null, getSimpleConfig)
  const { configuredGroups, groupConfigError } = useMemo(() => {
    if (!simpleState) return { configuredGroups: [] }
    try {
      const parsed: unknown = parse(simpleState.draft.modules['proxy-groups'])
      if (
        !Array.isArray(parsed) ||
        parsed.some((group) => !group || typeof group.name !== 'string')
      ) {
        throw new Error('代理组配置必须是包含名称的对象列表')
      }
      return { configuredGroups: parsed as SimpleObject[] }
    } catch (error) {
      return { configuredGroups: [], groupConfigError: String(error) }
    }
  }, [simpleState])
  const groups = useMemo(() => {
    if (!editing) return groupData ?? EMPTY_GROUPS
    const entries = configuredGroups.map((group): IMihomoMixedGroup => {
      const runtime = groupData?.find((item) => item.name === group.name)
      return {
        alive: true,
        all: [],
        extra: {},
        hidden: false,
        history: [],
        now: '',
        tfo: false,
        udp: true,
        xudp: false,
        ...runtime,
        name: String(group.name),
        type: String(group.type) as MihomoGroupType,
        icon: typeof group.icon === 'string' ? group.icon : ''
      }
    })
    return groupOrder
      ? [...entries].sort((a, b) => groupOrder.indexOf(a.name) - groupOrder.indexOf(b.name))
      : entries
  }, [editing, configuredGroups, groupData, groupOrder])
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const openGroupEditor = useCallback(
    (name: string): void => {
      if (dragging.current || Date.now() - lastDragEnd.current < 250 || savingOrder) return
      setEditingGroup(name)
    },
    [savingOrder]
  )
  const onGroupDragEnd = async ({ active, over }: DragEndEvent): Promise<void> => {
    dragging.current = false
    lastDragEnd.current = Date.now()
    if (!over || active.id === over.id || savingOrder) return
    const names = groups.map((group) => group.name)
    const from = names.indexOf(String(active.id))
    const to = names.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    const order = arrayMove(names, from, to)
    setGroupOrder(order)
    setSavingOrder(true)
    try {
      await reorderSimpleProxyGroups(order)
      await mutateSimple()
      await mutate()
    } catch (error) {
      toast.error(String(error))
    } finally {
      setGroupOrder(undefined)
      setSavingOrder(false)
    }
  }
  useEffect(() => {
    if (!simpleMode) {
      setEditMode(false)
      setEditingGroup(undefined)
      setCreatingGroup(false)
    }
  }, [simpleMode])
  const {
    proxyDisplayMode = 'simple',
    proxyDisplayOrder = 'default',
    autoCloseConnection = true,
    proxyCols = 'auto',
    delayTestConcurrency = 50
  } = appConfig || {}

  const [cols, setCols] = useState(1)
  const { virtuosoRef, isOpen, setIsOpen } = useProxyState(groups)
  const [delaying, setDelaying] = useState<Set<string>[]>(() =>
    Array.from({ length: groups.length }, () => new Set<string>())
  )
  const [searchValue, setSearchValue] = useState<string[]>(() => loadProxiesSearch(groups.length))

  // searchValue 初始化：保留已暂存的筛选词（#1621），仅在长度变化时扩/缩
  useEffect(() => {
    if (groups.length !== searchValue.length) {
      setSearchValue((prev) => {
        const next = loadProxiesSearch(groups.length)
        // 若 localStorage 尚无数据，则按当前内存态截断/补齐
        if (next.every((v) => v === '')) {
          return Array.from({ length: groups.length }, (_, i) => prev[i] ?? '')
        }
        return next
      })
    }
  }, [groups.length, searchValue.length])

  useEffect(() => {
    saveProxiesSearch(searchValue)
  }, [searchValue])

  useEffect(() => {
    setDelaying((prev) => {
      if (prev.length === groups.length) return prev
      return Array.from({ length: groups.length }, (_, i) => prev[i] ?? new Set<string>())
    })
  }, [groups.length])

  // 代理列表排序
  const sortProxies = useCallback((proxies: (IMihomoProxy | IMihomoGroup)[], order: string) => {
    if (order === 'delay') {
      return [...proxies].sort((a, b) => {
        if (a.history.length === 0) return 1
        if (b.history.length === 0) return -1
        const aDelay = a.history[a.history.length - 1].delay
        const bDelay = b.history[b.history.length - 1].delay
        if (aDelay === 0) return 1
        if (bDelay === 0) return -1
        return aDelay - bDelay
      })
    }
    if (order === 'name') {
      return [...proxies].sort((a, b) => a.name.localeCompare(b.name))
    }
    return proxies
  }, [])

  const { groupCounts, allProxies } = useMemo(() => {
    const groupCounts: number[] = []
    const allProxies: (IMihomoProxy | IMihomoGroup)[][] = []

    groups.forEach((group, index) => {
      if (!editing && isOpen[index]) {
        const filtered = group.all.filter((proxy) => {
          if (!proxy) return false
          if (!includesIgnoreCase(proxy.name, searchValue[index])) {
            return false
          }
          if (appConfig?.hideUnavailableProxies) {
            const isGroup = 'all' in proxy
            if (isGroup) {
              return true
            }
            if (!proxy.history || proxy.history.length === 0) {
              return true
            }
            const lastDelay = proxy.history[proxy.history.length - 1].delay
            if (lastDelay === 0) {
              return false
            }
          }
          return true
        })
        const sorted = sortProxies(filtered, proxyDisplayOrder)
        const count = Math.ceil(sorted.length / cols)
        groupCounts.push(count)
        allProxies.push(sorted)
      } else {
        groupCounts.push(0)
        allProxies.push([])
      }
    })
    return { groupCounts, allProxies }
  }, [
    groups,
    isOpen,
    proxyDisplayOrder,
    cols,
    searchValue,
    sortProxies,
    appConfig?.hideUnavailableProxies,
    editing
  ])

  const onChangeProxy = useCallback(
    async (group: string, proxy: string): Promise<void> => {
      await mihomoChangeProxy(group, proxy)
      if (autoCloseConnection) {
        await mihomoCloseAllConnections()
      }
      mutate()
    },
    [autoCloseConnection, mutate]
  )

  const onProxyDelay = useCallback(
    async (proxy: IMihomoProxy | IMihomoGroup, url?: string): Promise<IMihomoDelay> => {
      return await mihomoProxyDelay(proxy.name, url, getProviderName(proxy))
    },
    []
  )

  // 组测速时逐节点写回会造成 O(N²) 分配与 N 次 allProxies 重算
  const pendingDelayResults = useRef<Map<string, Map<string, { time: string; delay: number }>>>(
    new Map()
  )
  const pendingDelayDone = useRef<Map<number, Set<string>>>(new Map())
  const flushDelayTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushDelayResults = useCallback((): void => {
    if (flushDelayTimer.current) {
      clearTimeout(flushDelayTimer.current)
      flushDelayTimer.current = null
    }
    const results = pendingDelayResults.current
    const done = pendingDelayDone.current
    if (results.size === 0 && done.size === 0) return

    // 把 ref 换成新的空容器，updater 只读这份脱离 ref 的快照
    pendingDelayResults.current = new Map()
    pendingDelayDone.current = new Map()

    if (results.size > 0) {
      mutate(
        (current) => {
          if (!current) return current
          let changed = false
          const next = current.map((group) => {
            const groupResults = results.get(group.name)
            if (!groupResults || groupResults.size === 0) return group
            let groupChanged = false
            const all = group.all.map((p) => {
              const entry = groupResults.get(p.name)
              if (!entry) return p
              groupChanged = true
              return { ...p, history: [...p.history, entry] }
            })
            if (!groupChanged) return group
            changed = true
            return { ...group, all }
          })
          return changed ? next : current
        },
        { revalidate: false }
      )
    }

    if (done.size > 0) {
      setDelaying((prev) => {
        let changed = false
        const next = [...prev]
        done.forEach((names, idx) => {
          const set = next[idx]
          if (!set) return
          const newSet = new Set(set)
          let localChanged = false
          names.forEach((name) => {
            if (newSet.delete(name)) localChanged = true
          })
          if (localChanged) {
            next[idx] = newSet
            changed = true
          }
        })
        return changed ? next : prev
      })
    }
  }, [mutate])

  const scheduleFlushDelayResults = useCallback((): void => {
    if (flushDelayTimer.current) return
    flushDelayTimer.current = setTimeout(flushDelayResults, 200)
  }, [flushDelayResults])

  useEffect(() => {
    return (): void => {
      if (flushDelayTimer.current) {
        clearTimeout(flushDelayTimer.current)
        flushDelayTimer.current = null
      }
    }
  }, [])

  const onGroupDelay = useCallback(
    async (index: number): Promise<void> => {
      if (allProxies[index].length === 0) {
        setIsOpen((prev) => {
          const newOpen = [...prev]
          newOpen[index] = true
          return newOpen
        })
      }
      const proxyNames = allProxies[index].map((p) => p.name)
      setDelaying((prev) => {
        const next = [...prev]
        next[index] = new Set(proxyNames)
        return next
      })

      // 限制并发数量
      const result: Promise<void>[] = []
      const runningList: Promise<void>[] = []
      for (const proxy of allProxies[index]) {
        const promise = Promise.resolve().then(async () => {
          let res: IMihomoDelay | undefined
          try {
            res = await mihomoProxyDelay(proxy.name, groups[index].testUrl, getProviderName(proxy))
          } catch {
            // ignore
          }
          const groupName = groups[index].name
          let groupResults = pendingDelayResults.current.get(groupName)
          if (!groupResults) {
            groupResults = new Map()
            pendingDelayResults.current.set(groupName, groupResults)
          }
          groupResults.set(proxy.name, {
            time: new Date().toISOString(),
            delay: res?.delay ?? 0
          })

          let groupDone = pendingDelayDone.current.get(index)
          if (!groupDone) {
            groupDone = new Set()
            pendingDelayDone.current.set(index, groupDone)
          }
          groupDone.add(proxy.name)

          scheduleFlushDelayResults()
        })
        result.push(promise)
        const running = promise.then(() => {
          runningList.splice(runningList.indexOf(running), 1)
        })
        runningList.push(running)
        if (runningList.length >= (delayTestConcurrency || 50)) {
          await Promise.race(runningList)
        }
      }
      await Promise.all(result)
      flushDelayResults()
    },
    [
      allProxies,
      groups,
      delayTestConcurrency,
      scheduleFlushDelayResults,
      flushDelayResults,
      setIsOpen
    ]
  )

  const calcCols = useCallback((): number => {
    if (proxyCols !== 'auto') {
      return parseInt(proxyCols)
    }
    if (window.matchMedia('(min-width: 1536px)').matches) return 5
    if (window.matchMedia('(min-width: 1280px)').matches) return 4
    if (window.matchMedia('(min-width: 1024px)').matches) return 3
    return 2
  }, [proxyCols])

  useEffect(() => {
    const handleResize = (): void => {
      setCols(calcCols())
    }

    handleResize() // 初始化
    window.addEventListener('resize', handleResize)

    return (): void => {
      window.removeEventListener('resize', handleResize)
    }
  }, [calcCols])

  const renderGroupContent = useCallback(
    (index: number) => {
      if (
        groups[index]?.icon &&
        groups[index].icon.startsWith('http') &&
        !localStorage.getItem(groups[index].icon)
      ) {
        getImageDataURL(groups[index].icon)
          .then((dataURL) => {
            localStorage.setItem(groups[index].icon, dataURL)
            mutate()
          })
          .catch(() => {})
      }
      return groups[index] ? (
        <div
          className={`w-full pt-2 ${index === groupCounts.length - 1 && !isOpen[index] ? 'pb-2' : ''} px-2`}
        >
          <Card
            as="div"
            isPressable
            fullWidth
            onPress={() => {
              if (editing) {
                openGroupEditor(groups[index].name)
                return
              }
              setIsOpen((prev) => {
                const newOpen = [...prev]
                newOpen[index] = !prev[index]
                return newOpen
              })
            }}
          >
            <CardBody className="w-full h-14">
              <div className="flex justify-between h-full gap-3">
                <div className="flex min-w-0 h-full text-ellipsis overflow-hidden whitespace-nowrap">
                  {groups[index].icon ? (
                    <Avatar
                      className="bg-transparent mr-2 shrink-0"
                      size="sm"
                      radius="sm"
                      src={
                        groups[index].icon.startsWith('<svg')
                          ? `data:image/svg+xml;utf8,${groups[index].icon}`
                          : localStorage.getItem(groups[index].icon) || groups[index].icon
                      }
                    />
                  ) : null}
                  <div className="flex min-w-0 flex-col h-full">
                    <div className="text-ellipsis overflow-hidden whitespace-nowrap leading-tight text-md flex-5 flex items-center">
                      <span title={groups[index].name} className="flag-emoji inline-block truncate">
                        {groups[index].name}
                      </span>
                    </div>
                    <div className="text-ellipsis overflow-hidden whitespace-nowrap text-[10px] text-foreground-500 leading-tight flex-3 flex items-center">
                      <span>{groups[index].type}</span>
                      <span
                        title={groups[index].now}
                        className="flag-emoji ml-1 inline-block truncate"
                      >
                        {groups[index].now}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center">
                  <div
                    className="flex items-center"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    {editing ? (
                      <>
                        <Button
                          title="编辑代理组"
                          aria-label={`编辑 ${groups[index].name}`}
                          variant="light"
                          size="sm"
                          isIconOnly
                          isDisabled={savingOrder}
                          onPress={() => openGroupEditor(groups[index].name)}
                        >
                          <MdEdit className="text-lg text-foreground-500" />
                        </Button>
                        <DeleteResourceButton
                          label={`代理组 ${groups[index].name}`}
                          disabled={savingOrder}
                          onDelete={async () => {
                            const group = configuredGroups.find(
                              (entry) => entry.name === groups[index].name
                            )
                            if (!group) throw new Error('代理组已变化，请刷新')
                            await removeSimpleProxyGroup(groups[index].name, group)
                            await mutateSimple()
                            await mutate()
                          }}
                        />
                      </>
                    ) : (
                      <>
                        {proxyDisplayMode === 'full' && (
                          <Chip size="sm" className="my-1 mr-2">
                            {/* 搜索时显示过滤后的节点数，显示总数会让人以为筛选没生效（#332） */}
                            {searchValue[index] && isOpen[index]
                              ? (allProxies[index]?.length ?? 0)
                              : groups[index].all.length}
                          </Chip>
                        )}
                        <CollapseInput
                          title={t('proxies.search.placeholder')}
                          value={searchValue[index]}
                          onValueChange={(v) => {
                            setSearchValue((prev) => {
                              const newSearchValue = [...prev]
                              newSearchValue[index] = v
                              // 立即落盘，组件卸载/切页后仍可恢复（#1621）
                              saveProxiesSearch(newSearchValue)
                              return newSearchValue
                            })
                            // 过滤会改变列表总高度。不把正在筛选的分组标题钉回顶部的话，
                            // 它会被滚出渲染窗口而卸载，搜索框随之消失、焦点丢失，
                            // 中文输入法的组词也被打断（#332、#1621）。
                            virtuosoRef.current?.scrollToIndex({
                              groupIndex: index,
                              align: 'start'
                            })
                          }}
                        />
                        <Button
                          title={t('proxies.locate')}
                          variant="light"
                          size="sm"
                          isIconOnly
                          onPress={() => {
                            if (!isOpen[index]) {
                              setIsOpen((prev) => {
                                const newOpen = [...prev]
                                newOpen[index] = true
                                return newOpen
                              })
                            }
                            let i = 0
                            for (let j = 0; j < index; j++) {
                              i += groupCounts[j]
                            }
                            i += Math.floor(
                              allProxies[index].findIndex(
                                (proxy) => proxy.name === groups[index].now
                              ) / cols
                            )
                            virtuosoRef.current?.scrollToIndex({
                              index: Math.floor(i),
                              align: 'start'
                            })
                          }}
                        >
                          <FaLocationCrosshairs className="text-lg text-foreground-500" />
                        </Button>
                        <Button
                          title={t('proxies.delay.test')}
                          variant="light"
                          isLoading={(delaying[index]?.size ?? 0) > 0}
                          size="sm"
                          isIconOnly
                          onPress={() => {
                            onGroupDelay(index)
                          }}
                        >
                          <MdOutlineSpeed className="text-lg text-foreground-500" />
                        </Button>
                      </>
                    )}
                  </div>
                  {!editing && (
                    <IoIosArrowBack
                      className={`transition duration-200 ml-2 h-8 text-lg text-foreground-500 ${isOpen[index] ? '-rotate-90' : ''}`}
                    />
                  )}
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      ) : (
        <div>Never See This</div>
      )
    },
    [
      groups,
      groupCounts,
      isOpen,
      proxyDisplayMode,
      t,
      searchValue,
      delaying,
      mutate,
      setIsOpen,
      allProxies,
      cols,
      virtuosoRef,
      onGroupDelay,
      editing,
      openGroupEditor,
      configuredGroups,
      mutateSimple,
      savingOrder
    ]
  )

  const renderItemContent = useCallback(
    (index: number, groupIndex: number) => {
      let innerIndex = index
      groupCounts.slice(0, groupIndex).forEach((count) => {
        innerIndex -= count
      })
      return allProxies[groupIndex] ? (
        <div
          style={
            proxyCols !== 'auto'
              ? { gridTemplateColumns: `repeat(${proxyCols}, minmax(0, 1fr))` }
              : {}
          }
          className={`grid ${proxyCols === 'auto' ? 'sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5' : ''} ${groupIndex === groupCounts.length - 1 && innerIndex === groupCounts[groupIndex] - 1 ? 'pb-2' : ''} gap-2 pt-2 mx-2`}
        >
          {Array.from({ length: cols }).map((_, i) => {
            if (!allProxies[groupIndex][innerIndex * cols + i]) return null
            return (
              <ProxyItem
                key={allProxies[groupIndex][innerIndex * cols + i].name}
                mutateProxies={mutate}
                onProxyDelay={onProxyDelay}
                onSelect={onChangeProxy}
                proxy={allProxies[groupIndex][innerIndex * cols + i]}
                group={groups[groupIndex]}
                proxyDisplayMode={proxyDisplayMode}
                selected={
                  allProxies[groupIndex][innerIndex * cols + i]?.name === groups[groupIndex].now
                }
                isGroupTesting={
                  delaying[groupIndex]?.has(allProxies[groupIndex][innerIndex * cols + i].name) ??
                  false
                }
              />
            )
          })}
        </div>
      ) : (
        <div>Never See This</div>
      )
    },
    [
      groupCounts,
      allProxies,
      proxyCols,
      cols,
      groups,
      proxyDisplayMode,
      delaying,
      mutate,
      onProxyDelay,
      onChangeProxy
    ]
  )

  return (
    <BasePage
      title={t('proxies.title')}
      header={
        <>
          <Dropdown placement="bottom-end">
            <DropdownTrigger>
              <Button
                size="sm"
                isIconOnly
                variant="light"
                className="app-nodrag"
                title={t('proxies.settings')}
              >
                <HiOutlineAdjustmentsHorizontal className="text-lg" />
              </Button>
            </DropdownTrigger>
            <DropdownMenu
              aria-label={t('proxies.settings')}
              className="min-w-64 p-1"
              onAction={(key) => {
                switch (key) {
                  case 'edit-groups':
                    setEditMode((enabled) => !enabled)
                    setEditingGroup(undefined)
                    break
                  case 'show-hidden':
                    setShowHidden((prev) => !prev)
                    break
                  case 'hide-unavailable':
                    void patchAppConfig({
                      hideUnavailableProxies: !appConfig?.hideUnavailableProxies
                    })
                    break
                  case 'order-default':
                    void patchAppConfig({ proxyDisplayOrder: 'default' })
                    break
                  case 'order-delay':
                    void patchAppConfig({ proxyDisplayOrder: 'delay' })
                    break
                  case 'order-name':
                    void patchAppConfig({ proxyDisplayOrder: 'name' })
                    break
                  case 'mode-simple':
                    void patchAppConfig({ proxyDisplayMode: 'simple' })
                    break
                  case 'mode-full':
                    void patchAppConfig({ proxyDisplayMode: 'full' })
                    break
                }
              }}
            >
              {simpleMode ? (
                <DropdownSection showDivider>
                  <DropdownItem
                    key="edit-groups"
                    startContent={<MdEdit className="text-lg" />}
                    isDisabled={savingOrder}
                    endContent={
                      <Switch
                        size="sm"
                        aria-label="编辑模式"
                        isSelected={editing}
                        isReadOnly
                        tabIndex={-1}
                        className="pointer-events-none"
                      />
                    }
                  >
                    编辑模式
                  </DropdownItem>
                </DropdownSection>
              ) : null}
              <DropdownSection title={t('proxies.settings.visibility')} showDivider>
                <DropdownItem
                  key="show-hidden"
                  startContent={<MdFilterAlt className="text-lg" />}
                  endContent={showHidden ? <MdCheck className="text-lg text-primary" /> : null}
                >
                  {t(showHidden ? 'proxies.hiddenGroups.hide' : 'proxies.hiddenGroups.show')}
                </DropdownItem>
                <DropdownItem
                  key="hide-unavailable"
                  startContent={<MdVisibilityOff className="text-lg" />}
                  endContent={
                    appConfig?.hideUnavailableProxies ? (
                      <MdCheck className="text-lg text-primary" />
                    ) : null
                  }
                >
                  {t(
                    appConfig?.hideUnavailableProxies
                      ? 'proxies.hideUnavailable.enabled'
                      : 'proxies.hideUnavailable.disabled'
                  )}
                </DropdownItem>
              </DropdownSection>
              <DropdownSection title={t('proxies.settings.order')} showDivider>
                <DropdownItem
                  key="order-default"
                  startContent={<TbCircleLetterD className="text-lg" />}
                  endContent={
                    proxyDisplayOrder === 'default' ? (
                      <MdCheck className="text-lg text-primary" />
                    ) : null
                  }
                >
                  {t('proxies.order.default')}
                </DropdownItem>
                <DropdownItem
                  key="order-delay"
                  startContent={<MdOutlineSpeed className="text-lg" />}
                  endContent={
                    proxyDisplayOrder === 'delay' ? (
                      <MdCheck className="text-lg text-primary" />
                    ) : null
                  }
                >
                  {t('proxies.order.delay')}
                </DropdownItem>
                <DropdownItem
                  key="order-name"
                  startContent={<RxLetterCaseCapitalize className="text-lg" />}
                  endContent={
                    proxyDisplayOrder === 'name' ? (
                      <MdCheck className="text-lg text-primary" />
                    ) : null
                  }
                >
                  {t('proxies.order.name')}
                </DropdownItem>
              </DropdownSection>
              <DropdownSection title={t('proxies.settings.mode')}>
                <DropdownItem
                  key="mode-simple"
                  startContent={<CgDetailsLess className="text-lg" />}
                  endContent={
                    proxyDisplayMode === 'simple' ? (
                      <MdCheck className="text-lg text-primary" />
                    ) : null
                  }
                >
                  {t('proxies.mode.simple')}
                </DropdownItem>
                <DropdownItem
                  key="mode-full"
                  startContent={<CgDetailsMore className="text-lg" />}
                  endContent={
                    proxyDisplayMode === 'full' ? (
                      <MdCheck className="text-lg text-primary" />
                    ) : null
                  }
                >
                  {t('proxies.mode.full')}
                </DropdownItem>
              </DropdownSection>
            </DropdownMenu>
          </Dropdown>
        </>
      }
    >
      {editing && (editingGroup !== undefined || creatingGroup) && (
        <GroupEditorModal
          key={creatingGroup ? 'new-group' : `edit:${editingGroup}`}
          name={editingGroup}
          onClose={() => {
            setEditingGroup(undefined)
            setCreatingGroup(false)
          }}
          onSaved={() => {
            void mutateSimple()
            void mutate()
          }}
        />
      )}
      {editing ? (
        <>
          {!simpleState && !simpleError && (
            <div className="flex justify-center p-6">
              <Spinner aria-label="加载代理组" />
            </div>
          )}
          {(simpleError || groupConfigError) && (
            <div role="alert" className="p-3 text-danger text-sm">
              {String(simpleError || groupConfigError)}
            </div>
          )}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragStart={() => {
              dragging.current = true
            }}
            onDragEnd={onGroupDragEnd}
            onDragCancel={() => {
              dragging.current = false
              lastDragEnd.current = Date.now()
            }}
          >
            <SortableContext
              items={groups.map((group) => group.name)}
              strategy={verticalListSortingStrategy}
            >
              {groups.map((group, index) => (
                <SortableGroup
                  key={group.name}
                  name={group.name}
                  disabled={savingOrder || !!editingGroup || creatingGroup}
                >
                  {renderGroupContent(index)}
                </SortableGroup>
              ))}
            </SortableContext>
          </DndContext>
          <div className="px-2 pb-2">
            <Card
              isPressable
              fullWidth
              isDisabled={savingOrder || !simpleState || !!simpleError || !!groupConfigError}
              onPress={() => setCreatingGroup(true)}
            >
              <CardBody className="flex h-14 flex-row items-center justify-center gap-2 text-foreground-500">
                <MdAdd className="text-xl" />
                <span className="text-sm">添加代理组</span>
              </CardBody>
            </Card>
          </div>
        </>
      ) : mode === 'direct' ? (
        <div className="h-full w-full flex justify-center items-center">
          <div className="flex flex-col items-center">
            <MdDoubleArrow className="text-foreground-500 text-[100px]" />
            <h2 className="text-foreground-500 text-[20px]">{t('proxies.mode.direct')}</h2>
          </div>
        </div>
      ) : (
        <div className="h-[calc(100vh-50px)]">
          {/* Reset Virtuoso's measured sizes after toggling unavailable proxy filtering. */}
          <GroupedVirtuoso
            key={appConfig?.hideUnavailableProxies ? 'hide-unavailable' : 'show-unavailable'}
            ref={virtuosoRef}
            groupCounts={groupCounts}
            defaultItemHeight={80}
            increaseViewportBy={{ top: 150, bottom: 150 }}
            overscan={200}
            computeItemKey={(index, groupIndex) => `${groupIndex}-${index}`}
            groupContent={renderGroupContent}
            itemContent={renderItemContent}
          />
        </div>
      )}
    </BasePage>
  )
}

export default Proxies
