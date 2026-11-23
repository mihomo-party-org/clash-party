import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultLocalDraft, type LocalDraft } from '../../../../shared/local-config'
import Proxies from '../../pages/proxies'
import LocalNodes from './local-nodes'

const { hooks, swr, ipc } = vi.hoisted(() => ({
  hooks: {
    state: [] as unknown[],
    refs: [] as Array<{ current: unknown }>,
    stateCursor: 0,
    refCursor: 0
  },
  swr: {
    cache: new Map<string, { data?: unknown; error?: unknown }>(),
    pending: [] as Array<Promise<void>>,
    mutate: vi.fn()
  },
  ipc: {
    getLocalConfig: vi.fn<(id?: string) => Promise<LocalDraft>>(),
    removeLocalNode: vi.fn(),
    getImageDataURL: vi.fn(),
    mihomoChangeProxy: vi.fn(),
    mihomoCloseAllConnections: vi.fn(),
    mihomoProxyDelay: vi.fn(),
    reorderLocalProxyGroups: vi.fn(),
    removeLocalProxyGroup: vi.fn()
  }
}))

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState(initial: unknown) {
    const slot = hooks.stateCursor++
    if (!(slot in hooks.state))
      hooks.state[slot] = typeof initial === 'function' ? initial() : initial
    return [
      hooks.state[slot],
      (next: unknown) => {
        hooks.state[slot] = typeof next === 'function' ? next(hooks.state[slot]) : next
      }
    ]
  },
  useRef(initial: unknown) {
    const slot = hooks.refCursor++
    if (!(slot in hooks.refs)) hooks.refs[slot] = { current: initial }
    return hooks.refs[slot]
  },
  useEffect: () => {},
  useMemo: (compute: () => unknown) => compute(),
  useCallback: (callback: unknown) => callback
}))

// Mirror SWR's real calling convention: fetcher receives the cache key as its first argument.
vi.mock('swr', () => ({
  default: (key: string | null, fetcher: (key: string) => Promise<unknown>) => {
    if (key !== null && !swr.cache.has(key)) {
      swr.cache.set(key, {})
      swr.pending.push(
        Promise.resolve()
          .then(() => fetcher(key))
          .then(
            (data) => {
              swr.cache.set(key, { data })
            },
            (error) => {
              swr.cache.set(key, { error })
            }
          )
      )
    }
    const entry = key === null ? {} : (swr.cache.get(key) ?? {})
    return { data: entry.data, error: entry.error, mutate: swr.mutate }
  }
}))

vi.mock('@heroui/react', () =>
  Object.fromEntries(
    [
      'Avatar',
      'Button',
      'Card',
      'CardBody',
      'Chip',
      'Dropdown',
      'DropdownItem',
      'DropdownMenu',
      'DropdownSection',
      'DropdownTrigger',
      'Spinner',
      'Switch'
    ].map((name) => [name, name])
  )
)
vi.mock('@dnd-kit/core', () => ({
  DndContext: 'DndContext',
  PointerSensor: 'PointerSensor',
  KeyboardSensor: 'KeyboardSensor',
  closestCenter: vi.fn(),
  useSensor: () => ({}),
  useSensors: () => []
}))
vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: 'SortableContext',
  arrayMove: (items: unknown[]) => items,
  sortableKeyboardCoordinates: vi.fn(),
  verticalListSortingStrategy: vi.fn()
}))
vi.mock('react-virtuoso', () => ({ GroupedVirtuoso: 'GroupedVirtuoso' }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@renderer/utils/ipc', () => ipc)
vi.mock('@renderer/utils/includes', () => import('../../utils/includes'))
vi.mock('@renderer/components/base/toast', () => ({ toast: { error: vi.fn() } }))
vi.mock('@renderer/components/base/base-page', () => ({ default: 'BasePage' }))
vi.mock('@renderer/components/base/collapse-input', () => ({ default: 'CollapseInput' }))
vi.mock('@renderer/components/proxies/proxy-item', () => ({ default: 'ProxyItem' }))
vi.mock('@renderer/components/proxies/group-editor-modal', () => ({ default: 'GroupEditorModal' }))
vi.mock('@renderer/components/proxies/sortable-group', () => ({ default: 'SortableGroup' }))
vi.mock('@renderer/components/local/delete-resource-button', () => ({
  default: 'DeleteResourceButton'
}))
vi.mock('./node-card', () => ({ default: 'NodeCard' }))
vi.mock('./node-modal', () => ({ default: 'NodeModal' }))
vi.mock('@renderer/hooks/use-active-profile', () => ({
  useActiveProfile: () => ({
    currentProfileItem: { id: 'local', type: 'local', name: 'Local' },
    isLocalActive: true
  })
}))
vi.mock('@renderer/hooks/use-app-config', () => ({
  useAppConfig: () => ({ appConfig: {}, patchAppConfig: vi.fn() })
}))
vi.mock('@renderer/hooks/use-controled-mihomo-config', () => ({
  useControledMihomoConfig: () => ({ controledMihomoConfig: { mode: 'rule' } })
}))
vi.mock('@renderer/hooks/use-groups', () => ({
  useGroups: () => ({ groups: [], mutate: vi.fn(), showHidden: false, setShowHidden: vi.fn() })
}))

function elements(node: ReactNode): Array<ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [
    node,
    ...elements(node.props.children as ReactNode),
    ...elements(node.props.header as ReactNode)
  ]
}

function render(component: () => ReactNode | Promise<ReactNode>): ReactNode {
  hooks.stateCursor = 0
  hooks.refCursor = 0
  const tree = component()
  if (tree instanceof Promise) throw new Error('Expected a synchronous component')
  return tree
}

async function flushSwr(): Promise<void> {
  await Promise.all(swr.pending.splice(0))
}

const sampleDraft: LocalDraft = {
  ...defaultLocalDraft(),
  modules: {
    ...defaultLocalDraft().modules,
    proxies: '- name: HK-01\n  type: ss\n  server: 1.2.3.4\n  port: 443\n',
    'proxy-groups': '- name: PROXY\n  type: select\n  proxies:\n    - HK-01\n    - DIRECT\n'
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  hooks.state = []
  hooks.refs = []
  swr.cache.clear()
  swr.pending = []
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() })
  // Match main process getLocalConfig(id?): passing the SWR key string fails lookup.
  ipc.getLocalConfig.mockImplementation(async (id?: string) => {
    if (id !== undefined) throw new Error('找不到本地配置')
    return sampleDraft
  })
})

