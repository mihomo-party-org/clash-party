import './web-apis'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createLogger } from '../utils/logger'
import { hasValidBearerToken, isLoopbackAddress, isTrustedLocalRequest } from './security'
import { createMcpServer } from './tools'

export { createMcpServer } from './tools'

const MCP_PATH = '/mcp'
const DEFAULT_MCP_PORT = 28765
const MAX_REQUEST_BYTES = 1024 * 1024
const MAX_ACTIVE_REQUESTS = 16
const mcpLogger = createLogger('MCP')
class RequestBodyTooLargeError extends Error {}

let server: ReturnType<typeof createServer> | null = null
let activeConfigKey = ''
let syncPromise = Promise.resolve()

function parsePort(value: number | string | undefined): number {
  const port = Number(value)
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_MCP_PORT
}

function jsonRpcError(res: ServerResponse, status: number, message: string): void {
  if (res.headersSent || res.destroyed) return
  res.writeHead(status, { 'content-type': 'application/json', connection: 'close' })
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }))
}

async function readRequestBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  // Keep the response socket alive long enough to return an explicit 413 on chunked overflow.
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_REQUEST_BYTES) throw new RequestBodyTooLargeError()
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

export async function handleMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  token: string,
  port: number
): Promise<void> {
  if (!isLoopbackAddress(req.socket.remoteAddress) || !isTrustedLocalRequest(req.headers, port)) {
    jsonRpcError(res, 403, 'MCP only accepts native loopback clients')
    return
  }
  if (!hasValidBearerToken(req.headers.authorization, token)) {
    jsonRpcError(res, 401, 'Invalid MCP bearer token')
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
  if (Number(req.headers['content-length']) > MAX_REQUEST_BYTES) {
    jsonRpcError(res, 413, 'MCP request is too large')
    return
  }
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    jsonRpcError(res, 415, 'MCP requires application/json')
    return
  }
  let body: unknown
  try {
    body = await readRequestBody(req)
  } catch (error) {
    jsonRpcError(
      res,
      error instanceof RequestBodyTooLargeError ? 413 : 400,
      error instanceof RequestBodyTooLargeError
        ? 'MCP request is too large'
        : 'Invalid MCP JSON request'
    )
    return
  }

  const requestController = new AbortController()
  const onDisconnect = (): void => {
    if (!res.writableEnded) requestController.abort()
  }
  res.once('close', onDisconnect)
  if (res.destroyed) requestController.abort()
  const mcp = createMcpServer(token, requestController.signal)
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  })
  try {
    await mcp.connect(transport)
    await transport.handleRequest(req, res, body)
  } catch {
    void mcpLogger.warn('MCP protocol request failed')
    jsonRpcError(res, 500, 'MCP request failed')
  } finally {
    res.removeListener('close', onDisconnect)
    await transport.close().catch(() => undefined)
    await mcp.close().catch(() => undefined)
  }
}

export async function startMcpServer(config: IAppConfig): Promise<void> {
  if (server) return
  const token = config.mcpToken?.trim()
  if (!token) throw new Error('MCP token must be configured before enabling the server')
  const port = parsePort(config.mcpPort)
  let activeRequests = 0
  const nextServer = createServer((req, res) => {
    if (activeRequests >= MAX_ACTIVE_REQUESTS) {
      jsonRpcError(res, 429, 'Too many MCP requests')
      return
    }
    activeRequests++
    void handleMcpRequest(req, res, token, port)
      .catch(() => jsonRpcError(res, 500, 'MCP request failed'))
      .finally(() => activeRequests--)
  })
  nextServer.requestTimeout = 15000
  nextServer.headersTimeout = 10000
  nextServer.on('error', () => {
    void mcpLogger.warn('MCP server error')
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
  await mcpLogger.info(`MCP server listening at http://127.0.0.1:${port}${MCP_PATH}`)
}

export async function stopMcpServer(): Promise<void> {
  const activeServer = server
  server = null
  activeConfigKey = ''
  if (!activeServer) return
  await new Promise<void>((resolve) => {
    activeServer.close(() => resolve())
    // Disconnect outstanding requests so disabling/rotating MCP never waits on a client body/dialog.
    activeServer.closeAllConnections()
  })
}

async function reconcileMcpServer(config: IAppConfig): Promise<void> {
  if (config.mcpEnabled !== true) {
    await stopMcpServer()
    return
  }
  const port = parsePort(config.mcpPort)
  const token = config.mcpToken?.trim()
  if (!token) {
    await stopMcpServer()
    await mcpLogger.warn('MCP is enabled but no token is configured')
    return
  }
  const configKey = `${port}\u0000${token}`
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
