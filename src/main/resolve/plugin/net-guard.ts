import { lookup as dnsLookup, type LookupAddress } from 'dns'
import { isIP, type LookupFunction } from 'net'

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((s) => Number(s))
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = parts
  if (a === 0) return true
  if (a === 10) return true
  if (a === 127) return true
  if (a === 169 && b === 254) return true // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true
  // 特殊用途只有 192.0.0.0/24，写成 /16 会把 192.0.32.x（ICANN）、192.0.78.x（WordPress.com）
  // 这些正常公网地址误判为私网，导致机场网关直接连不上
  if (a === 192 && b === 0 && parts[2] === 0) return true // IETF protocol assignments
  if (a === 192 && b === 0 && parts[2] === 2) return true // TEST-NET-1
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
  if (a === 198 && b === 51 && parts[2] === 100) return true // TEST-NET-2
  if (a === 203 && b === 0 && parts[2] === 113) return true // TEST-NET-3
  if (a >= 224) return true // multicast + reserved
  return false
}

// Expand an IPv6 string to 8 16-bit hextets; returns null if unparseable.
function expandIpv6(input: string): number[] | null {
  let ip = input.toLowerCase()
  const pct = ip.indexOf('%')
  if (pct >= 0) ip = ip.slice(0, pct) // strip zone id
  const halves = ip.split('::')
  if (halves.length > 2) return null

  const parseGroups = (s: string): string[] | null => {
    if (s === '') return []
    const groups = s.split(':')
    const out: string[] = []
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i]
      if (g.includes('.')) {
        // embedded IPv4 dotted form, only valid as the last group
        if (i !== groups.length - 1) return null
        const o = g.split('.').map((n) => Number(n))
        if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null
        out.push((((o[0] << 8) | o[1]) >>> 0).toString(16))
        out.push((((o[2] << 8) | o[3]) >>> 0).toString(16))
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(g)) return null
        out.push(g)
      }
    }
    return out
  }

  const head = parseGroups(halves[0])
  if (head === null) return null
  let groups: string[]
  if (halves.length === 2) {
    const tail = parseGroups(halves[1])
    if (tail === null) return null
    const missing = 8 - head.length - tail.length
    if (missing < 1) return null // "::" must stand for at least one zero group
    groups = [...head, ...Array(missing).fill('0'), ...tail]
  } else {
    groups = head
  }
  if (groups.length !== 8) return null
  return groups.map((g) => parseInt(g, 16))
}

function isPrivateIpv6(ip: string): boolean {
  const h = expandIpv6(ip)
  if (!h) return true // fail closed
  if (h.every((x) => x === 0)) return true // :: unspecified
  if (h.slice(0, 7).every((x) => x === 0) && h[7] === 1) return true // ::1 loopback
  if ((h[0] & 0xffc0) === 0xfe80) return true // link-local fe80::/10
  if ((h[0] & 0xfe00) === 0xfc00) return true // ULA fc00::/7
  if (h[0] === 0x0100 && h[1] === 0 && h[2] === 0 && h[3] === 0) return true // discard 100::/64
  if (h[0] === 0x2001 && h[1] === 0x0db8) return true // documentation 2001:db8::/32
  if (h[0] === 0x2002) return true // 6to4, fail closed for embedded special-use IPv4
  if ((h[0] & 0xff00) === 0xff00) return true // multicast ff00::/8
  // IPv4-mapped ::ffff:a.b.c.d (decimal OR hex form both expand here)
  if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0xffff) {
    const v4 = `${(h[6] >> 8) & 0xff}.${h[6] & 0xff}.${(h[7] >> 8) & 0xff}.${h[7] & 0xff}`
    return isPrivateIpv4(v4)
  }
  return false
}

export function isPrivateIp(ip: string): boolean {
  const fam = isIP(ip)
  if (fam === 4) return isPrivateIpv4(ip)
  if (fam === 6) return isPrivateIpv6(ip)
  return true // not a valid literal IP → unsafe
}

// 字面层面的“非公网/特殊主机名”判定（无需 DNS）：私网/环回/保留 IP literal，或 localhost /
// *.localhost / 带尾点变体（RFC 6761 保留，始终指向环回）。用于 descriptor(loginUrl/site)、
// discovery(gateway origin)、vault 复用，确保校验语义一致；代理模式下也能拦住字面内网/环回目标。
export function isForbiddenHost(host: string): boolean {
  let h = host.trim().toLowerCase()
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1) // strip IPv6 brackets
  if (h.endsWith('.')) h = h.slice(0, -1) // strip FQDN trailing dot
  if (h === '') return true
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (isIP(h) && isPrivateIp(h)) return true
  return false
}

export type ResolveAll = (hostname: string) => Promise<LookupAddress[]>

const defaultResolveAll: ResolveAll = (hostname) =>
  new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true }, (err, addresses) => {
      if (err) reject(err)
      else resolve(addresses)
    })
  })

// 返回一个 Node 风格 lookup：先解析全部地址，全部为公网才放行，并把连接钉到已校验地址，挡 DNS rebinding。
// 必须尊重 options.all：Node 的 autoSelectFamily（Happy Eyeballs，现代 Node/Electron 默认开启）会用
// { all: true } 调用 lookup 并期望回调返回 LookupAddress[]；此时若只回单个地址，Node 抛
// ERR_INVALID_IP_ADDRESS（"Invalid IP address: undefined"），双栈/多 A 记录的网关主机会直接连不上。
export function createGuardedLookup(resolveAll: ResolveAll = defaultResolveAll): LookupFunction {
  return ((hostname, options, callback) => {
    const opts = (typeof options === 'function' ? {} : options) as { all?: boolean }
    const cb = (typeof options === 'function' ? options : callback) as (
      err: NodeJS.ErrnoException | null,
      address: string | LookupAddress[],
      family?: number
    ) => void
    resolveAll(hostname)
      .then((addrs) => {
        if (!addrs || addrs.length === 0) {
          cb(new Error('No addresses resolved'), '', 0)
          return
        }
        const bad = addrs.find((a) => isPrivateIp(a.address))
        if (bad) {
          cb(new Error(`Refusing to connect to non-public address: ${bad.address}`), '', 0)
          return
        }
        if (opts.all) cb(null, addrs)
        else cb(null, addrs[0].address, addrs[0].family)
      })
      .catch((e: NodeJS.ErrnoException) => cb(e, '', 0))
  }) as LookupFunction
}
