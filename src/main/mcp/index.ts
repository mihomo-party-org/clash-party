import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import * as z from 'zod/v4'
import { app } from 'electron'
import {
  getAppConfig,
  getControledMihomoConfig,
  getCurrentProfileItem,
  getProfileConfig
} from '../config'
import { invokeIpcHandler, ipcHandlerRequiresConfirmation, mcpCapabilities } from '../utils/ipc'
import { createLogger } from '../utils/logger'
import { mainWindow } from '../window'
import { hasValidBearerToken, isLoopbackAddress } from './security'

const MCP_PATH = '/mcp'
const DEFAULT_MCP_PORT = 28765
const MAX_REQUEST_BYTES = 1024 * 1024
const mcpLogger = createLogger('MCP')
const sensitiveStateKey = /(?:password|token|secret|privateKey|authToken|authentication)/i
const noArgs = z.tuple([])
const optionalBoolean = z.tuple([z.boolean().optional()])
const optionalString = z.tuple([z.string().min(1).optional()])
const stringArg = z.tuple([z.string().min(1)])
const objectArg = z.tuple([z.record(z.string(), z.unknown())])
const twoStrings = z.tuple([z.string().min(1), z.string().min(1)])
const profileItemArg = z.tuple([
  z.record(z.string(), z.unknown()),
  z.record(z.string(), z.unknown()).optional()
])
const overrideContentArgs = z.tuple([z.string().min(1), z.enum(['js', 'yaml']), z.string()])
const overrideReadArgs = z.tuple([z.string().min(1), z.enum(['js', 'yaml', 'log'])])
const proxyDelayArgs = z.tuple([
  z.string().min(1),
  z.string().min(1).optional(),
  z.string().min(1).optional()
])
const groupDelayArgs = z.tuple([z.string().min(1), z.string().min(1).optional()])
type FrontendRefreshChannel =
  | 'appConfigUpdated'
  | 'controledMihomoConfigUpdated'
  | 'profileConfigUpdated'
  | 'groupsUpdated'
  | 'rulesUpdated'
  | 'localConfigUpdated'
  | 'overrideConfigUpdated'
  | 'proxyProvidersUpdated'
  | 'ruleProvidersUpdated'

const frontendRefreshChannels: Partial<Record<string, FrontendRefreshChannel[]>> = {
  patchAppConfig: ['appConfigUpdated'],
  patchControledMihomoConfig: ['controledMihomoConfigUpdated'],
  setProfileStr: ['localConfigUpdated', 'groupsUpdated', 'rulesUpdated'],
  addProfileItem: ['profileConfigUpdated'],
  removeProfileItem: ['profileConfigUpdated'],
  updateProfileItem: ['profileConfigUpdated'],
  changeCurrentProfile: ['profileConfigUpdated', 'groupsUpdated', 'rulesUpdated'],
  addOverrideItem: ['overrideConfigUpdated'],
  removeOverrideItem: ['overrideConfigUpdated'],
  updateOverrideItem: ['overrideConfigUpdated'],
  setOverride: ['overrideConfigUpdated'],
  setRuleStr: ['rulesUpdated', 'localConfigUpdated'],
  mihomoRulesDisable: ['rulesUpdated'],
  mihomoUpdateProxyProviders: ['proxyProvidersUpdated', 'groupsUpdated'],
  mihomoUpdateRuleProviders: ['ruleProvidersUpdated', 'rulesUpdated'],
  mihomoChangeProxy: ['groupsUpdated'],
  mihomoUnfixedProxy: ['groupsUpdated'],
  patchMihomoConfig: ['groupsUpdated', 'rulesUpdated'],
  mihomoHotReloadConfig: ['groupsUpdated', 'rulesUpdated'],
  mihomoSmartGroupWeights: ['groupsUpdated'],
  mihomoSmartFlushCache: ['groupsUpdated']
}

