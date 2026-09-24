import { describe, expect, it } from 'vitest'
import { drawModeBadgeBGRA } from './trayBadge'

function createBuffer(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(width * height * 4)
  for (let i = 0; i < buffer.length; i += 4) {
    buffer[i] = 10
    buffer[i + 1] = 20
    buffer[i + 2] = 30
    buffer[i + 3] = 255
  }
  return buffer
}

function readBgra(
  buffer: Buffer,
  width: number,
  x: number,
  y: number
): [number, number, number, number] {
  const offset = (y * width + x) * 4
  return [buffer[offset], buffer[offset + 1], buffer[offset + 2], buffer[offset + 3]]
}

function findModeColor(
  buffer: Buffer,
  width: number,
  height: number,
  rgb: [number, number, number]
): Array<{ x: number; y: number }> {
  const hits: Array<{ x: number; y: number }> = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [b, g, r, a] = readBgra(buffer, width, x, y)
      if (a === 255 && r === rgb[0] && g === rgb[1] && b === rgb[2]) {
        hits.push({ x, y })
      }
    }
  }
  return hits
}

describe('drawModeBadgeBGRA', () => {
  it('draws a blue badge for rule mode', () => {
    const width = 16
    const height = 16
    const buffer = createBuffer(width, height)
    drawModeBadgeBGRA(buffer, width, height, 'rule', 'color')
    const hits = findModeColor(buffer, width, height, [37, 99, 235])
    expect(hits.length).toBeGreaterThan(8)
    expect(hits.every(({ x, y }) => x >= 4 && y >= 4)).toBe(true)
  })

  it('draws distinct colors for each mode', () => {
    const width = 16
    const height = 16
    const modes: Array<[OutboundMode, [number, number, number]]> = [
      ['rule', [37, 99, 235]],
      ['global', [217, 119, 6]],
      ['direct', [17, 24, 39]]
    ]
    const seen = modes.map(([mode, rgb]) => {
      const buffer = createBuffer(width, height)
      drawModeBadgeBGRA(buffer, width, height, mode, 'color')
      return findModeColor(buffer, width, height, rgb).length
    })
    expect(seen.every((count) => count > 0)).toBe(true)
    expect(new Set(seen).size).toBeGreaterThan(1)
  })

  it('leaves pixels outside the badge unchanged', () => {
    const width = 16
    const height = 16
    const buffer = createBuffer(width, height)
    drawModeBadgeBGRA(buffer, width, height, 'global', 'color')
    const [b, g, r, a] = readBgra(buffer, width, 1, 1)
    expect([b, g, r, a]).toEqual([10, 20, 30, 255])
  })

  it('draws white letter pixels inside the badge', () => {
    const width = 32
    const height = 32
    const buffer = createBuffer(width, height)
    drawModeBadgeBGRA(buffer, width, height, 'rule', 'color')
    const whites = findModeColor(buffer, width, height, [255, 255, 255])
    expect(whites.length).toBeGreaterThanOrEqual(5)
  })

  it('clears template gap and letter pixels in template style', () => {
    const width = 32
    const height = 32
    const buffer = createBuffer(width, height)
    drawModeBadgeBGRA(buffer, width, height, 'direct', 'template')

    let cleared = 0
    let opaqueBadge = 0
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const [, , , a] = readBgra(buffer, width, x, y)
        if (a === 0) cleared += 1
        if (a === 255) {
          const [b, g, r] = readBgra(buffer, width, x, y)
          if (r === 255 && g === 255 && b === 255) opaqueBadge += 1
        }
      }
    }
    expect(cleared).toBeGreaterThan(0)
    expect(opaqueBadge).toBeGreaterThan(8)
  })

  it('ignores undersized buffers', () => {
    const buffer = Buffer.alloc(4)
    expect(() => drawModeBadgeBGRA(buffer, 2, 2, 'rule', 'color')).not.toThrow()
    expect(() => drawModeBadgeBGRA(Buffer.alloc(0), 16, 16, 'rule', 'color')).not.toThrow()
  })
})
