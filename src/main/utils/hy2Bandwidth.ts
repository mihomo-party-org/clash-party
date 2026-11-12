import type { ClientRequest, IncomingMessage } from 'http'
import dns from 'dns'
import https from 'https'
import os from 'os'
import { URL } from 'url'
import { parseDocument, isMap, isSeq } from 'yaml'

export const HY2_CN_ENDPOINTS = {
  dl: [
    'https://wirelesscdn-download.xuexi.cn/publish/xuexi_android/latest/xuexi_android_10002068.apk',
    'https://mensura.cdn-apple.com/api/v1/gm/large',
    'https://d1.music.126.net/dmusic/cloudmusicsetup2.8.0.198822.exe'
  ],
  ul: ['https://test.ustc.edu.cn/backend/empty.php']
}

export const HY2_GLOBAL_ENDPOINTS = {
  dl: [
    'https://speed.cloudflare.com/__down?bytes=50000000',
    'https://mensura.cdn-apple.com/api/v1/gm/large'
  ],
  ul: ['https://speed.cloudflare.com/__up']
}

const HY2_OVERHEAD_FACTOR = 1.06

const HY2_DNS_CN = ['223.5.5.5', '119.29.29.29']
const HY2_DNS_GLOBAL = ['1.1.1.1', '8.8.8.8']

const dnsCache = new Map<string, { ips: string[]; expiresAt: number }>()
const DNS_CACHE_TTL_MS = 5 * 60 * 1000

const HY2_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
const HY2_VIRTUAL_IFACE_REGEX =
  /mihomo|meta|clash|wintun|wireguard|zerotier|tailscale|vethernet|virtual|vmware|vbox|virtualbox|hyper-v|wsl|docker|loopback|npcap|bluetooth|tap-|tun\d|utun|radmin|hamachi/i
const HY2_PREFERRED_IFACE_REGEX = /wlan|wi-?fi|无线|以太网|ethernet|^eth|^en\d|^wl/i

export function parseBandwidthMbps(val: unknown): number | null {
  if (val === undefined || val === null || val === '') return null
  if (typeof val === 'number') {
    return Number.isFinite(val) && val > 0 ? Math.round(val) : null
  }
  const str = String(val).trim()
  if (!str) return null
  const m = str.match(/^([\d.]+)\s*([kmg]?)(bps|b)?$/i)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n) || n <= 0) return null
  const unit = m[2].toLowerCase()
  const mbps = unit === 'g' ? n * 1000 : unit === 'k' ? n / 1000 : n
  return mbps > 0 ? Math.round(mbps) : null
}

function preprocessYaml(yamlStr: string): string {
  return yamlStr.replace(
    /(^|\{|,)(\s*short-id:\s*)(?!['"]|null\b|Null\b|NULL\b|~)([^"'\s,}\n]+)/gm,
    '$1$2"$3"'
  )
}

function isHy2Type(type: unknown): boolean {
  const s = String(type || '')
    .trim()
    .toLowerCase()
  return s === 'hysteria2' || s === 'hy2'
}

export function inspectHy2InYaml(yamlStr: string): IHy2ProfileInspection {
  const empty: IHy2ProfileInspection = {
    hasHy2: false,
    hy2Count: 0,
    names: [],
    firstUpMbps: null,
    firstDownMbps: null,
    hasBandwidth: false
  }
  if (!yamlStr || typeof yamlStr !== 'string') return empty
  try {
    const doc = parseDocument(preprocessYaml(yamlStr), { merge: true })
    const proxiesNode = doc.get('proxies', true)
    if (!isSeq(proxiesNode)) {
      return empty
    }
    const names: string[] = []
    let firstUpMbps: number | null = null
    let firstDownMbps: number | null = null
    let hy2Count = 0

    for (const item of proxiesNode.items) {
      if (!isMap(item)) continue
      const type = item.get('type')
      if (isHy2Type(type)) {
        hy2Count++
        const nameVal = item.get('name')
        if (nameVal !== undefined && nameVal !== null) {
          names.push(String(nameVal))
        }
        if (firstUpMbps === null) {
          const up = item.get('up') ?? item.get('up-speed')
          firstUpMbps = parseBandwidthMbps(up)
        }
        if (firstDownMbps === null) {
          const down = item.get('down') ?? item.get('down-speed')
          firstDownMbps = parseBandwidthMbps(down)
        }
      }
    }

    return {
      hasHy2: hy2Count > 0,
      hy2Count,
      names,
      firstUpMbps,
      firstDownMbps,
      hasBandwidth: firstUpMbps !== null || firstDownMbps !== null
    }
  } catch {
    return empty
  }
}

