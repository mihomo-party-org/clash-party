import { beforeEach, expect, it, vi } from 'vitest'
import { buildContextMenu } from './tray'

const mocks = vi.hoisted(() => ({
  buildFromTemplate: vi.fn((template: unknown) => template),
  getAppConfig: vi.fn(),
  mihomoGroups: vi.fn(),
  mihomoProxyDelay: vi.fn(),
  send: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(), quit: vi.fn() },
  ipcMain: { on: vi.fn(), removeAllListeners: vi.fn() },
  Menu: { buildFromTemplate: mocks.buildFromTemplate },
  nativeImage: {},
  shell: {},
  systemPreferences: {},
  Tray: vi.fn()
}))
vi.mock('i18next', () => ({ t: (key: string) => key }))
vi.mock('../config', () => ({
  changeCurrentProfile: vi.fn(),
  getAppConfig: mocks.getAppConfig,
  getControledMihomoConfig: vi.fn(async () => ({ mode: 'rule', tun: { enable: false } })),
  getProfileConfig: vi.fn(async () => ({ items: [] })),
  patchAppConfig: vi.fn(),
  patchControledMihomoConfig: vi.fn()
}))
vi.mock('../core/mihomoApi', () => ({
  mihomoChangeProxy: vi.fn(),
  mihomoCloseAllConnections: vi.fn(),
  mihomoGroups: mocks.mihomoGroups,
  mihomoProxyDelay: mocks.mihomoProxyDelay,
  patchMihomoConfig: vi.fn(),
  getTrayIconStatus: vi.fn(),
  calculateTrayIconStatus: vi.fn()
}))
vi.mock('../window', () => ({
  mainWindow: { webContents: { send: mocks.send } },
  showMainWindow: vi.fn(),
  triggerMainWindow: vi.fn()
}))
vi.mock('../utils/dirs', () => ({
  dataDir: vi.fn(),
  logDir: vi.fn(),
  mihomoCoreDir: vi.fn(),
  mihomoWorkDir: vi.fn()
}))
vi.mock('../sys/sysproxy', () => ({ triggerSysProxy: vi.fn() }))
vi.mock('../core/manager', () => ({
  quitWithoutCore: vi.fn(),
  checkMihomoCorePermissions: vi.fn(),
  requestTunPermissions: vi.fn(),
  restartAsAdmin: vi.fn()
}))
vi.mock('../utils/logger', () => ({
  trayLogger: { debug: vi.fn(async () => {}), error: vi.fn(async () => {}) }
}))
vi.mock('../utils/clipboard', () => ({ writeClipboardText: vi.fn() }))
vi.mock('./floatingWindow', () => ({ floatingWindow: null, triggerFloatingWindow: vi.fn() }))
vi.mock('../../../resources/icon.ico?asset', () => ({ default: 'icon.ico' }))
vi.mock('../../../resources/icon_blue.ico?asset', () => ({ default: 'icon_blue.ico' }))
vi.mock('../../../resources/icon_red.ico?asset', () => ({ default: 'icon_red.ico' }))
vi.mock('../../../resources/icon_green.ico?asset', () => ({ default: 'icon_green.ico' }))
vi.mock('../../../resources/icon.png?asset', () => ({ default: 'icon.png' }))
vi.mock('../../../resources/icon_blue.png?asset', () => ({ default: 'icon_blue.png' }))
vi.mock('../../../resources/icon_red.png?asset', () => ({ default: 'icon_red.png' }))
vi.mock('../../../resources/icon_green.png?asset', () => ({ default: 'icon_green.png' }))
vi.mock('../../../resources/iconTemplate.png?asset', () => ({ default: 'iconTemplate.png' }))

type MenuItem = { id?: string; submenu?: MenuItem[]; click?: () => Promise<void> }

const proxies = ['a', 'b', 'c', 'd', 'e'].map((name) => ({ name, history: [] }))

async function clickGroupDelayTest(): Promise<void> {
  const template = (await buildContextMenu()) as unknown as MenuItem[]
  const group = template.find((item) => item.id === 'Proxy')
  const delayTest = group?.submenu?.find((item) => item.id === 'Proxy-delay-test')
  expect(delayTest?.click).toBeTypeOf('function')
  await delayTest?.click?.()
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mihomoGroups.mockResolvedValue([
    {
      name: 'Proxy',
      now: 'a',
      testUrl: 'https://example.com/generate_204',
      all: [...proxies, { name: 'provided', history: [], 'provider-name': 'remote' }]
    }
  ])
})

it('tests the group node by node within the delay test concurrency (#1507)', async () => {
  mocks.getAppConfig.mockResolvedValue({ sysProxy: { enable: false }, delayTestConcurrency: 2 })
  let running = 0
  let peak = 0
  mocks.mihomoProxyDelay.mockImplementation(async (name: string) => {
    running++
    peak = Math.max(peak, running)
    await new Promise((resolve) => setTimeout(resolve, 1))
    running--
    if (name === 'c') throw new Error('timeout')
    return { delay: 100 }
  })

  await clickGroupDelayTest()

  expect(mocks.mihomoProxyDelay).toHaveBeenCalledTimes(6)
  expect(peak).toBe(2)
  expect(mocks.mihomoProxyDelay).toHaveBeenCalledWith(
    'a',
    'https://example.com/generate_204',
    undefined
  )
  expect(mocks.mihomoProxyDelay).toHaveBeenCalledWith(
    'provided',
    'https://example.com/generate_204',
    'remote'
  )
  // one timed out node must not abort the rest or skip the UI refresh
  expect(mocks.send).toHaveBeenCalledWith('groupsUpdated')
})

it('falls back to the default concurrency when the setting is unset or invalid', async () => {
  mocks.getAppConfig.mockResolvedValue({ sysProxy: { enable: false }, delayTestConcurrency: 0 })
  let running = 0
  let peak = 0
  mocks.mihomoProxyDelay.mockImplementation(async () => {
    running++
    peak = Math.max(peak, running)
    await new Promise((resolve) => setTimeout(resolve, 1))
    running--
    return { delay: 100 }
  })

  await clickGroupDelayTest()

  expect(mocks.mihomoProxyDelay).toHaveBeenCalledTimes(6)
  expect(peak).toBe(6)
})
