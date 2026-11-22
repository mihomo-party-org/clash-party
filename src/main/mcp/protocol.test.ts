import { createServer, request, type Server } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const backend = vi.hoisted(() => ({
  getAppConfig: vi.fn(),
  getProfileConfig: vi.fn(),
  getControledMihomoConfig: vi.fn(),
  updateProfileConfig: vi.fn(),
  addProfileItem: vi.fn(),
  changeCurrentProfile: vi.fn(),
  patchControledMihomoConfig: vi.fn(),
  addProfileUpdater: vi.fn(),
  showMessageBox: vi.fn(),
  send: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  mihomoGroups: vi.fn(),
  mihomoVersion: vi.fn(),
  mihomoRules: vi.fn(),
  mihomoChangeProxy: vi.fn(),
  mihomoUnfixedProxy: vi.fn(),
  mihomoRulesDisable: vi.fn(),
  mihomoProxyProviders: vi.fn(),
  mihomoRuleProviders: vi.fn(),
  mihomoUpdateProxyProviders: vi.fn(),
  mihomoUpdateRuleProviders: vi.fn(),
  mihomoProxyDelay: vi.fn(),
  mihomoCloseAllConnections: vi.fn(),
  mihomoHotReloadConfig: vi.fn(),
  restartCore: vi.fn(),
  getLocalNode: vi.fn(),
  saveLocalNode: vi.fn(),
  getLocalProxyGroup: vi.fn(),
  saveLocalProxyGroup: vi.fn(),
  getLocalRulesEditor: vi.fn(),
  saveLocalRules: vi.fn(),
  withLocalProfileScope: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getVersion: () => 'test' },
  dialog: { showMessageBox: backend.showMessageBox }
}))
vi.mock('../window', () => ({
  mainWindow: {
    isDestroyed: () => false,
    webContents: { isDestroyed: () => false, send: backend.send }
  }
}))
vi.mock('../config', () => backend)
vi.mock('../config/profile', () => backend)
vi.mock('../core/profileUpdater', () => backend)
vi.mock('../core/mihomoApi', () => backend)
vi.mock('../core/manager', () => ({ restartCore: backend.restartCore, hasCoreProcess: () => true }))
vi.mock('../local/service', () => backend)
vi.mock('../local/store', () => ({ withLocalProfileScope: backend.withLocalProfileScope }))
vi.mock('../utils/logger', () => ({ createLogger: () => backend }))

const remoteProfile = {
  id: 'remote',
  name: 'Subscription',
  type: 'remote',
  updated: 1,
  interval: 60,
  url: 'https://subscription.invalid/path-secret?token=url-secret',
  authToken: 'auth-secret',
  ageSecretKey: 'age-secret'
}
const localProfile = { id: 'local', name: 'Local', type: 'local' }
let appConfig: Record<string, unknown>
let profileConfig: { current: string; items: Record<string, unknown>[] }
const sessions: {
  client: Client
  server: Awaited<ReturnType<(typeof import('./index'))['createMcpServer']>>
}[] = []
const httpServers: Server[] = []

async function connect(expectedToken?: string, requestSignal?: AbortSignal) {
  const { createMcpServer } = await import('./index')
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createMcpServer(expectedToken, requestSignal)
  const client = new Client({ name: 'security-test', version: '1.0.0' })
  sessions.push({ client, server })
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  return client
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {}
): Promise<CallToolResult> {
  return (await client.callTool({ name, arguments: args })) as CallToolResult
}

function value(result: CallToolResult): Record<string, unknown> {
  return result.structuredContent?.result as Record<string, unknown>
}

function errorCode(result: CallToolResult): unknown {
  return (result.structuredContent?.error as { code?: string })?.code
}

async function httpEndpoint(production = false): Promise<{ url: URL; port: number }> {
  const { handleMcpRequest, startMcpServer } = await import('./index')
  let port = 0
  const server = createServer((req, res) => {
    void handleMcpRequest(req, res, 'mcp-secret', port)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as { port: number }).port
  if (production) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await startMcpServer({ mcpPort: port, mcpToken: 'mcp-secret' } as IAppConfig)
  } else {
    httpServers.push(server)
  }
  return { url: new URL(`http://127.0.0.1:${port}/mcp`), port }
}

