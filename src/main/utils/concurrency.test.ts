import { describe, expect, it } from 'vitest'
import { mapWithConcurrency } from './concurrency'

function deferredWorker(): {
  worker: (item: number) => Promise<number>
  inFlight: () => number
  peak: () => number
  release: () => void
} {
  let running = 0
  let peak = 0
  const pending: Array<() => void> = []
  return {
    worker: async (item) => {
      running++
      peak = Math.max(peak, running)
      await new Promise<void>((resolve) => pending.push(resolve))
      running--
      return item * 2
    },
    inFlight: () => running,
    peak: () => peak,
    release: () => pending.splice(0).forEach((resolve) => resolve())
  }
}

describe('mapWithConcurrency', () => {
  it('never runs more than the given number of workers at once and keeps result order', async () => {
    const { worker, inFlight, peak, release } = deferredWorker()
    const result = mapWithConcurrency([1, 2, 3, 4, 5], 2, worker)

    await Promise.resolve()
    expect(inFlight()).toBe(2)
    while (inFlight() > 0) {
      release()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    await expect(result).resolves.toEqual([2, 4, 6, 8, 10])
    expect(peak()).toBe(2)
  })

  it('handles more workers than items and an empty list', async () => {
    await expect(mapWithConcurrency([1], 50, async (n) => n + 1)).resolves.toEqual([2])
    await expect(mapWithConcurrency([], 50, async (n: number) => n)).resolves.toEqual([])
  })
})
