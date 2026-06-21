import BasePage from '@renderer/components/base/base-page'
import NetworkTopologyCard from '@renderer/components/network/network-topology'
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Button, Select, SelectItem, Chip, Tooltip, Input } from '@heroui/react'
import {
  DndContext,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  IoRefresh,
  IoCopyOutline,
  IoCheckmark,
  IoEyeOutline,
  IoEyeOffOutline,
  IoAdd,
  IoClose
} from 'react-icons/io5'
import { IoMdGlobe, IoMdPulse } from 'react-icons/io'
import { useTranslation } from 'react-i18next'
import { fetchIPInfo, measureLatency } from '@renderer/utils/ipc'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { DEFAULT_NETWORK_INFO_CARD_ORDER } from '../../../shared/appConfig'

type IPProvider = 'ip.sb' | 'ipwho.is' | 'ipapi.is'

interface IPInfo {
  ip: string
  country?: string
  countryCode?: string
  city?: string
  region?: string
  asn?: number
  org?: string
  isp?: string
  isProxy?: boolean
  isVPN?: boolean
  timezone?: string
  latitude?: number
  longitude?: number
}

const IP_ENDPOINTS: Record<IPProvider, string> = {
  'ip.sb': 'https://api.ip.sb/geoip',
  'ipwho.is': 'https://ipwho.is/',
  'ipapi.is': 'https://api.ipapi.is/'
}

const CountryFlag: React.FC<{ code?: string; className?: string }> = ({ code, className }) => {
  if (!code || code.length !== 2) return null
  return (
    <span
      className={`fi fi-${code.toLowerCase()} rounded-sm ${className ?? ''}`}
      style={{ fontSize: '1rem', lineHeight: 1 }}
    />
  )
}

function parseProvider(provider: IPProvider, data: Record<string, unknown>): IPInfo {
  if (provider === 'ip.sb') {
    return {
      ip: data.ip as string,
      country: data.country as string | undefined,
      countryCode: data.country_code as string | undefined,
      city: data.city as string | undefined,
      asn: data.asn as number | undefined,
      org: data.asn_organization as string | undefined,
      latitude: data.latitude as number | undefined,
      longitude: data.longitude as number | undefined
    }
  }
  if (provider === 'ipwho.is') {
    const conn = data.connection as Record<string, unknown> | undefined
    const tz = data.timezone as Record<string, unknown> | undefined
    return {
      ip: data.ip as string,
      country: data.country as string | undefined,
      countryCode: data.country_code as string | undefined,
      city: data.city as string | undefined,
      region: data.region as string | undefined,
      asn: conn?.asn as number | undefined,
      org: conn?.org as string | undefined,
      isp: conn?.isp as string | undefined,
      timezone: tz?.id as string | undefined,
      latitude: data.latitude as number | undefined,
      longitude: data.longitude as number | undefined
    }
  }
  const loc = data.location as Record<string, unknown> | undefined
  const asn = data.asn as Record<string, unknown> | undefined
  return {
    ip: data.ip as string,
    country: loc?.country as string | undefined,
    countryCode: loc?.country_code as string | undefined,
    city: loc?.city as string | undefined,
    region: loc?.state as string | undefined,
    asn: asn?.asn as number | undefined,
    org: asn?.org as string | undefined,
    isProxy: data.is_proxy as boolean | undefined,
    isVPN: data.is_vpn as boolean | undefined,
    timezone: loc?.timezone as string | undefined,
    latitude: loc?.latitude as number | undefined,
    longitude: loc?.longitude as number | undefined
  }
}

// ─── Latency ───────────────────────────────────────────────────────────────

type LatencyStatus = 'idle' | 'pending' | 'success' | 'error'

interface LatencyResult {
  latency: number | null
  status: LatencyStatus
}

interface LatencyTarget {
  name: string
  url: string
  custom?: boolean
}

const DEFAULT_LATENCY_TARGETS: LatencyTarget[] = [
  { name: 'Google', url: 'https://www.google.com/generate_204' },
  { name: 'Cloudflare', url: 'https://www.cloudflare.com/cdn-cgi/trace' },
  { name: 'GitHub', url: 'https://github.com/' }
]

function mergeNetworkInfoCardOrder(saved: string[] = []): NetworkInfoCardKey[] {
  const valid = saved.filter((key): key is NetworkInfoCardKey =>
    DEFAULT_NETWORK_INFO_CARD_ORDER.includes(key as NetworkInfoCardKey)
  )
  const missing = DEFAULT_NETWORK_INFO_CARD_ORDER.filter((key) => !valid.includes(key))
  return [...valid, ...missing]
}

