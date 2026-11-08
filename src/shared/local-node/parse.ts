import type { LocalObject } from '../local-config'
import { parseYaml } from '../yaml'

export interface LocalNodeParseResult {
  nodes: LocalObject[]
  errors: string[]
}

const SCHEME_PATTERN = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//

const SUPPORTED_SCHEMES = new Set([
  'ss',
  'ssr',
  'vmess',
  'vless',
  'trojan',
  'hysteria2',
  'hy2',
  'hysteria',
  'tuic',
  'anytls',
  'socks5',
  'socks',
  'socks5h',
  'http',
  'https'
])

const SS_PLUGIN_ALIASES: Record<string, string> = {
  'obfs-local': 'obfs',
  'simple-obfs': 'obfs'
}

const SS_PLUGIN_KEY_ALIASES: Record<string, string> = {
  obfs: 'mode',
  'obfs-host': 'host'
}

const SS_PLUGIN_NUMBER_KEYS = new Set([
  'version',
  'conn',
  'autoexpire',
  'scavengettl',
  'mtu',
  'ratelimit',
  'sndwnd',
  'rcvwnd',
  'datashard',
  'parityshard',
  'dscp',
  'nodelay',
  'interval',
  'resend',
  'nc',
  'sockbuf',
  'smuxver',
  'smuxbuf',
  'framesize',
  'streambuf',
  'keepalive'
])

const SS_PLUGIN_FLAG_KEYS = new Set(['tls', 'mux', 'nocomp', 'acknodelay', 'force-tls12'])

const UTF8_DECODER = new TextDecoder()

interface LinkParts {
  scheme: string
  userinfo: string
  host: string
  port: string
  path: string
  params: Record<string, string>
  tag: string
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function decodeComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function decodeBase64(value: string): string | null {
  const normalized = value.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  if (normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return null
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  try {
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return UTF8_DECODER.decode(bytes)
  } catch {
    return null
  }
}

function readText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function readList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => readText(item)).filter(Boolean)
  return splitList(readText(value))
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function buildParams(query: string): Record<string, string> {
  const params: Record<string, string> = {}
  for (const [key, value] of new URLSearchParams(query)) {
    const lower = key.toLowerCase()
    if (params[lower] === undefined) params[lower] = value
  }
  return params
}

function readParam(params: Record<string, string>, ...names: string[]): string {
  for (const name of names) {
    const value = params[name.toLowerCase()]
    if (value !== undefined && value !== '') return value
  }
  return ''
}

function setValue(target: LocalObject, key: string, value: unknown): void {
  if (value === undefined || value === null) return
  if (typeof value === 'string') {
    if (value.trim() === '') return
    target[key] = value
    return
  }
  if (typeof value === 'object' && Object.keys(value as LocalObject).length === 0) return
  target[key] = value
}

function setNumber(target: LocalObject, key: string, value: unknown): void {
  if (value === undefined || value === null || value === '') return
  const parsed = typeof value === 'number' ? value : Number(String(value).trim())
  if (Number.isFinite(parsed)) target[key] = parsed
}

function setSpeed(target: LocalObject, key: string, value: unknown): void {
  if (value === undefined || value === null || value === '') return
  const text = String(value).trim()
  if (!text) return
  target[key] = /^\d+(?:\.\d+)?$/.test(text) ? `${text} mbps` : text
}

function setFlag(target: LocalObject, key: string, value: unknown): void {
  if (value === true) {
    target[key] = true
    return
  }
  const text = String(value ?? '')
    .trim()
    .toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(text)) target[key] = true
}

function splitHostPort(value: string): { host: string; port: string } {
  const text = value.trim()
  if (text.startsWith('[')) {
    const end = text.indexOf(']')
    if (end >= 0) return { host: text.slice(1, end), port: text.slice(end + 1).replace(/^:/, '') }
  }
  const colonIndex = text.lastIndexOf(':')
  if (colonIndex < 0) return { host: text, port: '' }
  return { host: text.slice(0, colonIndex), port: text.slice(colonIndex + 1) }
}

function toPort(value: unknown): number | null {
  const match = /^(\d+)/.exec(String(value ?? '').trim())
  if (!match) return null
  const port = Number(match[1])
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return port
}

