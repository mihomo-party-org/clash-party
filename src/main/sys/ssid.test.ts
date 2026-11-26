import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  // The mode stored in mihomo.yaml.
  mode: 'rule',
  // An empty string means no Wi-Fi network, e.g. on Ethernet.
  ssid: 'Home',
  netshCalls: 0,
  // Any change makes the network fingerprint differ, which is what triggers a new SSID lookup.
  networkId: 1,
  patchControledMihomoConfig: vi.fn(),
  patchMihomoConfig: vi.fn(),
  send: vi.fn(),
  warn: vi.fn()
}))

vi.mock('child_process', () => ({
  exec: (command: string, callback: (error: Error | null, result?: { stdout: string }) => void) => {
    if (command.includes('netsh')) {
      h.netshCalls++
      callback(null, {
        stdout: h.ssid
          ? `    Name                   : Wi-Fi\n    SSID                   : ${h.ssid}\n`
          : '    State                  : disconnected\n'
      })
    } else if (command.includes('airport')) {
      // Removed in macOS 14.4.
      callback(new Error('not found'))
    } else if (command.includes('listpreferredwirelessnetworks')) {
      callback(null, { stdout: `Preferred networks on en0:\n\t${h.ssid}\n` })
    } else {
      callback(new Error(`unexpected command: ${command}`))
    }
  },
  spawn: () => Object.assign(new EventEmitter(), { kill: vi.fn() })
}))
vi.mock('os', () => ({
  networkInterfaces: () => ({ en0: [{ address: `10.0.0.${h.networkId}`, mac: 'aa' }] })
}))
vi.mock('electron', () => ({ ipcMain: { emit: vi.fn() }, net: { isOnline: () => true } }))
vi.mock('../config', () => ({
  getAppConfig: async () => ({ ...h.config }),
  patchAppConfig: async (patch: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete h.config[key]
      else h.config[key] = value
    }
  },
  getControledMihomoConfig: async () => ({ mode: h.mode }),
  patchControledMihomoConfig: h.patchControledMihomoConfig
}))
vi.mock('../config/profile', () => ({
  changeCurrentProfile: vi.fn(),
  getProfileConfig: async () => ({ current: 'a', items: [] })
}))
vi.mock('../core/mihomoApi', () => ({ patchMihomoConfig: h.patchMihomoConfig }))
vi.mock('../window', () => ({ mainWindow: { webContents: { send: h.send } } }))
vi.mock('../core/manager', () => ({ getDefaultDevice: async () => 'en0' }))
vi.mock('../resolve/tray', () => ({ updateTrayIcon: vi.fn(async () => {}) }))
vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: h.warn, error: vi.fn(), debug: vi.fn() })
}))

const originalPlatform = process.platform
let ssid: typeof import('./ssid')

async function start(platform: NodeJS.Platform): Promise<void> {
  Object.defineProperty(process, 'platform', { value: platform })
  ssid = await import('./ssid')
  await ssid.startSSIDCheck()
}

async function moveTo(name: string): Promise<void> {
  h.ssid = name
  h.networkId++
  await vi.advanceTimersByTimeAsync(15000)
}

function modeCalls(): string[] {
  return h.patchMihomoConfig.mock.calls.map(([patch]) => patch.mode)
}

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  h.config = { pauseSSID: ['Home'] }
  h.mode = 'rule'
  h.ssid = 'Home'
  h.networkId = 1
  h.netshCalls = 0
  h.patchControledMihomoConfig.mockReset().mockImplementation(async (patch) => {
    if (patch.mode) h.mode = patch.mode
  })
  h.patchMihomoConfig.mockReset().mockResolvedValue(undefined)
  h.send.mockReset()
  h.warn.mockReset()
})

afterEach(() => {
  ssid?.stopSSIDCheck()
  vi.useRealTimers()
  Object.defineProperty(process, 'platform', { value: originalPlatform })
})