export function patchHy2BandwidthInYaml(
  yamlStr: string,
  policy: IHy2BandwidthPolicy | null | undefined
): string {
  if (!policy || policy.mode === 'keep') return yamlStr
  if (!yamlStr || typeof yamlStr !== 'string') return yamlStr
  try {
    const doc = parseDocument(preprocessYaml(yamlStr), { merge: true })
    if (doc.errors && doc.errors.length > 0) return yamlStr
    const proxiesNode = doc.get('proxies', true)
    if (!isSeq(proxiesNode)) return yamlStr

    let changed = false
    for (const item of proxiesNode.items) {
      if (!isMap(item)) continue
      const type = item.get('type')
      if (!isHy2Type(type)) continue

      changed = true
      if (policy.mode === 'bbr') {
        item.delete('up')
        item.delete('down')
        item.delete('up-speed')
        item.delete('down-speed')
      } else if (policy.mode === 'brutal') {
        if (typeof policy.upMbps === 'number' && policy.upMbps > 0) {
          item.set('up', `${Math.round(policy.upMbps)} Mbps`)
        } else {
          item.delete('up')
        }
        if (typeof policy.downMbps === 'number' && policy.downMbps > 0) {
          item.set('down', `${Math.round(policy.downMbps)} Mbps`)
        } else {
          item.delete('down')
        }
        item.delete('up-speed')
        item.delete('down-speed')
      }
    }

    return changed ? doc.toString({ lineWidth: 0 }) : yamlStr
  } catch {
    return yamlStr
  }
}

export function calculateSustainedPeakMbps(rates: number[], steadyMeanMbps?: number): number {
  const valid = (rates || []).filter((r) => Number.isFinite(r) && r > 0)
  if (valid.length === 0) return 0
  const sorted = [...valid].sort((a, b) => a - b)
  if (sorted.length === 1) return Math.round(sorted[0])

  let chosen: number
  if (sorted.length <= 4) {
    const maxVal = sorted[sorted.length - 1]
    const secondVal = sorted[sorted.length - 2]
    chosen = maxVal > secondVal * 1.35 ? secondVal : maxVal
  } else {
    const startIdx = Math.floor(sorted.length * 0.72)
    const endIdx = Math.max(startIdx + 1, Math.ceil(sorted.length * 0.92))
    const band = sorted.slice(startIdx, endIdx)
    chosen = band.reduce((acc, v) => acc + v, 0) / band.length
  }

  if (typeof steadyMeanMbps === 'number' && Number.isFinite(steadyMeanMbps) && steadyMeanMbps > 0) {
    chosen = Math.min(chosen, steadyMeanMbps * 1.25)
    chosen = Math.max(chosen, steadyMeanMbps)
  }

  return Math.round(chosen)
}

export function computeRecommendedBandwidth(
  peakMbps: number,
  _dir?: 'down' | 'up'
): { recommendedMbps: number; matchedTierMbps: number | null } {
  const peak = Number(peakMbps)
  if (!Number.isFinite(peak) || peak <= 0) {
    return { recommendedMbps: 0, matchedTierMbps: null }
  }

  return {
    matchedTierMbps: null,
    recommendedMbps: Math.max(1, Math.round(peak * 0.85))
  }
}

export function isFakeOrTunIp(ip: string): boolean {
  const p = String(ip).split('.').map(Number)
  if (p.length !== 4) return true
  if (p[0] === 198 && (p[1] === 18 || p[1] === 19)) return true
  if (p[0] === 169 && p[1] === 254) return true
  if (p[0] === 127) return true
  return false
}

