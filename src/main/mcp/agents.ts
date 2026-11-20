import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { app, dialog, shell } from 'electron'
import i18next from '../../shared/i18n'
import { mcpAgents, type McpAgent, type McpAgentImportResult } from '../../shared/mcp-agents'
import { getAppConfig } from '../config/app'
import { WriteQueue } from '../utils/safeFile'
import {
  AgentImportError,
  updateClaudeConfig,
  updateCodexConfig,
  type AgentConnection
} from './agent-config'

const importQueue = new WriteQueue()
const maxConfigBytes = 8 * 1024 * 1024

function connectionFromConfig(config: IAppConfig): AgentConnection {
  if (config.mcpEnabled !== true) throw new AgentImportError('disabled')
  const port = config.mcpPort ?? 28765
  const token = config.mcpToken
  if (
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    typeof token !== 'string' ||
    !/^[\x21-\x7e]{1,512}$/.test(token) ||
    token.includes('${')
  ) {
    throw new AgentImportError('invalidConnection')
  }
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    headers: { Authorization: `Bearer ${token}` }
  }
}

function configPath(agent: 'codex' | 'claude-code'): string {
  const home = app.getPath('home')
  const override = process.env[agent === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR']
  if (override && !isAbsolute(override)) throw new AgentImportError('unsafeFile')
  return agent === 'codex'
    ? join(override || join(home, '.codex'), 'config.toml')
    : join(override || home, '.claude.json')
}

async function snapshot(file: string): Promise<string | undefined> {
  try {
    const stat = await lstat(file)
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > maxConfigBytes) {
      throw new AgentImportError('unsafeFile')
    }
    // O_NOFOLLOW also protects the open after lstat on platforms that support it.
    const handle = await open(
      file,
      constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0)
    )
    try {
      const opened = await handle.stat()
      if (
        !opened.isFile() ||
        opened.nlink !== 1 ||
        opened.ino !== stat.ino ||
        opened.dev !== stat.dev ||
        opened.size > maxConfigBytes
      ) {
        throw new AgentImportError('configChanged')
      }
      const data = Buffer.alloc(maxConfigBytes + 1)
      let bytesRead = 0
      while (bytesRead < data.length) {
        const part = await handle.read(data, bytesRead, data.length - bytesRead, bytesRead)
        if (part.bytesRead === 0) break
        bytesRead += part.bytesRead
      }
      if (bytesRead > maxConfigBytes) throw new AgentImportError('unsafeFile')
      return new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(0, bytesRead))
    } finally {
      await handle.close()
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return undefined
    if (error instanceof TypeError) throw new AgentImportError('invalidConfig')
    throw error
  }
}

async function saveConfig(file: string, before: string | undefined, after: string): Promise<void> {
  const parent = dirname(file)
  await mkdir(parent, { recursive: true, mode: 0o700 })
  const directory = await realpath(parent)
  const temp = join(directory, `.clash-party-${randomBytes(16).toString('hex')}.tmp`)
  try {
    const handle = await open(temp, 'wx', 0o600)
    try {
      await handle.writeFile(after, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    if ((await realpath(parent)) !== directory || (await snapshot(file)) !== before) {
      throw new AgentImportError('configChanged')
    }
    if (before === undefined) {
      // Publishing a new config must never replace a file created in the meantime.
      await link(temp, file)
    } else {
      await rename(temp, file)
    }
  } finally {
    await rm(temp, { force: true }).catch(() => {})
  }
}

export async function importMcpAgent(agent: McpAgent): Promise<McpAgentImportResult> {
  if (!mcpAgents.includes(agent)) return { status: 'error', code: 'invalidAgent' }
  return importQueue.run(async () => {
    try {
      const connection = connectionFromConfig(await getAppConfig())
      if (agent === 'cursor' || agent === 'vscode') {
        const link =
          agent === 'cursor'
            ? `cursor://anysphere.cursor-deeplink/mcp/install?name=clash-party&config=${encodeURIComponent(Buffer.from(JSON.stringify(connection)).toString('base64'))}`
            : `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: 'clash-party', type: 'http', ...connection }))}`
        try {
          await shell.openExternal(link)
        } catch {
          throw new AgentImportError('openFailed')
        }
        return { status: 'opened' }
      }

      const file = configPath(agent)
      const before = await snapshot(file)
      const after =
        agent === 'codex'
          ? updateCodexConfig(before ?? '', connection)
          : updateClaudeConfig(before ?? '{}', connection)
      if (Buffer.byteLength(after, 'utf8') > maxConfigBytes) {
        throw new AgentImportError('unsafeFile')
      }
      let response: number
      try {
        const approval = await dialog.showMessageBox({
          type: 'question',
          title: i18next.t('settings.mcp.importTitle'),
          message: i18next.t('settings.mcp.importConfirm', {
            agent: agent === 'codex' ? 'Codex' : 'Claude Code'
          }),
          detail: file,
          buttons: [i18next.t('common.cancel'), i18next.t('common.confirm')],
          defaultId: 0,
          cancelId: 0,
          noLink: true
        })
        response = approval.response
      } catch {
        throw new AgentImportError('confirmationFailed')
      }
      if (response !== 1) return { status: 'cancelled' }
      // A settings change while the approval was open invalidates this import.
      const current = connectionFromConfig(await getAppConfig())
      if (JSON.stringify(current) !== JSON.stringify(connection)) {
        throw new AgentImportError('configChanged')
      }
      await saveConfig(file, before, after)
      return { status: 'imported' }
    } catch (error) {
      if (error instanceof AgentImportError) return { status: 'error', code: error.code }
      const code = (error as NodeJS.ErrnoException | null)?.code
      if (code === 'EACCES' || code === 'EPERM') {
        return { status: 'error', code: 'permissionDenied' }
      }
      if (code === 'EEXIST') return { status: 'error', code: 'configChanged' }
      if (code === 'ELOOP') return { status: 'error', code: 'unsafeFile' }
      // Native errors can include paths, configuration contents, or the credential-bearing URI.
      return { status: 'error', code: 'writeFailed' }
    }
  })
}