function splitLinkParts(raw: string): LinkParts | null {
  const match = SCHEME_PATTERN.exec(raw)
  if (!match) return null
  const scheme = match[1].toLowerCase()
  let rest = raw.slice(match[0].length)
  let tag = ''
  const hashIndex = rest.indexOf('#')
  if (hashIndex >= 0) {
    tag = decodeComponent(rest.slice(hashIndex + 1)).trim()
    rest = rest.slice(0, hashIndex)
  }
  let query = ''
  const queryIndex = rest.indexOf('?')
  if (queryIndex >= 0) {
    query = rest.slice(queryIndex + 1)
    rest = rest.slice(0, queryIndex)
  }
  const slashIndex = rest.indexOf('/')
  const authority = slashIndex >= 0 ? rest.slice(0, slashIndex) : rest
  const path = slashIndex >= 0 ? rest.slice(slashIndex) : ''
  let userinfo = ''
  let hostPort = authority
  const atIndex = authority.lastIndexOf('@')
  if (atIndex >= 0) {
    userinfo = authority.slice(0, atIndex)
    hostPort = authority.slice(atIndex + 1)
  }
  const { host, port } = splitHostPort(hostPort)
  return {
    scheme,
    userinfo,
    host: host.trim(),
    port: port.trim(),
    path,
    params: buildParams(query),
    tag
  }
}

function readServer(parts: LinkParts, scheme: string): { server: string; port: number } {
  const port = toPort(parts.port)
  if (!parts.host || port === null) throw new Error(`无效的 ${scheme} 链接：服务器地址或端口无效`)
  return { server: parts.host, port }
}

function setName(node: LocalObject, tag: string, server: string, port: number): void {
  node.name = tag.trim() || `${server}:${port}`
}

function parseShareLink(raw: string, scheme: string): LocalObject {
  switch (scheme) {
    case 'ss':
      return parseShadowsocks(raw)
    case 'ssr':
      return parseShadowsocksR(raw)
    case 'vmess':
      return parseVmess(raw)
    case 'vless':
      return parseVless(raw)
    case 'trojan':
      return parseTrojan(raw)
    case 'hysteria2':
    case 'hy2':
      return parseHysteria2(raw)
    case 'hysteria':
      return parseHysteria(raw)
    case 'tuic':
      return parseTuic(raw)
    case 'anytls':
      return parseAnytls(raw)
    case 'socks5':
    case 'socks':
    case 'socks5h':
      return parseSocks(raw, scheme)
    case 'http':
    case 'https':
      return parseHttp(raw, scheme)
    default:
      throw new Error(`不支持的链接协议 ${scheme}://`)
  }
}

