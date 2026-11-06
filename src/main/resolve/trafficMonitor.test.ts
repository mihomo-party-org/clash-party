import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startMonitor, stopMonitor } from './trafficMonitor'

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
  existsSync: vi.fn(),
  readFile: vi.fn(),
  rm: vi.fn(),
  writeFile: vi.fn(),
  getAppConfig: vi.fn(),
  verifyProcessOwner: vi.fn(),
  isPidAlive: vi.fn()
}))

vi.mock('child_process', () => ({ spawn: mocks.spawn, execFile: mocks.execFile }))
vi.mock('fs', () => ({ existsSync: mocks.existsSync }))
vi.mock('fs/promises', () => ({
  readFile: mocks.readFile,
  rm: mocks.rm,
  writeFile: mocks.writeFile
}))
vi.mock('../utils/dirs', () => ({
  dataDir: () => 'C:\\data',
  resourcesFilesDir: () => 'C:\\resources\\files'
}))
vi.mock('../config', () => ({ getAppConfig: mocks.getAppConfig }))
vi.mock('../core/process', () => ({
  isPidAlive: mocks.isPidAlive,
  verifyProcessOwner: mocks.verifyProcessOwner
}))

const platform = Object.getOwnPropertyDescriptor(process, 'platform')
const alive = new Set<number>()
let nextPid = 100
let killSpy: ReturnType<typeof vi.spyOn>

function fakeChild(pid: number): unknown {
  alive.add(pid)
  return {
    pid,
    // like a real ChildProcess, exitCode is set once the process has exited
    get exitCode(): number | null {
      return alive.has(pid) ? null : 0
    },
    signalCode: null,
    unref: vi.fn(),
    kill: vi.fn(() => alive.delete(pid))
  }
}