export function pickDirectIPv4Interface(
  ifaces?: NodeJS.Dict<os.NetworkInterfaceInfo[]>
): { name: string; address: string } | null {
  const allIfaces = ifaces ?? os.networkInterfaces()
  const candidates: Array<{ name: string; address: string; preferred: boolean }> = []

  for (const [name, addrs] of Object.entries(allIfaces)) {
    if (!name || HY2_VIRTUAL_IFACE_REGEX.test(name)) continue
    for (const a of addrs || []) {
      const aFam = (a as { family?: string | number }).family
      const isIpv4 = aFam === 'IPv4' || aFam === 4
      if (!isIpv4 || a.internal || isFakeOrTunIp(a.address)) continue
      candidates.push({
        name,
        address: a.address,
        preferred: HY2_PREFERRED_IFACE_REGEX.test(name)
      })
    }
  }

  if (candidates.length === 0) return null
  candidates.sort((a, b) => Number(b.preferred) - Number(a.preferred))
  return { name: candidates[0].name, address: candidates[0].address }
}

async function queryDoH(
  dohServer: { host: string; servername: string; path: string },
  localAddress?: string
): Promise<string[]> {
  return await new Promise<string[]>((resolve, reject) => {
    const req = https.get(
      {
        host: dohServer.host,
        servername: dohServer.servername,
        path: dohServer.path,
        localAddress,
        family: 4,
        agent: false,
        timeout: 2500,
        headers: { accept: 'application/dns-json' }
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          body += chunk
        })
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body)
            const answers = (parsed.Answer || []) as Array<{ type: number; data: string }>
            const ips = answers
              .filter((a) => a.type === 1)
              .map((a) => a.data)
              .filter((ip) => !isFakeOrTunIp(ip))
            if (ips.length > 0) resolve(ips)
            else reject(new Error('DoH returned no valid IPv4'))
          } catch (e) {
            reject(e)
          }
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error('DoH timeout')))
    req.on('error', reject)
  })
}

export async function resolveSpeedtestHostDirect(
  host: string,
  localAddress?: string
): Promise<string[]> {
  const cached = dnsCache.get(host)
  if (cached && Date.now() < cached.expiresAt) {
    return cached.ips
  }

  const queryUdpGroup = (servers: string[]) =>
    new Promise<string[]>((resolve, reject) => {
      const resolver = new dns.Resolver({ timeout: 1000, tries: 1 })
      resolver.setServers(servers)
      if (localAddress) {
        try {
          resolver.setLocalAddress(localAddress)
        } catch {
          // ignore error if binding local address fails
        }
      }
      resolver.resolve4(host, (err, addresses) => {
        if (err || !addresses || addresses.length === 0) {
          reject(err || new Error('No addresses returned'))
          return
        }
        const filtered = addresses.filter((ip) => !isFakeOrTunIp(ip))
        if (filtered.length > 0) resolve(filtered)
        else reject(new Error('Only fake or tun IP returned'))
      })
    })

  const queryUdpConcurrent = () =>
    new Promise<string[]>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('UDP DNS timeout'))
      }, 1200)

      Promise.any([queryUdpGroup(HY2_DNS_CN), queryUdpGroup(HY2_DNS_GLOBAL)])
        .then((ips) => {
          clearTimeout(timeoutId)
          resolve(ips)
        })
        .catch((err) => {
          clearTimeout(timeoutId)
          reject(err)
        })
    })

  let ips: string[] = []
  try {
    ips = await queryUdpConcurrent()
  } catch {
    try {
      ips = await queryDoH(
        {
          host: '223.5.5.5',
          servername: 'dns.alidns.com',
          path: `/resolve?name=${encodeURIComponent(host)}&type=1`
        },
        localAddress
      )
    } catch {
      ips = await queryDoH(
        {
          host: '1.1.1.1',
          servername: 'cloudflare-dns.com',
          path: `/dns-query?name=${encodeURIComponent(host)}&type=A`
        },
        localAddress
      )
    }
  }

  if (ips.length > 0) {
    dnsCache.set(host, { ips, expiresAt: Date.now() + DNS_CACHE_TTL_MS })
  }
  return ips
}

interface SpeedtestRoute {
  localAddress?: string
  ifName?: string
}

