import { app, dialog } from 'electron'
import i18next from 'i18next'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import * as z from 'zod/v4'
import {
  addProfileItem,
  changeCurrentProfile,
  getAppConfig,
  getControledMihomoConfig,
  getProfileConfig,
  patchControledMihomoConfig
} from '../config'
import {
  mihomoChangeProxy,
  mihomoCloseAllConnections,
  mihomoGroups,
  mihomoHotReloadConfig,
  mihomoProxyDelay,
  mihomoProxyProviders,
  mihomoRuleProviders,
  mihomoRules,
  mihomoRulesDisable,
  mihomoUnfixedProxy,
  mihomoUpdateProxyProviders,
  mihomoUpdateRuleProviders,
  mihomoVersion
} from '../core/mihomoApi'
import { hasCoreProcess, restartCore } from '../core/manager'
import { createLogger } from '../utils/logger'
import { mainWindow } from '../window'
import { McpToolError as ToolError, toolFailure } from './errors'
import { publicScalar } from './security'
import {
  editGroup,
  editNode,
  editProfile,
  editRules,
  groupPatchSchema,
  nodePatchSchema,
  profilePatchSchema,
  readGroup,
  readNode,
  readRules,
  revisionOf,
  revisionSchema,
  ruleEditSchema,
  inLocalProfile
} from './editing'

const logger = createLogger('MCP')
const MAX_RESULT_BYTES = 1024 * 1024
const nameSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[^\p{Cc}\p{Cf}]+$/u)
const profileIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/)
const pageSchema = {
  offset: z.number().int().min(0).max(100000).default(0),
  limit: z.number().int().min(1).max(200).default(50)
}
type RefreshChannel =
  | 'controledMihomoConfigUpdated'
  | 'profileConfigUpdated'
  | 'groupsUpdated'
  | 'rulesUpdated'
  | 'proxyProvidersUpdated'
  | 'ruleProvidersUpdated'
  | 'localConfigUpdated'

// Shared across stateless HTTP requests: only one approval/operation may be active.
let mutationPending = false

function result(value: unknown): CallToolResult {
  const output = value === undefined ? { success: true } : value
  const text = JSON.stringify(output)
  const payload: CallToolResult = {
    content: [{ type: 'text', text }],
    structuredContent: { result: output }
  }
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_RESULT_BYTES) {
    throw new ToolError('Result is too large. Use a smaller page size.', 'RESULT_TOO_LARGE')
  }
  return payload
}

function page<T>(items: T[], { offset, limit }: { offset: number; limit: number }) {
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    nextOffset: offset + limit < items.length ? offset + limit : null
  }
}

function ruleSummaries(rules: IMihomoRulesDetail[]) {
  return rules.map((rule) => ({
    index: publicScalar(rule.index),
    type: publicScalar(rule.type),
    payload: publicScalar(rule.payload),
    proxy: publicScalar(rule.proxy),
    disabled: rule.extra?.disabled === true
  }))
}

async function runtimeRuleRevision(rules: IMihomoRulesDetail[]): Promise<string> {
  const { current } = await getProfileConfig()
  return revisionOf({ profileId: current, rules: ruleSummaries(rules) })
}

async function requireRuntimeRule(index: number, revision: string): Promise<IMihomoRulesDetail> {
  const { rules } = await mihomoRules()
  if ((await runtimeRuleRevision(rules)) !== revision) {
    throw new ToolError(
      'Runtime rules or the active profile changed. List rules again.',
      'CONFLICT'
    )
  }
  const rule = rules.find((rule) => rule.index === index)
  if (!rule) throw new ToolError('Rule does not exist. List rules again.', 'NOT_FOUND')
  return rule
}

function profileSummary(item: IProfileItem): unknown {
  return {
    id: publicScalar(item.id),
    name: publicScalar(item.name),
    type: publicScalar(item.type),
    updated: publicScalar(item.updated),
    autoUpdate: publicScalar(item.autoUpdate),
    interval: publicScalar(item.interval),
    managedByPlugin: Boolean(item.pluginId),
    revision: revisionOf(item)
  }
}

