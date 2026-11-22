export const mcpAgents = ['cursor', 'vscode', 'claude-code', 'codex'] as const
export type McpAgent = (typeof mcpAgents)[number]

export type McpAgentImportError =
  | 'invalidAgent'
  | 'disabled'
  | 'invalidConnection'
  | 'invalidConfig'
  | 'unsafeFile'
  | 'configChanged'
  | 'permissionDenied'
  | 'confirmationFailed'
  | 'openFailed'
  | 'writeFailed'

export type McpAgentImportResult =
  { status: 'opened' | 'imported' | 'cancelled' } | { status: 'error'; code: McpAgentImportError }