beforeEach(() => {
  vi.clearAllMocks()
  appConfig = {
    mcpEnabled: true,
    mcpAllowWrites: false,
    mcpToken: 'mcp-secret',
    core: 'mihomo',
    sysProxy: { enable: true, password: 'proxy-secret' },
    webdavPassword: 'webdav-secret'
  }
  profileConfig = { current: 'remote', items: [{ ...remoteProfile }, { ...localProfile }] }
  backend.getAppConfig.mockImplementation(async () => appConfig)
  backend.getProfileConfig.mockImplementation(async () => structuredClone(profileConfig))
  backend.updateProfileConfig.mockImplementation(async (update) => {
    profileConfig = await update(structuredClone(profileConfig))
    return structuredClone(profileConfig)
  })
  backend.getControledMihomoConfig.mockResolvedValue({
    mode: 'rule',
    tun: { enable: true },
    secret: 'core-secret',
    authentication: ['user:password']
  })
  backend.showMessageBox.mockResolvedValue({ response: 1 })
  backend.mihomoGroups.mockResolvedValue([
    {
      name: 'PROXY',
      type: 'Selector',
      now: 'Node',
      hidden: false,
      all: [
        {
          name: 'Node',
          type: 'Shadowsocks',
          alive: true,
          history: [{ delay: 10 }],
          password: 'node-secret'
        }
      ],
      testUrl: 'https://endpoint.invalid/private-token'
    }
  ])
  backend.mihomoVersion.mockResolvedValue({ version: 'test-core', meta: true, secret: 'hidden' })
  backend.mihomoRules.mockResolvedValue({
    rules: [{ index: 0, type: 'MATCH', payload: '', proxy: 'PROXY' }]
  })
  backend.mihomoProxyProviders.mockResolvedValue({
    providers: {
      Provider: { type: 'Proxy', vehicleType: 'HTTP', proxies: [], url: remoteProfile.url }
    }
  })
  backend.mihomoRuleProviders.mockResolvedValue({ providers: {} })
  backend.mihomoProxyDelay.mockResolvedValue({ delay: 15 })
  backend.getLocalNode.mockResolvedValue({
    name: 'Node',
    type: 'ss',
    server: 'proxy.invalid',
    port: 443,
    cipher: 'aes-128-gcm',
    password: 'node-secret',
    'private-key': '/private/key',
    uuid: 'uuid-secret'
  })
  backend.getLocalProxyGroup.mockResolvedValue({
    group: {
      name: 'PROXY',
      type: 'select',
      proxies: ['Node'],
      icon: 'https://hidden.invalid/token'
    },
    outbounds: ['Node', 'DIRECT']
  })
  backend.getLocalRulesEditor.mockResolvedValue({
    rules: ['MATCH,PROXY'],
    outbounds: ['PROXY', 'DIRECT']
  })
  backend.withLocalProfileScope.mockImplementation((_id, run) => run())
})

