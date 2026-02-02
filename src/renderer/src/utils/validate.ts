import validator from 'validator'

const domainValidator = (value: string): boolean => {
  if (value.length > 253 || value.length < 2) return false

  // 检查是否为合法的 FQDN (完全限定域名)
  if (validator.isFQDN(value, { require_tld: true })) return true

  // 允许特殊的本地域名
  return ['localhost', 'local', 'localdomain'].includes(value.toLowerCase())
}

const domainSuffixValidator = (value: string): boolean => {
  // 域名后缀验证 - 可以是完整域名或带通配符的域名后缀
  return validator.isFQDN(value, { require_tld: true, allow_wildcard: true })
}

const domainKeywordValidator = (value: string): boolean => {
  // 域名关键字不能包含逗号和空格
  return value.length > 0 && validator.isWhitelisted(value, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._')
}

const domainRegexValidator = (value: string): boolean => {
  try {
    new RegExp(value)
    return true
  } catch {
    return false
  }
}

const portValidator = (value: string): boolean => {
  return validator.isPort(value)
}

const ipv4CIDRValidator = (value: string): boolean => {
  // 验证 IPv4 CIDR 格式 (例如: 192.168.1.0/24)
  if (!value.includes('/')) return false

  const [ip, cidr] = value.split('/')
  const cidrNum = parseInt(cidr, 10)

  return validator.isIP(ip, 4) && !isNaN(cidrNum) && cidrNum >= 0 && cidrNum <= 32
}

const ipv6CIDRValidator = (value: string): boolean => {
  // 验证 IPv6 CIDR 格式 (例如: 2001:db8::/32)
  if (!value.includes('/')) return false

  const [ip, cidr] = value.split('/')
  const cidrNum = parseInt(cidr, 10)

  return validator.isIP(ip, 6) && !isNaN(cidrNum) && cidrNum >= 0 && cidrNum <= 128
}

// 便捷函数：将 ValidationResult 转换为布尔值
export const isValid = (result: ValidationResult): boolean => result.ok

// 便捷函数：获取错误信息
export const getError = (result: ValidationResult): string | undefined => result.error

// IP CIDR 验证器（同时支持 IPv4 和 IPv6）
const ipCIDRValidator = (value: string): boolean => {
  return ipv4CIDRValidator(value) || ipv6CIDRValidator(value)
}

// DOMAIN-WILDCARD 验证器 - 仅支持 * 和 ? 通配符
const domainWildcardValidator = (value: string): boolean => {
  if (value.length === 0) return false
  // 检查是否只包含合法字符（字母、数字、点、*、?、-）
  const validPattern = /^[a-zA-Z0-9.*?-]+$/
  if (!validPattern.test(value)) return false
  // 移除通配符后验证基本格式
  const withoutWildcards = value.replace(/\*/g, 'a').replace(/\?/g, 'a')
  // 至少要有一个点（域名结构）
  return withoutWildcards.includes('.')
}

// GEOSITE 验证器 - 站点名称验证
const geositeValidator = (value: string): boolean => {
  // GEOSITE 名称只能包含字母、数字、连字符和下划线
  return validator.isAlphanumeric(value, 'en-US', { ignore: '-_' }) && value.length > 0
}

// GEOIP 验证器 - 国家代码验证（ISO 3166-1 alpha-2）
const geoipValidator = (value: string): boolean => {
  // 支持2位国家代码（大小写不敏感）
  return validator.isAlpha(value) && value.length === 2
}

// ASN 验证器 - 自治系统号验证
const asnValidator = (value: string): boolean => {
  // ASN 范围: 1 - 4294967295 (32-bit)
  return validator.isInt(value, { min: 1, max: 4294967295 })
}

// UID 验证器 - Linux 用户 ID 验证
const uidValidator = (value: string): boolean => {
  // UID 范围: 0 - 65535 (大多数系统)
  return validator.isInt(value, { min: 0, max: 65535 })
}

// DSCP 验证器 - 区分服务代码点验证
const dscpValidator = (value: string): boolean => {
  // DSCP 范围: 0 - 63 (6-bit)
  return validator.isInt(value, { min: 0, max: 63 })
}

// NETWORK 验证器 - 网络类型验证
const networkValidator = (value: string): boolean => {
  return validator.isIn(value.toLowerCase(), ['tcp', 'udp'])
}

// 进程路径验证器
const processPathValidator = (value: string): boolean => {
  if (value.length === 0) return false
  // Windows 路径或 Unix 路径
  const windowsPath = /^[a-zA-Z]:[\\/].+/
  const unixPath = /^\/.*/
  const androidPackage = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i
  return windowsPath.test(value) || unixPath.test(value) || androidPackage.test(value)
}

// 进程路径通配符验证器
const processPathWildcardValidator = (value: string): boolean => {
  if (value.length === 0) return false
  // 包含通配符的路径，移除通配符后检查路径格式
  const withoutWildcards = value.replace(/\*/g, 'a').replace(/\?/g, 'a')
  return processPathValidator(withoutWildcards)
}

// 进程路径正则验证器
const processPathRegexValidator = (value: string): boolean => {
  try {
    new RegExp(value)
    return true
  } catch {
    return false
  }
}

// 进程名称验证器
const processNameValidator = (value: string): boolean => {
  if (value.length === 0) return false
  // 进程名或 Android 包名
  const processName = /^[a-zA-Z0-9\-_.]+$/
  const androidPackage = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i
  return processName.test(value) || androidPackage.test(value)
}

// 进程名称通配符验证器
const processNameWildcardValidator = (value: string): boolean => {
  if (value.length === 0) return false
  // 移除通配符后检查进程名格式
  const withoutWildcards = value.replace(/\*/g, 'a').replace(/\?/g, 'a')
  return processNameValidator(withoutWildcards)
}

// 进程名称正则验证器
const processNameRegexValidator = (value: string): boolean => {
  try {
    new RegExp(value)
    return true
  } catch {
    return false
  }
}

// IN-TYPE 验证器 - 入站类型验证
const inTypeValidator = (value: string): boolean => {
  // 支持单个或多个类型（用 / 分隔）
  const types = value.split('/')
  const validTypes = ['http', 'https', 'socks', 'socks4', 'socks5', 'tproxy', 'redir', 'mixed']
  return types.length > 0 && types.every((type) => validator.isIn(type.toLowerCase(), validTypes))
}

// IN-USER 验证器 - 入站用户名验证
const inUserValidator = (value: string): boolean => {
  if (value.length === 0) return false
  // 支持多个用户名（用 / 分隔）
  const users = value.split('/')
  return users.every((user) => user.length > 0 && validator.isAlphanumeric(user, 'en-US', { ignore: '-_.' }))
}

// IN-NAME 验证器 - 入站名称验证
const inNameValidator = (value: string): boolean => {
  // 入站名称可以包含字母、数字、连字符和下划线
  return validator.isAlphanumeric(value, 'en-US', { ignore: '-_' }) && value.length > 0
}

// RULE-SET 验证器 - 规则集名称验证
const ruleSetValidator = (value: string): boolean => {
  // 规则集名称（对应 rule-providers 中定义的名称）
  return validator.isAlphanumeric(value, 'en-US', { ignore: '-_' }) && value.length > 0
}

// 逻辑规则验证器 - AND, OR, NOT
const logicRuleValidator = (value: string): boolean => {
  if (value.length === 0) return false
  // 检查括号是否匹配
  let depth = 0
  for (const char of value) {
    if (char === '(') depth++
    if (char === ')') depth--
    if (depth < 0) return false
  }
  return depth === 0 && value.startsWith('(') && value.endsWith(')')
}

// SUB-RULE 验证器 - 子规则验证
const subRuleValidator = (value: string): boolean => {
  if (value.length === 0) return false
  // 格式: (RULE_TYPE,payload) 或 provider_name
  if (value.startsWith('(') && value.endsWith(')')) {
    return logicRuleValidator(value)
  }
  // 如果不是括号格式，则视为 provider 名称
  return ruleSetValidator(value)
}

// 端口范围验证器（支持单个端口或范围）
const portRangeValidator = (value: string): boolean => {
  // 支持单个端口或范围格式，如: 80 或 8000-9000
  if (value.includes('-')) {
    const [start, end] = value.split('-')
    return validator.isPort(start) && validator.isPort(end) && parseInt(start) <= parseInt(end)
  }
  return validator.isPort(value)
}

export {
  domainValidator,
  domainSuffixValidator,
  domainKeywordValidator,
  domainRegexValidator,
  domainWildcardValidator,
  geositeValidator,
  geoipValidator,
  asnValidator,
  uidValidator,
  dscpValidator,
  networkValidator,
  processPathValidator,
  processPathWildcardValidator,
  processPathRegexValidator,
  processNameValidator,
  processNameWildcardValidator,
  processNameRegexValidator,
  inTypeValidator,
  inUserValidator,
  inNameValidator,
  ruleSetValidator,
  logicRuleValidator,
  subRuleValidator,
  portValidator,
  portRangeValidator,
  ipv4CIDRValidator,
  ipv6CIDRValidator,
  ipCIDRValidator
}

// 通用验证结果类型
export interface ValidationResult {
  ok: boolean
  error?: string
}

// 验证 IPv4 地址
export const isIPv4 = (ip: string): ValidationResult => {
  if (!validator.isIP(ip, 4)) {
    return { ok: false, error: '不是有效的 IPv4 地址' }
  }
  return { ok: true }
}

// 验证 IPv6 地址
export const isIPv6 = (ip: string): ValidationResult => {
  if (!validator.isIP(ip, 6)) {
    return { ok: false, error: '不是有效的 IPv6 地址' }
  }
  return { ok: true }
}

// 验证端口
export const isValidPort = (port: string): ValidationResult => {
  if (!validator.isPort(port)) {
    return { ok: false, error: '端口号必须在 1-65535 范围内' }
  }
  return { ok: true }
}

// 验证监听地址
export const isValidListenAddress = (s: string | undefined): ValidationResult => {
  if (!s || s.trim() === '') return { ok: true }

  const v = s.trim()

  // 格式: :port (仅端口)
  if (v.startsWith(':')) {
    return isValidPort(v.slice(1))
  }

  const idx = v.lastIndexOf(':')
  if (idx === -1) return { ok: false, error: '应包含端口号' }

  const host = v.slice(0, idx)
  const port = v.slice(idx + 1)

  // 验证端口
  const portResult = isValidPort(port)
  if (!portResult.ok) return portResult

  // 格式: [IPv6]:port
  if (host.startsWith('[') && host.endsWith(']')) {
    const inner = host.slice(1, -1)
    return isIPv6(inner)
  }

  // IPv4 地址
  if (validator.isIP(host, 4)) {
    return { ok: true }
  }

  // 域名或主机名 (使用宽松的 FQDN 验证)
  if (validator.isFQDN(host, { require_tld: false }) || validator.isAlphanumeric(host, 'en-US', { ignore: '-.' })) {
    return { ok: true }
  }

  return { ok: false, error: '主机名包含非法字符' }
}

// 验证监听地址（完整版，包含 0.0.0.0 和 ::）
export const isValidListenAddressFull = (s: string | undefined): ValidationResult => {
  if (!s || s.trim() === '') return { ok: true }

  const v = s.trim()

  // 格式: :port (仅端口)
  if (v.startsWith(':')) {
    return isValidPort(v.slice(1))
  }

  const idx = v.lastIndexOf(':')
  if (idx === -1) return { ok: false, error: '应包含端口号' }

  const host = v.slice(0, idx)
  const port = v.slice(idx + 1)

  // 验证端口
  const portResult = isValidPort(port)
  if (!portResult.ok) return portResult

  // 格式: [IPv6]:port
  if (host.startsWith('[') && host.endsWith(']')) {
    const inner = host.slice(1, -1)
    return isIPv6(inner)
  }

  // 特殊地址: 0.0.0.0 (监听所有 IPv4) 或 :: (监听所有 IPv6)
  if (host === '0.0.0.0' || host === '::') {
    return { ok: true }
  }

  // IPv4 地址
  if (validator.isIP(host, 4)) {
    return { ok: true }
  }

  // 域名或主机名 (使用宽松的 FQDN 验证)
  if (validator.isFQDN(host, { require_tld: false }) || validator.isAlphanumeric(host, 'en-US', { ignore: '-.' })) {
    return { ok: true }
  }

  return { ok: false, error: '主机名包含非法字符' }
}