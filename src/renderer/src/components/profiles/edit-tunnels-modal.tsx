import {
  Autocomplete,
  AutocompleteItem,
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Spinner
} from '@heroui/react'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from '@renderer/components/base/toast'
import { getProfileStr, setProfileStr } from '@renderer/utils/ipc'
import { isValidListenAddressFull } from '@renderer/utils/validate'
import yaml from 'js-yaml'
import { useTranslation } from 'react-i18next'
import { IoMdCreate, IoMdTrash, IoMdUndo } from 'react-icons/io'

interface Props {
  id: string
  onClose: () => void
}

interface TunnelItem {
  network: string[]
  address: string
  target: string
  proxy: string
}

type ProfileYaml = Record<string, unknown>

const toStringValue = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  return String(value)
}

const defaultTunnel: TunnelItem = {
  network: ['tcp'],
  address: '',
  target: '',
  proxy: ''
}

const builtInProxies = ['DIRECT']

const normalizeNetwork = (network: unknown): string[] => {
  const values = Array.isArray(network)
    ? network
    : typeof network === 'string'
      ? network.split('/')
      : []

  const normalized = values
    .map((value) => String(value).trim().toLowerCase())
    .filter((value) => value === 'tcp' || value === 'udp')

  return [...new Set(normalized)]
}

const parseTunnelString = (value: string): TunnelItem | undefined => {
  const parts = value.split(',').map((part) => part.trim())
  if (parts.length !== 3 && parts.length !== 4) return undefined

  const network = normalizeNetwork(parts[0])
  if (network.length === 0) return undefined

  return {
    network,
    address: toStringValue(parts[1]),
    target: toStringValue(parts[2]),
    proxy: toStringValue(parts[3])
  }
}

const parseTunnelObject = (value: Record<string, unknown>): TunnelItem | undefined => {
  const network = normalizeNetwork(value.network)
  const address = typeof value.address === 'string' ? value.address : ''
  const target = typeof value.target === 'string' ? value.target : ''
  const proxy = typeof value.proxy === 'string' ? value.proxy : ''

  if (network.length === 0 && !address && !target && !proxy) return undefined

  return {
    network: network.length > 0 ? network : ['tcp'],
    address,
    target,
    proxy
  }
}

const parseTunnels = (value: unknown): TunnelItem[] => {
  if (!Array.isArray(value)) return []

  return value.flatMap((item) => {
    if (typeof item === 'string') {
      const parsed = parseTunnelString(item)
      return parsed ? [parsed] : []
    }

    if (item && typeof item === 'object') {
      const parsed = parseTunnelObject(item as Record<string, unknown>)
      return parsed ? [parsed] : []
    }

    return []
  })
}

const collectProxyNames = (profile: ProfileYaml): string[] => {
  const names: string[] = []

  const collect = (items: unknown): void => {
    if (!Array.isArray(items)) return

    items.forEach((item) => {
      if (item && typeof item === 'object') {
        const name = (item as Record<string, unknown>).name
        if (typeof name === 'string') {
          names.push(name)
        }
      }
    })
  }

  collect(profile['proxy-groups'])
  collect(profile.proxies)
  names.push(...builtInProxies)

  return [...new Set(names.filter(Boolean))]
}

const splitHostPort = (value: string): { host: string; port: string } | undefined => {
  const trimmed = value.trim()
  if (!trimmed) return undefined

  if (trimmed.startsWith('[')) {
    const closingBracket = trimmed.indexOf(']')
    if (closingBracket === -1 || trimmed[closingBracket + 1] !== ':') return undefined
    return {
      host: trimmed.slice(1, closingBracket),
      port: trimmed.slice(closingBracket + 2)
    }
  }

  const colonIndex = trimmed.lastIndexOf(':')
  if (colonIndex === -1) return undefined
  if (trimmed.slice(0, colonIndex).includes(':')) return undefined
  return {
    host: trimmed.slice(0, colonIndex),
    port: trimmed.slice(colonIndex + 1)
  }
}

const isValidTarget = (value: string): boolean => {
  const parsed = splitHostPort(value)
  if (!parsed || !parsed.host || !parsed.port) return false
  const portNumber = Number(parsed.port)
  return Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535
}

const isTunnelValid = (tunnel: TunnelItem): boolean => {
  return (
    tunnel.network.length > 0 &&
    tunnel.address.trim().length > 0 &&
    isValidListenAddressFull(tunnel.address).ok &&
    isValidTarget(tunnel.target)
  )
}

const toYamlTunnel = (tunnel: TunnelItem): Record<string, unknown> => {
  const item: Record<string, unknown> = {
    network: tunnel.network,
    address: tunnel.address.trim(),
    target: tunnel.target.trim()
  }

  if (tunnel.proxy.trim()) {
    item.proxy = tunnel.proxy.trim()
  }

  return item
}