afterEach(async () => {
  for (const { client, server } of sessions.splice(0)) {
    await client.close()
    await server.close()
  }
  for (const server of httpServers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  const { stopMcpServer } = await import('./index')
  await stopMcpServer()
})

describe('explicit MCP tools and security boundary', () => {
  it('advertises strict business tools without IPC dispatch or raw config access', async () => {
    const client = await connect()
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name)).toContain('edit_local_node')
    expect(tools.map((tool) => tool.name)).toContain('edit_local_rule')
    for (const forbidden of [
      'call',
      'list_capabilities',
      'patchAppConfig',
      'importMcpAgent',
      'getProfileStr',
      'setOverride'
    ]) {
      expect(tools.map((tool) => tool.name)).not.toContain(forbidden)
    }
    for (const tool of tools) expect(tool.inputSchema.additionalProperties).toBe(false)
    expect(
      (await call(client, 'call', { method: 'patchAppConfig', args: [{ mcpAllowWrites: true }] }))
        .isError
    ).toBe(true)
  })

  it('returns only allowlisted state/profile/provider fields in text AND structured content', async () => {
    const client = await connect()
    for (const [tool, args] of [
      ['get_state', {}],
      ['list_profiles', {}],
      ['list_proxy_groups', {}],
      ['list_group_members', { group: 'PROXY' }],
      ['list_providers', { kind: 'proxy' }]
    ] as const) {
      const output = await call(client, tool, args)
      expect(output.isError).not.toBe(true)
      for (const secret of [
        'url-secret',
        'auth-secret',
        'age-secret',
        'proxy-secret',
        'node-secret',
        'core-secret',
        'webdav-secret',
        'path-secret',
        'private-token',
        'user:password'
      ]) {
        expect(JSON.stringify(output)).not.toContain(secret)
      }
    }
  })

  it.each(['restart_core', 'reload_config', 'close_connections'])(
    'blocks %s by default before showing a dialog',
    async (name) => {
      const output = await call(await connect(), name)
      expect(errorCode(output)).toBe('READ_ONLY')
      expect(backend.showMessageBox).not.toHaveBeenCalled()
      expect(backend.restartCore).not.toHaveBeenCalled()
      expect(backend.mihomoHotReloadConfig).not.toHaveBeenCalled()
      expect(backend.mihomoCloseAllConnections).not.toHaveBeenCalled()
    }
  )

  it.each(['confirm', 'autoApprove', 'mcpAutoApprove'])(
    'does not accept client-supplied %s as local consent',
    async (field) => {
      appConfig.mcpAllowWrites = true
      const result = await call(await connect(), 'restart_core', { [field]: true })
      expect(result.isError).toBe(true)
      expect(backend.showMessageBox).not.toHaveBeenCalled()
      expect(backend.restartCore).not.toHaveBeenCalled()
    }
  )

  it('requires a local decision with cancel selected by default', async () => {
    appConfig.mcpAllowWrites = true
    backend.showMessageBox.mockResolvedValueOnce({ response: 0 })
    const result = await call(await connect(), 'restart_core')
    expect(errorCode(result)).toBe('USER_DENIED')
    expect(backend.restartCore).not.toHaveBeenCalled()
    expect(backend.showMessageBox.mock.calls[0].at(-1)).toMatchObject({ defaultId: 0, cancelId: 0 })
  })

  it('executes an approved operation and refreshes the frontend', async () => {
    appConfig.mcpAllowWrites = true
    const output = await call(await connect(), 'select_profile', { profileId: 'local' })
    expect(output.isError).not.toBe(true)
    expect(backend.changeCurrentProfile).toHaveBeenCalledWith('local')
    expect(backend.send.mock.calls).toEqual([
      ['profileConfigUpdated'],
      ['groupsUpdated'],
      ['rulesUpdated']
    ])
    expect(backend.info).toHaveBeenCalledWith('Tool select_profile completed')
  })

  it.each([undefined, false, 'true', 1])(
    'requires local confirmation unless auto-approval is explicitly true: %s',
    async (setting) => {
      Object.assign(appConfig, { mcpAllowWrites: true, mcpAutoApprove: setting })
      const client = await connect()
      expect(value(await call(client, 'get_state')).permissions).toMatchObject({
        localConfirmationRequired: true
      })
      expect((await call(client, 'restart_core')).isError).not.toBe(true)
      expect(backend.showMessageBox).toHaveBeenCalledOnce()
      expect(backend.restartCore).toHaveBeenCalledOnce()
    }
  )

  it('runs writes without a dialog only when local settings allow automatic approval', async () => {
    Object.assign(appConfig, { mcpAllowWrites: true, mcpAutoApprove: true })
    const client = await connect('mcp-secret')
    expect(value(await call(client, 'get_state')).permissions).toEqual({
      allowWrites: true,
      localConfirmationRequired: false
    })
    expect((await call(client, 'select_profile', { profileId: 'local' })).isError).not.toBe(true)
    expect(backend.changeCurrentProfile).toHaveBeenCalledWith('local')
    expect(backend.showMessageBox).not.toHaveBeenCalled()
    expect(backend.send).toHaveBeenCalledWith('profileConfigUpdated')
    expect(backend.info).toHaveBeenCalledWith('Tool select_profile completed')
  })

  it('does not grant write permission through automatic approval alone', async () => {
    appConfig.mcpAutoApprove = true
    expect(errorCode(await call(await connect(), 'restart_core'))).toBe('READ_ONLY')
    expect(backend.restartCore).not.toHaveBeenCalled()
    expect(backend.showMessageBox).not.toHaveBeenCalled()
  })

  it('restores local confirmation for an existing client after automatic approval is disabled', async () => {
    Object.assign(appConfig, { mcpAllowWrites: true, mcpAutoApprove: true })
    const client = await connect('mcp-secret')
    expect((await call(client, 'restart_core')).isError).not.toBe(true)
    appConfig.mcpAutoApprove = false
    backend.showMessageBox.mockResolvedValueOnce({ response: 0 })
    expect(errorCode(await call(client, 'restart_core'))).toBe('USER_DENIED')
    expect(backend.restartCore).toHaveBeenCalledOnce()
    expect(backend.showMessageBox).toHaveBeenCalledOnce()
    expect(value(await call(client, 'get_state')).permissions).toMatchObject({
      localConfirmationRequired: true
    })
  })

  it.each([
    ['mcpAutoApprove', false, 'APPROVAL_REQUIRED'],
    ['mcpAllowWrites', false, 'READ_ONLY'],
    ['mcpEnabled', false, 'READ_ONLY'],
    ['mcpToken', 'rotated', 'UNAUTHORIZED']
  ])('rechecks %s before an automatically approved operation starts', async (field, next, code) => {
    Object.assign(appConfig, { mcpAllowWrites: true, mcpAutoApprove: true })
    const granted = { ...appConfig }
    backend.getAppConfig
      .mockResolvedValueOnce(granted) // Initial write permission.
      .mockResolvedValueOnce(granted) // Confirmation policy after preparing the operation.
      .mockResolvedValueOnce({ ...granted, [field]: next }) // Execution permission.
    expect(errorCode(await call(await connect(), 'restart_core'))).toBe(code)
    expect(backend.restartCore).not.toHaveBeenCalled()
    expect(backend.showMessageBox).not.toHaveBeenCalled()
    // A rejected operation must release the mutation lock.
    expect((await call(await connect(), 'restart_core')).isError).not.toBe(true)
    expect(backend.restartCore).toHaveBeenCalledOnce()
  })

  it.each([false, true])(
    'checks cancellation after reading the confirmation policy (auto-approval=%s)',
    async (autoApprove) => {
      Object.assign(appConfig, { mcpAllowWrites: true, mcpAutoApprove: autoApprove })
      const controller = new AbortController()
      const client = await connect(undefined, controller.signal)
      backend.getAppConfig.mockResolvedValueOnce(appConfig).mockImplementationOnce(async () => {
        controller.abort()
        return appConfig
      })
      expect(errorCode(await call(client, 'restart_core'))).toBe('CANCELLED')
      expect(backend.restartCore).not.toHaveBeenCalled()
      expect(backend.showMessageBox).not.toHaveBeenCalled()
    }
  )

  it('checks cancellation after the final automatic-approval permission read', async () => {
    Object.assign(appConfig, { mcpAllowWrites: true, mcpAutoApprove: true })
    const controller = new AbortController()
    const client = await connect(undefined, controller.signal)
    backend.getAppConfig
      .mockResolvedValueOnce(appConfig)
      .mockResolvedValueOnce(appConfig)
      .mockImplementationOnce(async () => {
        controller.abort()
        return appConfig
      })
    expect(errorCode(await call(client, 'restart_core'))).toBe('CANCELLED')
    expect(backend.restartCore).not.toHaveBeenCalled()
    expect(backend.showMessageBox).not.toHaveBeenCalled()
  })

  it('preserves serialization across clients in automatic-approval mode', async () => {
    Object.assign(appConfig, { mcpAllowWrites: true, mcpAutoApprove: true })
    let finish!: () => void
    backend.restartCore.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const first = await connect()
    const second = await connect()
    const pending = call(first, 'restart_core')
    await vi.waitFor(() => expect(backend.restartCore).toHaveBeenCalledOnce())
    try {
      expect(errorCode(await call(second, 'restart_core'))).toBe('BUSY')
    } finally {
      finish()
      expect((await pending).isError).not.toBe(true)
    }
    expect(backend.showMessageBox).not.toHaveBeenCalled()
  })

  it.each(['mcpAllowWrites', 'mcpEnabled'])(
    'rechecks %s after local confirmation',
    async (field) => {
      appConfig.mcpAllowWrites = true
      backend.showMessageBox.mockImplementationOnce(async () => {
        appConfig[field] = false
        return { response: 1 }
      })
      const output = await call(await connect(), 'restart_core')
      expect(errorCode(output)).toBe('READ_ONLY')
      expect(backend.restartCore).not.toHaveBeenCalled()
    }
  )

  it('rejects token rotation during approval', async () => {
    appConfig.mcpAllowWrites = true
    backend.showMessageBox.mockImplementationOnce(async () => {
      appConfig.mcpToken = 'rotated'
      return { response: 1 }
    })
    expect(errorCode(await call(await connect(), 'restart_core'))).toBe('UNAUTHORIZED')
    expect(backend.restartCore).not.toHaveBeenCalled()
  })

  it('revokes tools on previously authenticated transports when MCP is disabled', async () => {
    const client = await connect('mcp-secret')
    appConfig.mcpEnabled = false
    expect(errorCode(await call(client, 'get_state'))).toBe('UNAUTHORIZED')
  })

  it('serializes approvals across separate stateless server instances', async () => {
    appConfig.mcpAllowWrites = true
    let approve!: (decision: { response: number }) => void
    backend.showMessageBox.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          approve = resolve
        })
    )
    const first = await connect()
    const second = await connect()
    const pending = call(first, 'restart_core')
    await vi.waitFor(() => expect(backend.showMessageBox).toHaveBeenCalledOnce())
    try {
      const output = await call(second, 'restart_core')
      expect(errorCode(output)).toBe('BUSY')
      expect(backend.showMessageBox).toHaveBeenCalledOnce()
    } finally {
      approve({ response: 1 })
      await pending
    }
    expect(backend.restartCore).toHaveBeenCalledOnce()
    expect((await call(second, 'restart_core')).isError).not.toBe(true)
  })

  it('does not execute a cancelled request even if the local dialog is later approved', async () => {
    appConfig.mcpAllowWrites = true
    let approve!: (decision: { response: number }) => void
    backend.showMessageBox.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          approve = resolve
        })
    )
    const client = await connect()
    const controller = new AbortController()
    const pending = client.callTool({ name: 'restart_core', arguments: {} }, undefined, {
      signal: controller.signal
    })
    const rejected = expect(pending).rejects.toThrow()
    await vi.waitFor(() => expect(backend.showMessageBox).toHaveBeenCalledOnce())
    controller.abort()
    await rejected
    approve({ response: 1 })
    await vi.waitFor(() =>
      expect(backend.warn).toHaveBeenCalledWith('Tool restart_core failed code=CANCELLED')
    )
    expect(backend.restartCore).not.toHaveBeenCalled()
  })

  it('fails closed when the local confirmation dialog cannot be displayed', async () => {
    appConfig.mcpAllowWrites = true
    backend.showMessageBox.mockRejectedValueOnce(new Error('private-app-state'))
    const output = await call(await connect(), 'restart_core')
    expect(errorCode(output)).toBe('APPROVAL_UNAVAILABLE')
    expect(JSON.stringify(output)).not.toContain('private-app-state')
    expect(backend.restartCore).not.toHaveBeenCalled()
  })

  it.each([
    ['select_profile', { profileId: '../../secret' }],
    ['select_profile', { profileId: '/tmp/file' }],
    ['select_profile', { profileId: 'bad\nid' }],
    ['set_proxy_mode', { mode: 'rule', 'external-controller': '0.0.0.0:9090' }],
    ['set_proxy_mode', { mode: 'arbitrary' }],
    ['test_proxy_delay', { group: 'PROXY', proxy: 'Node', url: 'http://169.254.169.254/' }],
    [
      'edit_profile',
      { profileId: 'remote', revision: 'a'.repeat(64), patch: { url: 'http://127.0.0.1/' } }
    ],
    [
      'edit_profile',
      { profileId: 'remote', revision: 'a'.repeat(64), patch: { mcpAllowWrites: true } }
    ],
    [
      'edit_profile',
      { profileId: 'remote', revision: 'a'.repeat(64), patch: { mcpAutoApprove: true } }
    ],
    [
      'edit_local_node',
      {
        profileId: 'local',
        name: 'Node',
        revision: 'a'.repeat(64),
        patch: { 'private-key': '/etc/passwd' }
      }
    ],
    [
      'edit_local_group',
      {
        profileId: 'local',
        name: 'PROXY',
        revision: 'a'.repeat(64),
        patch: { url: 'http://internal/' }
      }
    ],
    [
      'edit_local_node',
      { profileId: 'local', name: 'Node', revision: 'a'.repeat(64), patch: { port: 65536 } }
    ],
    [
      'edit_local_group',
      {
        profileId: 'local',
        name: 'PROXY',
        revision: 'a'.repeat(64),
        patch: { proxies: ['Node', 'Node'] }
      }
    ],
    ['list_profiles', { limit: 201 }],
    ['list_profiles', { offset: -1 }]
  ])('rejects malformed or excessive arguments to %s', async (tool, args) => {
    appConfig.mcpAllowWrites = true
    expect((await call(await connect(), tool, args)).isError).toBe(true)
    expect(backend.showMessageBox).not.toHaveBeenCalled()
    expect(backend.saveLocalNode).not.toHaveBeenCalled()
    expect(backend.patchControledMihomoConfig).not.toHaveBeenCalled()
  })

  it('validates group membership and rule/provider targets', async () => {
    appConfig.mcpAllowWrites = true
    const client = await connect()
    expect(
      errorCode(await call(client, 'select_proxy', { group: 'PROXY', proxy: 'not-member' }))
    ).toBe('INVALID_ARGUMENT')
    expect(errorCode(await call(client, 'select_proxy', { group: 'missing', proxy: 'Node' }))).toBe(
      'NOT_FOUND'
    )
    const revision = value(await call(client, 'list_rules')).revision
    expect(
      errorCode(await call(client, 'set_rule_enabled', { index: 4, enabled: false, revision }))
    ).toBe('NOT_FOUND')
    expect(
      errorCode(await call(client, 'update_provider', { kind: 'proxy', name: '__proto__' }))
    ).toBe('NOT_FOUND')
    expect(backend.mihomoChangeProxy).not.toHaveBeenCalled()
    expect(backend.mihomoRulesDisable).not.toHaveBeenCalled()
    expect(backend.mihomoUpdateProxyProviders).not.toHaveBeenCalled()
  })

  it.each(['profile', 'rule'])('rejects a changed runtime %s after approval', async (kind) => {
    appConfig.mcpAllowWrites = true
    const client = await connect()
    const revision = value(await call(client, 'list_rules')).revision
    backend.showMessageBox.mockImplementationOnce(async () => {
      if (kind === 'profile') profileConfig.current = 'local'
      else
        backend.mihomoRules.mockResolvedValue({
          rules: [{ index: 0, type: 'DOMAIN', payload: 'changed.example', proxy: 'DIRECT' }]
        })
      return { response: 1 }
    })
    const output = await call(client, 'set_rule_enabled', { index: 0, enabled: false, revision })
    expect(errorCode(output)).toBe('CONFLICT')
    expect(backend.mihomoRulesDisable).not.toHaveBeenCalled()
  })

  it('displays the reviewed runtime rule and ignores hit-counter changes in its revision', async () => {
    appConfig.mcpAllowWrites = true
    const client = await connect()
    const revision = value(await call(client, 'list_rules')).revision
    backend.showMessageBox.mockImplementationOnce(async () => {
      backend.mihomoRules.mockResolvedValue({
        rules: [
          {
            index: 0,
            type: 'MATCH',
            payload: '',
            proxy: 'PROXY',
            extra: { disabled: false, hitCount: 99 }
          }
        ]
      })
      return { response: 1 }
    })
    expect(
      (await call(client, 'set_rule_enabled', { index: 0, enabled: false, revision })).isError
    ).not.toBe(true)
    expect(backend.mihomoRulesDisable).toHaveBeenCalledWith({ '0': true })
    expect(backend.showMessageBox.mock.calls[0].at(-1).detail).toContain('"type":"MATCH"')
  })

  it('uses only the saved delay endpoint and only returns delay', async () => {
    const result = await call(await connect(), 'test_proxy_delay', {
      group: 'PROXY',
      proxy: 'Node'
    })
    expect(value(result)).toEqual({ delay: 15 })
    expect(backend.mihomoProxyDelay).toHaveBeenCalledWith('Node', undefined, undefined)
  })

  it('does not pass nested secret objects through public scalar fields', async () => {
    profileConfig.items[0].name = { password: 'nested-secret' }
    backend.mihomoVersion.mockResolvedValueOnce({
      version: { privateKey: 'nested-secret' },
      meta: true
    })
    const client = await connect()
    for (const name of ['get_state', 'list_profiles', 'get_core_version']) {
      expect(JSON.stringify(await call(client, name))).not.toContain('nested-secret')
    }
  })

  it.each([
    ['ETIMEDOUT', 'TIMEOUT'],
    ['ENOTFOUND', 'NETWORK_ERROR'],
    ['ECONNREFUSED', 'CORE_UNAVAILABLE'],
    ['EACCES', 'PERMISSION_DENIED'],
    ['UNEXPECTED', 'BACKEND_ERROR']
  ])('returns a clear %s error without leaking backend details', async (code, expected) => {
    appConfig.mcpAllowWrites = true
    backend.restartCore.mockRejectedValueOnce(
      Object.assign(new Error(remoteProfile.url), {
        code,
        config: { url: remoteProfile.url },
        stack: '/home/private-path'
      })
    )
    const output = await call(await connect(), 'restart_core')
    expect(errorCode(output)).toBe(expected)
    expect(JSON.stringify(output)).not.toContain('url-secret')
    expect(JSON.stringify(output)).not.toContain('private-path')
    expect(JSON.stringify(backend.warn.mock.calls)).not.toContain('url-secret')
  })

  it('enforces the output cap on structured content as well as text', async () => {
    backend.mihomoRules.mockResolvedValueOnce({
      rules: [
        {
          index: 0,
          payload: 'sensitive'.repeat(150000),
          type: 'DOMAIN',
          proxy: 'DIRECT'
        }
      ]
    })
    const output = await call(await connect(), 'list_rules')
    expect(output.isError).toBe(true)
    expect(JSON.stringify(output)).not.toContain('sensitive')
    expect(JSON.stringify(output).length).toBeLessThan(1024)
  })
})

