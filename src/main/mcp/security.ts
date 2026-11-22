import { timingSafeEqual } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'

export function publicScalar(value: unknown): string | number | boolean | undefined {
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return undefined
}

export function isTrustedLocalRequest(headers: IncomingHttpHeaders, port: number): boolean {
  // Native MCP clients do not need browser origins. Reject them instead of enabling CORS.
  if (headers.origin !== undefined) return false
  return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(headers.host ?? '')
}

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

export function hasValidBearerToken(authorization: string | undefined, expected: string): boolean {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return false

  const actual = Buffer.from(token)
  const wanted = Buffer.from(expected)
  return actual.length === wanted.length && timingSafeEqual(actual, wanted)
}
