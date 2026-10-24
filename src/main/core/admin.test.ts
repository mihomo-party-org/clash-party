import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  execFile: vi.fn()
}))

vi.mock('child_process', () => ({
  execFile: mocks.execFile
}))

vi.mock('../utils/logger', () => ({
  managerLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

type ExecCallback = (error: Error | null, stdout?: string, stderr?: string) => void

function ok(): (cmd: string, args: string[], opts: unknown, cb: ExecCallback) => void {
  return (_cmd, _args, _opts, cb) => cb(null, '', '')
}

function exitCode(
  code: number
): (cmd: string, args: string[], opts: unknown, cb: ExecCallback) => void {
  return (_cmd, _args, _opts, cb) => cb(Object.assign(new Error('Command failed'), { code }))
}

function killed(): (cmd: string, args: string[], opts: unknown, cb: ExecCallback) => void {
  return (_cmd, _args, _opts, cb) =>
    cb(Object.assign(new Error('Command failed'), { code: null, killed: true, signal: 'SIGTERM' }))
}

describe('checkAdminPrivileges', () => {
  const originalPlatform = process.platform

  beforeEach(() => {
    vi.resetModules()
    mocks.execFile.mockReset()
    Object.defineProperty(process, 'platform', { value: 'win32' })
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
  })

  it('returns true when the first fltmc call succeeds', async () => {
    mocks.execFile.mockImplementation(ok())
    const { checkAdminPrivileges } = await import('./admin')
    expect(await checkAdminPrivileges()).toBe(true)
    expect(mocks.execFile).toHaveBeenCalledTimes(1)
    expect(mocks.execFile.mock.calls[0][0]).toBe('fltmc')
  })

  it('returns false and caches it when both commands exit with a real non-zero code', async () => {
    mocks.execFile.mockImplementation(exitCode(1))
    const { checkAdminPrivileges } = await import('./admin')
    expect(await checkAdminPrivileges()).toBe(false)
    const calls = mocks.execFile.mock.calls.length
    expect(await checkAdminPrivileges()).toBe(false)
    expect(mocks.execFile).toHaveBeenCalledTimes(calls)
  })

  it('does not treat a timeout as "not admin": a slow command is retried and succeeds', async () => {
    // A slow machine: anything with a short timeout is killed, a generous one succeeds.
    mocks.execFile.mockImplementation(
      (_cmd, _args, opts: { timeout?: number }, cb: ExecCallback) =>
        (opts.timeout ?? 0) >= 5000 ? ok()(_cmd, _args, opts, cb) : killed()(_cmd, _args, opts, cb)
    )
    const { checkAdminPrivileges } = await import('./admin')
    expect(await checkAdminPrivileges()).toBe(true)
  })

  it('does not cache false when every attempt timed out', async () => {
    mocks.execFile.mockImplementation(killed())
    const { checkAdminPrivileges } = await import('./admin')
    await checkAdminPrivileges()
    mocks.execFile.mockReset()
    mocks.execFile.mockImplementation(ok())
    expect(await checkAdminPrivileges()).toBe(true)
  })
})