describe('MCP editing and stale changes', () => {
  it('edits profile metadata atomically without touching credentials', async () => {
    appConfig.mcpAllowWrites = true
    const client = await connect()
    const { items } = value(await call(client, 'list_profiles')) as {
      items: { revision: string }[]
    }
    const output = await call(client, 'edit_profile', {
      profileId: 'remote',
      revision: items[0].revision,
      patch: { name: 'Renamed', interval: 120 }
    })
    expect(output.isError).not.toBe(true)
    expect(profileConfig.items[0]).toMatchObject({
      ...remoteProfile,
      name: 'Renamed',
      interval: 120
    })
    expect(backend.addProfileUpdater).toHaveBeenCalledOnce()
    expect(backend.updateProfileConfig).toHaveBeenCalledOnce()
  })

  it('detects profile changes made while waiting for confirmation', async () => {
    appConfig.mcpAllowWrites = true
    const client = await connect()
    const { items } = value(await call(client, 'list_profiles')) as {
      items: { revision: string }[]
    }
    backend.showMessageBox.mockImplementationOnce(async () => {
      profileConfig.items[0].updated = 2
      return { response: 1 }
    })
    const output = await call(client, 'edit_profile', {
      profileId: 'remote',
      revision: items[0].revision,
      patch: { name: 'Renamed' }
    })
    expect(errorCode(output)).toBe('CONFLICT')
    expect(profileConfig.items[0].name).toBe('Subscription')
    expect(backend.addProfileUpdater).not.toHaveBeenCalled()
  })

  it('reads node metadata without credentials and updates supported write-only fields', async () => {
    appConfig.mcpAllowWrites = true
    profileConfig.current = 'local'
    const client = await connect()
    const node = await call(client, 'get_local_node', { profileId: 'local', name: 'Node' })
    expect(JSON.stringify(node)).not.toContain('node-secret')
    expect(JSON.stringify(node)).not.toContain('/private/key')
    expect(JSON.stringify(node)).not.toContain('uuid-secret')
    const output = await call(client, 'edit_local_node', {
      profileId: 'local',
      name: 'Node',
      revision: value(node).revision,
      patch: { port: 8443, password: 'new-secret' }
    })
    expect(output.isError).not.toBe(true)
    expect(backend.saveLocalNode).toHaveBeenCalledWith(
      'Node',
      expect.objectContaining({ port: 8443, password: 'new-secret' }),
      expect.objectContaining({ port: 443, password: 'node-secret' })
    )
    expect(JSON.stringify(output)).not.toContain('new-secret')
    expect(JSON.stringify(backend.showMessageBox.mock.calls)).not.toContain('new-secret')
    expect(backend.withLocalProfileScope).toHaveBeenCalledWith('local', expect.any(Function))
  })

  it('blocks unsupported node fields and stale node revisions', async () => {
    appConfig.mcpAllowWrites = true
    profileConfig.current = 'local'
    const client = await connect()
    const revision = value(
      await call(client, 'get_local_node', { profileId: 'local', name: 'Node' })
    ).revision
    const unsupported = await call(client, 'edit_local_node', {
      profileId: 'local',
      name: 'Node',
      revision,
      patch: { uuid: '00000000-0000-4000-8000-000000000000' }
    })
    expect(errorCode(unsupported)).toBe('INVALID_ARGUMENT')
    const stale = await call(client, 'edit_local_node', {
      profileId: 'local',
      name: 'Node',
      revision: 'a'.repeat(64),
      patch: { name: 'New' }
    })
    expect(errorCode(stale)).toBe('CONFLICT')
    expect(backend.saveLocalNode).not.toHaveBeenCalled()
  })

  it.each([
    ['节点 Node 已被修改', 'CONFLICT'],
    ['找不到节点：Node', 'NOT_FOUND'],
    ['节点名称已存在：Node', 'DUPLICATE_NAME'],
    ['代理组循环引用: a → b', 'VALIDATION_FAILED'],
    ['应用失败，已恢复原配置: secret', 'APPLY_FAILED_ROLLED_BACK'],
    ['恢复配置或内核失败: secret', 'ROLLBACK_FAILED']
  ])('reports editor errors safely: %s', async (message, code) => {
    appConfig.mcpAllowWrites = true
    profileConfig.current = 'local'
    const client = await connect()
    const revision = value(
      await call(client, 'get_local_node', { profileId: 'local', name: 'Node' })
    ).revision
    backend.saveLocalNode.mockRejectedValueOnce(new Error(message))
    const output = await call(client, 'edit_local_node', {
      profileId: 'local',
      name: 'Node',
      revision,
      patch: { port: 8443 }
    })
    expect(errorCode(output)).toBe(code)
    expect(JSON.stringify(output)).not.toContain('secret')
  })

  it('rejects a UI profile switch during local edit confirmation', async () => {
    appConfig.mcpAllowWrites = true
    profileConfig.current = 'local'
    const client = await connect()
    const revision = value(
      await call(client, 'get_local_node', { profileId: 'local', name: 'Node' })
    ).revision
    backend.showMessageBox.mockImplementationOnce(async () => {
      profileConfig.current = 'remote'
      return { response: 1 }
    })
    const output = await call(client, 'edit_local_node', {
      profileId: 'local',
      name: 'Node',
      revision,
      patch: { name: 'New' }
    })
    expect(errorCode(output)).toBe('CONFLICT')
    expect(backend.saveLocalNode).not.toHaveBeenCalled()
  })

  it('binds revision tokens to a local profile even with identical nodes', async () => {
    appConfig.mcpAllowWrites = true
    profileConfig.current = 'local'
    profileConfig.items.push({ ...localProfile, id: 'other' })
    const client = await connect()
    const revision = value(
      await call(client, 'get_local_node', { profileId: 'local', name: 'Node' })
    ).revision
    profileConfig.current = 'other'
    const output = await call(client, 'edit_local_node', {
      profileId: 'other',
      name: 'Node',
      revision,
      patch: { name: 'New' }
    })
    expect(errorCode(output)).toBe('CONFLICT')
    expect(backend.saveLocalNode).not.toHaveBeenCalled()
  })

  it('restricts group members to existing outbounds and preserves unrelated fields', async () => {
    appConfig.mcpAllowWrites = true
    profileConfig.current = 'local'
    const client = await connect()
    const group = await call(client, 'get_local_group', { profileId: 'local', name: 'PROXY' })
    const revision = value(group).revision
    expect(JSON.stringify(group)).not.toContain('https://hidden')
    expect(
      errorCode(
        await call(client, 'edit_local_group', {
          profileId: 'local',
          name: 'PROXY',
          revision,
          patch: { proxies: ['PROXY'] }
        })
      )
    ).toBe('INVALID_ARGUMENT')
    expect(backend.saveLocalProxyGroup).not.toHaveBeenCalled()
    expect(
      (
        await call(client, 'edit_local_group', {
          profileId: 'local',
          name: 'PROXY',
          revision,
          patch: { proxies: ['DIRECT'] }
        })
      ).isError
    ).not.toBe(true)
    expect(backend.saveLocalProxyGroup).toHaveBeenCalledWith(
      'PROXY',
      expect.objectContaining({
        proxies: ['DIRECT'],
        type: 'select',
        icon: 'https://hidden.invalid/token'
      }),
      expect.objectContaining({ proxies: ['Node'] })
    )
  })

  it('builds a single structured rule and uses the existing optimistic editor', async () => {
    appConfig.mcpAllowWrites = true
    profileConfig.current = 'local'
    const client = await connect()
    const revision = value(await call(client, 'list_local_rules', { profileId: 'local' })).revision
    const output = await call(client, 'edit_local_rule', {
      profileId: 'local',
      revision,
      action: 'add',
      index: 0,
      rule: { type: 'DOMAIN-SUFFIX', payload: 'example.com', target: 'DIRECT' }
    })
    expect(output.isError).not.toBe(true)
    expect(backend.saveLocalRules).toHaveBeenCalledWith(
      {
        action: 'add',
        index: 0,
        value: 'DOMAIN-SUFFIX,example.com,DIRECT'
      },
      ['MATCH,PROXY']
    )
  })

  it.each([
    {
      action: 'add',
      rule: { type: 'DOMAIN', payload: 'x,DIRECT\nMATCH,REJECT', target: 'DIRECT' }
    },
    { action: 'add', rule: { type: 'MATCH', payload: 'x', target: 'DIRECT' } },
    { action: 'add' },
    { action: 'remove', rule: { type: 'MATCH', target: 'DIRECT' } },
    {
      action: 'add',
      rule: { type: 'DOMAIN', payload: 'example.com', target: 'DIRECT', noResolve: true }
    },
    { action: 'add', rule: { type: 'SCRIPT', payload: 'exec()', target: 'DIRECT' } }
  ])('rejects malformed structured rules: %j', async (rule) => {
    appConfig.mcpAllowWrites = true
    profileConfig.current = 'local'
    const result = await call(await connect(), 'edit_local_rule', {
      profileId: 'local',
      revision: 'a'.repeat(64),
      index: 0,
      ...rule
    })
    expect(result.isError).toBe(true)
    expect(backend.saveLocalRules).not.toHaveBeenCalled()
    expect(backend.showMessageBox).not.toHaveBeenCalled()
  })
})