async function requireProfile(id: string): Promise<IProfileItem> {
  const { items = [] } = await getProfileConfig()
  const item = items.find((item) => item.id === id)
  if (!item) throw new ToolError('Profile does not exist. List profiles again.', 'NOT_FOUND')
  return item
}

async function requireGroup(name: string): Promise<IMihomoMixedGroup> {
  const group = (await mihomoGroups(true)).find((group) => group.name === name)
  if (!group) throw new ToolError('Proxy group does not exist. List groups again.', 'NOT_FOUND')
  return group
}

function refresh(channels: RefreshChannel[]): void {
  const window = mainWindow
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
  for (const channel of channels) {
    try {
      window.webContents.send(channel)
    } catch {
      void logger.warn(`Failed to refresh ${channel} after MCP operation`)
    }
  }
}

async function requireWriteAccess(
  expectedToken?: string
): Promise<{ token: string | undefined; autoApprove: boolean }> {
  const config = await getAppConfig()
  if (expectedToken !== undefined && config.mcpToken?.trim() !== expectedToken) {
    throw new ToolError(
      'MCP credentials changed. Reconnect with the current token.',
      'UNAUTHORIZED'
    )
  }
  if (config.mcpEnabled !== true || config.mcpAllowWrites !== true) {
    throw new ToolError(
      'MCP is read-only. Enable write operations in Clash Party settings.',
      'READ_ONLY'
    )
  }
  return { token: config.mcpToken?.trim(), autoApprove: config.mcpAutoApprove === true }
}

async function approveMutation(summary: string): Promise<void> {
  const options: Electron.MessageBoxOptions = {
    type: 'warning',
    title: i18next.t('settings.mcp.confirmTitle'),
    message: i18next.t('settings.mcp.confirmMessage'),
    detail: summary,
    buttons: [i18next.t('common.cancel'), i18next.t('common.confirm')],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  }
  const window = mainWindow
  let decision: Electron.MessageBoxReturnValue
  try {
    decision =
      window && !window.isDestroyed()
        ? await dialog.showMessageBox(window, options)
        : await dialog.showMessageBox(options)
  } catch {
    throw new ToolError(
      'Local confirmation could not be displayed. Open Clash Party and retry.',
      'APPROVAL_UNAVAILABLE'
    )
  }
  if (decision.response !== 1)
    throw new ToolError('Operation was denied in Clash Party.', 'USER_DENIED')
}

