import {
  DEFAULT_CONTROL_DNS,
  DEFAULT_CONTROL_SNIFF,
  DEFAULT_ENABLE_TRAFFIC_LOGGER,
  DEFAULT_MIHOMO_DNS_CONFIG,
  DEFAULT_MIHOMO_LAN_ALLOWED_IPS,
  DEFAULT_MIHOMO_PORTS,
  DEFAULT_MIHOMO_SKIP_AUTH_PREFIXES,
  DEFAULT_MIHOMO_SNIFFER_CONFIG,
  DEFAULT_MIHOMO_TUN_CONFIG,
  DEFAULT_NAMESERVER_POLICY,
  DEFAULT_NETWORK_INFO_CARD_ORDER,
  DEFAULT_SIDER_ORDER,
  DEFAULT_USE_SUB_STORE,
  getDefaultMihomoTunDevice,
  DEFAULT_USE_NAMESERVER_POLICY
} from '../../shared/appConfig'

export const defaultConfig: IAppConfig = {
  core: 'mihomo',
  enableSmartCore: false,
  enableSmartOverride: true,
  smartCoreUseLightGBM: false,
  smartCoreCollectData: false,
  smartCoreStrategy: 'sticky-sessions',
  silentStart: false,
  appTheme: 'system',
  useWindowFrame: false,
  proxyInTray: true,
  showCurrentProxyInTray: false,
  enableTrafficLogger: DEFAULT_ENABLE_TRAFFIC_LOGGER,
  trayProxyGroupStyle: 'default',
  disableTrayIconColor: false,
  customTrayIcon: '',
  maxLogDays: 7,
  maxLogFileSize: 10,
  disableAppLog: false,
  proxyCols: 'auto',
  connectionDirection: 'asc',
  connectionOrderBy: 'time',
  useSubStore: DEFAULT_USE_SUB_STORE,
  autoQuitWithoutCore: false,
  autoQuitWithoutCoreDelay: 60,
  autoQuitWithoutCoreMode: 'core',
  proxyDisplayMode: 'simple',
  proxyDisplayOrder: 'default',
  autoCheckUpdate: true,
  autoCloseConnection: true,
  subscriptionTimeout: 30000,
  gistAgeEncrypt: false,
  gistAgeRecipient: '',
  gistAgeSecretKey: '',
  networkLatencyTargets: [],
  networkInfoCardOrder: DEFAULT_NETWORK_INFO_CARD_ORDER,
  useNameserverPolicy: DEFAULT_USE_NAMESERVER_POLICY,
  controlDns: DEFAULT_CONTROL_DNS,
  controlSniff: DEFAULT_CONTROL_SNIFF,
  floatingWindowCompatMode: true,
  disableHardwareAcceleration: false,
  hideConnectionCardWave: false,
  nameserverPolicy: DEFAULT_NAMESERVER_POLICY,
  siderOrder: DEFAULT_SIDER_ORDER,
  lastSelectedSiderCard: 'proxy',
  siderWidth: 250,
  sysProxy: { enable: false, mode: 'manual' },
  triggerMainWindowBehavior: 'show',
  showMixedPort: DEFAULT_MIHOMO_PORTS.mixed,
  enableMixedPort: true,
  showSocksPort: DEFAULT_MIHOMO_PORTS.socks,
  enableSocksPort: true,
  showHttpPort: DEFAULT_MIHOMO_PORTS.http,
  enableHttpPort: true,
  showRedirPort: DEFAULT_MIHOMO_PORTS.redir,
  enableRedirPort: false,
  showTproxyPort: DEFAULT_MIHOMO_PORTS.tproxy,
  enableTproxyPort: false,
  testProfileOnStart: true,
  useHotReloadProfile: false,
  hotReloadProfileAutoCloseConnection: false
}

export const defaultControledMihomoConfig: Partial<IMihomoConfig> = {
  'external-controller': '',
  ipv6: true,
  mode: 'rule',
  'mixed-port': DEFAULT_MIHOMO_PORTS.mixed,
  'socks-port': DEFAULT_MIHOMO_PORTS.socks,
  port: DEFAULT_MIHOMO_PORTS.http,
  'redir-port': DEFAULT_MIHOMO_PORTS.redir,
  'tproxy-port': DEFAULT_MIHOMO_PORTS.tproxy,
  'allow-lan': false,
  'unified-delay': true,
  'tcp-concurrent': false,
  'log-level': 'info',
  'find-process-mode': 'strict',
  'bind-address': '*',
  'lan-allowed-ips': DEFAULT_MIHOMO_LAN_ALLOWED_IPS,
  'lan-disallowed-ips': [],
  authentication: [],
  'skip-auth-prefixes': DEFAULT_MIHOMO_SKIP_AUTH_PREFIXES,
  tun: {
    ...DEFAULT_MIHOMO_TUN_CONFIG,
    device: getDefaultMihomoTunDevice(process.platform)
  },
  dns: DEFAULT_MIHOMO_DNS_CONFIG,
  sniffer: DEFAULT_MIHOMO_SNIFFER_CONFIG,
  profile: {
    'store-selected': true,
    'store-fake-ip': true
  },
  'geo-auto-update': false,
  'geo-update-interval': 24,
  'geodata-mode': false,
  'geox-url': {
    geoip: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip-lite.dat',
    geosite: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat',
    mmdb: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.metadb',
    asn: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/GeoLite2-ASN.mmdb'
  }
}

export const defaultProfileConfig: IProfileConfig = {
  items: []
}

export const defaultOverrideConfig: IOverrideConfig = {
  items: []
}

export const defaultProfile: Partial<IMihomoConfig> = {
  proxies: [],
  'proxy-groups': [],
  rules: []
}
