import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

it('loads the MCP transport and serves initialization without native Web APIs', async () => {
  for (const name of [
    'fetch',
    'Headers',
    'Request',
    'Response',
    'FormData',
    'File',
    'Blob',
    'ReadableStream',
    'TransformStream',
    'WritableStream',
    'crypto'
  ]) {
    vi.stubGlobal(name, undefined)
  }
  await import('./web-apis')
  const { StreamableHTTPServerTransport } =
    await import('@modelcontextprotocol/sdk/server/streamableHttp.js')
  expect(StreamableHTTPServerTransport).toBeTypeOf('function')
  const { WebStandardStreamableHTTPServerTransport } =
    await import('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js')
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
  const server = new McpServer({ name: 'legacy-test', version: '1.0.0' })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  })
  try {
    await server.connect(transport)
    const response = await transport.handleRequest(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test', version: '1.0.0' }
          }
        })
      })
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      id: 1,
      result: { serverInfo: { name: 'legacy-test' } }
    })
  } finally {
    await server.close()
  }
})

it('preserves existing runtime Web APIs', async () => {
  const nativeHeaders = globalThis.Headers
  const nativeFetch = globalThis.fetch
  await import('./web-apis')
  expect(globalThis.Headers).toBe(nativeHeaders)
  expect(globalThis.fetch).toBe(nativeFetch)
})
