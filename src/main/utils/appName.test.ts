import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { execFileAsync, existsSync } = vi.hoisted(() => ({
  execFileAsync: vi.fn(),
  existsSync: vi.fn()
}))

vi.mock('fs', () => ({
  default: {
    existsSync,
    readFileSync: vi.fn()
  }
}))

vi.mock('child_process', () => ({
  execFile: vi.fn(),
  spawnSync: vi.fn()
}))

vi.mock('util', () => ({
  promisify: () => execFileAsync
}))

vi.mock('./icon', () => ({
  findBestAppPath: vi.fn(),
  isIOSApp: vi.fn()
}))

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { configurable: true, value: platform })
}

beforeEach(() => {
  setPlatform('win32')
  existsSync.mockReset()
  execFileAsync.mockReset()
  vi.resetModules()
})

afterEach(() => {
  if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform)
})

describe('getAppName on Windows', () => {
  it('reads the executable file description', async () => {
    existsSync.mockReturnValue(true)
    execFileAsync.mockResolvedValue({ stdout: 'Google Chrome\r\n' })
    const { getAppName } = await import('./appName')

    await expect(getAppName("C:\\Program Files\\Publisher's App\\application.exe")).resolves.toBe(
      'Google Chrome'
    )

    const args = execFileAsync.mock.calls[0][1] as string[]
    expect(args[3]).toContain("Publisher''s App")
    expect(args[3]).toContain('VersionInfo.FileDescription')
    expect(args[3]).toContain('VersionInfo.ProductName')
  })

  it('skips metadata lookup when the executable does not exist', async () => {
    existsSync.mockReturnValue(false)
    const { getAppName } = await import('./appName')

    await expect(getAppName('C:\\missing.exe')).resolves.toBe('')
    expect(execFileAsync).not.toHaveBeenCalled()
  })
})
