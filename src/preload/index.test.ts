import { afterEach, expect, it, vi } from 'vitest'

const { expose, invoke } = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn() }))
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: expose },
  ipcRenderer: { invoke },
  webUtils: {}
}))
const isolated = Object.getOwnPropertyDescriptor(process, 'contextIsolated')
afterEach(() => {
  if (isolated) Object.defineProperty(process, 'contextIsolated', isolated)
  else delete process.contextIsolated
  vi.unstubAllGlobals()
})

it('allows the Linux application lookup through the renderer and preload bridge', async () => {
  Object.defineProperty(process, 'contextIsolated', { configurable: true, value: true })
  await import('./index')
  const api = expose.mock.calls.find(([name]) => name === 'electron')?.[1]
  vi.stubGlobal('window', { electron: api })
  const info = { name: 'Browser', icon: 'data:image/png;base64,aWNvbg==' }
  invoke.mockResolvedValue(info)
  const { getAppInfo } = await import('../renderer/src/utils/ipc')
  const metadata = { processPath: '/opt/browser' } as IMihomoConnectionDetail['metadata']
  await expect(getAppInfo(metadata)).resolves.toEqual(info)
  expect(invoke).toHaveBeenCalledWith('getAppInfo', metadata)
})
