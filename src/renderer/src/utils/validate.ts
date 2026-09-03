import validator from 'validator'

export interface ValidationResult {
  ok: boolean
  error?: string
}

type BooleanValidator = (value: string) => boolean

const LOCAL_DOMAINS = new Set(['localhost', 'local', 'localdomain'])
const NETWORK_TYPES = new Set(['tcp', 'udp'])
const LOCAL_BYPASS_PLATFORMS = new Set<string>(['win32', 'darwin'])
const INBOUND_TYPES = new Set([
  'http',
  'https',
  'socks',
  'socks4',
  'socks5',
  'tproxy',
  'redir',
  'mixed'
])

const DOMAIN_KEYWORD_PATTERN = /^[a-zA-Z0-9._-]+$/
const DOMAIN_WILDCARD_PATTERN = /^[a-zA-Z0-9.*?-]+$/
const WINDOWS_PATH_PATTERN = /^[a-zA-Z]:[\\/].+/
const UNIX_PATH_PATTERN = /^\/.+/
const ANDROID_PACKAGE_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i
const PROCESS_NAME_PATTERN = /^[a-zA-Z0-9._-]+$/
// Windows 上常见的前缀通配写法，如 *\chrome.exe：不是绝对路径，替换通配符后仍不匹配
const PREFIX_WILDCARD_PATH_PATTERN = /^[*?][^\\/]*[\\/].+/

const isValidRegex: BooleanValidator = (value) => {
  try {
    new RegExp(value)
    return true
  } catch {
    return false
  }
}

const isNamedIdentifier = (value: string, ignore = '-_'): boolean =>
  value.length > 0 && validator.isAlphanumeric(value, 'en-US', { ignore })

const replaceWildcards = (value: string): string => value.replace(/\*/g, 'a').replace(/\?/g, 'a')

const isValidHostname = (host: string): boolean =>
  validator.isFQDN(host, { require_tld: false }) ||
  validator.isAlphanumeric(host, 'en-US', { ignore: '-.' })

const validationResult = (ok: boolean, error: string): ValidationResult =>
  ok ? { ok: true } : { ok: false, error }

const integerValidator =
  (min: number, max: number): BooleanValidator =>
  (value) =>
    validator.isInt(value, { min, max })

export const isValid = (result: ValidationResult): boolean => result.ok
export const getError = (result: ValidationResult): string | undefined => result.error

// Domain rules

export const domainValidator: BooleanValidator = (value) => {
  if (value.length < 2 || value.length > 253) return false

  return validator.isFQDN(value, { require_tld: true }) || LOCAL_DOMAINS.has(value.toLowerCase())
}

export const domainSuffixValidator: BooleanValidator = (value) =>
  validator.isFQDN(value, { require_tld: true, allow_wildcard: true })

export const domainKeywordValidator: BooleanValidator = (value) =>
  DOMAIN_KEYWORD_PATTERN.test(value)

export const domainRegexValidator = isValidRegex

export const domainWildcardValidator: BooleanValidator = (value) => {
  if (!DOMAIN_WILDCARD_PATTERN.test(value)) return false

  const normalizedDomain = replaceWildcards(value)
  return (
    normalizedDomain.includes('.') && validator.isFQDN(normalizedDomain, { require_tld: false })
  )
}

// Network rules

export const portValidator: BooleanValidator = (value) => validator.isPort(value)

export const portRangeValidator: BooleanValidator = (value) => {
  const [start, end, ...rest] = value.split('-')

  if (end === undefined) return validator.isPort(start)
  if (rest.length > 0) return false

  return validator.isPort(start) && validator.isPort(end) && Number(start) <= Number(end)
}

export const ipv4CIDRValidator: BooleanValidator = (value) => validator.isIPRange(value, 4)
export const ipv6CIDRValidator: BooleanValidator = (value) => validator.isIPRange(value, 6)
export const ipCIDRValidator: BooleanValidator = (value) => validator.isIPRange(value)

