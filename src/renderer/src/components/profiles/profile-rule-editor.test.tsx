import { setImmediate } from 'node:timers/promises'
import { isValidElement, type ComponentProps, type ReactElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parse, stringify } from 'yaml'
import EditRulesModal from './edit-rules-modal'
import ProfileCardContent from './profile-card-content'
import ProfileItem from './profile-item'

const { hooks, ipc, reportError, changeCurrentProfile } = vi.hoisted(() => ({
  hooks: {
    state: [] as unknown[],
    effects: [] as Array<() => void>,
    cursor: 0,
    mounted: false
  },
  ipc: {
    getProfileStr: vi.fn<(id: string) => Promise<string>>(),
    getRuleStr: vi.fn<(id: string) => Promise<string>>(),
    setRuleStr: vi.fn<(id: string, content: string) => Promise<void>>(),
    getProfileConfig: vi.fn<() => Promise<{ current: string }>>(),
    mihomoHotReloadConfig: vi.fn<() => Promise<void>>()
  },
  reportError: vi.fn(),
  changeCurrentProfile: vi.fn()
}))

// Run the component handlers and mount effects in Vitest's Node environment.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState(initial: unknown) {
    const slot = hooks.cursor++
    if (!(slot in hooks.state))
      hooks.state[slot] = typeof initial === 'function' ? initial() : initial
    return [
      hooks.state[slot],
      (next: unknown) => {
        hooks.state[slot] = typeof next === 'function' ? next(hooks.state[slot]) : next
      }
    ]
  },
  useEffect(effect: () => void) {
    if (!hooks.mounted) hooks.effects.push(effect)
  },
  useMemo: (compute: () => unknown) => compute(),
  useCallback: (callback: unknown) => callback,
  useDeferredValue: (value: unknown) => value,
  startTransition: (update: () => void) => update()
}))

