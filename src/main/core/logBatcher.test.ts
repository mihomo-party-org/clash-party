import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLogBatcher } from './logBatcher'

describe('live core log batching', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('delivers normal logs in order with one IPC callback', () => {
    const send = vi.fn()
    const batcher = createLogBatcher(send)
    const logs = [
      { type: 'info', payload: 'TUN started' },
      { type: 'error', payload: 'connection failed' }
    ]
    for (const log of logs) batcher.push(JSON.stringify(log))
    expect(send).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(send).toHaveBeenCalledExactlyOnceWith(logs)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds a 50,000-message error storm and reports dropped messages', () => {
    const send = vi.fn()
    const batcher = createLogBatcher(send)
    const message = JSON.stringify({
      type: 'error',
      payload: 'batch read packet: bad file descriptor'
    })
    for (let i = 0; i < 50_000; i++) batcher.push(message)
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(100)
    expect(send).toHaveBeenCalledTimes(1)
    const batch = send.mock.calls[0][0] as IMihomoLogInfo[]
    expect(batch).toHaveLength(101)
    expect(batch[100]).toEqual({
      type: 'warning',
      payload: expect.stringContaining('49900 logs omitted')
    })
    batcher.push(JSON.stringify({ type: 'info', payload: 'recovered' }))
    vi.advanceTimersByTime(100)
    expect(send).toHaveBeenLastCalledWith([{ type: 'info', payload: 'recovered' }])
  })

  it('discards pending logs when a stream stops or reconnects', () => {
    const send = vi.fn()
    const batcher = createLogBatcher(send)
    batcher.push('{"type":"info","payload":"old core"}')
    batcher.dispose()
    batcher.push('{"type":"info","payload":"late message"}')
    vi.runAllTimers()
    expect(send).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores malformed messages and bounds oversized messages', () => {
    const send = vi.fn()
    const batcher = createLogBatcher(send)
    for (const message of ['{', 'null', '{}', '{"type":"info","payload":42}']) {
      batcher.push(message)
    }
    batcher.push(JSON.stringify({ type: 'error', payload: 'x'.repeat(20_000) }))
    batcher.push('{"type":"info","payload":"still works"}')
    vi.advanceTimersByTime(100)
    expect(send.mock.calls[0][0]).toEqual([
      { type: 'info', payload: 'still works' },
      { type: 'warning', payload: expect.stringContaining('1 logs omitted') }
    ])
  })
})
