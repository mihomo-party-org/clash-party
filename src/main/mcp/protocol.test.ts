import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeIpcHandler = vi.fn()
const refreshFrontend = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({ app: { getVersion: () => 'test' } }))
vi.mock('../window', () => ({
  mainWindow: {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: refreshFrontend
    }
  }
}))
vi.mock('../config', () => ({
  getAppConfig: vi.fn().mockResolvedValue({}),
  getControledMihomoConfig: vi.fn().mockResolvedValue({}),
  getCurrentProfileItem: vi.fn().mockResolvedValue({ id: 'default' }),
  getProfileConfig: vi.fn().mockResolvedValue({ items: [] })
}))
vi.mock('../utils/ipc', () => ({
  invokeIpcHandler: (...args: unknown[]) => invokeIpcHandler(...args),
  ipcHandlerRequiresConfirmation: () => false,
  mcpCapabilities: [
    { name: 'restartCore', kind: 'async', requiresConfirmation: false },
    { name: 'changeCurrentProfile', kind: 'async', requiresConfirmation: false },
    { name: 'mihomoVersion', kind: 'async', requiresConfirmation: false }
  ]
}))
vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}))

describe('MCP protocol surface', () => {
  beforeEach(() => {
    invokeIpcHandler.mockReset().mockResolvedValue(undefined)
    refreshFrontend.mockReset()
  })

  it('advertises standard tools and returns text plus structured content', async () => {
    const { createMcpServer } = await import('./index')
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const server = createMcpServer()
    const client = new Client({ name: 'test-client', version: '1.0.0' }, {})

    await server.connect(serverTransport)
    await client.connect(clientTransport)

    const tools = await client.listTools()
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      'list_capabilities',
      'get_state',
      'restart_core',
      'call'
    ])

    const result = await client.callTool({
      name: 'call',
      arguments: { method: 'restartCore', args: [] }
    })
    expect(result.isError).not.toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'success' }])
    expect(result.structuredContent).toEqual({ result: { success: true } })
    expect(refreshFrontend).not.toHaveBeenCalled()

    const switched = await client.callTool({
      name: 'call',
      arguments: { method: 'changeCurrentProfile', args: ['profile-id'] }
    })
    expect(switched.isError).not.toBe(true)
    expect(refreshFrontend.mock.calls).toEqual([
      ['profileConfigUpdated'],
      ['groupsUpdated'],
      ['rulesUpdated']
    ])

    await client.callTool({
      name: 'call',
      arguments: { method: 'mihomoVersion', args: [] }
    })
    expect(refreshFrontend).toHaveBeenCalledTimes(3)

    await client.close()
    await server.close()
  })

  it('rejects arguments that do not match the capability schema', async () => {
    const { createMcpServer } = await import('./index')
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const server = createMcpServer()
    const client = new Client({ name: 'test-client', version: '1.0.0' }, {})

    await server.connect(serverTransport)
    await client.connect(clientTransport)

    const result = await client.callTool({
      name: 'call',
      arguments: { method: 'restartCore', args: ['unexpected'] }
    })
    expect(result.isError).toBe(true)
    expect(invokeIpcHandler).not.toHaveBeenCalled()

    await client.close()
    await server.close()
  })
})