const EditTunnelsModal: React.FC<Props> = (props) => {
  const { id, onClose } = props
  const { t } = useTranslation()
  const [profile, setProfile] = useState<ProfileYaml>({})
  const [tunnels, setTunnels] = useState<TunnelItem[]>([])
  const [proxyNames, setProxyNames] = useState<string[]>(builtInProxies)
  const [newTunnel, setNewTunnel] = useState<TunnelItem>(defaultTunnel)
  const [editingIndex, setEditingIndex] = useState<number | undefined>()
  const [isLoading, setIsLoading] = useState(true)

  const addressInvalid = useMemo(() => {
    if (!newTunnel.address.trim()) return false
    return !isValidListenAddressFull(newTunnel.address).ok
  }, [newTunnel.address])

  const targetInvalid = useMemo(() => {
    if (!newTunnel.target.trim()) return false
    return !isValidTarget(newTunnel.target)
  }, [newTunnel.target])

  const canSubmit = useMemo(() => isTunnelValid(newTunnel), [newTunnel])

  useEffect(() => {
    const loadContent = async (): Promise<void> => {
      setIsLoading(true)
      try {
        const content = await getProfileStr(id)
        const parsed = yaml.load(content)
        const nextProfile = parsed && typeof parsed === 'object' ? (parsed as ProfileYaml) : {}
        setProfile(nextProfile)
        setTunnels(parseTunnels(nextProfile.tunnels))
        setProxyNames(collectProxyNames(nextProfile))
      } catch (e) {
        toast.error(
          t('profiles.editTunnels.loadError') + ': ' + (e instanceof Error ? e.message : String(e))
        )
      } finally {
        setIsLoading(false)
      }
    }

    loadContent()
  }, [id, t])

  const resetForm = useCallback(() => {
    setNewTunnel(defaultTunnel)
    setEditingIndex(undefined)
  }, [])

  const updateNetwork = (network: 'tcp' | 'udp'): void => {
    setNewTunnel((prev) => {
      const nextNetwork = prev.network.includes(network)
        ? prev.network.filter((item) => item !== network)
        : [...prev.network, network]

      return {
        ...prev,
        network: nextNetwork
      }
    })
  }

  const handleSubmitTunnel = (): void => {
    if (!canSubmit) return

    const normalizedTunnel: TunnelItem = {
      network: newTunnel.network,
      address: newTunnel.address.trim(),
      target: newTunnel.target.trim(),
      proxy: newTunnel.proxy.trim()
    }

    setTunnels((prev) => {
      if (editingIndex === undefined) {
        return [...prev, normalizedTunnel]
      }

      return prev.map((item, index) => (index === editingIndex ? normalizedTunnel : item))
    })
    resetForm()
  }

  const handleEditTunnel = (index: number): void => {
    setNewTunnel({ ...tunnels[index], network: [...tunnels[index].network] })
    setEditingIndex(index)
  }

  const handleRemoveTunnel = (index: number): void => {
    setTunnels((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
    if (editingIndex === index) {
      resetForm()
    } else if (editingIndex !== undefined && editingIndex > index) {
      setEditingIndex(editingIndex - 1)
    }
  }

  const handleSave = async (): Promise<void> => {
    try {
      const nextProfile: ProfileYaml = { ...profile }
      if (tunnels.length > 0) {
        nextProfile.tunnels = tunnels.map(toYamlTunnel)
      } else {
        delete nextProfile.tunnels
      }

      await setProfileStr(id, yaml.dump(nextProfile))
      onClose()
    } catch (e) {
      toast.error(
        t('profiles.editTunnels.saveError') + ': ' + (e instanceof Error ? e.message : String(e))
      )
    }
  }

  return (
    <Modal
      backdrop="blur"
      classNames={{ backdrop: 'top-[48px]' }}
      size="5xl"
      hideCloseButton
      isOpen={true}
      onOpenChange={onClose}
      scrollBehavior="inside"
    >
      <ModalContent className="h-full w-[calc(100%-100px)]">
        <ModalHeader className="flex pb-0 app-drag">
          <div className="flex justify-start">
            <div className="flex items-center">{t('profiles.editTunnels.title')}</div>
          </div>
        </ModalHeader>
        <ModalBody className="h-full">
          <div className="flex gap-4 h-full">
            <div className="w-1/3 flex flex-col gap-4">
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant={newTunnel.network.includes('tcp') ? 'solid' : 'flat'}
                    color={newTunnel.network.includes('tcp') ? 'primary' : 'default'}
                    onPress={() => updateNetwork('tcp')}
                  >
                    TCP
                  </Button>
                  <Button
                    size="sm"
                    variant={newTunnel.network.includes('udp') ? 'solid' : 'flat'}
                    color={newTunnel.network.includes('udp') ? 'primary' : 'default'}
                    onPress={() => updateNetwork('udp')}
                  >
                    UDP
                  </Button>
                </div>
                <Input
                  label={t('profiles.editTunnels.address')}
                  placeholder="127.0.0.1:7777"
                  value={newTunnel.address}
                  onValueChange={(value) =>
                    setNewTunnel((prev) => ({ ...prev, address: toStringValue(value) }))
                  }
                />
                {addressInvalid && (
                  <div className="-mt-2 px-1 text-xs text-danger">
                    {t('profiles.editTunnels.invalidAddress')}
                  </div>
                )}
                <Input
                  label={t('profiles.editTunnels.target')}
                  placeholder="target.com:443"
                  value={newTunnel.target}
                  onValueChange={(value) =>
                    setNewTunnel((prev) => ({ ...prev, target: toStringValue(value) }))
                  }
                />
                {targetInvalid && (
                  <div className="-mt-2 px-1 text-xs text-danger">
                    {t('profiles.editTunnels.invalidTarget')}
                  </div>
                )}
                <Autocomplete
                  label={t('profiles.editTunnels.proxy')}
                  placeholder={t('profiles.editTunnels.proxyPlaceholder')}
                  selectedKey={newTunnel.proxy || null}
                  inputValue={newTunnel.proxy || ''}
                  onSelectionChange={(key) =>
                    setNewTunnel((prev) => ({ ...prev, proxy: toStringValue(key) }))
                  }
                  onInputChange={(value) =>
                    setNewTunnel((prev) => ({ ...prev, proxy: toStringValue(value) }))
                  }
                >
                  {proxyNames.map((proxy) => (
                    <AutocompleteItem key={proxy} textValue={proxy}>
                      {proxy}
                    </AutocompleteItem>
                  ))}
                </Autocomplete>
                <div className="flex gap-2">
                  <Button
                    color="primary"
                    className="flex-1"
                    onPress={handleSubmitTunnel}
                    isDisabled={!canSubmit}
                  >
                    {editingIndex === undefined
                      ? t('profiles.editTunnels.addTunnel')
                      : t('profiles.editTunnels.updateTunnel')}
                  </Button>
                  {editingIndex !== undefined && (
                    <Button isIconOnly variant="flat" onPress={resetForm} aria-label="Reset">
                      <IoMdUndo className="text-lg" />
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <div className="w-2/3 border-l border-divider pl-4 flex flex-col">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-lg font-semibold">
                  {t('profiles.editTunnels.currentTunnels')}
                </h3>
              </div>
              <div className="flex-1 min-h-0 overflow-auto">
                {isLoading ? (
                  <div className="flex items-center justify-center h-full py-8">
                    <Spinner size="lg" label={t('common.loading') || 'Loading...'} />
                  </div>
                ) : tunnels.length === 0 ? (
                  <div className="text-center text-foreground-500 py-4">
                    {t('profiles.editTunnels.noTunnels')}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {tunnels.map((tunnel, index) => (
                      <div
                        key={`${tunnel.network.join('/')}-${tunnel.address}-${tunnel.target}-${index}`}
                        className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border border-divider rounded-lg px-4 py-3 ${editingIndex === index ? 'bg-primary-50 dark:bg-primary-900/20' : 'bg-content1/40'}`}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold leading-5">
                            {tunnel.address}
                          </div>
                          <div className="mt-0.5 truncate text-sm leading-5 text-foreground-500">
                            <span className="font-medium text-primary">
                              {tunnel.network.join('/').toUpperCase()}
                            </span>
                            <span className="px-1.5 text-foreground-300">·</span>
                            {tunnel.proxy && (
                              <>
                                <span>{tunnel.proxy}</span>
                                <span className="px-1 text-foreground-400">-&gt;</span>
                              </>
                            )}
                            <span>{tunnel.target}</span>
                          </div>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button
                            isIconOnly
                            size="sm"
                            variant="light"
                            onPress={() => handleEditTunnel(index)}
                            aria-label="Edit"
                          >
                            <IoMdCreate className="text-lg" />
                          </Button>
                          <Button
                            isIconOnly
                            size="sm"
                            variant="light"
                            color="danger"
                            onPress={() => handleRemoveTunnel(index)}
                            aria-label="Delete"
                          >
                            <IoMdTrash className="text-lg" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </ModalBody>
        <ModalFooter className="pt-0">
          <Button size="sm" variant="light" onPress={onClose}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" color="primary" onPress={handleSave}>
            {t('common.save')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default EditTunnelsModal
