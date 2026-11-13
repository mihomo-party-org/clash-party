import path from 'path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const APP_DATA = 'C:\\Users\\me\\AppData\\Roaming'
const DATA_DIR = path.join(APP_DATA, 'mihomo-party')
const PORTABLE_DATA_DIR = 'D:\\Clash Party\\data'
const RUNNER = path.join(DATA_DIR, 'tasks', 'mihomo-party-run.exe')

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  execFile: vi.fn(),
  existsSync: vi.fn(),
  rm: vi.fn(),
  writeFile: vi.fn(),
  checkAdminPrivileges: vi.fn(),
  dataDir: ''
}))

vi.mock('child_process', () => ({ exec: mocks.exec, execFile: mocks.execFile }))
vi.mock('fs', () => ({ existsSync: mocks.existsSync }))
vi.mock('fs/promises', () => ({
  mkdir: vi.fn(),
  readFile: vi.fn(),
  rm: mocks.rm,
  writeFile: mocks.writeFile
}))
vi.mock('electron', () => ({ app: { getPath: () => APP_DATA } }))
vi.mock('../utils/dirs', () => ({
  dataDir: () => mocks.dataDir,
  exePath: () => 'C:\\Program Files\\Clash Party\\Clash Party.exe',
  homeDir: 'C:\\Users\\me'
}))
vi.mock('../utils/logger', () => ({
  managerLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))
vi.mock('../core/admin', () => ({ checkAdminPrivileges: mocks.checkAdminPrivileges }))

// What `schtasks /query /xml` prints for the logon task written by 1.8.2 and earlier.
const LEGACY_TASK = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Actions Context="Author">
    <Exec>
      <Command>"${RUNNER}"</Command>
      <Arguments>"C:\\Program Files\\Mihomo Party\\Mihomo Party.exe"</Arguments>
    </Exec>
  </Actions>
</Task>`

const CURRENT_TASK = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Actions Context="Author">
    <Exec>
      <Command>"C:\\Program Files\\Clash Party\\Clash Party.exe"</Command>
    </Exec>
  </Actions>
</Task>`

type ExecCallback = (error: Error | null, result?: { stdout: string; stderr: string }) => void

// `task` is the scheduled task XML, or null when the task does not exist.
function mockWindows(task: string | null, registry = false, declineUac = false): void {
  mocks.exec.mockImplementation((command: string, ...rest: unknown[]) => {
    const cb = rest[rest.length - 1] as ExecCallback
    if (command.includes('/query')) {
      if (task === null) cb(new Error('ERROR: The system cannot find the file specified.'))
      else cb(null, { stdout: `Active code page: 437\r\n${task}`, stderr: '' })
    } else {
      // The non-admin path asks for UAC; declining makes PowerShell fail.
      if (command.includes('RunAs') && declineUac)
        cb(new Error('The operation was canceled by the user.'))
      else cb(null, { stdout: '', stderr: '' })
    }
  })
  mocks.execFile.mockImplementation((_file: string, args: string[], cb: ExecCallback) => {
    if (args[0] === 'query' && !registry) cb(new Error('not found'))
    else cb(null, { stdout: registry ? 'mihomo-party    REG_SZ    "x"' : '', stderr: '' })
  })
}

function execCommands(): string[] {
  return mocks.exec.mock.calls.map((call) => call[0] as string)
}

const originalPlatform = process.platform

beforeEach(() => {
  vi.resetModules()
  for (const mock of Object.values(mocks)) if (typeof mock === 'function') mock.mockReset()
  mocks.dataDir = DATA_DIR
  mocks.rm.mockResolvedValue(undefined)
  mocks.writeFile.mockResolvedValue(undefined)
  Object.defineProperty(process, 'platform', { value: 'win32' })
})

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform })
})

describe('checkAutoRun on Windows', () => {
  it('reports the current logon task as enabled', async () => {
    mockWindows(CURRENT_TASK)
    const { checkAutoRun } = await import('./autoRun')
    expect(await checkAutoRun()).toBe(true)
  })

  it('does not count a legacy task that starts the old runner', async () => {
    mockWindows(LEGACY_TASK)
    const { checkAutoRun } = await import('./autoRun')
    expect(await checkAutoRun()).toBe(false)
  })

  it('recognises the legacy task when schtasks prints UTF-16', async () => {
    mockWindows(LEGACY_TASK.split('').join('\0'))
    const { checkAutoRun } = await import('./autoRun')
    expect(await checkAutoRun()).toBe(false)
  })

  it('still falls back to the registry entry', async () => {
    mockWindows(LEGACY_TASK, true)
    const { checkAutoRun } = await import('./autoRun')
    expect(await checkAutoRun()).toBe(true)
  })

  it('reports disabled when there is no task and no registry entry', async () => {
    mockWindows(null)
    const { checkAutoRun } = await import('./autoRun')
    expect(await checkAutoRun()).toBe(false)
  })
})