interface SortableNetworkInfoCardProps {
  id: NetworkInfoCardKey
  order: number
  children: React.ReactNode
}

const SortableNetworkInfoCard: React.FC<SortableNetworkInfoCardProps> = ({
  id,
  order,
  children
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform: tf,
    transition,
    isDragging
  } = useSortable({ id })
  const transform = tf ? { x: tf.x, y: tf.y, scaleX: 1, scaleY: 1 } : null

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        position: 'relative',
        transform: CSS.Transform.toString(transform),
        transition,
        order,
        zIndex: isDragging ? 'calc(infinity)' : undefined
      }}
      className={`w-full ${isDragging ? 'scale-[0.98] tap-highlight-transparent' : ''}`}
    >
      {children}
    </div>
  )
}

function normalizeLatencyUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const urlText = /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(urlText)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

function normalizeLatencyTarget(
  value: string | Partial<INetworkLatencyTarget>
): INetworkLatencyTarget | null {
  if (typeof value === 'string') {
    const url = normalizeLatencyUrl(value)
    if (!url) return null
    return { name: getLatencyTargetName(url), url }
  }

  const url = normalizeLatencyUrl(value.url ?? '')
  if (!url) return null
  return { name: value.name?.trim() || getLatencyTargetName(url), url }
}

function normalizeLatencyTargets(
  values: Array<string | Partial<INetworkLatencyTarget>> = []
): INetworkLatencyTarget[] {
  const result: INetworkLatencyTarget[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const target = normalizeLatencyTarget(value)
    if (!target || seen.has(target.url)) continue
    seen.add(target.url)
    result.push(target)
  }
  return result
}

function getLatencyTargetName(url: string): string {
  try {
    return new URL(url).hostname || url
  } catch {
    return url
  }
}

function latencyColor(latency: number | null): string {
  if (latency === null) return ''
  if (latency < 100) return 'text-success'
  if (latency < 300) return 'text-warning'
  return 'text-danger'
}

function latencyBarColor(latency: number | null): string {
  if (latency === null) return 'bg-foreground/20'
  if (latency < 100) return 'bg-success'
  if (latency < 300) return 'bg-warning'
  return 'bg-danger'
}

// ─────────────────────────────────────────────────────────────────────────────

const providers: { value: IPProvider; label: string }[] = [
  { value: 'ip.sb', label: 'IP.SB' },
  { value: 'ipwho.is', label: 'ipwho.is' },
  { value: 'ipapi.is', label: 'ipapi.is' }
]

interface InfoRowProps {
  label: string
  value: React.ReactNode
  mono?: boolean
}

const InfoRow: React.FC<InfoRowProps> = ({ label, value, mono }) => (
  <div className="flex items-center justify-between gap-3">
    <span className="shrink-0 text-[13px] text-foreground/60">{label}</span>
    <span
      className={`overflow-hidden text-right text-[13px] font-medium text-ellipsis whitespace-nowrap ${mono ? 'font-mono' : ''}`}
    >
      {value}
    </span>
  </div>
)