function parseShadowsocks(raw: string): LocalObject {
  let rest = raw.replace(/^ss:\/\//i, '')
  let tag = ''
  const hashIndex = rest.indexOf('#')
  if (hashIndex >= 0) {
    tag = decodeComponent(rest.slice(hashIndex + 1)).trim()
    rest = rest.slice(0, hashIndex)
  }
  let query = ''
  const queryIndex = rest.indexOf('?')
  if (queryIndex >= 0) {
    query = rest.slice(queryIndex + 1)
    rest = rest.slice(0, queryIndex)
  }
  const atIndex = rest.lastIndexOf('@')
  let credentials = ''
  let hostPort = ''
  if (atIndex >= 0) {
    hostPort = rest.slice(atIndex + 1)
    const plain = decodeComponent(rest.slice(0, atIndex))
    const decoded = decodeBase64(plain)
    // SIP002 的 userinfo 既可能是 base64，也可能是百分号编码的明文
    credentials = decoded !== null && decoded.includes(':') ? decoded : plain
  } else {
    const decoded = decodeBase64(rest)
    if (decoded === null) throw new Error('无效的 ss 链接：base64 解码失败')
    const decodedAt = decoded.lastIndexOf('@')
    if (decodedAt < 0) throw new Error('无效的 ss 链接：缺少服务器地址')
    credentials = decoded.slice(0, decodedAt)
    hostPort = decoded.slice(decodedAt + 1)
  }
  const colonIndex = credentials.indexOf(':')
  if (colonIndex < 0 || !credentials.slice(0, colonIndex).trim()) {
    throw new Error('无效的 ss 链接：缺少加密方式或密码')
  }
  const { host, port: portText } = splitHostPort(hostPort)
  const port = toPort(portText)
  if (!host || port === null) throw new Error('无效的 ss 链接：服务器地址或端口无效')
  const node: LocalObject = {
    type: 'ss',
    server: host,
    port,
    cipher: credentials.slice(0, colonIndex).trim(),
    password: credentials.slice(colonIndex + 1)
  }
  setName(node, tag, host, port)
  const plugin = readParam(buildParams(query), 'plugin')
  if (plugin) applyShadowsocksPlugin(node, plugin)
  return node
}

function applyShadowsocksPlugin(node: LocalObject, value: string): void {
  const segments = value
    .split(';')
    .map((segment) => segment.trim())
    .filter(Boolean)
  let pluginName = ''
  const options: LocalObject = {}
  for (const segment of segments) {
    const equalsIndex = segment.indexOf('=')
    if (equalsIndex < 0) {
      if (!pluginName) pluginName = segment
      continue
    }
    const key = segment.slice(0, equalsIndex).trim()
    if (key) options[key] = segment.slice(equalsIndex + 1).trim()
  }
  const alias = SS_PLUGIN_ALIASES[pluginName.toLowerCase()]
  const plugin = (alias ?? pluginName) || inferShadowsocksPlugin(options)
  setValue(node, 'plugin', plugin)
  setValue(node, 'plugin-opts', mapShadowsocksPluginOptions(options))
}

function inferShadowsocksPlugin(options: LocalObject): string {
  if ('obfs' in options) return 'obfs'
  if ('crypt' in options || 'key' in options) return 'kcptun'
  return 'v2ray-plugin'
}

function mapShadowsocksPluginOptions(options: LocalObject): LocalObject {
  const mapped: LocalObject = {}
  for (const [rawKey, rawValue] of Object.entries(options)) {
    const key = SS_PLUGIN_KEY_ALIASES[rawKey.toLowerCase()] ?? rawKey
    if (key === 'alpn') {
      setValue(mapped, key, splitList(String(rawValue)))
      continue
    }
    if (SS_PLUGIN_NUMBER_KEYS.has(key)) {
      setNumber(mapped, key, rawValue)
      continue
    }
    if (SS_PLUGIN_FLAG_KEYS.has(key)) {
      setFlag(mapped, key, rawValue)
      continue
    }
    setValue(mapped, key, rawValue)
  }
  return mapped
}

function parseShadowsocksR(raw: string): LocalObject {
  const body = raw.replace(/^ssr:\/\//i, '')
  let tag = ''
  let payload = body
  const hashIndex = body.indexOf('#')
  if (hashIndex >= 0) {
    tag = decodeComponent(body.slice(hashIndex + 1)).trim()
    payload = body.slice(0, hashIndex)
  }
  const decoded = decodeBase64(payload)
  if (decoded === null) throw new Error('无效的 ssr 链接：base64 解码失败')
  const queryIndex = decoded.indexOf('?')
  const main = (queryIndex >= 0 ? decoded.slice(0, queryIndex) : decoded).replace(/\/+$/, '')
  const query = queryIndex >= 0 ? decoded.slice(queryIndex + 1) : ''
  const segments = main.split(':')
  if (segments.length < 6) throw new Error('无效的 ssr 链接：字段数量不足')
  const [portText, protocol, method, obfs, passwordText] = segments.slice(-5)
  const host = segments.slice(0, -5).join(':')
  const port = toPort(portText)
  const password = decodeBase64(passwordText)
  if (!host || port === null) throw new Error('无效的 ssr 链接：服务器地址或端口无效')
  if (password === null) throw new Error('无效的 ssr 链接：密码解码失败')
  if (!protocol || !method || !obfs) throw new Error('无效的 ssr 链接：缺少协议或加密方式')
  const params = buildParams(query)
  const node: LocalObject = {
    type: 'ssr',
    server: host,
    port,
    password,
    cipher: method,
    protocol,
    obfs
  }
  setValue(node, 'obfs-param', decodeBase64(readParam(params, 'obfsparam')))
  setValue(node, 'protocol-param', decodeBase64(readParam(params, 'protoparam')))
  setName(node, tag || readText(decodeBase64(readParam(params, 'remarks'))), host, port)
  return node
}

function parseVmess(raw: string): LocalObject {
  const body = raw.replace(/^vmess:\/\//i, '')
  let tag = ''
  let payload = body
  const hashIndex = body.indexOf('#')
  if (hashIndex >= 0) {
    tag = decodeComponent(body.slice(hashIndex + 1)).trim()
    payload = body.slice(0, hashIndex)
  }
  const decoded = decodeBase64(payload)
  if (decoded === null) throw new Error('无效的 vmess 链接：base64 解码失败')
  let config: LocalObject
  try {
    const parsed: unknown = JSON.parse(decoded)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object')
    }
    config = parsed as LocalObject
  } catch {
    throw new Error('无效的 vmess 链接：JSON 解析失败')
  }
  const server = readText(config.add)
  const port = toPort(config.port)
  if (!server || port === null) throw new Error('无效的 vmess 链接：服务器地址或端口无效')
  const node: LocalObject = { type: 'vmess', server, port }
  setName(node, tag || readText(config.ps), server, port)
  setValue(node, 'uuid', readText(config.id))
  setNumber(node, 'alterId', config.aid ?? config.alterId)
  setValue(node, 'cipher', readText(config.scy ?? config.security))

  const network = readText(config.net).toLowerCase()
  const headerType = readText(config.type).toLowerCase()
  const path = readText(config.path)
  const host = readText(config.host)
  const tls = ['tls', 'true', '1', 'reality'].includes(readText(config.tls).toLowerCase())
  const resolvedNetwork = network === 'tcp' && headerType === 'http' ? 'http' : network
  setValue(node, 'network', resolvedNetwork === 'tcp' ? '' : resolvedNetwork)
  if (resolvedNetwork === 'ws') {
    const wsOpts: LocalObject = {}
    setValue(wsOpts, 'path', path)
    if (host) wsOpts.headers = { Host: host }
    setValue(node, 'ws-opts', wsOpts)
  } else if (resolvedNetwork === 'h2') {
    const h2Opts: LocalObject = {}
    setValue(h2Opts, 'path', path)
    if (host) h2Opts.host = [host]
    setValue(node, 'h2-opts', h2Opts)
  } else if (resolvedNetwork === 'grpc') {
    setValue(node, 'grpc-opts', path ? { 'grpc-service-name': path } : {})
  } else if (resolvedNetwork === 'http') {
    const httpOpts: LocalObject = { method: 'GET' }
    if (path) httpOpts.path = [path]
    if (host) httpOpts.headers = { Host: [host] }
    setValue(node, 'http-opts', httpOpts)
  } else if ((resolvedNetwork === 'mkcp' || resolvedNetwork === 'kcp') && headerType) {
    setValue(node, 'mkcp-opts', headerType === 'none' ? {} : { header: headerType })
  }
  if (tls) {
    node.tls = true
    setValue(node, 'servername', readText(config.sni) || host)
  }
  setValue(node, 'client-fingerprint', readText(config.fp))
  setValue(node, 'alpn', readList(config.alpn))
  setFlag(node, 'skip-cert-verify', config.allowInsecure ?? config['skip-cert-verify'])
  return node
}

function parseVless(raw: string): LocalObject {
  const parts = splitLinkParts(raw)
  if (!parts) throw new Error('无效的 vless 链接')
  const { server, port } = readServer(parts, 'vless')
  const uuid = decodeComponent(parts.userinfo).trim()
  if (!uuid) throw new Error('无效的 vless 链接：缺少 UUID')
  const node: LocalObject = { type: 'vless', server, port, uuid }
  setName(node, parts.tag, server, port)
  const params = parts.params
  const network = readParam(params, 'type', 'network').toLowerCase()
  const security = readParam(params, 'security').toLowerCase()
  const host = readParam(params, 'host')
  const path = readParam(params, 'path')
  const serviceName = readParam(params, 'servicename')
  setValue(node, 'encryption', readParam(params, 'encryption'))
  setValue(node, 'flow', readParam(params, 'flow'))
  const secure = ['tls', 'reality', 'xtls'].includes(security)
  if (secure) node.tls = true
  const sni = readParam(params, 'sni', 'peer')
  setValue(node, 'servername', sni || (secure ? host : ''))
  setValue(node, 'client-fingerprint', readParam(params, 'fp'))
  setValue(node, 'alpn', splitList(readParam(params, 'alpn')))
  setFlag(node, 'skip-cert-verify', readParam(params, 'allowinsecure', 'insecure'))
  const resolvedNetwork = network === 'raw' ? 'tcp' : network
  setValue(node, 'network', resolvedNetwork === 'tcp' ? '' : resolvedNetwork)
  if (security === 'reality') {
    const realityOpts: LocalObject = {}
    setValue(realityOpts, 'public-key', readParam(params, 'pbk'))
    setValue(realityOpts, 'short-id', readParam(params, 'sid'))
    setValue(node, 'reality-opts', realityOpts)
  }
  if (resolvedNetwork === 'ws') {
    const wsOpts: LocalObject = {}
    setValue(wsOpts, 'path', path)
    if (host) wsOpts.headers = { Host: host }
    setValue(node, 'ws-opts', wsOpts)
  } else if (resolvedNetwork === 'grpc') {
    const name = serviceName || path
    setValue(node, 'grpc-opts', name ? { 'grpc-service-name': name } : {})
  } else if (resolvedNetwork === 'h2') {
    const h2Opts: LocalObject = {}
    setValue(h2Opts, 'path', path)
    if (host) h2Opts.host = [host]
    setValue(node, 'h2-opts', h2Opts)
  } else if (resolvedNetwork === 'xhttp') {
    const xhttpOpts: LocalObject = {}
    setValue(xhttpOpts, 'path', path)
    setValue(xhttpOpts, 'host', host)
    setValue(xhttpOpts, 'mode', readParam(params, 'mode'))
    setValue(node, 'xhttp-opts', xhttpOpts)
  }
  return node
}

function parseTrojan(raw: string): LocalObject {
  const parts = splitLinkParts(raw)
  if (!parts) throw new Error('无效的 trojan 链接')
  const { server, port } = readServer(parts, 'trojan')
  const password = decodeComponent(parts.userinfo).trim()
  if (!password) throw new Error('无效的 trojan 链接：缺少密码')
  const node: LocalObject = { type: 'trojan', server, port, password }
  setName(node, parts.tag, server, port)
  const params = parts.params
  const network = readParam(params, 'type', 'network').toLowerCase()
  const host = readParam(params, 'host')
  const path = readParam(params, 'path')
  setValue(node, 'sni', readParam(params, 'sni', 'peer'))
  setValue(node, 'client-fingerprint', readParam(params, 'fp'))
  setValue(node, 'alpn', splitList(readParam(params, 'alpn')))
  setFlag(node, 'skip-cert-verify', readParam(params, 'allowinsecure', 'insecure'))
  const resolvedNetwork = network === 'raw' ? 'tcp' : network
  setValue(node, 'network', resolvedNetwork === 'tcp' ? '' : resolvedNetwork)
  if (resolvedNetwork === 'ws') {
    const wsOpts: LocalObject = {}
    setValue(wsOpts, 'path', path)
    if (host) wsOpts.headers = { Host: host }
    setValue(node, 'ws-opts', wsOpts)
  } else if (resolvedNetwork === 'grpc') {
    const name = readParam(params, 'servicename') || path
    setValue(node, 'grpc-opts', name ? { 'grpc-service-name': name } : {})
  }
  return node
}

function parseHysteria2(raw: string): LocalObject {
  const parts = splitLinkParts(raw)
  if (!parts) throw new Error('无效的 hysteria2 链接')
  const { server, port } = readServer(parts, 'hysteria2')
  const node: LocalObject = { type: 'hysteria2', server, port }
  setName(node, parts.tag, server, port)
  setValue(node, 'password', decodeComponent(parts.userinfo))
  const params = parts.params
  setValue(node, 'sni', readParam(params, 'sni', 'peer'))
  setValue(node, 'obfs', readParam(params, 'obfs'))
  setValue(node, 'obfs-password', readParam(params, 'obfs-password'))
  setValue(node, 'up', readParam(params, 'up'))
  setValue(node, 'down', readParam(params, 'down'))
  setValue(node, 'fingerprint', readParam(params, 'pinsha256', 'pin'))
  setValue(node, 'alpn', splitList(readParam(params, 'alpn')))
  setFlag(node, 'skip-cert-verify', readParam(params, 'insecure', 'allowinsecure'))
  if (/[,-]/.test(parts.port)) setValue(node, 'ports', parts.port)
  return node
}

function parseHysteria(raw: string): LocalObject {
  const parts = splitLinkParts(raw)
  if (!parts) throw new Error('无效的 hysteria 链接')
  const { server, port } = readServer(parts, 'hysteria')
  const node: LocalObject = { type: 'hysteria', server, port }
  setName(node, parts.tag, server, port)
  const params = parts.params
  setValue(node, 'auth-str', readParam(params, 'auth') || decodeComponent(parts.userinfo))
  setValue(node, 'sni', readParam(params, 'peer', 'sni'))
  setValue(node, 'obfs', readParam(params, 'obfs'))
  setValue(node, 'protocol', readParam(params, 'protocol'))
  setSpeed(node, 'up', readParam(params, 'upmbps', 'up'))
  setSpeed(node, 'down', readParam(params, 'downmbps', 'down'))
  setValue(node, 'alpn', splitList(readParam(params, 'alpn')))
  setFlag(node, 'skip-cert-verify', readParam(params, 'insecure'))
  if (/[,-]/.test(parts.port)) setValue(node, 'ports', parts.port)
  return node
}

function parseTuic(raw: string): LocalObject {
  const parts = splitLinkParts(raw)
  if (!parts) throw new Error('无效的 tuic 链接')
  const { server, port } = readServer(parts, 'tuic')
  const node: LocalObject = { type: 'tuic', server, port }
  setName(node, parts.tag, server, port)
  const colonIndex = parts.userinfo.indexOf(':')
  if (colonIndex >= 0) {
    setValue(node, 'uuid', decodeComponent(parts.userinfo.slice(0, colonIndex)).trim())
    setValue(node, 'password', decodeComponent(parts.userinfo.slice(colonIndex + 1)))
  } else {
    setValue(node, 'uuid', decodeComponent(parts.userinfo).trim())
  }
  const params = parts.params
  setValue(node, 'token', readParam(params, 'token'))
  setValue(node, 'sni', readParam(params, 'sni', 'peer'))
  setValue(
    node,
    'congestion-controller',
    readParam(params, 'congestion_control', 'congestion-controller')
  )
  setValue(node, 'udp-relay-mode', readParam(params, 'udp_relay_mode', 'udp-relay-mode'))
  setValue(node, 'alpn', splitList(readParam(params, 'alpn')))
  setFlag(
    node,
    'skip-cert-verify',
    readParam(params, 'allow_insecure', 'insecure', 'allowinsecure')
  )
  return node
}

function parseAnytls(raw: string): LocalObject {
  const parts = splitLinkParts(raw)
  if (!parts) throw new Error('无效的 anytls 链接')
  const { server, port } = readServer(parts, 'anytls')
  const password = decodeComponent(parts.userinfo).trim()
  if (!password) throw new Error('无效的 anytls 链接：缺少密码')
  const node: LocalObject = { type: 'anytls', server, port, password }
  setName(node, parts.tag, server, port)
  const params = parts.params
  setValue(node, 'sni', readParam(params, 'sni', 'peer'))
  setValue(node, 'client-fingerprint', readParam(params, 'fp'))
  setValue(node, 'alpn', splitList(readParam(params, 'alpn')))
  setFlag(node, 'skip-cert-verify', readParam(params, 'insecure', 'allowinsecure'))
  return node
}

function parseSocks(raw: string, scheme: string): LocalObject {
  const parts = splitLinkParts(raw)
  if (!parts) throw new Error(`无效的 ${scheme} 链接`)
  const { server, port } = readServer(parts, scheme)
  const node: LocalObject = { type: 'socks5', server, port }
  setName(node, parts.tag, server, port)
  const colonIndex = parts.userinfo.indexOf(':')
  if (colonIndex >= 0) {
    setValue(node, 'username', decodeComponent(parts.userinfo.slice(0, colonIndex)))
    setValue(node, 'password', decodeComponent(parts.userinfo.slice(colonIndex + 1)))
  } else {
    setValue(node, 'username', decodeComponent(parts.userinfo))
  }
  return node
}

function parseHttp(raw: string, scheme: string): LocalObject {
  const parts = splitLinkParts(raw)
  if (!parts) throw new Error(`无效的 ${scheme} 链接`)
  if (!parts.userinfo.includes(':') || !parts.port || parts.path) {
    throw new Error(`${scheme}:// 链接看起来是普通网址，不是代理节点`)
  }
  const { server, port } = readServer(parts, scheme)
  const colonIndex = parts.userinfo.indexOf(':')
  const node: LocalObject = {
    type: 'http',
    server,
    port,
    username: decodeComponent(parts.userinfo.slice(0, colonIndex)),
    password: decodeComponent(parts.userinfo.slice(colonIndex + 1))
  }
  setName(node, parts.tag, server, port)
  if (scheme === 'https') node.tls = true
  return node
}

function isPlainObject(value: unknown): value is LocalObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isProxyObject(value: LocalObject): boolean {
  return typeof value.type === 'string' && value.type.trim() !== ''
}

function cleanStructuredValue(value: unknown): unknown {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value === '' ? undefined : value
  if (Array.isArray(value)) {
    if (!value.length) return undefined
    return value.map(cleanStructuredValue).filter((item) => item !== undefined)
  }
  if (typeof value === 'object') {
    const result: LocalObject = {}
    for (const [key, item] of Object.entries(value as LocalObject)) {
      const cleaned = cleanStructuredValue(item)
      if (cleaned !== undefined) result[key] = cleaned
    }
    return result
  }
  return value
}

function normalizeStructuredNode(
  value: LocalObject,
  fallbackName: string,
  errors: string[]
): LocalObject | null {
  const server = readText(value.server)
  const port = toPort(value.port)
  const name = readText(value.name) || fallbackName
  if (!server || port === null) {
    errors.push(`节点 ${name || '(未命名)'} 缺少有效的 server/port 字段`)
    return null
  }
  const node = (cleanStructuredValue(value) ?? {}) as LocalObject
  node.type = readText(value.type).toLowerCase()
  node.server = server
  node.port = port
  node.name = name || `${server}:${port}`
  if (value.alterId !== undefined) setNumber(node, 'alterId', value.alterId)
  return node
}

function collectStructuredNodes(value: unknown, errors: string[]): LocalObject[] {
  if (typeof value === 'string') {
    const text = value.trim()
    const match = SCHEME_PATTERN.exec(text)
    if (!match) return []
    const scheme = match[1].toLowerCase()
    if (!SUPPORTED_SCHEMES.has(scheme)) {
      errors.push(`不支持的链接协议 ${scheme}://`)
      return []
    }
    try {
      return [parseShareLink(text, scheme)]
    } catch (error) {
      errors.push(errorMessage(error))
      return []
    }
  }
  if (Array.isArray(value)) return value.flatMap((item) => collectStructuredNodes(item, errors))
  if (!isPlainObject(value)) return []
  if (Array.isArray(value.proxies)) return collectStructuredNodes(value.proxies, errors)
  if (isProxyObject(value)) {
    const node = normalizeStructuredNode(value, '', errors)
    return node ? [node] : []
  }
  const nodes: LocalObject[] = []
  for (const [key, item] of Object.entries(value)) {
    if (!isPlainObject(item) || !isProxyObject(item)) continue
    const node = normalizeStructuredNode(item, key, errors)
    if (node) nodes.push(node)
  }
  return nodes
}

export function parseLocalNodeInput(text: string): LocalNodeParseResult {
  const nodes: LocalObject[] = []
  const errors: string[] = []
  const leftovers: string[] = []
  const lines = text.split(/\r?\n/)
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = SCHEME_PATTERN.exec(trimmed)
    if (!match) {
      leftovers.push(line)
      continue
    }
    const scheme = match[1].toLowerCase()
    if (!SUPPORTED_SCHEMES.has(scheme)) {
      errors.push(`第 ${index + 1} 行: 不支持的链接协议 ${scheme}://`)
      continue
    }
    try {
      nodes.push(parseShareLink(trimmed, scheme))
    } catch (error) {
      errors.push(`第 ${index + 1} 行: ${errorMessage(error)}`)
    }
  }
  const structured = leftovers.join('\n').trim()
  if (structured) {
    let document: unknown
    try {
      document = parseYaml(structured)
    } catch (error) {
      errors.push(`YAML/JSON 解析失败: ${errorMessage(error).split('\n')[0]}`)
    }
    if (document !== undefined) {
      const errorCount = errors.length
      const collected = collectStructuredNodes(document, errors)
      if (!collected.length && errors.length === errorCount) {
        errors.push('未从 YAML/JSON 内容中解析到节点')
      }
      nodes.push(...collected)
    }
  }
  if (!nodes.length && !errors.length) errors.push('未解析到任何节点')
  return { nodes, errors }
}