function closeGracefully(): void {
  // taskkill without /F asks the window to close; the process then exits on its own
  mocks.execFile.mockImplementation((_file: string, args: string[], _options, callback) => {
    alive.delete(Number(args[1]))
    callback(null, { stdout: '', stderr: '' })
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
  mocks.existsSync.mockReturnValue(false)
  mocks.getAppConfig.mockResolvedValue({ showTraffic: true })
  mocks.spawn.mockImplementation(() => fakeChild(nextPid++))
  closeGracefully()
  mocks.isPidAlive.mockImplementation((pid: number) => alive.has(pid))
  killSpy = vi
    .spyOn(process, 'kill')
    .mockImplementation((pid: number, signal?: string | number) => {
      if (signal === 0) {
        if (alive.has(pid)) return true
        throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' })
      }
      alive.delete(pid)
      return true
    })
})

afterEach(async () => {
  // stop whatever the test left running so the module-level child does not leak into the next test
  vi.useRealTimers()
  closeGracefully()
  mocks.existsSync.mockReturnValue(false)
  mocks.getAppConfig.mockResolvedValue({ showTraffic: false })
  await startMonitor()
  killSpy.mockRestore()
  alive.clear()
  if (platform) Object.defineProperty(process, 'platform', platform)
})

// hard kills by PID (process.kill), excluding the signal-0 liveness probes
function hardKills(): unknown[][] {
  return killSpy.mock.calls.filter(([, signal]) => signal !== 0)
}

// hard kills through a spawned child's own handle
function childKills(): number {
  return mocks.spawn.mock.results.reduce(
    (count, { value }) => count + value.kill.mock.calls.length,
    0
  )
}

function ignoreCloseRequests(): void {
  mocks.execFile.mockImplementation((_file, _args, _options, callback) => {
    callback(new Error('could not be terminated'))
  })
}

describe('startMonitor', () => {
  it('closes the previous TrafficMonitor gracefully before starting a new one (#741)', async () => {
    await startMonitor()
    const first = mocks.spawn.mock.results[0].value.pid

    mocks.spawn.mockImplementationOnce(() => {
      expect(alive.has(first)).toBe(false)
      return fakeChild(nextPid++)
    })
    await startMonitor()

    expect(mocks.execFile).toHaveBeenCalledWith(
      'taskkill',
      ['/PID', String(first)],
      expect.objectContaining({ windowsHide: true }),
      expect.any(Function)
    )
    expect(hardKills()).toEqual([])
    expect(childKills()).toBe(0)
    expect(mocks.spawn).toHaveBeenCalledTimes(2)
  })

  it('waits for the old monitor to actually exit before starting the new one', async () => {
    await startMonitor()
    const first = mocks.spawn.mock.results[0].value.pid
    // taskkill without /F returns once WM_CLOSE is posted; the process exits a moment later
    mocks.execFile.mockImplementationOnce((_file, args: string[], _options, callback) => {
      setTimeout(() => alive.delete(Number(args[1])), 250)
      callback(null, { stdout: '', stderr: '' })
    })
    mocks.spawn.mockImplementationOnce(() => {
      expect(alive.has(first)).toBe(false)
      return fakeChild(nextPid++)
    })

    await startMonitor()

    expect(mocks.spawn).toHaveBeenCalledTimes(2)
    expect(hardKills()).toEqual([])
    expect(childKills()).toBe(0)
  })

  it('never leaves two monitors running when the switch is toggled while one is closing', async () => {
    await startMonitor()
    // the first close request takes a while, so the second toggle arrives mid-shutdown
    mocks.execFile.mockImplementationOnce((_file, args: string[], _options, callback) => {
      setTimeout(() => {
        alive.delete(Number(args[1]))
        callback(null, { stdout: '', stderr: '' })
      }, 20)
    })

    await Promise.all([startMonitor(), startMonitor()])

    expect(mocks.spawn).toHaveBeenCalledTimes(3)
    expect(alive.size).toBe(1)
  })

  it('only stops the monitor when the traffic display is turned off', async () => {
    await startMonitor()
    const first = mocks.spawn.mock.results[0].value.pid
    mocks.getAppConfig.mockResolvedValue({ showTraffic: false })

    await startMonitor()

    expect(alive.has(first)).toBe(false)
    expect(mocks.spawn).toHaveBeenCalledTimes(1)
  })

  it('closes the monitor gracefully when the app quits instead of leaving it to the job object', async () => {
    await startMonitor()
    const first = mocks.spawn.mock.results[0].value.pid

    await stopMonitor()

    expect(mocks.execFile).toHaveBeenCalledWith(
      'taskkill',
      ['/PID', String(first)],
      expect.anything(),
      expect.any(Function)
    )
    expect(alive.has(first)).toBe(false)
    expect(hardKills()).toEqual([])
    expect(childKills()).toBe(0)
    expect(mocks.spawn).toHaveBeenCalledTimes(1)
  })

  it('falls back to a hard kill when the monitor ignores the close request', async () => {
    await startMonitor()
    const first = mocks.spawn.mock.results[0].value
    ignoreCloseRequests()
    vi.useFakeTimers()

    const restart = startMonitor()
    await vi.advanceTimersByTimeAsync(3000)
    await restart

    // through the child handle, not by PID, so a recycled PID can never be hit
    expect(first.kill).toHaveBeenCalledTimes(1)
    expect(alive.has(first.pid)).toBe(false)
    expect(hardKills()).toEqual([])
    expect(mocks.spawn).toHaveBeenCalledTimes(2)
  })

  it('closes the detached monitor recorded by lightweight mode', async () => {
    alive.add(42)
    mocks.existsSync.mockReturnValue(true)
    mocks.readFile.mockResolvedValue('42')
    mocks.verifyProcessOwner.mockResolvedValue(true)

    await startMonitor()

    expect(mocks.verifyProcessOwner).toHaveBeenCalledWith(42, ['TrafficMonitor'])
    expect(mocks.execFile).toHaveBeenCalledWith(
      'taskkill',
      ['/PID', '42'],
      expect.anything(),
      expect.any(Function)
    )
    expect(alive.has(42)).toBe(false)
    expect(hardKills()).toEqual([])
    expect(mocks.rm).toHaveBeenCalledTimes(1)
  })

  it('hard-kills the lightweight-mode monitor when it ignores the close request', async () => {
    alive.add(42)
    mocks.existsSync.mockReturnValue(true)
    mocks.readFile.mockResolvedValue('42')
    mocks.verifyProcessOwner.mockResolvedValue(true)
    ignoreCloseRequests()
    vi.useFakeTimers()

    const restart = startMonitor()
    await vi.advanceTimersByTimeAsync(3000)
    await restart

    expect(mocks.verifyProcessOwner).toHaveBeenCalledTimes(2)
    expect(hardKills()).toEqual([[42]])
    expect(alive.has(42)).toBe(false)
  })

  it('does not hard-kill a recycled PID from the lightweight-mode pid file', async () => {
    alive.add(42)
    mocks.existsSync.mockReturnValue(true)
    mocks.readFile.mockResolvedValue('42')
    // TrafficMonitor exits after the first check and another process gets PID 42
    mocks.verifyProcessOwner.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    ignoreCloseRequests()
    vi.useFakeTimers()

    const restart = startMonitor()
    await vi.advanceTimersByTimeAsync(3000)
    await restart

    expect(mocks.verifyProcessOwner).toHaveBeenCalledTimes(2)
    expect(hardKills()).toEqual([])
    expect(alive.has(42)).toBe(true)
  })
})
