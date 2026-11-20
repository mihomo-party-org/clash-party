import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  rm,
  lstat,
  symlink,
  link,
  open
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getStaticTOMLValue, parseTOML } from 'toml-eslint-parser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpAgent } from '../../shared/mcp-agents'
import { importMcpAgent } from './agents'
import { AgentImportError, updateClaudeConfig, updateCodexConfig } from './agent-config'

const native = vi.hoisted(() => ({
  getPath: vi.fn(),
  showMessageBox: vi.fn(),
  openExternal: vi.fn(),
  getAppConfig: vi.fn()
}))
vi.mock('electron', () => ({
  app: { getPath: native.getPath },
  dialog: { showMessageBox: native.showMessageBox },
  shell: { openExternal: native.openExternal }
}))
vi.mock('../config/app', () => ({ getAppConfig: native.getAppConfig }))
vi.mock('../../shared/i18n', () => ({ default: { t: (key: string) => key } }))

const connection = {
  url: 'http://127.0.0.1:28765/mcp',
  headers: { Authorization: 'Bearer test-private-token' }
}
const codexEntry = { url: connection.url, http_headers: connection.headers }
const parseCodex = (text: string): Record<string, unknown> =>
  getStaticTOMLValue(parseTOML(text)) as Record<string, unknown>

describe('Agent configuration edits', () => {
  it('preserves other Claude servers, account and project state', () => {
    const original = {
      account: { id: 'owner' },
      projects: { '/work': { mcpServers: { local: { command: 'untouched' } } } },
      mcpServers: { other: { command: 'untouched' }, 'clash-party': { command: 'old' } }
    }
    const result = JSON.parse(updateClaudeConfig(JSON.stringify(original), connection))
    expect(result).toEqual({
      ...original,
      mcpServers: {
        other: original.mcpServers.other,
        'clash-party': { type: 'http', ...connection }
      }
    })
  })

  it.each(['', '{broken', '[]', 'null', '{"mcpServers":[]}', '{"mcpServers":false}'])(
    'rejects invalid Claude config without including contents in errors: %s',
    (source) => {
      expect(() => updateClaudeConfig(source, connection)).toThrowError(
        new AgentImportError('invalidConfig')
      )
    }
  )

  it('preserves unrelated JSON text and large integer literals exactly', () => {
    const source = '{ "account": 123456789012345678901, "other": { "setting" : true } }'
    const result = updateClaudeConfig(source, connection)
    expect(result).toContain('"account": 123456789012345678901')
    expect(result).toContain('"other": { "setting" : true }')
    expect(JSON.parse(result).mcpServers['clash-party']).toEqual({ type: 'http', ...connection })
  })

  it('rejects JSON layouts whose duplicate keys would shadow the imported server', () => {
    expect(() =>
      updateClaudeConfig('{"mcpServers":{}, "mcpServers":{"other":{}}}', connection)
    ).toThrowError(new AgentImportError('invalidConfig'))
  })

  it.each([
    '',
    '# Keep comment\nmodel = "example"\n',
    '[mcp_servers.other]\ncommand = "untouched"\n',
    '[mcp_servers.clash-party]\ncommand = "old"\nargs = ["old"]\n',
    '["mcp_servers"."clash-party"]\nurl = "old"\n[mcp_servers.clash-party.http_headers]\nOld = "old"\n',
    '[mcp_servers]\nclash-party = { command = "old" }\nother = { command = "untouched" }\n',
    'mcp_servers.clash-party.url = "old"\nmcp_servers.other.command = "untouched"\n',
    'mcp_servers = { other = { command = "untouched" }, clash-party = { url = "old" } }\n',
    'mcp_servers = { other = { command = "untouched" } }\n',
    'mcp_servers = {}\n'
  ])('imports Codex with existing tables, quoted keys and inline tables: %s', (source) => {
    const before = parseCodex(source)
    const result = updateCodexConfig(source, connection)
    const after = parseCodex(result)
    expect(after).toEqual({
      ...before,
      mcp_servers: {
        ...(before.mcp_servers as object | undefined),
        'clash-party': codexEntry
      }
    })
    expect(parseCodex(updateCodexConfig(result, connection))).toEqual(after)
  })

  it('preserves comments and unrelated TOML text including multiline strings', () => {
    const untouched =
      '[mcp_servers.other]\ncommand = "other"\n# Keep this\nargs = [ "one", "two" ]\n' +
      '[profiles.example]\nprompt = """\n[mcp_servers.clash-party]\nThis is a string.\n"""\n'
    const source =
      '# Custom model\nmodel = "mine"\n' +
      '[mcp_servers.clash-party]\ncommand = "old"\n' +
      '[mcp_servers.clash-party.env]\nOLD = "secret"\n' +
      untouched
    const result = updateCodexConfig(source, connection)
    expect(result).toContain('# Custom model\nmodel = "mine"\n')
    expect(result).toContain(untouched)
    expect(result).not.toContain('OLD = "secret"')
    expect(parseCodex(result).mcp_servers).toEqual({
      other: { command: 'other', args: ['one', 'two'] },
      'clash-party': codexEntry
    })
  })

  it.each([
    '[broken',
    'mcp_servers = []',
    'mcp_servers = "text"',
    'mcp_servers = { clash-party = 1 }\n[mcp_servers.clash-party]\nurl = "duplicate"'
  ])('refuses broken Codex config: %s', (source) => {
    expect(() => updateCodexConfig(source, connection)).toThrowError(
      new AgentImportError('invalidConfig')
    )
  })

  it('escapes token characters as data in both formats', () => {
    const special = { ...connection, headers: { Authorization: 'Bearer "\'\\#&?=+' } }
    expect(parseCodex(updateCodexConfig('', special)).mcp_servers).toEqual({
      'clash-party': { url: special.url, http_headers: special.headers }
    })
    expect(JSON.parse(updateClaudeConfig('{}', special)).mcpServers['clash-party'].headers).toEqual(
      special.headers
    )
  })
})