const mcpArgumentSchemas = {
  getAppConfig: optionalBoolean,
  patchAppConfig: objectArg,
  getControledMihomoConfig: optionalBoolean,
  patchControledMihomoConfig: objectArg,
  setControlDns: z.tuple([z.boolean(), z.string().min(1).optional()]),
  getProfileConfig: optionalBoolean,
  getCurrentProfileItem: noArgs,
  getProfileItem: optionalString,
  getProfileStr: optionalString,
  getProfileImportInfo: objectArg,
  setProfileStr: twoStrings,
  addProfileItem: profileItemArg,
  removeProfileItem: stringArg,
  updateProfileItem: profileItemArg,
  changeCurrentProfile: stringArg,
  getOverrideConfig: optionalBoolean,
  getOverrideItem: optionalString,
  addOverrideItem: objectArg,
  removeOverrideItem: stringArg,
  updateOverrideItem: objectArg,
  getOverride: overrideReadArgs,
  setOverride: overrideContentArgs,
  getRuntimeConfig: noArgs,
  getRuntimeConfigStr: noArgs,
  getRuleStr: stringArg,
  setRuleStr: twoStrings,
  getLocalConfig: noArgs,
  getLocalNode: optionalString,
  getLocalProxyGroup: optionalString,
  getLocalRulesEditor: noArgs,
  previewLocalConfig: noArgs,
  mihomoVersion: noArgs,
  mihomoCloseConnection: stringArg,
  mihomoCloseAllConnections: optionalString,
  mihomoRules: noArgs,
  mihomoRulesDisable: objectArg,
  mihomoProxies: noArgs,
  mihomoGroups: optionalBoolean,
  mihomoProxyProviders: noArgs,
  mihomoUpdateProxyProviders: stringArg,
  mihomoRuleProviders: noArgs,
  mihomoUpdateRuleProviders: stringArg,
  mihomoChangeProxy: twoStrings,
  mihomoUnfixedProxy: stringArg,
  mihomoProxyDelay: proxyDelayArgs,
  mihomoGroupDelay: groupDelayArgs,
  patchMihomoConfig: objectArg,
  mihomoHotReloadConfig: noArgs,
  mihomoSmartGroupWeights: stringArg,
  mihomoSmartFlushCache: optionalString,
  restartCore: noArgs
} as const

function getMcpCapabilityMetadata(): Array<{
  name: string
  kind: 'async' | 'sync'
  requiresConfirmation: boolean
  inputSchema: Record<string, unknown>
}> {
  return mcpCapabilities.map((capability) => ({
    ...capability,
    inputSchema: z.toJSONSchema(
      mcpArgumentSchemas[capability.name as keyof typeof mcpArgumentSchemas]
    ) as Record<string, unknown>
  }))
}

let server: ReturnType<typeof createServer> | null = null
let activeConfigKey = ''
let syncPromise = Promise.resolve()

function parsePort(value: number | string | undefined): number {
  const port = Number(value)
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_MCP_PORT
}

function jsonRpcError(res: ServerResponse, status: number, message: string): void {
  if (res.headersSent) return
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }))
}

function checkRequest(req: IncomingMessage, token: string): string | undefined {
  if (!isLoopbackAddress(req.socket.remoteAddress)) return 'MCP only accepts loopback connections'
  if (!hasValidBearerToken(req.headers.authorization, token)) return 'Invalid MCP bearer token'
  const length = Number(req.headers['content-length'])
  if (Number.isFinite(length) && length > MAX_REQUEST_BYTES) return 'MCP request is too large'
  return undefined
}

async function readRequestBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_REQUEST_BYTES) throw new Error('MCP request is too large')
    chunks.push(buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as unknown
  } catch {
    throw new Error('MCP request body is not valid JSON')
  }
}

function serializeToolResult(value: unknown): {
  content: [{ type: 'text'; text: string }]
  structuredContent: { result: unknown }
} {
  const isVoidResult = value === undefined
  const output = isVoidResult ? { success: true } : value
  let text: string
  try {
    text = isVoidResult ? 'success' : (JSON.stringify(output, null, 2) ?? 'null')
  } catch {
    text = String(value)
  }
  if (text.length > MAX_REQUEST_BYTES) text = `${text.slice(0, MAX_REQUEST_BYTES)}\n...[truncated]`
  return {
    content: [{ type: 'text', text }],
    structuredContent: { result: output }
  }
}

function redactSensitiveState(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveState)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      sensitiveStateKey.test(key) ? '[redacted]' : redactSensitiveState(child)
    ])
  )
}

function refreshFrontend(method: string): void {
  const channels = frontendRefreshChannels[method]
  if (!channels) return
  const window = mainWindow
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
  for (const channel of channels) {
    try {
      window.webContents.send(channel)
    } catch (error) {
      mcpLogger.warn(`Failed to refresh frontend channel ${channel} after MCP operation`, error)
    }
  }
}

