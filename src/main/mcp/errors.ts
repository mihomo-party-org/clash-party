import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

export class McpToolError extends Error {
  constructor(
    message: string,
    readonly code = 'INVALID_TARGET'
  ) {
    super(message)
  }
}

export function toolFailure(error: unknown): CallToolResult {
  let code = 'BACKEND_ERROR'
  let message = 'Clash Party could not complete the operation. Check the app and retry.'
  if (error instanceof McpToolError) {
    code = error.code
    message = error.message
  } else if (error && typeof error === 'object') {
    const backend = error as { code?: unknown; response?: { status?: unknown }; message?: unknown }
    if (['ETIMEDOUT', 'ECONNABORTED'].includes(String(backend.code))) {
      code = 'TIMEOUT'
      message = 'The operation timed out. Check network/core availability before retrying.'
    } else if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET'].includes(String(backend.code))) {
      code = 'NETWORK_ERROR'
      message = 'The network request failed. Check DNS, connectivity and the saved subscription.'
    } else if (['ENOENT', 'ECONNREFUSED'].includes(String(backend.code))) {
      code = 'CORE_UNAVAILABLE'
      message = 'The Mihomo core or its local socket is unavailable. Check the core status.'
    } else if (['EACCES', 'EPERM', 'EROFS'].includes(String(backend.code))) {
      code = 'PERMISSION_DENIED'
      message = 'The app cannot access the required file or system resource.'
    } else if (backend.response?.status === 401 || backend.response?.status === 403) {
      code = 'UPSTREAM_AUTH_FAILED'
      message = 'The saved upstream credentials were rejected. Update them in Clash Party.'
    } else if (
      typeof backend.message === 'string' &&
      /已被修改|已变化|草稿尚未发布/.test(backend.message)
    ) {
      code = 'CONFLICT'
      message = 'The configuration changed. Read the target again before editing.'
    } else if (
      typeof backend.message === 'string' &&
      /找不到节点|找不到代理组|已不存在|Profile not found/.test(backend.message)
    ) {
      code = 'NOT_FOUND'
      message = 'The target no longer exists. Read the current profile, nodes or groups again.'
    } else if (typeof backend.message === 'string' && /恢复配置或内核失败/.test(backend.message)) {
      code = 'ROLLBACK_FAILED'
      message =
        'Applying the edit and restoring the previous configuration failed. Check the app/core before making another edit.'
    } else if (typeof backend.message === 'string' && /已恢复原配置/.test(backend.message)) {
      code = 'APPLY_FAILED_ROLLED_BACK'
      message = 'Applying the edit failed. Clash Party restored the previous configuration.'
    } else if (
      typeof backend.message === 'string' &&
      /名称已存在|名称与已有.*冲突/.test(backend.message)
    ) {
      code = 'DUPLICATE_NAME'
      message = 'The requested name is already used by a node, group or provider.'
    } else if (
      typeof backend.message === 'string' &&
      /配置无效|循环引用|未定义出站|缺少必填项|名称不能为空|configuration file .* test failed/.test(
        backend.message
      )
    ) {
      code = 'VALIDATION_FAILED'
      message =
        'Configuration validation failed (required fields, outbound references, cycles or core compatibility). No edit was published.'
    }
  }
  const failure = { code, message }
  return {
    isError: true,
    content: [{ type: 'text', text: `${code}: ${message}` }],
    structuredContent: { error: failure }
  }
}
