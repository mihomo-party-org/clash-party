import { timingSafeEqual } from 'node:crypto'

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