vi.mock('@heroui/react', () =>
  Object.fromEntries(
    [
      'Autocomplete',
      'AutocompleteItem',
      'Button',
      'Card',
      'Checkbox',
      'Chip',
      'Divider',
      'Dropdown',
      'DropdownItem',
      'DropdownMenu',
      'DropdownTrigger',
      'Input',
      'Modal',
      'ModalBody',
      'ModalContent',
      'ModalFooter',
      'ModalHeader',
      'Select',
      'SelectItem',
      'Spinner',
      'Tooltip'
    ].map((name) => [name, name])
  )
)
vi.mock('@dnd-kit/sortable', () => ({ useSortable: () => ({}) }))
vi.mock('react-virtuoso', () => ({ Virtuoso: 'Virtuoso' }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@renderer/utils/init', () => ({ platform: 'linux' }))
vi.mock('@renderer/utils/dayjs', () => ({ default: () => ({ fromNow: () => '' }) }))
vi.mock('@renderer/utils/validate', () => import('../../utils/validate'))
vi.mock('@renderer/utils/ipc', () => ipc)
vi.mock('@renderer/utils/error-display', () => ({ showError: vi.fn() }))
vi.mock('@renderer/hooks/use-profile-config', () => ({
  useProfileConfig: () => ({ changeCurrentProfile })
}))
vi.mock('@renderer/components/base/toast', () => ({ toast: { error: reportError } }))
vi.mock('../base/base-confirm-modal', () => ({ default: 'BaseConfirmModal' }))
vi.mock('../local/local-nodes', () => ({ default: 'LocalNodes' }))
vi.mock('./edit-file-modal', () => ({ default: 'EditFileModal' }))
vi.mock('./edit-info-modal', () => ({ default: 'EditInfoModal' }))
vi.mock('./edit-tunnels-modal', () => ({ default: 'EditTunnelsModal' }))
vi.mock('./qr-code-modal', () => ({ default: 'QrCodeModal' }))
vi.mock('./profile-card-content', () => ({ default: 'ProfileCardContent' }))

function elements(node: ReactNode): Array<ReactElement<{ children?: ReactNode }>> {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<{ children?: ReactNode }>(node)) return []
  return [node, ...elements(node.props.children)]
}

function requireElement<P>(
  tree: ReactNode,
  type: ReactElement['type'],
  label?: string
): ReactElement<P> {
  const match = elements(tree).find(
    (element) => element.type === type && (label === undefined || element.props.children === label)
  )
  if (!match) throw new Error(`Missing element ${label ?? String(type)}`)
  return match as ReactElement<P>
}

function render(component: () => ReactNode | Promise<ReactNode>): ReactNode {
  hooks.cursor = 0
  const tree = component()
  if (tree instanceof Promise) throw new Error('Expected a synchronous component')
  hooks.mounted = true
  return tree
}

const id = 'selected-profile'
const legacyOverrides = {
  prepend: [
    'DOMAIN,first.test,DIRECT',
    'DOMAIN,second.test,DIRECT',
    '0,AND,((NETWORK,tcp),(DOMAIN,logic.test)),DIRECT'
  ],
  append: ['DOMAIN,last.test,DIRECT', '4,DOMAIN,middle.test,DIRECT'],
  delete: ['MATCH,DIRECT', 'DOMAIN,old.test,DIRECT']
}

beforeEach(() => {
  vi.resetAllMocks()
  hooks.state = []
  hooks.effects = []
  hooks.mounted = false
  ipc.getProfileStr.mockResolvedValue('rules: ["DOMAIN,base.test,DIRECT", "MATCH,DIRECT"]\n')
  ipc.getRuleStr.mockResolvedValue(stringify(legacyOverrides))
  ipc.getProfileConfig.mockResolvedValue({ current: id })
})

describe('subscription rule editor entry', () => {
  function renderCard(
    type: IProfileItem['type'],
    source?: ComponentProps<typeof ProfileItem>['source']
  ): ReactNode {
    return render(() =>
      ProfileItem({
        info: { id, type, name: 'Test subscription' },
        source,
        isCurrent: false,
        addProfileItem: vi.fn(),
        removeProfileItem: vi.fn(),
        mutateProfileConfig: vi.fn()
      })
    )
  }

  function ruleMenu(tree: ReactNode): ReactElement<{ onAction: (key: string) => Promise<void> }> {
    const card = requireElement<{ actions: ReactNode }>(tree, ProfileCardContent)
    return requireElement(card.props.actions, 'DropdownMenu')
  }

  it.each(['remote', 'local'] as const)('opens the rule editor for a %s profile', async (type) => {
    const menu = ruleMenu(renderCard(type))
    const item = requireElement(menu, 'DropdownItem', 'profiles.editRules.title')

    expect(item.key).toBe('edit-rules')
    await menu.props.onAction(String(item.key))

    const editor = requireElement<ComponentProps<typeof EditRulesModal>>(
      renderCard(type),
      EditRulesModal
    )
    expect(editor.props.id).toBe(id)
    expect(changeCurrentProfile).not.toHaveBeenCalled()
  })

  it('omits the rule editor action for a source that only supplies nodes', () => {
    const menu = ruleMenu(
      renderCard('remote', {
        id,
        name: 'Node source',
        mode: 'http',
        prefix: '',
        interval: 0,
        proxies: []
      })
    )
    const actions = elements(menu)
      .filter((element) => element.type === 'DropdownItem')
      .map((element) => element.key)
    expect(actions).toContain('edit-info')
    expect(actions).not.toContain('edit-rules')
  })
})

describe('subscription rule overrides', () => {
  const close = vi.fn()
  const renderEditor = (): ReactNode => render(() => EditRulesModal({ id, onClose: close }))

  async function loadEditor(): Promise<ReactNode> {
    renderEditor()
    for (const effect of hooks.effects) effect()
    await setImmediate()
    return renderEditor()
  }

  function button(tree: ReactNode, label: string) {
    return requireElement<{ onPress: () => Promise<void> | void; isDisabled?: boolean }>(
      tree,
      'Button',
      label
    ).props
  }

  function addRule(tree: ReactNode, action: string): void {
    const payload = elements(tree).find(
      (element) =>
        element.type === 'Input' &&
        isValidElement<{ label?: string }>(element) &&
        element.props.label === 'profiles.editRules.payload'
    )
    if (!isValidElement<{ onValueChange: (value: string) => void }>(payload)) {
      throw new Error('Missing rule payload input')
    }
    payload.props.onValueChange('new.test')
    void button(renderEditor(), action).onPress()
  }

  function savedOverrides(): typeof legacyOverrides {
    expect(ipc.setRuleStr).toHaveBeenCalledExactlyOnceWith(id, expect.any(String))
    return parse(ipc.setRuleStr.mock.calls[0][1])
  }

  it('loads legacy rules in order and preserves their overrides on save', async () => {
    const tree = await loadEditor()
    const list = requireElement<{ data: { original: string }[] }>(tree, 'Virtuoso')
    expect(list.props.data.map((rule) => rule.original)).toEqual([
      'DOMAIN,first.test,DIRECT',
      'DOMAIN,middle.test,DIRECT',
      'DOMAIN,second.test,DIRECT',
      'AND,((NETWORK,tcp),(DOMAIN,logic.test)),DIRECT',
      'DOMAIN,base.test,DIRECT',
      'MATCH,DIRECT',
      'DOMAIN,last.test,DIRECT'
    ])
    expect(ipc.getRuleStr).toHaveBeenCalledWith(id)

    await button(tree, 'common.save').onPress()

    const saved = savedOverrides()
    expect({ ...saved, delete: [...saved.delete].sort() }).toEqual({
      ...legacyOverrides,
      delete: [...legacyOverrides.delete].sort()
    })
    expect(ipc.mihomoHotReloadConfig).toHaveBeenCalledOnce()
    expect(ipc.setRuleStr).toHaveBeenCalledBefore(ipc.mihomoHotReloadConfig)
    expect(close).toHaveBeenCalledOnce()
  })

  it('adds a rule to an inactive profile without reloading the active profile', async () => {
    ipc.getProfileConfig.mockResolvedValue({ current: 'other-profile' })
    addRule(await loadEditor(), 'profiles.editRules.addRulePrepend')

    await button(renderEditor(), 'common.save').onPress()

    expect(savedOverrides().prepend).toEqual([...legacyOverrides.prepend, 'DOMAIN,new.test,DIRECT'])
    expect(ipc.mihomoHotReloadConfig).not.toHaveBeenCalled()
  })

  it('creates the first override when no rule file exists', async () => {
    ipc.getRuleStr.mockResolvedValue('')
    addRule(await loadEditor(), 'profiles.editRules.addRuleAppend')

    await button(renderEditor(), 'common.save').onPress()

    expect(savedOverrides()).toEqual({
      append: ['DOMAIN,new.test,DIRECT'],
      prepend: [],
      delete: []
    })
  })

  it.each([
    ['invalid', () => ipc.getRuleStr.mockResolvedValue('prepend: {}'), 'invalidRulesFile'],
    ['unreadable', () => ipc.getRuleStr.mockRejectedValue(new Error('EACCES')), 'EACCES']
  ])('blocks saving when the rule file is %s', async (_kind, arrange, message) => {
    arrange()
    const save = button(await loadEditor(), 'common.save')
    expect(reportError).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(message))
    expect(save.isDisabled).toBe(true)

    await save.onPress()

    expect(ipc.setRuleStr).not.toHaveBeenCalled()
    expect(ipc.mihomoHotReloadConfig).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
  })
})