const IPPage: React.FC = () => {
  const { t } = useTranslation()
  const { appConfig, patchAppConfig } = useAppConfig()
  const [provider, setProvider] = useState<IPProvider>(
    (appConfig?.networkIPProvider as IPProvider) ?? 'ip.sb'
  )
  const fetchIdRef = useRef(0)
  const [ipInfo, setIpInfo] = useState<IPInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [isAddingLatencyTarget, setIsAddingLatencyTarget] = useState(false)
  const [customLatencyName, setCustomLatencyName] = useState('')
  const [customLatencyUrl, setCustomLatencyUrl] = useState('')
  const [customLatencyNameError, setCustomLatencyNameError] = useState(false)
  const [customLatencyUrlError, setCustomLatencyUrlError] = useState(false)

  // latency state: map from url -> result
  const [latencyResults, setLatencyResults] = useState<Record<string, LatencyResult>>({})
  const [testingLatency, setTestingLatency] = useState(false)
  const appConfigLoaded = appConfig !== undefined
  const [cardOrder, setCardOrder] = useState<NetworkInfoCardKey[]>(() =>
    mergeNetworkInfoCardOrder(appConfig?.networkInfoCardOrder)
  )
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  useEffect(() => {
    setCardOrder(mergeNetworkInfoCardOrder(appConfig?.networkInfoCardOrder))
  }, [appConfig?.networkInfoCardOrder])

  const handleCardDragEnd = useCallback(
    async (event: DragEndEvent): Promise<void> => {
      const { active, over } = event
      if (!over || active.id === over.id) return

      const activeId = active.id as NetworkInfoCardKey
      const overId = over.id as NetworkInfoCardKey
      const activeIndex = cardOrder.indexOf(activeId)
      const overIndex = cardOrder.indexOf(overId)
      if (activeIndex === -1 || overIndex === -1) return

      const nextOrder = cardOrder.slice()
      nextOrder.splice(activeIndex, 1)
      nextOrder.splice(overIndex, 0, activeId)
      setCardOrder(nextOrder)
      await patchAppConfig({ networkInfoCardOrder: nextOrder })
    },
    [cardOrder, patchAppConfig]
  )

  const customLatencyTargets = useMemo(
    () => normalizeLatencyTargets(appConfig?.networkLatencyTargets),
    [appConfig?.networkLatencyTargets]
  )

  const latencyTargets = useMemo(() => {
    const defaultUrls = new Set(DEFAULT_LATENCY_TARGETS.map((target) => target.url))
    return [
      ...DEFAULT_LATENCY_TARGETS,
      ...customLatencyTargets
        .filter((target) => !defaultUrls.has(target.url))
        .map((target) => ({ ...target, custom: true }))
    ]
  }, [customLatencyTargets])

  const patchCustomLatencyTargets = useCallback(
    async (targets: Array<string | Partial<INetworkLatencyTarget>>) => {
      const defaultUrls = new Set(DEFAULT_LATENCY_TARGETS.map((target) => target.url))
      await patchAppConfig({
        networkLatencyTargets: normalizeLatencyTargets(targets).filter(
          (target) => !defaultUrls.has(target.url)
        )
      })
    },
    [patchAppConfig]
  )

  const closeLatencyTargetForm = useCallback(() => {
    setIsAddingLatencyTarget(false)
    setCustomLatencyName('')
    setCustomLatencyUrl('')
    setCustomLatencyNameError(false)
    setCustomLatencyUrlError(false)
  }, [])

  const addCustomLatencyTarget = useCallback(async () => {
    const name = customLatencyName.trim()
    const url = normalizeLatencyUrl(customLatencyUrl)
    setCustomLatencyNameError(!name)
    setCustomLatencyUrlError(!url)
    if (!name || !url) return

    const existingUrls = new Set(DEFAULT_LATENCY_TARGETS.map((target) => target.url))
    if (!existingUrls.has(url)) {
      await patchCustomLatencyTargets([
        ...customLatencyTargets.filter((target) => target.url !== url),
        { name, url }
      ])
    }
    closeLatencyTargetForm()
  }, [
    closeLatencyTargetForm,
    customLatencyName,
    customLatencyTargets,
    customLatencyUrl,
    patchCustomLatencyTargets
  ])

  const openLatencyTargetForm = useCallback(() => {
    setIsAddingLatencyTarget(true)
  }, [])

  const updateCustomLatencyName = useCallback((value: string) => {
    setCustomLatencyName(value)
    setCustomLatencyNameError(false)
  }, [])

  const updateCustomLatencyUrl = useCallback((value: string) => {
    setCustomLatencyUrl(value)
    setCustomLatencyUrlError(false)
  }, [])

  const submitLatencyTargetOnEnter = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      addCustomLatencyTarget()
    },
    [addCustomLatencyTarget]
  )

  const removeCustomLatencyTarget = useCallback(
    async (url: string) => {
      await patchCustomLatencyTargets(
        customLatencyTargets.filter((targetUrl) => targetUrl.url !== url)
      )
      setLatencyResults((prev) => {
        const next = { ...prev }
        delete next[url]
        return next
      })
    },
    [customLatencyTargets, patchCustomLatencyTargets]
  )

  const testAllLatencies = useCallback(async () => {
    setTestingLatency(true)
    // mark all as pending first
    setLatencyResults(
      Object.fromEntries(
        latencyTargets.map((t) => [t.url, { latency: null, status: 'pending' as LatencyStatus }])
      )
    )
    await Promise.all(
      latencyTargets.map(async (target) => {
        try {
          const latency = await measureLatency(target.url)
          setLatencyResults((prev) => ({
            ...prev,
            [target.url]: { latency, status: latency !== null ? 'success' : 'error' }
          }))
        } catch {
          setLatencyResults((prev) => ({
            ...prev,
            [target.url]: { latency: null, status: 'error' }
          }))
        }
      })
    )
    setTestingLatency(false)
  }, [latencyTargets])

  useEffect(() => {
    if (!appConfigLoaded) return
    testAllLatencies()
  }, [appConfigLoaded, testAllLatencies])

  const averageLatency = (() => {
    const successes = latencyTargets
      .map((t) => latencyResults[t.url])
      .filter(
        (r): r is LatencyResult & { latency: number } =>
          r?.status === 'success' && r.latency !== null
      )
    if (successes.length === 0) return null
    return Math.round(successes.reduce((acc, r) => acc + r.latency, 0) / successes.length)
  })()

  const fetchIP = useCallback(
    async (p?: IPProvider) => {
      const target = p ?? provider
      const currentFetchId = ++fetchIdRef.current
      setLoading(true)
      setError(null)
      try {
        const data = await fetchIPInfo(IP_ENDPOINTS[target])
        if (currentFetchId !== fetchIdRef.current) return
        setIpInfo(parseProvider(target, data as Record<string, unknown>))
      } catch (e) {
        if (currentFetchId !== fetchIdRef.current) return
        setError(e instanceof Error ? e.message : t('network.fetchFailed'))
        setIpInfo(null)
      } finally {
        if (currentFetchId === fetchIdRef.current) {
          setLoading(false)
        }
      }
    },
    [provider, t]
  )

  useEffect(() => {
    fetchIP()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleCopy = useCallback(() => {
    if (!ipInfo?.ip) return
    navigator.clipboard.writeText(ipInfo.ip)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [ipInfo?.ip])

  return (
    <BasePage title={t('network.title')}>
      <div className="m-2 flex flex-col gap-4">
        <div style={{ overflowX: 'clip' }} className="flex flex-col gap-4">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragEnd={handleCardDragEnd}
          >
            <SortableContext items={cardOrder} strategy={verticalListSortingStrategy}>
              {/* 当前 IP 卡片 */}
              <SortableNetworkInfoCard id="ip" order={cardOrder.indexOf('ip')}>
                <div className="rounded-xl border border-foreground/10 bg-content1 p-4 shadow-sm">
                  {/* 卡片 Header */}
                  <div className="mb-3.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
                        <IoMdGlobe size={18} />
                      </div>
                      <h3 className="text-[15px] font-semibold">{t('network.ipCard.title')}</h3>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Select
                        size="sm"
                        className="w-28"
                        selectedKeys={[provider]}
                        onSelectionChange={(keys) => {
                          const val = Array.from(keys)[0] as IPProvider
                          if (val) {
                            setProvider(val)
                            patchAppConfig({ networkIPProvider: val })
                            fetchIP(val)
                          }
                        }}
                      >
                        {providers.map((p) => (
                          <SelectItem key={p.value}>{p.label}</SelectItem>
                        ))}
                      </Select>
                      <Button
                        size="sm"
                        isIconOnly
                        variant="light"
                        isLoading={loading}
                        onPress={() => fetchIP()}
                        className="h-7 w-7 min-w-0"
                      >
                        <IoRefresh size={16} />
                      </Button>
                    </div>
                  </div>

                  {/* 加载中 */}
                  {loading && !ipInfo && (
                    <div className="flex justify-center py-6">
                      <span className="h-6 w-6 animate-spin rounded-full border-2 border-foreground/10 border-t-primary" />
                    </div>
                  )}

                  {/* 错误 */}
                  {error && (
                    <div className="rounded-lg border border-danger/20 bg-danger/10 p-3 text-[13px] text-danger">
                      {error}
                    </div>
                  )}

                  {/* IP 信息 */}
                  {ipInfo && (
                    <div className="flex flex-col gap-2.5">
                      {/* IP 地址高亮行（负 margin 贴边） */}
                      <div className="-mx-1 -mt-1 mb-1 flex items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/8 px-2.5 py-2">
                        <span className="shrink-0 text-[13px] text-foreground/60">
                          {t('network.ipAddress')}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <span className="overflow-hidden text-right font-mono text-[13px] font-semibold text-primary text-ellipsis whitespace-nowrap">
                            {hidden ? '••••••••••••••' : ipInfo.ip}
                          </span>
                          <button
                            onClick={() => setHidden((h) => !h)}
                            className="shrink-0 text-primary/60 hover:text-primary transition-colors"
                          >
                            {hidden ? <IoEyeOffOutline size={14} /> : <IoEyeOutline size={14} />}
                          </button>
                          <Tooltip content={copied ? t('network.copied') : t('network.copy')}>
                            <button
                              onClick={handleCopy}
                              className="shrink-0 text-primary/60 hover:text-primary transition-colors"
                            >
                              {copied ? <IoCheckmark size={14} /> : <IoCopyOutline size={14} />}
                            </button>
                          </Tooltip>
                        </div>
                      </div>

                      {ipInfo.country && (
                        <InfoRow
                          label={t('network.country')}
                          value={
                            <span className="flex items-center justify-end gap-1.5">
                              <CountryFlag code={ipInfo.countryCode} />
                              <span>{ipInfo.country}</span>
                            </span>
                          }
                        />
                      )}
                      {ipInfo.region && (
                        <InfoRow label={t('network.region')} value={ipInfo.region} />
                      )}
                      {ipInfo.city && <InfoRow label={t('network.city')} value={ipInfo.city} />}
                      {ipInfo.timezone && (
                        <InfoRow label={t('network.timezone')} value={ipInfo.timezone} />
                      )}
                      {ipInfo.latitude != null && ipInfo.longitude != null && (
                        <InfoRow
                          label={t('network.coordinates')}
                          value={`${ipInfo.latitude.toFixed(4)}, ${ipInfo.longitude.toFixed(4)}`}
                          mono
                        />
                      )}
                      {ipInfo.asn != null && <InfoRow label="ASN" value={`AS${ipInfo.asn}`} mono />}
                      {ipInfo.org && (
                        <InfoRow label={t('network.organization')} value={ipInfo.org} />
                      )}
                      {ipInfo.isp && <InfoRow label="ISP" value={ipInfo.isp} />}

                      {(ipInfo.isProxy !== undefined || ipInfo.isVPN !== undefined) && (
                        <div className="flex items-center justify-between gap-3">
                          <span className="shrink-0 text-[13px] text-foreground/60">
                            {t('network.proxyDetection')}
                          </span>
                          <div className="flex gap-1">
                            {ipInfo.isProxy && (
                              <Chip
                                size="sm"
                                color="warning"
                                variant="flat"
                                classNames={{ content: 'text-[11px] font-semibold uppercase' }}
                              >
                                Proxy
                              </Chip>
                            )}
                            {ipInfo.isVPN && (
                              <Chip
                                size="sm"
                                color="warning"
                                variant="flat"
                                classNames={{ content: 'text-[11px] font-semibold uppercase' }}
                              >
                                VPN
                              </Chip>
                            )}
                            {!ipInfo.isProxy && !ipInfo.isVPN && (
                              <Chip
                                size="sm"
                                color="success"
                                variant="flat"
                                classNames={{ content: 'text-[11px] font-semibold uppercase' }}
                              >
                                {t('network.clean')}
                              </Chip>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {!loading && !error && !ipInfo && (
                    <div className="py-6 text-center text-sm text-foreground/50">
                      {t('network.noData')}
                    </div>
                  )}
                </div>
              </SortableNetworkInfoCard>

              {/* 网络拓扑卡片 */}
              <SortableNetworkInfoCard id="topology" order={cardOrder.indexOf('topology')}>
                <NetworkTopologyCard />
              </SortableNetworkInfoCard>

              {/* 网络延迟卡片 */}
              <SortableNetworkInfoCard id="latency" order={cardOrder.indexOf('latency')}>
                <div className="rounded-xl border border-foreground/10 bg-content1 p-4 shadow-sm">
                  <div className="mb-3.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
                        <IoMdPulse size={18} />
                      </div>
                      <h3 className="text-[15px] font-semibold">{t('network.latency.title')}</h3>
                    </div>
                    <div className="flex items-center gap-2">
                      {averageLatency !== null && (
                        <span
                          className={`rounded-md px-2 py-1 text-xs font-semibold ${
                            averageLatency < 100
                              ? 'bg-success/15 text-success'
                              : averageLatency < 300
                                ? 'bg-warning/15 text-warning'
                                : 'bg-danger/15 text-danger'
                          }`}
                        >
                          {t('network.latency.average')}: {averageLatency}ms
                        </span>
                      )}
                      <Tooltip content={t('network.latency.add')}>
                        <Button
                          size="sm"
                          isIconOnly
                          variant={isAddingLatencyTarget ? 'flat' : 'light'}
                          className="h-7 w-7 min-w-0"
                          aria-label={t('network.latency.add')}
                          onPress={openLatencyTargetForm}
                        >
                          <IoAdd size={16} />
                        </Button>
                      </Tooltip>
                      <Button
                        size="sm"
                        isIconOnly
                        variant="light"
                        isLoading={testingLatency}
                        isDisabled={testingLatency}
                        onPress={testAllLatencies}
                        className="h-7 w-7 min-w-0"
                      >
                        <IoRefresh size={16} />
                      </Button>
                    </div>
                  </div>

                  {isAddingLatencyTarget && (
                    <div className="mb-3 flex flex-wrap items-start gap-2">
                      <Input
                        size="sm"
                        className="min-w-32 flex-1"
                        value={customLatencyName}
                        placeholder={t('network.latency.namePlaceholder')}
                        aria-label={t('network.latency.namePlaceholder')}
                        isInvalid={customLatencyNameError}
                        errorMessage={
                          customLatencyNameError ? t('network.latency.invalidName') : undefined
                        }
                        onValueChange={updateCustomLatencyName}
                        onKeyDown={submitLatencyTargetOnEnter}
                      />
                      <Input
                        size="sm"
                        className="min-w-48 flex-[1.5]"
                        value={customLatencyUrl}
                        placeholder={t('network.latency.urlPlaceholder')}
                        aria-label={t('network.latency.urlPlaceholder')}
                        isInvalid={customLatencyUrlError}
                        errorMessage={
                          customLatencyUrlError ? t('network.latency.invalidUrl') : undefined
                        }
                        onValueChange={updateCustomLatencyUrl}
                        onKeyDown={submitLatencyTargetOnEnter}
                      />
                      <Tooltip content={t('common.save')}>
                        <Button
                          size="sm"
                          isIconOnly
                          variant="flat"
                          color="primary"
                          className="h-8 w-8 min-w-0"
                          aria-label={t('common.save')}
                          onPress={addCustomLatencyTarget}
                        >
                          <IoCheckmark size={16} />
                        </Button>
                      </Tooltip>
                      <Tooltip content={t('common.cancel')}>
                        <Button
                          size="sm"
                          isIconOnly
                          variant="light"
                          className="h-8 w-8 min-w-0"
                          aria-label={t('common.cancel')}
                          onPress={closeLatencyTargetForm}
                        >
                          <IoClose size={16} />
                        </Button>
                      </Tooltip>
                    </div>
                  )}

                  <div className="flex flex-col gap-3">
                    {latencyTargets.map((target) => {
                      const res = latencyResults[target.url]
                      return (
                        <div key={target.url} className="flex items-center gap-3">
                          <span className="w-20 shrink-0 overflow-hidden text-[13px] text-ellipsis whitespace-nowrap">
                            {target.name}
                          </span>
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-foreground/10">
                            <div
                              className={`h-full rounded-full transition-[width] duration-500 ease-out ${latencyBarColor(res?.latency ?? null)}`}
                              style={{
                                width:
                                  res?.status === 'success' && res.latency !== null
                                    ? `${Math.min((res.latency / 500) * 100, 100)}%`
                                    : '0%'
                              }}
                            />
                          </div>
                          <span className="w-16 shrink-0 text-right font-mono text-[13px]">
                            {!res || res.status === 'idle' ? (
                              <span className="text-foreground/40">-</span>
                            ) : res.status === 'pending' ? (
                              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-foreground/10 border-t-primary" />
                            ) : res.status === 'success' ? (
                              <span className={latencyColor(res.latency)}>{res.latency}ms</span>
                            ) : (
                              <span className="text-danger">{t('network.latency.timeout')}</span>
                            )}
                          </span>
                          {target.custom ? (
                            <Tooltip content={t('common.delete')}>
                              <Button
                                size="sm"
                                isIconOnly
                                variant="light"
                                color="danger"
                                className="h-6 w-6 min-w-0 shrink-0"
                                aria-label={t('common.delete')}
                                onPress={() => removeCustomLatencyTarget(target.url)}
                              >
                                <IoClose size={14} />
                              </Button>
                            </Tooltip>
                          ) : (
                            <span className="h-6 w-6 shrink-0" />
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </SortableNetworkInfoCard>
            </SortableContext>
          </DndContext>
        </div>
      </div>
    </BasePage>
  )
}

export default IPPage
