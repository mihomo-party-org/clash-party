import { beforeEach, describe, expect, it, vi } from 'vitest'
import { findDeepLink, handleDeepLink } from './deeplink'
const notificationShow = vi.fn()
const addProfileItem = vi.fn()
const setOperationMode = vi.fn()
const installRemotePlugin = vi.fn()
const loginPlugin = vi.fn()
const safeShowErrorBox = vi.fn()

vi.mock('electron', () => ({
  Notification: class {
    show(): void {
      notificationShow()
    }
  }
}))
vi.mock('i18next', () => ({ default: { t: (key: string) => key } }))
vi.mock('./config', () => ({
  addProfileItem: (...args: unknown[]) => addProfileItem(...args)
}))
vi.mock('./simple/mode', () => ({
  setOperationMode: (...args: unknown[]) => setOperationMode(...args)
}))
vi.mock('./resolve/plugin', () => ({
  installRemotePlugin: (...args: unknown[]) => installRemotePlugin(...args),
  loginPlugin: (...args: unknown[]) => loginPlugin(...args)
}))
vi.mock('./window', () => ({ mainWindow: null }))
vi.mock('./utils/init', () => ({
  safeShowErrorBox: (...args: unknown[]) => safeShowErrorBox(...args)
}))

beforeEach(() => {
  notificationShow.mockReset()
  addProfileItem.mockReset().mockResolvedValue(undefined)
  setOperationMode.mockReset().mockResolvedValue(undefined)
  installRemotePlugin.mockReset().mockResolvedValue({ id: 'plugin-id' })
  loginPlugin.mockReset().mockResolvedValue(undefined)
  safeShowErrorBox.mockReset()
})

describe('findDeepLink', () => {
  it('finds a supported scheme anywhere in the command line', () => {
    expect(findDeepLink(['app', '--flag', 'clash://install-config?url=x'])).toBe(
      'clash://install-config?url=x'
    )
    expect(findDeepLink(['app', 'MIHOMO://install-plugin?url=x'])).toBe(
      'MIHOMO://install-plugin?url=x'
    )
  })

  it('ignores unrelated arguments', () => {
    expect(findDeepLink(['app', '--flag'])).toBeUndefined()
  })
})

describe('install-config deep link', () => {
  const profileUrl = 'https://provider.example/sub?token=abc&flag=meta'
  const link = (query: string): string =>
    `clash://install-config?${query}&url=${encodeURIComponent(profileUrl)}`

  it('imports the profile without touching the operation mode by default', async () => {
    await handleDeepLink(link('name=Example'))

    expect(setOperationMode).not.toHaveBeenCalled()
    expect(addProfileItem).toHaveBeenCalledWith({
      type: 'remote',
      name: 'Example',
      url: profileUrl
    })
    expect(safeShowErrorBox).not.toHaveBeenCalled()
  })

  it.each(['standard', 'simple'])('switches to the %s mode before importing', async (mode) => {
    await handleDeepLink(link(`operation-mode=${mode}`))

    expect(setOperationMode).toHaveBeenCalledWith(mode)
    expect(setOperationMode.mock.invocationCallOrder[0]).toBeLessThan(
      addProfileItem.mock.invocationCallOrder[0]
    )
    expect(safeShowErrorBox).not.toHaveBeenCalled()
  })

  it('ignores an unknown operation mode', async () => {
    await handleDeepLink(link('operation-mode=global'))

    expect(setOperationMode).not.toHaveBeenCalled()
    expect(addProfileItem).toHaveBeenCalledOnce()
    expect(safeShowErrorBox).not.toHaveBeenCalled()
  })

  it('does not change the mode when the url parameter is missing', async () => {
    await handleDeepLink('clash://install-config?operation-mode=standard')

    expect(setOperationMode).not.toHaveBeenCalled()
    expect(addProfileItem).not.toHaveBeenCalled()
    expect(safeShowErrorBox).toHaveBeenCalledWith(
      'profiles.error.importFailed',
      expect.stringContaining('profiles.error.urlParamMissing')
    )
  })

  it('reports a mode switch failure and skips the import', async () => {
    setOperationMode.mockRejectedValue(new Error('switch failed'))
    await handleDeepLink(link('operation-mode=standard'))

    expect(addProfileItem).not.toHaveBeenCalled()
    expect(safeShowErrorBox).toHaveBeenCalledWith(
      'profiles.error.importFailed',
      expect.stringContaining('switch failed')
    )
  })
})

describe('install-plugin deep link', () => {
  it('downloads, installs and starts login', async () => {
    const remoteUrl = 'https://provider.example/app.cpx?channel=stable'
    await handleDeepLink(`clash://install-plugin?url=${encodeURIComponent(remoteUrl)}`)

    expect(installRemotePlugin).toHaveBeenCalledWith(remoteUrl)
    expect(loginPlugin).toHaveBeenCalledWith('plugin-id')
    expect(notificationShow).toHaveBeenCalledTimes(2)
    expect(safeShowErrorBox).not.toHaveBeenCalled()
  })

  it('reports an install failure and does not start login', async () => {
    installRemotePlugin.mockRejectedValue(new Error('bad descriptor'))
    await handleDeepLink('mihomo://install-plugin?url=https%3A%2F%2Fprovider.example%2Fapp.cpx')

    expect(loginPlugin).not.toHaveBeenCalled()
    expect(safeShowErrorBox).toHaveBeenCalledWith(
      'plugins.installFailed',
      expect.stringContaining('bad descriptor')
    )
  })

  it('keeps the installed plugin when login fails and reports the login error', async () => {
    loginPlugin.mockRejectedValue(new Error('PLUGIN_LOGIN_FAILED'))
    await handleDeepLink('clash://install-plugin?url=https%3A%2F%2Fprovider.example%2Fapp.cpx')

    expect(installRemotePlugin).toHaveBeenCalledOnce()
    expect(notificationShow).toHaveBeenCalledOnce()
    expect(safeShowErrorBox).toHaveBeenCalledWith(
      'plugins.loginFailed',
      expect.stringContaining('PLUGIN_LOGIN_FAILED')
    )
  })

  it('requires the url parameter', async () => {
    await handleDeepLink('clash://install-plugin')
    expect(installRemotePlugin).not.toHaveBeenCalled()
    expect(safeShowErrorBox).toHaveBeenCalledWith(
      'plugins.installFailed',
      expect.stringContaining('profiles.error.urlParamMissing')
    )
  })
})
