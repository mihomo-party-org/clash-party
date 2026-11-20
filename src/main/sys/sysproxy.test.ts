import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  sysProxy: {} as Record<string, unknown>,
  calls: [] as string[],
  helperGetError: null as Error | null,
  helperPostError: null as Error | null,
  execFile: vi.fn(),
  exec: vi.fn(),
  startPacServer: vi.fn(async () => {}),
  stopPacServer: vi.fn(async () => {})
}))

vi.mock('sysproxy-rs', () => ({
  triggerAutoProxy: (enable: boolean, url: string) => {
    h.calls.push(`auto ${enable} ${url}`)
  },
  triggerManualProxy: (enable: boolean, host: string, port: number, bypass: string) => {
    h.calls.push(`manual ${enable} ${host}:${port} ${bypass}`)
  }
}))
vi.mock('electron', () => ({ net: { isOnline: () => true } }))
vi.mock('child_process', () => ({ exec: h.exec, execFile: h.execFile }))
vi.mock('axios', () => ({
  default: {
    get: async (url: string, options: { timeout?: number }) => {
      h.calls.push(`helper GET ${url} timeout=${options.timeout}`)
      if (h.helperGetError) throw h.helperGetError
    },
    post: async (url: string, body: Record<string, string>, options: { timeout?: number }) => {
      h.calls.push(`helper POST ${url} ${JSON.stringify(body)} timeout=${options.timeout}`)
      if (h.helperPostError) throw h.helperPostError
    }
  }
}))
vi.mock('../config', () => ({
  getAppConfig: async () => ({ sysProxy: h.sysProxy }),
  getControledMihomoConfig: async () => ({ 'mixed-port': 7891 })
}))
vi.mock('../resolve/server', () => ({
  pacPort: 10000,
  startPacServer: h.startPacServer,
  stopPacServer: h.stopPacServer
}))
vi.mock('../utils/logger', () => ({
  proxyLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))
vi.mock('../utils/dirs', () => ({ resourcesFilesDir: () => '/resources/files' }))

const originalPlatform = process.platform

async function load(platform: NodeJS.Platform): Promise<typeof import('./sysproxy')> {
  Object.defineProperty(process, 'platform', { value: platform })
  return import('./sysproxy')
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  h.calls.length = 0
  h.helperGetError = null
  h.helperPostError = null
  h.sysProxy = { enable: true, mode: 'auto', bypass: ['localhost', '127.*'] }
})

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform })
})

describe('switchPacSysProxyToManual', () => {
  it('replaces the PAC address with the core port on Windows', async () => {
    const { switchPacSysProxyToManual } = await load('win32')

    await expect(switchPacSysProxyToManual()).resolves.toBe(true)

    expect(h.calls).toEqual([
      'auto false ',
      'manual false :0 ',
      'manual true 127.0.0.1:7891 localhost;127.*'
    ])
    // The PAC server is about to go away with the main process, so it must not be restarted.
    expect(h.startPacServer).not.toHaveBeenCalled()
  })

  it('points at the core on this machine even when a proxy host is configured', async () => {
    // The default PAC script names 127.0.0.1 whatever the host is, and with allow-lan off
    // the core listens nowhere else.
    h.sysProxy = { enable: true, mode: 'auto', host: '192.168.1.2', bypass: [] }
    const { switchPacSysProxyToManual } = await load('linux')

    await switchPacSysProxyToManual()

    expect(h.calls.at(-1)).toBe('manual true 127.0.0.1:7891 ')
  })

  it.each([
    ['the system proxy is off', { enable: false, mode: 'auto' }],
    ['the system proxy is already manual', { enable: true, mode: 'manual' }],
    ['no mode is stored', { enable: true }]
  ])('leaves the system proxy alone when %s', async (_name, sysProxy) => {
    h.sysProxy = sysProxy
    const { switchPacSysProxyToManual } = await load('win32')

    await expect(switchPacSysProxyToManual()).resolves.toBe(false)

    expect(h.calls).toEqual([])
    expect(h.stopPacServer).not.toHaveBeenCalled()
  })

  it('goes through the helper on macOS', async () => {
    const { switchPacSysProxyToManual } = await load('darwin')

    await expect(switchPacSysProxyToManual()).resolves.toBe(true)

    expect(h.calls).toEqual([
      'helper GET http://localhost/off timeout=3000',
      'helper POST http://localhost/global {"host":"127.0.0.1","port":"7891","bypass":"localhost,127.*"} timeout=3000'
    ])
  })

  it.each(['helperGetError', 'helperPostError'] as const)(
    'does not try to repair the macOS helper, which would ask for the admin password (%s)',
    async (failing) => {
      h[failing] = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
      const { switchPacSysProxyToManual } = await load('darwin')

      await expect(switchPacSysProxyToManual()).rejects.toThrow('ECONNREFUSED')

      // Repairing starts with pgrep / launchctl and ends in an osascript password prompt.
      expect(h.exec).not.toHaveBeenCalled()
      expect(h.execFile).not.toHaveBeenCalled()
    }
  )

  it('still repairs the macOS helper when the user turns the system proxy on', async () => {
    h.sysProxy = { enable: true, mode: 'manual', bypass: [] }
    h.helperPostError = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    h.exec.mockImplementation((_command: string, callback: (error: Error) => void) =>
      callback(new Error('not running'))
    )
    h.execFile.mockImplementation(
      (_file: string, _args: string[], callback: (error: Error) => void) =>
        callback(new Error('cancelled'))
    )
    const { triggerSysProxy } = await load('darwin')

    await expect(triggerSysProxy(true)).rejects.toThrow('ECONNREFUSED')

    expect(h.execFile).toHaveBeenCalledWith(
      '/usr/bin/osascript',
      expect.anything(),
      expect.anything()
    )
  })

  it('lets the next launch put the PAC address back', async () => {
    const { switchPacSysProxyToManual, triggerSysProxy } = await load('win32')
    await switchPacSysProxyToManual()
    h.calls.length = 0

    // What init() does on startup.
    await triggerSysProxy(true)

    expect(h.calls).toEqual([
      'auto false ',
      'manual false :0 ',
      'auto true http://127.0.0.1:10000/pac'
    ])
  })
})