export function createMcpServer(): McpServer {
  const mcp = new McpServer(
    { name: 'mihomo-party', version: app.getVersion() },
    { capabilities: { tools: {}, resources: {} }, maxToolInputElements: 10000 }
  )

  mcp.registerTool(
    'list_capabilities',
    {
      title: 'List Clash Party capabilities',
      description: 'List the read, write, and operational capabilities available through MCP.',
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
    },
    async () => serializeToolResult(getMcpCapabilityMetadata())
  )

  mcp.registerTool(
    'get_state',
    {
      title: 'Read Clash Party state',
      description: 'Read the app, Mihomo, profile, and current profile state in one call.',
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
    },
    async () =>
      serializeToolResult({
        app: redactSensitiveState(await getAppConfig()),
        mihomo: redactSensitiveState(await getControledMihomoConfig()),
        profiles: redactSensitiveState(await getProfileConfig()),
        currentProfile: redactSensitiveState(await getCurrentProfileItem())
      })
  )

  mcp.registerTool(
    'restart_core',
    {
      title: 'Restart Mihomo core',
      description: 'Perform the same full core restart used by the Clash Party UI.',
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
    },
    async () => {
      const result = await invokeIpcHandler('restartCore', [])
      refreshFrontend('restartCore')
      return serializeToolResult(result)
    }
  )

  mcp.registerTool(
    'call',
    {
      title: 'Call Clash Party capability',
      description:
        'Call any listed Clash Party capability. Set confirm=true for operations marked requiresConfirmation.',
      inputSchema: {
        method: z.string().min(1),
        args: z.array(z.unknown()).default([]),
        confirm: z.boolean().default(false)
      }
    },
    async ({ method, args, confirm }) => {
      if (!mcpCapabilities.some((capability) => capability.name === method)) {
        throw new Error(`Unknown IPC capability: ${method}`)
      }
      if (ipcHandlerRequiresConfirmation(method) && !confirm) {
        throw new Error(`Capability ${method} requires confirm=true`)
      }
      const result = await invokeIpcHandler(method, validateMcpArgs(method, args))
      refreshFrontend(method)
      return serializeToolResult(result)
    }
  )

  mcp.registerResource(
    'capabilities',
    'mihomo-party://capabilities',
    { description: 'Available Clash Party MCP capabilities', mimeType: 'application/json' },
    async (uri) => ({
      contents: [{ uri: uri.href, text: JSON.stringify(getMcpCapabilityMetadata(), null, 2) }]
    })
  )

  return mcp
}

function validateMcpArgs(method: string, args: unknown[]): unknown[] {
  const schema = mcpArgumentSchemas[method as keyof typeof mcpArgumentSchemas]
  if (!schema) throw new Error(`No MCP argument schema is defined for ${method}`)
  const result = schema.safeParse(args)
  if (!result.success) {
    throw new Error(`Invalid arguments for ${method}: ${result.error.message}`)
  }
  return result.data as unknown[]
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  token: string
): Promise<void> {
  const error = checkRequest(req, token)
  if (error) {
    jsonRpcError(res, error.startsWith('Invalid') ? 401 : 403, error)
    return
  }
  if (req.url !== MCP_PATH) {
    jsonRpcError(res, 404, 'Not found')
    return
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { allow: 'POST' })
    res.end('Method Not Allowed')
    return
  }

  const mcp = createMcpServer()
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  })
  try {
    const body = await readRequestBody(req)
    await mcp.connect(transport)
    await transport.handleRequest(req, res, body)
  } catch (error) {
    mcpLogger.warn('MCP request failed', error)
    jsonRpcError(res, 500, 'MCP request failed')
  } finally {
    await transport.close().catch(() => undefined)
    await mcp.close().catch(() => undefined)
  }
}

export async function startMcpServer(config: IAppConfig): Promise<void> {
  if (server) return

  const token = config.mcpToken?.trim()
  if (!token) throw new Error('MCP token must be configured before enabling the server')
  const port = parsePort(config.mcpPort)
  const url = `http://127.0.0.1:${port}${MCP_PATH}`

  const nextServer = createServer((req, res) => {
    void handleRequest(req, res, token)
  })
  nextServer.on('error', (error) => {
    mcpLogger.warn('MCP server error', error)
  })
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      nextServer.removeListener('listening', onListening)
      reject(error)
    }
    const onListening = (): void => {
      nextServer.removeListener('error', onError)
      resolve()
    }
    nextServer.once('error', onError)
    nextServer.once('listening', onListening)
    nextServer.listen(port, '127.0.0.1')
  }).catch((error) => {
    nextServer.close()
    throw error
  })
  server = nextServer
  await mcpLogger.info(`MCP server listening at ${url}`)
}

export async function stopMcpServer(): Promise<void> {
  const activeServer = server
  server = null
  activeConfigKey = ''
  if (!activeServer) return
  await new Promise<void>((resolve) => activeServer.close(() => resolve()))
}

async function reconcileMcpServer(config: IAppConfig): Promise<void> {
  if (config.mcpEnabled !== true) {
    await stopMcpServer()
    return
  }

  const port = parsePort(config.mcpPort)
  const token = config.mcpToken?.trim() || undefined
  if (!token) {
    await stopMcpServer()
    await mcpLogger.warn('MCP is enabled but no token is configured')
    return
  }
  const configKey = `${port}\u0000${token ?? ''}`
  if (server && activeConfigKey === configKey) return

  await stopMcpServer()
  await startMcpServer(config)
  activeConfigKey = configKey
}

export function syncMcpServer(config: IAppConfig): Promise<void> {
  syncPromise = syncPromise.then(
    () => reconcileMcpServer(config),
    () => reconcileMcpServer(config)
  )
  return syncPromise
}