describe('pauseSSID', () => {
  it('switches to direct mode on a paused network and remembers it', async () => {
    await start('win32')

    expect(h.patchControledMihomoConfig).toHaveBeenCalledWith({ mode: 'direct' })
    expect(modeCalls()).toEqual(['direct'])
    expect(h.config.pausedBySSID).toBe(true)
    expect(h.send).toHaveBeenCalledWith('controledMihomoConfigUpdated')
  })

  it.each(['win32', 'darwin'] as const)(
    'retries a switch the core rejected while starting (%s)',
    async (platform) => {
      h.patchMihomoConfig.mockRejectedValueOnce(new Error('Core is still initializing'))
      await start(platform)
      expect(modeCalls()).toEqual(['direct'])
      expect(h.send).not.toHaveBeenCalled()

      // Same network: before the fix nothing ever tried again, so the files said direct
      // while the core kept running in rule mode.
      await vi.advanceTimersByTimeAsync(15000)
      expect(modeCalls()).toEqual(['direct', 'direct'])
      expect(h.send).toHaveBeenCalledWith('controledMihomoConfigUpdated')

      await vi.advanceTimersByTimeAsync(60000)
      expect(modeCalls()).toEqual(['direct', 'direct'])
    }
  )

  it('restores rule mode when leaving the paused network', async () => {
    await start('win32')
    await moveTo('Office')

    expect(modeCalls()).toEqual(['direct', 'rule'])
    expect(h.config.pausedBySSID).toBeUndefined()
  })

  it.each(['win32', 'darwin'] as const)(
    'retries restoring rule mode when the core rejected it (%s)',
    async (platform) => {
      // A core that is already paused: the config file says rule after the first attempt,
      // which must not be taken for a mode the user picked.
      h.config.pausedBySSID = true
      h.mode = 'direct'
      h.ssid = 'Office'
      h.patchMihomoConfig.mockRejectedValueOnce(new Error('Core is still initializing'))
      await start(platform)
      expect(h.mode).toBe('rule')
      expect(modeCalls()).toEqual(['rule'])
      expect(h.config.pausedBySSID).toBe(true)

      await vi.advanceTimersByTimeAsync(15000)
      expect(modeCalls()).toEqual(['rule', 'rule'])
      expect(h.config.pausedBySSID).toBeUndefined()

      await vi.advanceTimersByTimeAsync(60000)
      expect(modeCalls()).toEqual(['rule', 'rule'])
    }
  )

  it('keeps a mode the user picked while restoring rule mode is being retried', async () => {
    await start('win32')
    h.patchMihomoConfig.mockRejectedValueOnce(new Error('Core is still initializing'))
    await moveTo('Office')
    h.mode = 'global'

    await vi.advanceTimersByTimeAsync(15000)

    expect(modeCalls()).toEqual(['direct', 'rule'])
    expect(h.config.pausedBySSID).toBeUndefined()
  })

  it.each([
    ['another Wi-Fi network', 'Office'],
    ['a network without Wi-Fi', '']
  ])('restores rule mode after a restart on %s', async (_name, network) => {
    h.config.pausedBySSID = true
    h.mode = 'direct'
    h.ssid = network

    await start('win32')

    expect(h.patchControledMihomoConfig).toHaveBeenCalledWith({ mode: 'rule' })
    expect(modeCalls()).toEqual(['rule'])
    expect(h.config.pausedBySSID).toBeUndefined()
  })

  it('keeps a mode the user picked while paused', async () => {
    await start('win32')
    // The user switches to global mode from the tray while on the paused network.
    h.mode = 'global'

    await moveTo('Office')

    expect(modeCalls()).toEqual(['direct'])
    expect(h.config.pausedBySSID).toBeUndefined()
  })

  it('forgets the pause when pauseSSID is cleared', async () => {
    h.config = { pauseSSID: [], pausedBySSID: true }
    h.mode = 'direct'
    h.ssid = 'Office'

    await start('win32')

    expect(h.config.pausedBySSID).toBeUndefined()
    expect(h.patchMihomoConfig).not.toHaveBeenCalled()
  })

  it('stops retrying after a while when the core keeps failing', async () => {
    h.patchMihomoConfig.mockRejectedValue(new Error('Core is not running'))
    await start('win32')

    await vi.advanceTimersByTimeAsync(15000 * 10)

    expect(modeCalls()).toHaveLength(7)
    // The 15 s poll does not ask netsh again for an unchanged network; only the retries do.
    expect(h.netshCalls).toBe(7)

    // A network change starts over: leaving the paused network tries to restore rule mode.
    await moveTo('Office')
    expect(modeCalls()).toHaveLength(8)
    expect(modeCalls().at(-1)).toBe('rule')
  })

  it('leaves a direct mode the user chose alone after a restart', async () => {
    h.ssid = 'Office'

    await start('win32')

    expect(h.patchControledMihomoConfig).not.toHaveBeenCalled()
    expect(h.patchMihomoConfig).not.toHaveBeenCalled()
  })

  it('keeps the saved DNS setting when the switch is retried or the next network is paused too', async () => {
    h.config = {
      pauseSSID: ['Home', 'Cafe'],
      disableDnsOnPauseSSID: true,
      controlDns: true
    }
    h.patchMihomoConfig.mockRejectedValueOnce(new Error('Core is still initializing'))

    await start('win32')
    await vi.advanceTimersByTimeAsync(15000)
    await moveTo('Cafe')

    expect(modeCalls()).toEqual(['direct', 'direct', 'direct'])
    expect(h.config.controlDns).toBe(false)
    // Overwriting it with the already disabled value would leave DNS off after leaving.
    expect(h.config.controlDnsBeforePause).toBe(true)
  })
})
