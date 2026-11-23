import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  events: [] as string[],
  uploadRuntimeConfigIfChanged: vi.fn(),
  patchMihomoConfig: vi.fn(),
  warn: vi.fn()
}))

vi.mock('chokidar', () => ({ default: {} }))
vi.mock('electron', () => ({ app: {}, dialog: {}, ipcMain: {} }))
vi.mock('../window', () => ({
  mainWindow: { webContents: { send: (channel: string) => h.events.push(channel) } }
}))
vi.mock('../config', () => ({}))
vi.mock('../utils/dirs', () => ({}))
vi.mock('../resolve/gistApi', () => ({
  uploadRuntimeConfigIfChanged: h.uploadRuntimeConfigIfChanged
}))
vi.mock('../resolve/trafficMonitor', () => ({}))
vi.mock('../sys/sysproxy', () => ({}))
vi.mock('../utils/init', () => ({}))
vi.mock('../utils/age', () => ({}))
vi.mock('../../shared/i18n', () => ({ default: {} }))
vi.mock('../utils/logger', () => ({ managerLogger: { info: vi.fn(), warn: h.warn } }))
vi.mock('../utils/logFile', () => ({}))
vi.mock('../utils/notification', () => ({}))
vi.mock('./mihomoApi', () => ({ patchMihomoConfig: h.patchMihomoConfig }))
vi.mock('./factory', () => ({}))
vi.mock('./dnsOverrideGuard', () => ({}))
vi.mock('./smartModel', () => ({}))
vi.mock('./permissions', () => ({ setStopCoreBeforeAdminRestart: vi.fn() }))
vi.mock('./process', () => ({}))
vi.mock('./dns', () => ({}))
vi.mock('./tailscale-auth', () => ({}))

beforeEach(() => {
  vi.resetModules()
  h.events.length = 0
  h.warn.mockReset()
  h.uploadRuntimeConfigIfChanged.mockReset().mockResolvedValue(undefined)
  h.patchMihomoConfig.mockReset().mockImplementation(async () => {
    h.events.push('log level restored')
  })
})

describe('completeCoreStartup', () => {
  it('refreshes the proxy groups without waiting for the Gist upload', async () => {
    let finishUpload = (): void => {}
    h.uploadRuntimeConfigIfChanged.mockReturnValue(
      new Promise<void>((resolve) => {
        finishUpload = () => {
          h.events.push('gist uploaded')
          resolve()
        }
      })
    )
    const { completeCoreStartup } = await import('./manager')

    const done = completeCoreStartup('warning')
    // The upload needs two GitHub requests through the proxy and can take seconds.
    await vi.waitFor(() => expect(h.events).toContain('rulesUpdated'))

    expect(h.events).toEqual(['log level restored', 'groupsUpdated', 'rulesUpdated'])
    expect(h.patchMihomoConfig).toHaveBeenCalledWith({ 'log-level': 'warning' })

    finishUpload()
    await done
    expect(h.events.at(-1)).toBe('gist uploaded')
  })

  it('still refreshes the proxy groups when the Gist upload fails', async () => {
    h.uploadRuntimeConfigIfChanged.mockRejectedValue(new Error('github unreachable'))
    const { completeCoreStartup } = await import('./manager')

    await expect(completeCoreStartup('info')).resolves.toBeUndefined()

    expect(h.events).toEqual(['log level restored', 'groupsUpdated', 'rulesUpdated'])
    expect(h.warn).toHaveBeenCalledWith(
      'Failed to sync runtime config to Gist',
      expect.objectContaining({ message: 'github unreachable' })
    )
  })

  it('refreshes the proxy groups even when the log level cannot be restored', async () => {
    h.patchMihomoConfig.mockRejectedValue(new Error('core not ready'))
    const { completeCoreStartup } = await import('./manager')

    await expect(completeCoreStartup('info')).rejects.toThrow('core not ready')

    expect(h.events).toEqual(['groupsUpdated', 'rulesUpdated'])
  })
})