function lookupForIp(ip: string) {
  return (
    _hostname: string,
    opts: unknown,
    callback: (
      err: Error | null,
      address: string | Array<{ address: string; family: number }>,
      family?: number
    ) => void
  ) => {
    let cb = callback
    let options = opts
    if (typeof options === 'function') {
      cb = options as typeof callback
      options = undefined
    }
    const isAll =
      typeof options === 'object' && options !== null && (options as { all?: boolean }).all
    if (isAll) {
      cb(null, [{ address: ip, family: 4 }])
    } else {
      cb(null, ip, 4)
    }
  }
}

let dnsRrCounter = 0

async function openSpeedtestHttp(
  urlStr: string,
  route: SpeedtestRoute,
  method: 'GET' | 'POST',
  bodyLen: number,
  signal?: AbortSignal,
  hops = 0
): Promise<{ req: ClientRequest; res: IncomingMessage | null }> {
  const parsedUrl = new URL(urlStr)
  let lookup: ReturnType<typeof lookupForIp> | undefined
  try {
    const ips = await resolveSpeedtestHostDirect(parsedUrl.hostname, route.localAddress)
    if (ips.length > 0) {
      lookup = lookupForIp(ips[dnsRrCounter++ % ips.length])
    }
  } catch {
    // fallback to default lookup
  }

  return await new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      'user-agent': HY2_UA,
      'accept-encoding': 'identity',
      'cache-control': 'no-cache'
    }
    if (method === 'POST') {
      headers['content-type'] = 'application/octet-stream'
      headers['content-length'] = String(bodyLen)
    }

    const req = https.request({
      protocol: 'https:',
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers,
      family: 4,
      lookup,
      localAddress: route.localAddress,
      agent: false,
      timeout: 6000
    })

    const onAbort = () => req.destroy(new Error('aborted'))
    signal?.addEventListener('abort', onAbort, { once: true })
    req.on('close', () => signal?.removeEventListener('abort', onAbort))
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)

    if (method === 'GET') {
      req.on('response', (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          hops < 3
        ) {
          res.resume()
          req.destroy()
          openSpeedtestHttp(
            new URL(res.headers.location, parsedUrl).toString(),
            route,
            method,
            bodyLen,
            signal,
            hops + 1
          ).then(resolve, reject)
          return
        }
        if (res.statusCode !== 200 && res.statusCode !== 206) {
          res.resume()
          req.destroy()
          reject(new Error(`HTTP ${res.statusCode}`))
          return
        }
        resolve({ req, res })
      })
      req.end()
    } else {
      resolve({ req, res: null })
    }
  })
}

interface SpeedSample {
  t: number
  bytes: number
}

function estimateMeanMbps(samples: SpeedSample[], warmupMs: number, durationMs: number): number {
  const pts = samples.filter((s) => s.t >= warmupMs && s.t <= durationMs + 100)
  if (pts.length < 2) return 0
  const first = pts[0]
  const last = pts[pts.length - 1]
  const totalBytes = last.bytes - first.bytes
  const secs = (last.t - first.t) / 1000
  if (totalBytes < 128 * 1024 || secs < 0.4) return 0
  return Math.round((totalBytes * 8 * HY2_OVERHEAD_FACTOR) / 1e6 / secs)
}

function estimatePeakMbps(samples: SpeedSample[], warmupMs = 1000, steadyMeanMbps = 0): number {
  const pts = samples.filter((s) => s.t >= warmupMs)
  const rates: number[] = []
  for (let i = 0; i < pts.length; i++) {
    const j = pts.findIndex((p) => p.t >= pts[i].t + 1000)
    if (j === -1) break
    const bytes = pts[j].bytes - pts[i].bytes
    const dt = (pts[j].t - pts[i].t) / 1000
    if (dt > 0) rates.push((bytes * 8 * HY2_OVERHEAD_FACTOR) / 1e6 / dt)
  }
  return calculateSustainedPeakMbps(rates, steadyMeanMbps)
}

