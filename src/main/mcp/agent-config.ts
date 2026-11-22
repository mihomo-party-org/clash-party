import { isDeepStrictEqual } from 'node:util'
import { parseTOML, getStaticTOMLValue, type AST } from 'toml-eslint-parser'
import { applyEdits, modify } from 'jsonc-parser'

export interface AgentConnection {
  url: string
  headers: { Authorization: string }
}

export class AgentImportError extends Error {
  constructor(readonly code: import('../../shared/mcp-agents').McpAgentImportError) {
    super(code)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function updateClaudeConfig(source: string, connection: AgentConnection): string {
  try {
    const config: unknown = JSON.parse(source)
    if (!isRecord(config) || (config.mcpServers !== undefined && !isRecord(config.mcpServers))) {
      throw new Error()
    }
    const result = applyEdits(
      source,
      modify(source, ['mcpServers', 'clash-party'], { type: 'http', ...connection }, {})
    )
    if (
      !isDeepStrictEqual(JSON.parse(result), {
        ...config,
        mcpServers: {
          ...(config.mcpServers as Record<string, unknown> | undefined),
          'clash-party': { type: 'http', ...connection }
        }
      })
    ) {
      throw new Error()
    }
    return result
  } catch {
    throw new AgentImportError('invalidConfig')
  }
}

const serverPath = ['mcp_servers', 'clash-party']
const keyParts = (key: AST.TOMLKey): string[] =>
  key.keys.map((part) => (part.type === 'TOMLBare' ? part.name : part.value))
const isPrefix = (prefix: (string | number)[], path: (string | number)[]): boolean =>
  prefix.length <= path.length && prefix.every((part, index) => part === path[index])

interface Edit {
  start: number
  end: number
  text: string
}

// Edit AST ranges so comments, ordering and unrelated Codex settings stay intact.
export function updateCodexConfig(source: string, connection: AgentConnection): string {
  try {
    const ast = parseTOML(source)
    const config = getStaticTOMLValue(ast) as Record<string, unknown>
    if (config.mcp_servers !== undefined && !isRecord(config.mcp_servers)) throw new Error()
    const entry = `url = ${JSON.stringify(connection.url)}, http_headers = { Authorization = ${JSON.stringify(connection.headers.Authorization)} }`
    const edits: Edit[] = []
    let inline = false
    const replaceInInline = (table: AST.TOMLInlineTable, path: string[]): void => {
      for (const item of table.body) {
        const keys = keyParts(item.key)
        if (!isPrefix(keys, path)) continue
        if (keys.length === path.length) {
          edits.push({ start: item.value.range[0], end: item.value.range[1], text: `{ ${entry} }` })
        } else {
          if (item.value.type !== 'TOMLInlineTable') throw new Error()
          replaceInInline(item.value, path.slice(keys.length))
        }
        return
      }
      const separator = table.body.length ? ', ' : ' '
      edits.push({
        start: table.range[1] - 1,
        end: table.range[1] - 1,
        text: `${separator}${path.map((key) => JSON.stringify(key)).join('.')} = { ${entry} } `
      })
    }
    const visitValue = (item: AST.TOMLKeyValue, parent: (string | number)[]): void => {
      const path = [...parent, ...keyParts(item.key)]
      if (isPrefix(serverPath, path)) {
        edits.push({ start: item.range[0], end: item.range[1], text: '' })
      } else if (isPrefix(path, serverPath)) {
        if (item.value.type !== 'TOMLInlineTable') throw new Error()
        replaceInInline(item.value, serverPath.slice(path.length))
        inline = true
      }
    }
    for (const item of ast.body[0].body) {
      if (item.type === 'TOMLKeyValue') {
        visitValue(item, [])
      } else if (isPrefix(serverPath, item.resolvedKey)) {
        edits.push({ start: item.range[0], end: item.range[1], text: '' })
      } else {
        for (const value of item.body) visitValue(value, item.resolvedKey)
      }
    }
    let result = source
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
      result = result.slice(0, edit.start) + edit.text + result.slice(edit.end)
    }
    if (!inline) {
      result += `\n[mcp_servers.clash-party]\nurl = ${JSON.stringify(connection.url)}\nhttp_headers = { Authorization = ${JSON.stringify(connection.headers.Authorization)} }\n`
    }
    // Reject conflicting or unsupported layouts before touching the original file.
    const updated = getStaticTOMLValue(parseTOML(result))
    if (
      !isDeepStrictEqual(updated, {
        ...config,
        mcp_servers: {
          ...(config.mcp_servers as Record<string, unknown> | undefined),
          'clash-party': { url: connection.url, http_headers: connection.headers }
        }
      })
    ) {
      throw new Error()
    }
    return result
  } catch {
    throw new AgentImportError('invalidConfig')
  }
}