export function createMcpServer(expectedToken?: string, requestSignal?: AbortSignal): McpServer {
  const mcp = new McpServer(
    { name: 'mihomo-party', version: app.getVersion() },
    { capabilities: { tools: {} }, maxToolInputElements: 1000 }
  )

  function register<S extends z.ZodRawShape>(
    name: string,
    description: string,
    schema: z.ZodObject<S>,
    run: (args: z.output<z.ZodObject<S>>) => Promise<unknown>,
    mutation?: {
      summary: (args: z.output<z.ZodObject<S>>) => string | Promise<string>
      channels: RefreshChannel[]
      openWorld?: boolean
    },
    openWorld = false
  ): void {
    mcp.registerTool<z.ZodRawShape, z.ZodObject<S>>(
      name,
      {
        description: mutation
          ? `${description} Requires write permission. Local confirmation is required unless auto-approval is enabled in Clash Party settings.`
          : description,
        inputSchema: schema,
        annotations: {
          readOnlyHint: !mutation,
          destructiveHint: Boolean(mutation),
          openWorldHint: mutation?.openWorld ?? openWorld
        }
      },
      async (input, extra) => {
        const args = input as z.output<z.ZodObject<S>>
        let locked = false
        try {
          if (extra.signal.aborted || requestSignal?.aborted) {
            throw new ToolError('Operation was cancelled.', 'CANCELLED')
          }
          if (expectedToken !== undefined) {
            const config = await getAppConfig()
            if (config.mcpEnabled !== true || config.mcpToken?.trim() !== expectedToken) {
              throw new ToolError(
                'MCP was disabled or its credentials changed. Reconnect.',
                'UNAUTHORIZED'
              )
            }
          }
          if (mutation) {
            const { token: approvedToken } = await requireWriteAccess(expectedToken)
            if (mutationPending)
              throw new ToolError('Another MCP operation is awaiting completion.', 'BUSY')
            mutationPending = true
            locked = true
            const summary = await mutation.summary(args)
            if (extra.signal.aborted || requestSignal?.aborted)
              throw new ToolError('Operation was cancelled.', 'CANCELLED')
            const policy = await requireWriteAccess(approvedToken)
            if (extra.signal.aborted || requestSignal?.aborted)
              throw new ToolError('Operation was cancelled.', 'CANCELLED')
            if (!policy.autoApprove) await approveMutation(summary)
            if (extra.signal.aborted || requestSignal?.aborted)
              throw new ToolError('Operation was cancelled.', 'CANCELLED')
            // Recheck settings even when no confirmation dialog was needed.
            const current = await requireWriteAccess(approvedToken)
            if (policy.autoApprove && !current.autoApprove) {
              throw new ToolError(
                'Automatic approval was disabled. Retry and confirm the operation in Clash Party.',
                'APPROVAL_REQUIRED'
              )
            }
            if (extra.signal.aborted || requestSignal?.aborted)
              throw new ToolError('Operation was cancelled.', 'CANCELLED')
          }
          const output = result(await run(args))
          if (mutation) {
            refresh(mutation.channels)
            await logger.info(`Tool ${name} completed`)
          }
          return output
        } catch (error) {
          // Backend exceptions can contain subscription URLs, credentials or file paths.
          const failure = toolFailure(error)
          const code =
            (failure.structuredContent?.error as { code: string } | undefined)?.code ??
            'BACKEND_ERROR'
          void logger.warn(`Tool ${name} failed code=${code}`)
          return failure
        } finally {
          if (locked) mutationPending = false
        }
      }
    )
  }

  register(
    'get_state',
    'Read a summary without credentials, subscription URLs or raw configuration.',
    z.strictObject({}),
    async () => {
      const [config, mihomo, profiles] = await Promise.all([
        getAppConfig(),
        getControledMihomoConfig(),
        getProfileConfig()
      ])
      const current = profiles.items?.find((item) => item.id === profiles.current)
      return {
        appVersion: app.getVersion(),
        coreRunning: hasCoreProcess(),
        core: publicScalar(config.core),
        mode: publicScalar(mihomo.mode),
        tunEnabled: mihomo.tun?.enable === true,
        systemProxyEnabled: config.sysProxy?.enable === true,
        currentProfile: current ? profileSummary(current) : null,
        permissions: {
          allowWrites: config.mcpAllowWrites === true,
          localConfirmationRequired: config.mcpAutoApprove !== true
        }
      }
    }
  )

  register(
    'list_profiles',
    'List saved profile metadata. Does not expose URLs or profile content.',
    z.strictObject(pageSchema),
    async (args) => page((await getProfileConfig()).items?.map(profileSummary) ?? [], args)
  )

  register('get_core_version', 'Read the running Mihomo version.', z.strictObject({}), async () => {
    const version = await mihomoVersion()
    return { version: publicScalar(version.version), meta: publicScalar(version.meta) }
  })

  register(
    'list_proxy_groups',
    'List proxy groups and their current selection.',
    z.strictObject(pageSchema),
    async (args) =>
      page(
        (await mihomoGroups(true)).map((group) => ({
          name: publicScalar(group.name),
          type: publicScalar(group.type),
          selected: publicScalar(group.now),
          memberCount: group.all.length,
          hidden: group.hidden
        })),
        args
      )
  )

  register(
    'list_group_members',
    'List selectable members of an existing proxy group.',
    z.strictObject({ group: nameSchema, ...pageSchema }),
    async (args) =>
      page(
        (await requireGroup(args.group)).all.map((proxy) => ({
          name: publicScalar(proxy.name),
          type: publicScalar(proxy.type),
          alive: publicScalar(proxy.alive),
          delay: publicScalar(proxy.history?.at(-1)?.delay)
        })),
        args
      )
  )

  register(
    'list_rules',
    'List routing rules with pagination and the revision required for runtime edits.',
    z.strictObject(pageSchema),
    async (args) => {
      const { rules } = await mihomoRules()
      return { ...page(ruleSummaries(rules), args), revision: await runtimeRuleRevision(rules) }
    }
  )

  const providerKind = z.enum(['proxy', 'rule'])
  register(
    'list_providers',
    'List provider metadata without URLs, credentials or node configurations.',
    z.strictObject({ kind: providerKind, ...pageSchema }),
    async (args) => {
      if (args.kind === 'proxy') {
        const { providers } = await mihomoProxyProviders()
        return page(
          Object.entries(providers).map(([name, provider]) => ({
            name,
            type: publicScalar(provider.type),
            vehicleType: publicScalar(provider.vehicleType),
            updatedAt: publicScalar(provider.updatedAt),
            count: provider.proxies?.length ?? 0
          })),
          args
        )
      }
      const { providers } = await mihomoRuleProviders()
      return page(
        Object.entries(providers).map(([name, provider]) => ({
          name,
          type: publicScalar(provider.type),
          vehicleType: publicScalar(provider.vehicleType),
          updatedAt: publicScalar(provider.updatedAt),
          count: publicScalar(provider.ruleCount)
        })),
        args
      )
    }
  )

  register(
    'select_profile',
    'Activate an existing saved profile.',
    z.strictObject({ profileId: profileIdSchema }),
    async ({ profileId }) => {
      await requireProfile(profileId)
      await changeCurrentProfile(profileId)
    },
    {
      summary: ({ profileId }) => i18next.t('settings.mcp.action.selectProfile', { id: profileId }),
      channels: ['profileConfigUpdated', 'groupsUpdated', 'rulesUpdated']
    }
  )

  register(
    'update_profile',
    'Refresh an existing remote subscription using its saved URL and credentials.',
    z.strictObject({ profileId: profileIdSchema }),
    async ({ profileId }) => {
      const item = await requireProfile(profileId)
      if (item.type !== 'remote' || item.pluginId) {
        throw new ToolError(
          'Only existing remote subscriptions can be refreshed.',
          'INVALID_ARGUMENT'
        )
      }
      await addProfileItem(item)
    },
    {
      summary: ({ profileId }) => i18next.t('settings.mcp.action.updateProfile', { id: profileId }),
      channels: ['profileConfigUpdated', 'groupsUpdated', 'rulesUpdated'],
      openWorld: true
    }
  )

  register(
    'select_proxy',
    'Select a member of an existing proxy group.',
    z.strictObject({ group: nameSchema, proxy: nameSchema }),
    async ({ group, proxy }) => {
      const target = await requireGroup(group)
      if (!target.all.some((member) => member.name === proxy)) {
        throw new ToolError('Proxy is not a member of the selected group.', 'INVALID_ARGUMENT')
      }
      await mihomoChangeProxy(group, proxy)
    },
    {
      summary: ({ group, proxy }) => i18next.t('settings.mcp.action.selectProxy', { group, proxy }),
      channels: ['groupsUpdated']
    }
  )

  register(
    'reset_proxy_selection',
    'Release the fixed selection of an existing proxy group.',
    z.strictObject({ group: nameSchema }),
    async ({ group }) => {
      await requireGroup(group)
      await mihomoUnfixedProxy(group)
    },
    {
      summary: ({ group }) => i18next.t('settings.mcp.action.resetProxy', { group }),
      channels: ['groupsUpdated']
    }
  )

  register(
    'set_proxy_mode',
    'Set rule, global or direct mode. No arbitrary configuration patches.',
    z.strictObject({ mode: z.enum(['rule', 'global', 'direct']) }),
    async ({ mode }) => {
      await patchControledMihomoConfig({ mode })
    },
    {
      summary: ({ mode }) => i18next.t('settings.mcp.action.setMode', { mode }),
      channels: ['controledMihomoConfigUpdated', 'groupsUpdated', 'rulesUpdated']
    }
  )

  register(
    'set_rule_enabled',
    'Enable or disable one existing routing rule using the index and revision from list_rules.',
    z.strictObject({
      index: z.number().int().min(0),
      enabled: z.boolean(),
      revision: revisionSchema
    }),
    async ({ index, enabled, revision }) => {
      await requireRuntimeRule(index, revision)
      await mihomoRulesDisable({ [String(index)]: !enabled })
    },
    {
      summary: async ({ index, enabled, revision }) => {
        const rule = await requireRuntimeRule(index, revision)
        return (
          i18next.t('settings.mcp.action.setRule', { index, enabled }) +
          '\n' +
          JSON.stringify(ruleSummaries([rule])[0])
        )
      },
      channels: ['rulesUpdated']
    }
  )

  register(
    'update_provider',
    'Refresh an existing provider using its saved configuration.',
    z.strictObject({ kind: providerKind, name: nameSchema }),
    async ({ kind, name }) => {
      const { providers } =
        kind === 'proxy' ? await mihomoProxyProviders() : await mihomoRuleProviders()
      if (!Object.hasOwn(providers, name))
        throw new ToolError('Provider does not exist.', 'NOT_FOUND')
      if (kind === 'proxy') await mihomoUpdateProxyProviders(name)
      else await mihomoUpdateRuleProviders(name)
    },
    {
      summary: ({ kind, name }) => i18next.t('settings.mcp.action.updateProvider', { kind, name }),
      channels: ['proxyProvidersUpdated', 'ruleProvidersUpdated', 'groupsUpdated', 'rulesUpdated'],
      openWorld: true
    }
  )

  register(
    'test_proxy_delay',
    'Measure an existing group member using the app-configured test endpoint.',
    z.strictObject({ group: nameSchema, proxy: nameSchema }),
    async ({ group, proxy }) => {
      const member = (await requireGroup(group)).all.find((member) => member.name === proxy)
      if (!member)
        throw new ToolError('Proxy is not a member of the selected group.', 'INVALID_ARGUMENT')
      const delay = await mihomoProxyDelay(
        proxy,
        undefined,
        'provider-name' in member ? member['provider-name'] : undefined
      )
      return { delay: publicScalar(delay.delay) }
    },
    undefined,
    true
  )

  register(
    'close_connections',
    'Close all connections, or only connections in an existing group.',
    z.strictObject({ group: nameSchema.optional() }),
    async ({ group }) => {
      if (group) await requireGroup(group)
      await mihomoCloseAllConnections(group)
    },
    {
      summary: ({ group }) =>
        group
          ? i18next.t('settings.mcp.action.closeGroup', { group })
          : i18next.t('settings.mcp.action.closeAll'),
      channels: []
    }
  )

  register(
    'reload_config',
    'Regenerate and hot-reload the saved configuration.',
    z.strictObject({}),
    async () => {
      await mihomoHotReloadConfig()
    },
    {
      summary: () => i18next.t('settings.mcp.action.reload'),
      channels: ['groupsUpdated', 'rulesUpdated']
    }
  )

  register(
    'restart_core',
    'Restart the Mihomo core.',
    z.strictObject({}),
    async () => {
      await restartCore()
    },
    {
      summary: () => i18next.t('settings.mcp.action.restart'),
      channels: ['groupsUpdated', 'rulesUpdated']
    }
  )

  register(
    'edit_profile',
    'Edit only saved profile metadata/update settings. Read list_profiles for the required revision. URLs, credentials, scripts and IDs cannot be changed.',
    z.strictObject({
      profileId: profileIdSchema,
      revision: revisionSchema,
      patch: profilePatchSchema
    }),
    async ({ profileId, revision, patch }) => editProfile(profileId, revision, patch),
    {
      summary: ({ profileId, patch }) =>
        i18next.t('settings.mcp.action.editProfile', { id: profileId }) +
        '\n' +
        JSON.stringify(patch),
      channels: ['profileConfigUpdated']
    }
  )

  register(
    'get_local_node',
    'Read editable node metadata and revision. Passwords/UUIDs are never returned.',
    z.strictObject({ profileId: profileIdSchema, name: nameSchema }),
    async ({ profileId, name }) => inLocalProfile(profileId, () => readNode(name))
  )

  register(
    'edit_local_node',
    'Edit explicitly supported fields of an existing local node using its revision. Credentials are write-only; file paths, scripts and node type changes are not accepted.',
    z.strictObject({
      profileId: profileIdSchema,
      name: nameSchema,
      revision: revisionSchema,
      patch: nodePatchSchema
    }),
    async ({ profileId, name, revision, patch }) =>
      inLocalProfile(profileId, () => editNode(name, revision, patch)),
    {
      summary: ({ profileId, name, patch }) =>
        i18next.t('settings.mcp.action.editNode', { name }) +
        `\nProfile: ${profileId}\n` +
        JSON.stringify({
          ...patch,
          ...(patch.password !== undefined ? { password: '[redacted]' } : {}),
          ...(patch.uuid !== undefined ? { uuid: '[redacted]' } : {})
        }),
      channels: ['localConfigUpdated', 'groupsUpdated', 'rulesUpdated']
    }
  )

  register(
    'get_local_group',
    'Read an existing local group, available outbound names and revision.',
    z.strictObject({ profileId: profileIdSchema, name: nameSchema }),
    async ({ profileId, name }) => inLocalProfile(profileId, () => readGroup(name))
  )

  register(
    'edit_local_group',
    'Edit the name, explicit outbound members or visibility of an existing local group. Uses a revision and the app compiler/core validator.',
    z.strictObject({
      profileId: profileIdSchema,
      name: nameSchema,
      revision: revisionSchema,
      patch: groupPatchSchema
    }),
    async ({ profileId, name, revision, patch }) =>
      inLocalProfile(profileId, () => editGroup(name, revision, patch)),
    {
      summary: ({ profileId, name, patch }) =>
        i18next.t('settings.mcp.action.editGroup', { name }) +
        `\nProfile: ${profileId}\n` +
        JSON.stringify(patch),
      channels: ['localConfigUpdated', 'groupsUpdated', 'rulesUpdated']
    }
  )

  register(
    'list_local_rules',
    'Read local routing rules, outbound names and the revision needed for edits.',
    z.strictObject({ profileId: profileIdSchema, ...pageSchema }),
    async ({ profileId, offset, limit }) =>
      inLocalProfile(profileId, () => readRules(offset, limit))
  )

  register(
    'edit_local_rule',
    'Add, edit or remove one local routing rule using structured fields and a revision. Applies through the existing compiler/core validator; no YAML or scripts accepted.',
    ruleEditSchema.safeExtend({ profileId: profileIdSchema }),
    async (args) => inLocalProfile(args.profileId, () => editRules(args)),
    {
      summary: ({ profileId, action, index, rule }) =>
        i18next.t('settings.mcp.action.editRule', { action, index }) +
        `\nProfile: ${profileId}\n` +
        JSON.stringify(rule ?? {}),
      channels: ['localConfigUpdated', 'rulesUpdated']
    }
  )

  return mcp
}