describe('Agent import boundaries', () => {
  let home: string
  let config: IAppConfig
  beforeEach(async () => {
    vi.resetAllMocks()
    home = await mkdtemp(join(tmpdir(), 'clash-party-agent-'))
    vi.stubEnv('CODEX_HOME', '')
    vi.stubEnv('CLAUDE_CONFIG_DIR', '')
    native.getPath.mockReturnValue(home)
    native.showMessageBox.mockResolvedValue({ response: 1 })
    native.openExternal.mockResolvedValue(undefined)
    config = { mcpEnabled: true, mcpPort: 28765, mcpToken: 'test-private-token' } as IAppConfig
    native.getAppConfig.mockImplementation(async () => ({ ...config }))
  })
  afterEach(async () => {
    vi.unstubAllEnvs()
    await rm(home, { recursive: true, force: true })
  })

  it.each(['https://attacker.invalid/', 'terminal', '../codex', null, {}])(
    'accepts only fixed client identifiers: %s',
    async (agent) => {
      expect(await importMcpAgent(agent as McpAgent)).toEqual({
        status: 'error',
        code: 'invalidAgent'
      })
      expect(native.getAppConfig).not.toHaveBeenCalled()
      expect(native.openExternal).not.toHaveBeenCalled()
    }
  )

  it.each([
    { mcpEnabled: false },
    { mcpPort: 80 },
    { mcpPort: 65536 },
    { mcpPort: 1234.5 },
    { mcpToken: '' },
    { mcpToken: 'a\r\nInjected: header' },
    { mcpToken: '${PRIVATE_ENV}' },
    { mcpToken: 'a'.repeat(513) }
  ])('rejects disabled/invalid saved connections: %o', async (patch) => {
    Object.assign(config, patch)
    expect(await importMcpAgent('cursor')).toEqual({
      status: 'error',
      code: patch.mcpEnabled === false ? 'disabled' : 'invalidConnection'
    })
    expect(native.openExternal).not.toHaveBeenCalled()
    expect(native.showMessageBox).not.toHaveBeenCalled()
  })

  it('opens the exact Cursor protocol using encoded JSON configuration', async () => {
    expect(await importMcpAgent('cursor')).toEqual({ status: 'opened' })
    const url = new URL(native.openExternal.mock.calls[0][0])
    expect(url.protocol).toBe('cursor:')
    expect(url.host).toBe('anysphere.cursor-deeplink')
    expect(url.pathname).toBe('/mcp/install')
    expect(url.searchParams.get('name')).toBe('clash-party')
    const encoded = url.searchParams.get('config')
    expect(encoded).toBeTruthy()
    expect(JSON.parse(Buffer.from(encoded ?? '', 'base64').toString())).toEqual(connection)
    expect(native.showMessageBox).not.toHaveBeenCalled()
  })

  it('opens VS Code with an HTTP server definition', async () => {
    expect(await importMcpAgent('vscode')).toEqual({ status: 'opened' })
    const url = native.openExternal.mock.calls[0][0] as string
    expect(url.startsWith('vscode:mcp/install?')).toBe(true)
    expect(JSON.parse(decodeURIComponent(url.split('?')[1]))).toEqual({
      name: 'clash-party',
      type: 'http',
      ...connection
    })
  })

  it('sanitizes launch failures that contain the full credential-bearing URI', async () => {
    native.openExternal.mockImplementation(async (url) => {
      throw new Error(`Could not open ${url}`)
    })
    expect(await importMcpAgent('vscode')).toEqual({ status: 'error', code: 'openFailed' })
  })

  it.each(['codex', 'claude-code'] as const)(
    'creates private %s user config only after local confirmation',
    async (agent) => {
      const file =
        agent === 'codex' ? join(home, '.codex', 'config.toml') : join(home, '.claude.json')
      native.showMessageBox.mockImplementation(async (options) => {
        expect(options.detail).toBe(file)
        expect(options.defaultId).toBe(0)
        expect(options.cancelId).toBe(0)
        expect(JSON.stringify(options)).not.toContain('test-private-token')
        await expect(lstat(file)).rejects.toMatchObject({ code: 'ENOENT' })
        return { response: 1 }
      })
      expect(await importMcpAgent(agent)).toEqual({ status: 'imported' })
      const text = await readFile(file, 'utf8')
      if (agent === 'codex') {
        expect(parseCodex(text).mcp_servers).toEqual({ 'clash-party': codexEntry })
      } else {
        expect(JSON.parse(text).mcpServers).toEqual({
          'clash-party': { type: 'http', ...connection }
        })
      }
      if (process.platform !== 'win32') expect((await lstat(file)).mode & 0o777).toBe(0o600)
    }
  )

  it('honors native config directory overrides', async () => {
    const codex = join(home, 'custom-codex')
    const claude = join(home, 'custom-claude')
    vi.stubEnv('CODEX_HOME', codex)
    vi.stubEnv('CLAUDE_CONFIG_DIR', claude)
    expect(await importMcpAgent('codex')).toEqual({ status: 'imported' })
    expect(await importMcpAgent('claude-code')).toEqual({ status: 'imported' })
    expect(await readFile(join(codex, 'config.toml'), 'utf8')).toContain(connection.url)
    expect(await readFile(join(claude, '.claude.json'), 'utf8')).toContain(connection.url)
  })

  it('rejects relative environment paths', async () => {
    vi.stubEnv('CODEX_HOME', '../untrusted')
    expect(await importMcpAgent('codex')).toEqual({ status: 'error', code: 'unsafeFile' })
  })

  it('cancellation creates neither file nor directory', async () => {
    native.showMessageBox.mockResolvedValue({ response: 0 })
    expect(await importMcpAgent('codex')).toEqual({ status: 'cancelled' })
    await expect(lstat(join(home, '.codex'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('fails closed with a specific error when the local confirmation cannot be shown', async () => {
    native.showMessageBox.mockRejectedValue(new Error('Native error with test-private-token'))
    expect(await importMcpAgent('codex')).toEqual({
      status: 'error',
      code: 'confirmationFailed'
    })
    await expect(lstat(join(home, '.codex'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves malformed configs and never exposes their contents', async () => {
    const file = join(home, '.claude.json')
    const invalid = '{private-account-secret'
    await writeFile(file, invalid)
    expect(await importMcpAgent('claude-code')).toEqual({ status: 'error', code: 'invalidConfig' })
    expect(await readFile(file, 'utf8')).toBe(invalid)
    expect(native.showMessageBox).not.toHaveBeenCalled()
  })

  it('refuses to overwrite a config changed while the confirmation was open', async () => {
    const file = join(home, '.claude.json')
    await writeFile(file, '{"account":1}')
    native.showMessageBox.mockImplementation(async () => {
      await writeFile(file, '{"account":2}')
      return { response: 1 }
    })
    expect(await importMcpAgent('claude-code')).toEqual({ status: 'error', code: 'configChanged' })
    expect(await readFile(file, 'utf8')).toBe('{"account":2}')
  })

  it('does not overwrite a newly created config', async () => {
    const file = join(home, '.claude.json')
    native.showMessageBox.mockImplementation(async () => {
      await writeFile(file, '{"account":"new"}')
      return { response: 1 }
    })
    expect(await importMcpAgent('claude-code')).toEqual({ status: 'error', code: 'configChanged' })
    expect(await readFile(file, 'utf8')).toBe('{"account":"new"}')
  })

  it.each([{ mcpToken: 'rotated' }, { mcpPort: 30000 }, { mcpEnabled: false }])(
    'rechecks connection and permission after confirmation: %o',
    async (patch) => {
      native.showMessageBox.mockImplementation(async () => {
        Object.assign(config, patch)
        return { response: 1 }
      })
      expect(await importMcpAgent('codex')).toEqual({
        status: 'error',
        code: patch.mcpEnabled === false ? 'disabled' : 'configChanged'
      })
      await expect(lstat(join(home, '.codex', 'config.toml'))).rejects.toMatchObject({
        code: 'ENOENT'
      })
    }
  )

  it.each(['symlink', 'hardlink', 'directory', 'oversized'] as const)(
    'refuses unsafe config files: %s',
    async (kind) => {
      const file = join(home, '.claude.json')
      const original = join(home, 'original')
      await writeFile(original, '{}')
      if (kind === 'symlink') await symlink(original, file)
      if (kind === 'hardlink') await link(original, file)
      if (kind === 'directory') await mkdir(file)
      if (kind === 'oversized') {
        const handle = await open(file, 'w')
        await handle.truncate(8 * 1024 * 1024 + 1)
        await handle.close()
      }
      expect(await importMcpAgent('claude-code')).toEqual({ status: 'error', code: 'unsafeFile' })
      expect(await readFile(original, 'utf8')).toBe('{}')
      expect(native.showMessageBox).not.toHaveBeenCalled()
    }
  )

  it('serializes concurrent imports without losing unrelated config', async () => {
    await writeFile(join(home, '.claude.json'), '{"account":"owner"}')
    expect(
      await Promise.all([importMcpAgent('claude-code'), importMcpAgent('claude-code')])
    ).toEqual([{ status: 'imported' }, { status: 'imported' }])
    expect(JSON.parse(await readFile(join(home, '.claude.json'), 'utf8')).account).toBe('owner')
  })
})