describe('real HTTP MCP transport', () => {
  it('initializes an external SDK client, lists tools, reads and performs an approved operation', async () => {
    appConfig.mcpAllowWrites = true
    const { url } = await httpEndpoint()
    const client = new Client({ name: 'http-client', version: '1.0.0' })
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: 'Bearer mcp-secret' } }
    })
    try {
      await client.connect(transport)
      expect((await client.listTools()).tools.length).toBeGreaterThan(20)
      expect((await call(client, 'get_state')).isError).not.toBe(true)
      const profiles = value(await call(client, 'list_profiles')).items as {
        id: string
        revision: string
      }[]
      expect(
        (
          await call(client, 'edit_profile', {
            profileId: profiles[0].id,
            revision: profiles[0].revision,
            patch: { name: 'HTTP Updated' }
          })
        ).isError
      ).not.toBe(true)
      expect(profileConfig.items[0].name).toBe('HTTP Updated')
      expect((await call(client, 'restart_core')).isError).not.toBe(true)
      expect(backend.restartCore).toHaveBeenCalledOnce()
    } finally {
      await client.close()
    }
  })

  it.each([
    [{ Authorization: 'Bearer wrong' }, 401],
    [{}, 401],
    [{ Authorization: 'Bearer mcp-secret', Origin: 'https://evil.example' }, 403],
    [{ Authorization: 'Bearer mcp-secret', Origin: 'null' }, 403],
    [{ Authorization: 'Bearer mcp-secret', Host: 'attacker.invalid' }, 403]
  ])('rejects unauthenticated/browser/rebinding HTTP requests', async (headers, status) => {
    const { url } = await httpEndpoint()
    const statusCode = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers }
        },
        (res) => {
          res.resume()
          res.on('end', () => resolve(res.statusCode))
        }
      )
      req.on('error', reject)
      req.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'restart_core' }
        })
      )
    })
    expect(statusCode).toBe(status)
    expect(backend.restartCore).not.toHaveBeenCalled()
    expect(backend.showMessageBox).not.toHaveBeenCalled()
  })

  it('rejects invalid JSON and oversized bodies without leaking request content', async () => {
    const { url } = await httpEndpoint()
    for (const body of ['not-json-secret', JSON.stringify({ secret: 'x'.repeat(1024 * 1024) })]) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: 'Bearer mcp-secret', 'Content-Type': 'application/json' },
        body
      })
      expect([400, 413]).toContain(response.status)
      expect(await response.text()).not.toContain('not-json-secret')
    }
  })

  it('returns an explicit 413 for a chunked request without Content-Length', async () => {
    const { url } = await httpEndpoint()
    const output = await new Promise<{ status?: number; text: string }>((resolve, reject) => {
      const req = request(
        url,
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer mcp-secret',
            'Content-Type': 'application/json',
            'Transfer-Encoding': 'chunked'
          }
        },
        (res) => {
          let text = ''
          res.on('data', (chunk) => {
            text += chunk
          })
          res.on('end', () => resolve({ status: res.statusCode, text }))
        }
      )
      req.on('error', reject)
      for (let i = 0; i < 17; i++) req.write('x'.repeat(65536))
      req.end()
    })
    expect(output.status).toBe(413)
    expect(output.text).toContain('MCP request is too large')
    expect(backend.showMessageBox).not.toHaveBeenCalled()
  })

  it('limits unfinished HTTP requests in the production listener and shuts down promptly', async () => {
    const { url } = await httpEndpoint(true)
    const pending: ReturnType<typeof request>[] = []
    try {
      for (let i = 0; i < 16; i++) {
        const req = request(url, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer mcp-secret',
            'Content-Type': 'application/json',
            'Content-Length': '10'
          }
        })
        req.on('error', () => undefined)
        pending.push(req)
        await new Promise<void>((resolve) => {
          req.once('socket', (socket) => socket.once('connect', resolve))
          req.flushHeaders()
        })
      }
      await vi.waitFor(async () => {
        const response = await fetch(url)
        expect(response.status).toBe(429)
        await response.text()
      })
      const { stopMcpServer } = await import('./index')
      await stopMcpServer()
      expect(backend.showMessageBox).not.toHaveBeenCalled()
    } finally {
      for (const req of pending) req.destroy()
    }
  })

  it('does not execute a disconnected HTTP request after the local user approves', async () => {
    appConfig.mcpAllowWrites = true
    let approve!: (decision: { response: number }) => void
    backend.showMessageBox.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          approve = resolve
        })
    )
    const { url } = await httpEndpoint()
    const req = request(url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer mcp-secret',
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream'
      }
    })
    req.on('error', () => undefined)
    req.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'restart_core', arguments: {} }
      })
    )
    await vi.waitFor(() => expect(backend.showMessageBox).toHaveBeenCalledOnce())
    req.destroy()
    await new Promise<void>((resolve) => req.once('close', resolve))
    // Allow the server's socket-close event to be observed before resolving the native dialog.
    await new Promise<void>((resolve) => setImmediate(resolve))
    approve({ response: 1 })
    await vi.waitFor(() =>
      expect(backend.warn).toHaveBeenCalledWith('Tool restart_core failed code=CANCELLED')
    )
    expect(backend.restartCore).not.toHaveBeenCalled()
  })
})