export async function selectBestEndpoints(
  route: SpeedtestRoute,
  signal?: AbortSignal
): Promise<{ dl: string[]; ul: string[] }> {
  const probeCnUrl =
    'https://wirelesscdn-download.xuexi.cn/publish/xuexi_android/latest/xuexi_android_10002068.apk'
  const probeGlobalUrl = 'https://speed.cloudflare.com/__down?bytes=65536'

  const cnCtl = new AbortController()
  const globalCtl = new AbortController()

  const onOuterAbort = () => {
    cnCtl.abort()
    globalCtl.abort()
  }
  signal?.addEventListener('abort', onOuterAbort, { once: true })

  const probe = (url: string, group: 'cn' | 'global', ctl: AbortController) =>
    new Promise<'cn' | 'global'>((resolve, reject) => {
      openSpeedtestHttp(url, route, 'GET', 0, ctl.signal)
        .then(({ req, res }) => {
          if (res) {
            res.resume()
          }
          req.destroy()
          resolve(group)
        })
        .catch(reject)
    })

  const raceWithTimeout = () =>
    new Promise<'cn' | 'global'>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('probe timeout'))
      }, 1200)

      Promise.any([probe(probeCnUrl, 'cn', cnCtl), probe(probeGlobalUrl, 'global', globalCtl)])
        .then((winner) => {
          clearTimeout(timeoutId)
          resolve(winner)
        })
        .catch((err) => {
          clearTimeout(timeoutId)
          reject(err)
        })
    })

  try {
    const winner = await raceWithTimeout()
    return winner === 'cn' ? HY2_CN_ENDPOINTS : HY2_GLOBAL_ENDPOINTS
  } catch {
    return {
      dl: [...HY2_CN_ENDPOINTS.dl, ...HY2_GLOBAL_ENDPOINTS.dl],
      ul: [...HY2_CN_ENDPOINTS.ul, ...HY2_GLOBAL_ENDPOINTS.ul]
    }
  } finally {
    cnCtl.abort()
    globalCtl.abort()
    signal?.removeEventListener('abort', onOuterAbort)
  }
}

