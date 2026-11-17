import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'

const h = vi.hoisted(() => ({
  profile: {} as Record<string, unknown>,
  controled: {} as Record<string, unknown>,
  overrides: {} as Record<string, string>,
  written: ''
}))

vi.mock('../config', () => ({
  getAppConfig: async () => ({}),
  getProfileConfig: async () => ({ current: 'sub' }),
  getProfileItem: async () => ({ id: 'sub', type: 'remote', override: Object.keys(h.overrides) }),
  getProfile: async () => structuredClone(h.profile),
  getControledMihomoConfig: async () => h.controled,
  getOverrideConfig: async () => ({ items: [] }),
  getOverrideItem: async (id: string) => ({ id, ext: 'yaml' }),
  getOverride: async (id: string) => h.overrides[id]
}))
vi.mock('../utils/dirs', () => ({
  mihomoWorkConfigPath: () => '/work/config.yaml',
  mihomoProfileWorkDir: () => '/work/sub',
  mihomoWorkDir: () => '/work',
  overridePath: () => '/override/x.log',
  rulePath: () => '/nonexistent/rules/sub.yaml'
}))
vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))
vi.mock('../utils/age', () => ({ decryptAgeContent: async (content: string) => content }))
vi.mock('../utils/safeFile', () => ({
  atomicWriteFile: async (_path: string, content: string) => {
    h.written = content
  }
}))
vi.mock('../local/service', () => ({ compileLocalRuntime: vi.fn() }))
vi.mock('./dnsOverrideGuard', () => ({
  evaluateDnsOverrideGuard: () => ({
    controlDns: true,
    autoDisabled: false,
    fingerprint: null,
    request: null
  })
}))

async function generatedTun(): Promise<Record<string, unknown>> {
  const { generateProfile } = await import('./factory')
  await generateProfile()
  return (parse(h.written) as { tun: Record<string, unknown> }).tun
}

beforeEach(() => {
  vi.resetModules()
  h.written = ''
  h.overrides = {}
  h.profile = { proxies: [], rules: [] }
  // What the TUN page stores when its exclude list was never filled in.
  h.controled = {
    tun: { enable: true, stack: 'mixed', 'dns-hijack': ['any:53'], 'route-exclude-address': [] }
  }
})

describe('TUN route-exclude-address', () => {
  it('keeps addresses added by an override when the list on the TUN page is empty', async () => {
    h.overrides = {
      tailscale: [
        'tun:',
        '  exclude-interface+:',
        '    - Tailscale',
        '  +route-exclude-address:',
        '    - 100.64.0.0/10',
        '    - fd7a:115c:a1e0::/48'
      ].join('\n')
    }

    const tun = await generatedTun()

    expect(tun['route-exclude-address']).toEqual(['100.64.0.0/10', 'fd7a:115c:a1e0::/48'])
    expect(tun['exclude-interface']).toEqual(['Tailscale'])
  })

  it('adds the addresses from the TUN page after those of the profile and its overrides', async () => {
    h.profile.tun = { 'route-exclude-address': ['10.0.0.0/8'] }
    h.overrides = { extra: 'tun:\n  route-exclude-address+:\n    - 100.64.0.0/10\n' }
    h.controled.tun = { enable: true, 'route-exclude-address': ['192.168.0.0/16'] }

    const tun = await generatedTun()

    expect(tun['route-exclude-address']).toEqual(['10.0.0.0/8', '100.64.0.0/10', '192.168.0.0/16'])
  })

  it('lists an address once when both sides have it', async () => {
    h.profile.tun = { 'route-exclude-address': ['FD7A:115C:A1E0::/48', '10.0.0.0/8'] }
    h.controled.tun = {
      enable: true,
      'route-exclude-address': ['fd7a:115c:a1e0::/48', '10.0.0.0/8']
    }

    const tun = await generatedTun()

    expect(tun['route-exclude-address']).toEqual(['FD7A:115C:A1E0::/48', '10.0.0.0/8'])
  })

  it('keeps the list from the TUN page unchanged when the profile has none', async () => {
    const controledList = ['192.168.0.0/16', '172.16.0.0/12']
    h.controled.tun = { enable: true, 'route-exclude-address': controledList }

    const tun = await generatedTun()

    expect(tun['route-exclude-address']).toEqual(['192.168.0.0/16', '172.16.0.0/12'])
    expect(controledList).toEqual(['192.168.0.0/16', '172.16.0.0/12'])
  })

  it('does not write profile addresses back into the stored TUN settings', async () => {
    h.profile.tun = { 'route-exclude-address': ['10.0.0.0/8'] }
    const controledList = ['192.168.0.0/16']
    h.controled.tun = { enable: true, 'route-exclude-address': controledList }

    await generatedTun()

    // The stored settings are what the TUN page shows and saves again.
    expect(controledList).toEqual(['192.168.0.0/16'])
  })

  it('still lets the TUN page decide the other TUN settings', async () => {
    h.profile.tun = { stack: 'gvisor', 'dns-hijack': ['tcp://any:53'] }

    const tun = await generatedTun()

    expect(tun.stack).toBe('mixed')
    expect(tun['dns-hijack']).toEqual(['any:53'])
  })

  it('does not add an empty list when neither side has one', async () => {
    h.controled.tun = { enable: true }

    const tun = await generatedTun()

    expect(tun).not.toHaveProperty('route-exclude-address')
  })
})
