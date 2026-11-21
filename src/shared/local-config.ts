export type LocalObject = Record<string, unknown>

export const LOCAL_PROFILE_ID = 'local'

export function isLocalProfile(item?: { id?: string; type?: string; pluginId?: string }): boolean {
  return item?.type === 'local' && item.id !== 'default' && !item.pluginId
}

export const LOCAL_BUILTIN_OUTBOUNDS: readonly string[] = [
  'DIRECT',
  'REJECT',
  'REJECT-DROP',
  'PASS',
  'PASS-RULE',
  'COMPATIBLE'
]

// Top-level Mihomo settings edited by the kernel settings page.
export const LOCAL_GENERAL_CONFIG_KEYS = [
  'external-controller-pipe',
  'external-controller-unix',
  'external-controller',
  'external-ui',
  'external-ui-url',
  'external-controller-cors',
  'secret',
  'ipv6',
  'mode',
  'mixed-port',
  'socks-port',
  'port',
  'redir-port',
  'tproxy-port',
  'allow-lan',
  'unified-delay',
  'tcp-concurrent',
  'log-level',
  'find-process-mode',
  'skip-auth-prefixes',
  'bind-address',
  'lan-allowed-ips',
  'lan-disallowed-ips',
  'authentication',
  'profile'
] as const

export type LocalGeneralConfigKey = (typeof LOCAL_GENERAL_CONFIG_KEYS)[number]

export const LOCAL_MODULES = {
  general: '基础设置',
  proxies: '节点',
  'proxy-providers': '代理集合',
  'proxy-groups': '策略组',
  rules: '规则',
  'rule-providers': '规则集合',
  'sub-rules': '子规则',
  dns: 'DNS',
  hosts: 'Hosts',
  tun: 'TUN',
  sniffer: '嗅探'
} as const

export type LocalModule = keyof typeof LOCAL_MODULES

export interface LocalSubscriptionOptions {
  mode: 'group' | 'nodes'
  prefix?: string
  providerName?: string
  targetGroups?: string[]
  providerOptions?: LocalObject
}

export interface LocalSourceBinding {
  localProfileId: string
  name: string
  mode: LocalSource['mode']
  prefix: string
  nodeNames?: string[]
}

export interface LocalSource {
  id: string
  name: string
  mode: 'extract' | 'inline' | 'http'
  url?: string
  content?: string
  prefix: string
  interval: number
  userAgent?: string
  authorization?: string
  ageSecretKey?: string
  proxy?: string
  providerOptions?: LocalObject
  extra?: { upload: number; download: number; total: number; expire: number }
  proxies: LocalObject[]
  updated?: number
  profileId?: string
  localProfileId?: string
  // Per-node cleanup of references from linked subscription content; no profile rewrite.
  removedDialerProxies?: Record<string, string[]>
}

export interface LocalDraft {
  sources: LocalSource[]
  modules: Record<LocalModule, string>
  // Standard Mihomo fields without a dedicated local config module.
  preserved?: LocalObject
}

export interface LocalPreview {
  yaml: string
  errors: string[]
  references: { outbounds: string[]; proxyProviders: string[]; ruleProviders: string[] }
}

export interface LocalProxyGroupEditor {
  group: LocalObject
  outbounds: string[]
  groupNames: string[]
  proxyProviders: string[]
  sources: string[]
  outboundDetails: Record<string, { type: string; source?: string }>
  providerTypes: Record<string, string>
}

export interface LocalRuleEditor {
  rules: string[]
  ruleProviders: Record<string, LocalObject>
  outbounds: string[]
  subRules: string[]
}

export type LocalRuleChange =
  | { action: 'add'; value: string; index: number }
  | { action: 'edit'; value: string; index: number }
  | { action: 'remove'; index: number }
  | { action: 'reorder'; order: number[] }

export function defaultLocalDraft(): LocalDraft {
  return {
    sources: [],
    modules: {
      general:
        'mixed-port: 7890\nmode: rule\nlog-level: info\nallow-lan: false\nipv6: true\nprofile:\n  store-selected: true\n',
      proxies: '[]\n',
      'proxy-providers': '{}\n',
      'proxy-groups':
        '- name: PROXY\n  type: select\n  include-all-proxies: true\n  include-all-providers: true\n  proxies:\n    - DIRECT\n',
      rules: '- MATCH,PROXY\n',
      'rule-providers': '{}\n',
      'sub-rules': '{}\n',
      dns: 'enable: true\nlisten: 127.0.0.1:1053\nenhanced-mode: fake-ip\nfake-ip-range: 198.18.0.1/16\nnameserver:\n  - https://doh.pub/dns-query\nproxy-server-nameserver:\n  - https://dns.alidns.com/dns-query\n',
      hosts: '{}\n',
      tun: 'enable: false\nstack: mixed\nauto-route: true\nauto-detect-interface: true\ndns-hijack:\n  - any:53\n',
      sniffer: 'enable: false\n'
    },
    preserved: {}
  }
}