async function measurePhase(
  kind: 'down' | 'up',
  urls: string[],
  route: SpeedtestRoute,
  signal?: AbortSignal,
  onTick?: (progress: number, curMbps: number) => void
): Promise<{ mean: number; peak: number }> {
  const durationMs = kind === 'down' ? 4400 : 3400
  const warmupMs = kind === 'down' ? 1100 : 1000
  const streams = kind === 'down' ? 6 : 3
  const ctl = new AbortController()

  const onOuterAbort = () => ctl.abort()
  signal?.addEventListener('abort', onOuterAbort, { once: true })

  const live = new Set<ClientRequest>()
  let doneBytes = 0
  const wallStart = Date.now()
  const maxWallMs = durationMs + 3500
  let transferStartAt = 0
  const samples: SpeedSample[] = []
  let errors = 0

  const getLiveBytes = () => {
    let b = doneBytes
    if (kind === 'up') {
      for (const r of live) {
        b += r.socket?.bytesWritten || 0
      }
    }
    return b
  }

  const deadline = () =>
    (transferStartAt > 0 && Date.now() - transferStartAt >= durationMs) ||
    Date.now() - wallStart >= maxWallMs ||
    ctl.signal.aborted

  const runDownStream = async (idx: number) => {
    if (idx > 0) {
      await new Promise((r) => setTimeout(r, idx * 100))
    }
    while (!deadline()) {
      try {
        const url = urls[idx % urls.length]
        const { req, res } = await openSpeedtestHttp(url, route, 'GET', 0, ctl.signal)
        if (!res) continue
        live.add(req)
        await new Promise<void>((resolve) => {
          res.on('data', (chunk: Buffer) => {
            if (!transferStartAt) transferStartAt = Date.now()
            doneBytes += chunk.length
            if (deadline()) req.destroy()
          })
          res.on('end', () => resolve())
          res.on('error', () => resolve())
          req.on('close', () => resolve())
        })
        live.delete(req)
      } catch {
        errors++
        if (errors > streams * 3) return
        await new Promise((r) => setTimeout(r, 150))
      }
    }
  }

  const chunkBuffer = Buffer.alloc(64 * 1024, 0x5a)
  const UL_BODY_SIZE = 16 * 1024 * 1024
  const runUpStream = async (idx: number) => {
    if (idx > 0) {
      await new Promise((r) => setTimeout(r, idx * 120))
    }
    while (!deadline()) {
      try {
        const url = urls[idx % urls.length]
        const { req } = await openSpeedtestHttp(url, route, 'POST', UL_BODY_SIZE, ctl.signal)
        live.add(req)
        await new Promise<void>((resolve) => {
          let sent = 0
          const finish = () => {
            if (!live.has(req)) return
            doneBytes += req.socket?.bytesWritten || 0
            live.delete(req)
            resolve()
          }
          const pump = () => {
            while (sent < UL_BODY_SIZE && !deadline()) {
              if (!transferStartAt) transferStartAt = Date.now()
              const n = Math.min(chunkBuffer.length, UL_BODY_SIZE - sent)
              sent += n
              const canWrite = req.write(
                n === chunkBuffer.length ? chunkBuffer : chunkBuffer.subarray(0, n)
              )
              if (!canWrite) {
                req.once('drain', pump)
                return
              }
            }
            if (sent >= UL_BODY_SIZE) req.end()
            else req.destroy()
          }
          req.on('response', (res) => {
            res.resume()
            res.on('end', finish)
          })
          req.on('close', finish)
          req.on('error', finish)
          pump()
        })
      } catch {
        errors++
        if (errors > streams * 3) return
        await new Promise((r) => setTimeout(r, 150))
      }
    }
  }

  const intervalId = setInterval(() => {
    if (deadline()) {
      ctl.abort()
      return
    }
    if (transferStartAt > 0) {
      const elapsed = Date.now() - transferStartAt
      samples.push({ t: elapsed, bytes: getLiveBytes() })
      const last = samples.length > 5 ? samples[samples.length - 6] : samples[0]
      const rawMbps =
        elapsed > last.t
          ? ((samples[samples.length - 1].bytes - last.bytes) * 8 * HY2_OVERHEAD_FACTOR) /
            1e6 /
            ((elapsed - last.t) / 1000)
          : 0
      const percent = Math.min(100, Math.round((elapsed / durationMs) * 100))
      onTick?.(percent, Math.max(0, Math.round(rawMbps)))
    } else {
      onTick?.(0, 0)
    }
  }, 100)

  const stopTimeout = setTimeout(() => ctl.abort(), maxWallMs)

  try {
    const workers: Promise<void>[] = []
    for (let i = 0; i < streams; i++) {
      workers.push(kind === 'down' ? runDownStream(i) : runUpStream(i))
    }
    await Promise.race([
      Promise.all(workers),
      new Promise<void>((r) => ctl.signal.addEventListener('abort', () => r(), { once: true }))
    ])
  } finally {
    clearInterval(intervalId)
    clearTimeout(stopTimeout)
    if (transferStartAt > 0) {
      samples.push({ t: Date.now() - transferStartAt, bytes: getLiveBytes() })
    }
    ctl.abort()
    for (const r of live) r.destroy()
    live.clear()
    signal?.removeEventListener('abort', onOuterAbort)
  }

  const mean = estimateMeanMbps(samples, warmupMs, durationMs)
  const peak = estimatePeakMbps(samples, warmupMs, mean) || mean
  return { mean, peak }
}

