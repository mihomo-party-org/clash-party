export const DEFAULT_CONTROL_DNS = false

export const DEFAULT_CONTROL_SNIFF = true

export const DEFAULT_USE_NAMESERVER_POLICY = false

export const DEFAULT_NAMESERVER_POLICY: IAppConfig['nameserverPolicy'] = {}

export const DEFAULT_ENABLE_TRAFFIC_LOGGER = true

export const DEFAULT_USE_SUB_STORE = true

export const DEFAULT_SIDER_ORDER: SiderCardKey[] = [
  'sysproxy',
  'tun',
  'profile',
  'proxy',
  'rule',
  'resource',
  'override',
  'connection',
  'mihomo',
  'dns',
  'sniff',
  'log',
  'substore',
  'network',
  'usage'
]

export const DEFAULT_NETWORK_INFO_CARD_ORDER: NetworkInfoCardKey[] = ['ip', 'topology', 'latency']

export const DEFAULT_MIHOMO_PORTS = {
  mixed: 7890,
  socks: 7891,
  http: 7892,
  redir: 0,
  tproxy: 0
} as const

export const DEFAULT_MIHOMO_SKIP_AUTH_PREFIXES = ['127.0.0.1/32', '::1/128']

export const DEFAULT_MIHOMO_LAN_ALLOWED_IPS = ['0.0.0.0/0', '::/0']

export function getDefaultMihomoTunDevice(platform: NodeJS.Platform | string): string {
  return platform === 'darwin' ? 'utun1500' : 'Mihomo'
}

type DefaultMihomoTunConfig = {
  enable: boolean
  stack: TunStack
  'auto-route': boolean
  'auto-redirect': boolean
  'auto-detect-interface': boolean
  'dns-hijack': string[]
  'route-exclude-address': string[]
  mtu: number
}

export const DEFAULT_MIHOMO_TUN_CONFIG: DefaultMihomoTunConfig = {
  enable: false,
  stack: 'mixed',
  'auto-route': true,
  'auto-redirect': false,
  'auto-detect-interface': true,
  'dns-hijack': ['any:53'],
  'route-exclude-address': [],
  mtu: 1500
}

export const DEFAULT_MIHOMO_DNS_CONFIG: IMihomoDNSConfig = {
  enable: true,
  ipv6: false,
  'enhanced-mode': 'fake-ip',
  'fake-ip-range': '198.18.0.1/16',
  'fake-ip-filter': ['*', '+.lan', '+.local', 'time.*.com', 'ntp.*.com', '+.market.xiaomi.com'],
  'use-hosts': false,
  'use-system-hosts': false,
  'respect-rules': false,
  'default-nameserver': ['tls://223.5.5.5'],
  nameserver: ['https://doh.pub/dns-query', 'https://dns.alidns.com/dns-query'],
  'proxy-server-nameserver': ['https://doh.pub/dns-query', 'https://dns.alidns.com/dns-query'],
  'direct-nameserver': [],
  fallback: [],
  'fallback-filter': {
    geoip: true,
    'geoip-code': 'CN',
    ipcidr: ['240.0.0.0/4', '0.0.0.0/32'],
    domain: ['+.google.com', '+.facebook.com', '+.youtube.com']
  }
}

// 仅包含旧模板实际下发到内核的字段，QUIC / force-domain / skip-src-address
// 等属于设置页可选项，不写入默认配置，避免凭空给已有用户的内核加参数。
type DefaultMihomoSnifferConfig = {
  enable: boolean
  'parse-pure-ip': boolean
  'force-dns-mapping': boolean
  'override-destination': boolean
  sniff: {
    HTTP: {
      ports: (number | string)[]
      'override-destination': boolean
    }
    TLS: {
      ports: (number | string)[]
    }
  }
  'skip-domain': string[]
  'skip-dst-address': string[]
}

export const DEFAULT_MIHOMO_SNIFFER_CONFIG: DefaultMihomoSnifferConfig = {
  enable: true,
  'parse-pure-ip': true,
  'force-dns-mapping': true,
  'override-destination': false,
  sniff: {
    HTTP: {
      ports: [80, 443],
      'override-destination': false
    },
    TLS: {
      ports: [443]
    }
  },
  'skip-domain': ['+.push.apple.com'],
  'skip-dst-address': [
    '91.105.192.0/23',
    '91.108.4.0/22',
    '91.108.8.0/21',
    '91.108.16.0/21',
    '91.108.56.0/22',
    '95.161.64.0/20',
    '149.154.160.0/20',
    '185.76.151.0/24',
    '2001:67c:4e8::/48',
    '2001:b28:f23c::/47',
    '2001:b28:f23f::/48',
    '2a0a:f280:203::/48'
  ]
}