export const sysProxyBypassValidator = (
  value: string,
  targetPlatform: NodeJS.Platform | string
): boolean => {
  const entry = value.trim()
  if (!entry) return false
  if (validator.isIP(entry)) return true
  if (targetPlatform !== 'win32' && validator.isIPRange(entry)) return true

  const normalizedEntry = entry.toLowerCase()
  if (LOCAL_BYPASS_PLATFORMS.has(targetPlatform) && normalizedEntry === '<local>') return true

  if (targetPlatform === 'win32' && /[*?]/.test(entry)) {
    return validator.isFQDN(entry.replace(/\*/g, 'wildcard').replace(/\?/g, 'q'), {
      require_tld: false,
      allow_numeric_tld: true
    })
  }

  return validator.isFQDN(entry, {
    require_tld: false,
    allow_numeric_tld: true,
    allow_wildcard: true
  })
}

// Rule values

export const geositeValidator: BooleanValidator = (value) => isNamedIdentifier(value)
export const geoipValidator: BooleanValidator = (value) => validator.isISO31661Alpha2(value)
export const asnValidator = integerValidator(1, 4_294_967_295)
export const uidValidator = integerValidator(0, 65_535)
export const dscpValidator = integerValidator(0, 63)
export const networkValidator: BooleanValidator = (value) => NETWORK_TYPES.has(value.toLowerCase())

export const inTypeValidator: BooleanValidator = (value) =>
  value.split('/').every((type) => INBOUND_TYPES.has(type.toLowerCase()))

export const inUserValidator: BooleanValidator = (value) =>
  value.length > 0 && value.split('/').every((user) => isNamedIdentifier(user, '-_.'))

export const inNameValidator: BooleanValidator = (value) => isNamedIdentifier(value)
export const ruleSetValidator: BooleanValidator = (value) => isNamedIdentifier(value)

// Process rules

export const processPathValidator: BooleanValidator = (value) =>
  WINDOWS_PATH_PATTERN.test(value) ||
  UNIX_PATH_PATTERN.test(value) ||
  ANDROID_PACKAGE_PATTERN.test(value)

export const processPathWildcardValidator: BooleanValidator = (value) =>
  value.length > 0 &&
  (processPathValidator(replaceWildcards(value)) || PREFIX_WILDCARD_PATH_PATTERN.test(value))

export const processPathRegexValidator = isValidRegex

export const processNameValidator: BooleanValidator = (value) => PROCESS_NAME_PATTERN.test(value)

export const processNameWildcardValidator: BooleanValidator = (value) =>
  value.length > 0 && processNameValidator(replaceWildcards(value))

export const processNameRegexValidator = isValidRegex

// Logical rules

export const logicRuleValidator: BooleanValidator = (value) => {
  if (!value.startsWith('(') || !value.endsWith(')')) return false

  let depth = 0
  for (const char of value) {
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (depth < 0) return false
  }

  return depth === 0
}

export const subRuleValidator: BooleanValidator = (value) => {
  if (!value) return false
  return value.startsWith('(') && value.endsWith(')')
    ? logicRuleValidator(value)
    : ruleSetValidator(value)
}

// Structured validation results

export const isIPv4 = (ip: string): ValidationResult =>
  validationResult(validator.isIP(ip, 4), '不是有效的 IPv4 地址')

export const isIPv6 = (ip: string): ValidationResult =>
  validationResult(validator.isIP(ip, 6), '不是有效的 IPv6 地址')

export const isValidPort = (port: string): ValidationResult =>
  validationResult(validator.isPort(port), '端口号必须在 1-65535 范围内')

const validateListenAddress = (
  input: string | undefined,
  allowUnbracketedIPv6: boolean
): ValidationResult => {
  const value = input?.trim()
  if (!value) return { ok: true }

  if (/^:\d+$/.test(value)) return isValidPort(value.slice(1))

  const separatorIndex = value.lastIndexOf(':')
  if (separatorIndex < 0) return { ok: false, error: '应包含端口号' }

  const host = value.slice(0, separatorIndex)
  const portResult = isValidPort(value.slice(separatorIndex + 1))
  if (!portResult.ok) return portResult

  if (host.startsWith('[') && host.endsWith(']')) {
    return isIPv6(host.slice(1, -1))
  }

  const validHost =
    validator.isIP(host, 4) ||
    (allowUnbracketedIPv6 && validator.isIP(host, 6)) ||
    isValidHostname(host)

  return validationResult(validHost, '主机名包含非法字符')
}

export const isValidListenAddress = (input: string | undefined): ValidationResult =>
  validateListenAddress(input, false)

export const isValidListenAddressFull = (input: string | undefined): ValidationResult =>
  validateListenAddress(input, true)