export async function runDirectSpeedtest(options?: {
  signal?: AbortSignal
  onProgress?: (progress: IHy2SpeedtestProgress) => void
}): Promise<IHy2SpeedtestResult> {
  const iface = pickDirectIPv4Interface()
  const route: SpeedtestRoute = {
    localAddress: iface?.address,
    ifName: iface?.name
  }

  options?.onProgress?.({
    phase: 'prepare',
    progress: 0,
    bindAddress: iface?.address ?? null,
    ifaceName: iface?.name ?? null
  })

  if (options?.signal?.aborted) {
    return {
      ok: false,
      downMbps: 0,
      downPeakMbps: 0,
      upMbps: 0,
      upPeakMbps: 0,
      recommendedDownMbps: 0,
      recommendedUpMbps: 0,
      matchedDownTierMbps: null,
      matchedUpTierMbps: null,
      bindAddress: iface?.address ?? null,
      ifaceName: iface?.name ?? null,
      error: 'aborted'
    }
  }

  const endpoints = await selectBestEndpoints(route, options?.signal)

  // 1. Download phase
  let downRes = { mean: 0, peak: 0 }
  try {
    downRes = await measurePhase(
      'down',
      endpoints.dl,
      route,
      options?.signal,
      (progress, currentMbps) => {
        options?.onProgress?.({
          phase: 'download',
          progress,
          currentMbps,
          downMbps: currentMbps,
          bindAddress: iface?.address ?? null,
          ifaceName: iface?.name ?? null
        })
      }
    )
  } catch {
    if (options?.signal?.aborted) {
      return {
        ok: false,
        downMbps: 0,
        downPeakMbps: 0,
        upMbps: 0,
        upPeakMbps: 0,
        recommendedDownMbps: 0,
        recommendedUpMbps: 0,
        matchedDownTierMbps: null,
        matchedUpTierMbps: null,
        bindAddress: iface?.address ?? null,
        ifaceName: iface?.name ?? null,
        error: 'aborted'
      }
    }
  }

  if (options?.signal?.aborted) {
    return {
      ok: false,
      downMbps: downRes.mean,
      downPeakMbps: downRes.peak,
      upMbps: 0,
      upPeakMbps: 0,
      recommendedDownMbps: 0,
      recommendedUpMbps: 0,
      matchedDownTierMbps: null,
      matchedUpTierMbps: null,
      bindAddress: iface?.address ?? null,
      ifaceName: iface?.name ?? null,
      error: 'aborted'
    }
  }

  // 2. Upload phase
  let upRes = { mean: 0, peak: 0 }
  try {
    upRes = await measurePhase(
      'up',
      endpoints.ul,
      route,
      options?.signal,
      (progress, currentMbps) => {
        options?.onProgress?.({
          phase: 'upload',
          progress,
          currentMbps,
          downMbps: downRes.mean,
          downPeakMbps: downRes.peak,
          upMbps: currentMbps,
          bindAddress: iface?.address ?? null,
          ifaceName: iface?.name ?? null
        })
      }
    )
  } catch {
    if (options?.signal?.aborted) {
      return {
        ok: false,
        downMbps: downRes.mean,
        downPeakMbps: downRes.peak,
        upMbps: 0,
        upPeakMbps: 0,
        recommendedDownMbps: 0,
        recommendedUpMbps: 0,
        matchedDownTierMbps: null,
        matchedUpTierMbps: null,
        bindAddress: iface?.address ?? null,
        ifaceName: iface?.name ?? null,
        error: 'aborted'
      }
    }
  }

  const downPeak = downRes.peak || downRes.mean
  const upPeak = upRes.peak || upRes.mean
  const downRec = computeRecommendedBandwidth(downPeak, 'down')
  const upRec = computeRecommendedBandwidth(upPeak, 'up')

  const result: IHy2SpeedtestResult = {
    ok: true,
    downMbps: downRes.mean,
    downPeakMbps: downRes.peak,
    upMbps: upRes.mean,
    upPeakMbps: upRes.peak,
    recommendedDownMbps: downRec.recommendedMbps,
    recommendedUpMbps: upRec.recommendedMbps,
    matchedDownTierMbps: downRec.matchedTierMbps,
    matchedUpTierMbps: upRec.matchedTierMbps,
    bindAddress: iface?.address ?? null,
    ifaceName: iface?.name ?? null
  }

  options?.onProgress?.({
    phase: 'done',
    progress: 100,
    downMbps: downRes.mean,
    downPeakMbps: downRes.peak,
    upMbps: upRes.mean,
    upPeakMbps: upRes.peak,
    recommendedDownMbps: downRec.recommendedMbps,
    recommendedUpMbps: upRec.recommendedMbps,
    matchedDownTierMbps: downRec.matchedTierMbps,
    matchedUpTierMbps: upRec.matchedTierMbps,
    bindAddress: iface?.address ?? null,
    ifaceName: iface?.name ?? null
  })

  return result
}