describe('local config SWR fetcher regression', () => {
  it('loads local nodes without forwarding the SWR cache key to getLocalConfig', async () => {
    render(() => LocalNodes({}))
    await flushSwr()
    const tree = render(() => LocalNodes({}))

    expect(ipc.getLocalConfig).toHaveBeenCalledTimes(1)
    expect(ipc.getLocalConfig).toHaveBeenCalledWith()

    const cards = elements(tree).filter((el) => el.type === 'NodeCard')
    expect(cards).toHaveLength(1)
    expect((cards[0].props.node as { name: string }).name).toBe('HK-01')
    expect(elements(tree).some((el) => el.props.role === 'alert')).toBe(false)
  })

  it('surfaces load errors in LocalNodes instead of showing the empty-list prompt', async () => {
    ipc.getLocalConfig.mockRejectedValueOnce(new Error('yaml broken'))
    render(() => LocalNodes({}))
    await flushSwr()
    const tree = render(() => LocalNodes({}))

    const alert = elements(tree).find((el) => el.props.role === 'alert')
    expect(alert?.props.children).toBe('Error: yaml broken')
    const text = elements(tree)
      .map((el) => el.props.children)
      .filter((value): value is string => typeof value === 'string')
    expect(text.some((line) => line.includes('还没有本地节点'))).toBe(false)
    const addCard = elements(tree).find(
      (el) =>
        el.type === 'Card' &&
        elements(el.props.children as ReactNode).some(
          (child) => child.props.children === '添加节点'
        )
    )
    expect(addCard?.props.isDisabled).toBe(true)
  })

  it('loads configured proxy groups in Proxies edit mode without passing the SWR key', async () => {
    const initialTree = render(() => Proxies({}))
    const menu = elements(initialTree).find((el) => el.type === 'DropdownMenu')
    expect(menu).toBeDefined()
    if (!menu) throw new Error('Missing DropdownMenu')
    ;(menu.props.onAction as (key: string) => void)('edit-groups')

    render(() => Proxies({}))
    await flushSwr()
    const editTree = render(() => Proxies({}))

    expect(ipc.getLocalConfig).toHaveBeenCalledTimes(1)
    expect(ipc.getLocalConfig).toHaveBeenCalledWith()

    const sortableGroups = elements(editTree).filter((el) => el.type === 'SortableGroup')
    expect(sortableGroups.map((el) => el.props.name)).toEqual(['PROXY'])
    expect(elements(editTree).some((el) => el.props.role === 'alert')).toBe(false)

    const addGroupCard = elements(editTree).find(
      (el) =>
        el.type === 'Card' &&
        elements(el.props.children as ReactNode).some(
          (child) => child.props.children === '添加代理组'
        )
    )
    expect(addGroupCard).toBeDefined()
    expect(addGroupCard?.props.isDisabled).toBe(false)
  })
})