describe('cleanupLegacyAutoRun', () => {
  it('does nothing when the old runner is not there', async () => {
    mockWindows(LEGACY_TASK)
    mocks.existsSync.mockReturnValue(false)
    const { cleanupLegacyAutoRun } = await import('./autoRun')

    await cleanupLegacyAutoRun()
    expect(mocks.exec).not.toHaveBeenCalled()
    expect(mocks.rm).not.toHaveBeenCalled()
  })

  it('removes the old runner without asking for admin rights', async () => {
    // Without the runner the stale task fails silently instead of showing "file does not exist".
    mockWindows(LEGACY_TASK)
    mocks.existsSync.mockImplementation((file: string) => file === RUNNER)
    mocks.checkAdminPrivileges.mockResolvedValue(false)
    const { cleanupLegacyAutoRun } = await import('./autoRun')

    await cleanupLegacyAutoRun()
    expect(mocks.rm).toHaveBeenCalledWith(RUNNER, { force: true })
    expect(execCommands().some((command) => command.includes('/create'))).toBe(false)
    expect(execCommands().some((command) => command.includes('RunAs'))).toBe(false)
  })

  it('rewrites the legacy task to start the current app when running as admin', async () => {
    mockWindows(LEGACY_TASK)
    mocks.existsSync.mockImplementation((file: string) => file === RUNNER)
    mocks.checkAdminPrivileges.mockResolvedValue(true)
    const { cleanupLegacyAutoRun } = await import('./autoRun')

    await cleanupLegacyAutoRun()
    const create = execCommands().find((command) => command.includes('/create'))
    expect(create).toContain('/tn "mihomo-party"')
    const xml = Buffer.from(mocks.writeFile.mock.calls[0][1]).toString('utf16le')
    expect(xml).toContain('<Command>"C:\\Program Files\\Clash Party\\Clash Party.exe"</Command>')
    expect(xml).not.toContain('mihomo-party-run.exe')
    expect(mocks.rm).toHaveBeenCalledWith(RUNNER, { force: true })
  })

  it('also removes the runner left in the installed data folder when running portable', async () => {
    mocks.dataDir = PORTABLE_DATA_DIR
    mockWindows(LEGACY_TASK)
    mocks.existsSync.mockImplementation((file: string) => file === RUNNER)
    mocks.checkAdminPrivileges.mockResolvedValue(false)
    const { cleanupLegacyAutoRun } = await import('./autoRun')

    await cleanupLegacyAutoRun()
    expect(mocks.rm).toHaveBeenCalledTimes(1)
    expect(mocks.rm).toHaveBeenCalledWith(RUNNER, { force: true })
  })

  it('leaves a current task alone', async () => {
    mockWindows(CURRENT_TASK)
    mocks.existsSync.mockImplementation((file: string) => file === RUNNER)
    mocks.checkAdminPrivileges.mockResolvedValue(true)
    const { cleanupLegacyAutoRun } = await import('./autoRun')

    await cleanupLegacyAutoRun()
    expect(execCommands().some((command) => command.includes('/create'))).toBe(false)
    expect(mocks.rm).toHaveBeenCalledWith(RUNNER, { force: true })
  })
})

describe('enableAutoRun on Windows', () => {
  it('falls back to the registry when UAC is declined and only the legacy task exists', async () => {
    mockWindows(LEGACY_TASK, false, true)
    mocks.checkAdminPrivileges.mockResolvedValue(false)
    const { enableAutoRun } = await import('./autoRun')

    await enableAutoRun()
    const regAdd = mocks.execFile.mock.calls.find((call) => call[1][0] === 'add')
    expect(regAdd?.[1]).toEqual(
      expect.arrayContaining([
        '/v',
        'mihomo-party',
        '/d',
        '"C:\\Program Files\\Clash Party\\Clash Party.exe"'
      ])
    )
  })

  it('does not add the registry entry when the task was rewritten', async () => {
    mockWindows(CURRENT_TASK, false, true)
    mocks.checkAdminPrivileges.mockResolvedValue(false)
    const { enableAutoRun } = await import('./autoRun')

    await enableAutoRun()
    expect(mocks.execFile.mock.calls.some((call) => call[1][0] === 'add')).toBe(false)
  })
})
