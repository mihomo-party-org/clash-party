import { afterEach, expect, it, vi } from 'vitest'
import { useConnectionApps } from './use-connection-apps'

const { lookup, publish, lifecycle } = vi.hoisted(() => ({
  lookup: vi.fn(),
  publish: vi.fn(),
  lifecycle: {
    cleanup: undefined as (() => void) | undefined,
    cursor: 0,
    platform: 'linux',
    refs: [] as { current: unknown }[]
  }
}))
vi.mock('@renderer/utils/init', () => ({
  get platform() {
    return lifecycle.platform
  }
}))
vi.mock('@renderer/utils/ipc', () => ({ getAppInfo: lookup }))
// Exercise the timer/IPC lifecycle without mounting the entire Electron connections page.
vi.mock('react', () => ({
  useRef: (current: unknown) => (lifecycle.refs[lifecycle.cursor++] ||= { current }),
  useState: () => [{}, publish],
  useEffect: (effect: () => (() => void) | undefined) => {
    lifecycle.cleanup = effect()
  }
}))

afterEach(() => {
  lifecycle.cleanup?.()
  vi.useRealTimers()
  vi.clearAllMocks()
  lifecycle.cursor = 0
  lifecycle.platform = 'linux'
  lifecycle.refs = []
})
const connection = {
  id: 'one',
  metadata: { processPath: '/opt/browser' }
} as IMihomoConnectionDetail

it('reuses successful results without publishing unchanged state and freezes closed connections', async () => {
  vi.useFakeTimers()
  lookup.mockResolvedValue({ name: 'Browser', icon: 'icon' })
  const active = [connection]
  const closed: IMihomoConnectionDetail[] = []
  useConnectionApps(active, closed, true)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(lookup).toHaveBeenCalledTimes(1)
  expect(publish).toHaveBeenCalledTimes(1)
  closed.push(...active.splice(0))
  await vi.advanceTimersByTimeAsync(600_000)
  expect(lookup).toHaveBeenCalledTimes(1)
  expect(publish).toHaveBeenCalledTimes(1)
  closed.splice(0)
  await vi.advanceTimersByTimeAsync(2000)
  expect(publish).toHaveBeenLastCalledWith({})
})

it('backs off missing apps, detects path changes and stops after cleanup', async () => {
  vi.useFakeTimers()
  lookup.mockResolvedValue({ name: '', icon: '' })
  const active = [{ ...connection, metadata: { ...connection.metadata } }]
  useConnectionApps(active, [], true)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(lookup).toHaveBeenCalledTimes(3)
  expect(publish).toHaveBeenCalledTimes(1)
  active[0].metadata.processPath = '/opt/other'
  await vi.advanceTimersByTimeAsync(2000)
  expect(lookup).toHaveBeenCalledTimes(4)
  lifecycle.cleanup?.()
  await vi.advanceTimersByTimeAsync(600_000)
  expect(lookup).toHaveBeenCalledTimes(4)
})

it('ignores cancelled results when an effect restarts with the same cache', async () => {
  vi.useFakeTimers()
  const finish: ((info: IAppInfo) => void)[] = []
  lookup.mockImplementation(() => new Promise<IAppInfo>((resolve) => finish.push(resolve)))
  useConnectionApps([connection], [], true)
  lifecycle.cleanup?.()
  lifecycle.cursor = 0
  useConnectionApps([connection], [], true)
  finish[0]({ name: 'Browser', icon: 'icon' })
  await vi.advanceTimersByTimeAsync(0)
  expect(publish).not.toHaveBeenCalled()
  finish[1]({ name: 'Browser', icon: 'icon' })
  await vi.advanceTimersByTimeAsync(0)
  expect(publish).toHaveBeenCalledExactlyOnceWith({ one: { name: 'Browser', icon: 'icon' } })
})

it('deduplicates Windows executable paths across many active and closed connections', async () => {
  vi.useFakeTimers()
  lifecycle.platform = 'win32'
  lookup.mockResolvedValue({ name: 'Browser', icon: 'icon' })
  const active = Array.from({ length: 100 }, (_, i) => ({
    ...connection,
    id: `${i}`,
    metadata: { ...connection.metadata, processPath: i % 2 ? 'C:\\Browser.exe' : 'c:\\browser.EXE' }
  }))
  useConnectionApps(active, [active[0]], true)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(lookup).toHaveBeenCalledTimes(1)
  expect(publish).toHaveBeenCalledTimes(1)
})

it('skips Linux connections that close while earlier batches are pending', async () => {
  vi.useFakeTimers()
  const finish: ((info: IAppInfo) => void)[] = []
  lookup.mockImplementation(() => new Promise<IAppInfo>((resolve) => finish.push(resolve)))
  const active = Array.from({ length: 9 }, (_, i) => ({ ...connection, id: `${i}` }))
  useConnectionApps(active, [], true)
  expect(lookup).toHaveBeenCalledTimes(8)
  lifecycle.refs[0].current = { active: active.slice(0, 8), closed: [active[8]] }
  finish.forEach((resolve) => resolve({ name: 'Browser', icon: 'icon' }))
  await vi.advanceTimersByTimeAsync(0)
  expect(lookup).toHaveBeenCalledTimes(8)
})

it('does not query any platform while the feature is disabled', async () => {
  vi.useFakeTimers()
  lifecycle.platform = 'darwin'
  useConnectionApps([connection], [], false)
  await vi.advanceTimersByTimeAsync(600_000)
  expect(lookup).not.toHaveBeenCalled()
})
