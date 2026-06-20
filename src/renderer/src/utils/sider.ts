import { DEFAULT_SIDER_ORDER } from '../../../shared/appConfig'

export const SIDER_CARD_KEYS: SiderCardKey[] = DEFAULT_SIDER_ORDER

export const SIDER_CARD_ROUTES: Record<SiderCardKey, string> = {
  sysproxy: '/sysproxy',
  tun: '/tun',
  profile: '/profiles',
  proxy: '/proxies',
  rule: '/rules',
  resource: '/resources',
  override: '/override',
  connection: '/connections',
  mihomo: '/mihomo',
  dns: '/dns',
  sniff: '/sniffer',
  log: '/logs',
  substore: '/substore',
  network: '/network',
  usage: '/traffic'
}

export function mergeSiderOrder(saved: string[] = []): SiderCardKey[] {
  const valid = saved.filter((key): key is SiderCardKey =>
    SIDER_CARD_KEYS.includes(key as SiderCardKey)
  )
  const missing = SIDER_CARD_KEYS.filter((key) => !valid.includes(key))
  return [...valid, ...missing]
}

export function getSiderCardRoute(card?: string): string {
  if (!card || !SIDER_CARD_KEYS.includes(card as SiderCardKey)) {
    return SIDER_CARD_ROUTES.proxy
  }
  return SIDER_CARD_ROUTES[card as SiderCardKey]
}

export function getSiderCardByPath(pathname: string): SiderCardKey | undefined {
  return SIDER_CARD_KEYS.find((key) => SIDER_CARD_ROUTES[key] === pathname)
}
