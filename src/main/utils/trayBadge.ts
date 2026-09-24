export type TrayBadgeStyle = 'color' | 'template'

interface ModeBadgeSpec {
  r: number
  g: number
  b: number
  letter: readonly string[]
}

const MODE_BADGES: Record<OutboundMode, ModeBadgeSpec> = {
  rule: {
    r: 37,
    g: 99,
    b: 235,
    letter: ['1111.', '1...1', '1...1', '1111.', '1.1..', '1..1.', '1...1']
  },
  global: {
    r: 217,
    g: 119,
    b: 6,
    letter: ['.111.', '1...1', '1....', '1.111', '1...1', '1...1', '.111.']
  },
  direct: {
    r: 17,
    g: 24,
    b: 39,
    letter: ['1111.', '1...1', '1...1', '1...1', '1...1', '1...1', '1111.']
  }
}

function inLetter(
  letter: readonly string[],
  x: number,
  y: number,
  originX: number,
  originY: number,
  cell: number
): boolean {
  const col = Math.floor((x - originX) / cell)
  const row = Math.floor((y - originY) / cell)
  if (row < 0 || row >= letter.length) return false
  if (col < 0 || col >= letter[row].length) return false
  return letter[row][col] === '1'
}

function writePixel(buffer: Buffer, offset: number, r: number, g: number, b: number, a: number) {
  buffer[offset] = b
  buffer[offset + 1] = g
  buffer[offset + 2] = r
  buffer[offset + 3] = a
}

export function drawModeBadgeBGRA(
  buffer: Buffer,
  width: number,
  height: number,
  mode: OutboundMode,
  style: TrayBadgeStyle
): void {
  if (width < 4 || height < 4) return
  if (buffer.length < width * height * 4) return

  const spec = MODE_BADGES[mode]
  const shortSide = Math.min(width, height)
  const radius = Math.max(3, shortSide * 0.26)
  const borderWidth = Math.max(1, Math.round(shortSide / 16))
  const margin = Math.max(1, shortSide * 0.05)
  const cx = width - radius - borderWidth - margin
  const cy = height - radius - borderWidth - margin
  const outerRadius = radius + borderWidth
  const clearRadius = outerRadius + (style === 'template' ? Math.max(1, borderWidth) : 0)

  const cell = Math.max(1, (radius * 1.35) / 7)
  const letterX = cx - (5 * cell) / 2
  const letterY = cy - (7 * cell) / 2

  const minX = Math.max(0, Math.floor(cx - clearRadius - 1))
  const maxX = Math.min(width - 1, Math.ceil(cx + clearRadius + 1))
  const minY = Math.max(0, Math.floor(cy - clearRadius - 1))
  const maxY = Math.min(height - 1, Math.ceil(cy + clearRadius + 1))

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist > clearRadius) continue

      const offset = (y * width + x) * 4
      const letter = inLetter(spec.letter, x + 0.5, y + 0.5, letterX, letterY, cell)

      if (style === 'template') {
        if (dist > outerRadius) {
          writePixel(buffer, offset, 0, 0, 0, 0)
          continue
        }
        if (dist > radius) {
          if (letter) {
            buffer[offset + 3] = 0
          } else {
            writePixel(buffer, offset, 255, 255, 255, 255)
          }
          continue
        }
        if (letter) {
          buffer[offset + 3] = 0
        } else {
          writePixel(buffer, offset, 255, 255, 255, 255)
        }
        continue
      }

      if (dist > radius) {
        writePixel(buffer, offset, 15, 23, 42, 255)
        continue
      }
      if (letter) {
        writePixel(buffer, offset, 255, 255, 255, 255)
      } else {
        writePixel(buffer, offset, spec.r, spec.g, spec.b, 255)
      }
    }
  }
}
