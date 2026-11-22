import { createHmac, randomBytes } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import * as z from 'zod/v4'
import { getProfileConfig } from '../config'
import { updateProfileConfig } from '../config/profile'
import { addProfileUpdater } from '../core/profileUpdater'
import {
  getLocalNode,
  getLocalProxyGroup,
  getLocalRulesEditor,
  saveLocalNode,
  saveLocalProxyGroup,
  saveLocalRules
} from '../local/service'
import { listLocalNodeFields } from '../../shared/local-node'
import { isLocalProfile } from '../../shared/local-config'
import { withLocalProfileScope } from '../local/store'
import { McpToolError } from './errors'
import { publicScalar } from './security'

// A keyed revision detects stale edits without publishing a hash of credentials.
const revisionKey = randomBytes(32)
const revisionScope = new AsyncLocalStorage<string>()
export function revisionOf(value: unknown): string {
  return createHmac('sha256', revisionKey)
    .update(JSON.stringify([revisionScope.getStore() ?? null, value]))
    .digest('hex')
}

export const revisionSchema = z.string().regex(/^[a-f0-9]{64}$/)
export const displayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[^,\p{Cc}\p{Cf}]+$/u)

export async function inLocalProfile<T>(profileId: string, run: () => Promise<T>): Promise<T> {
  const { current, items } = await getProfileConfig()
  if (
    current !== profileId ||
    !items?.some((item) => item.id === profileId && isLocalProfile(item))
  ) {
    throw new McpToolError(
      'The requested local profile is no longer active. Select it and read the target again.',
      'CONFLICT'
    )
  }
  // Keep reads and writes bound to this file even if the UI switches profile during validation.
  return revisionScope.run(profileId, () => withLocalProfileScope(profileId, run))
}

function assertRevision(value: unknown, expected: string): void {
  if (revisionOf(value) !== expected) {
    throw new McpToolError(
      'The target changed. Read it again and use the new revision.',
      'CONFLICT'
    )
  }
}

const nonEmptyPatch = (value: object): boolean => Object.keys(value).length > 0
export const profilePatchSchema = z
  .strictObject({
    name: displayNameSchema.optional(),
    autoUpdate: z.boolean().optional(),
    interval: z.number().int().min(1).max(35791).optional(),
    useProxy: z.boolean().optional(),
    updateTimeout: z.number().int().min(1).max(300).optional()
  })
  .refine(nonEmptyPatch, 'Provide at least one editable field.')

export async function editProfile(
  profileId: string,
  revision: string,
  patch: z.output<typeof profilePatchSchema>
): Promise<unknown> {
  let updated: IProfileItem | undefined
  await updateProfileConfig((config) => {
    const index = config.items.findIndex((item) => item.id === profileId)
    if (index === -1) throw new McpToolError('Profile does not exist.', 'NOT_FOUND')
    const item = config.items[index]
    assertRevision(item, revision)
    if (item.pluginId || item.type !== 'remote') {
      if (Object.keys(patch).some((key) => key !== 'name')) {
        throw new McpToolError(
          'Only the name can be edited for a local or plugin-managed profile.',
          'INVALID_ARGUMENT'
        )
      }
    }
    updated = { ...item, ...patch }
    config.items[index] = updated
    return config
  })
  if (!updated) throw new McpToolError('Profile update did not complete.', 'BACKEND_ERROR')
  await addProfileUpdater(updated)
  return { revision: revisionOf(updated) }
}

export const nodePatchSchema = z
  .strictObject({
    name: displayNameSchema.optional(),
    server: z
      .string()
      .min(1)
      .max(253)
      .regex(/^[a-zA-Z0-9.:[\]_-]+$/)
      .optional(),
    port: z.number().int().min(1).max(65535).optional(),
    udp: z.boolean().optional(),
    password: z.string().max(4096).optional(),
    uuid: z.uuid().optional()
  })
  .refine(nonEmptyPatch, 'Provide at least one editable field.')

export async function readNode(name: string): Promise<unknown> {
  const node = await getLocalNode(name)
  return {
    name: publicScalar(node.name),
    type: publicScalar(node.type),
    server: publicScalar(node.server),
    port: publicScalar(node.port),
    udp: publicScalar(node.udp),
    editableFields: editableNodeFields(node),
    revision: revisionOf(node)
  }
}

function editableNodeFields(node: Record<string, unknown>): string[] {
  const supported = new Set(listLocalNodeFields(String(node.type)).map((field) => field.path))
  return ['name', 'server', 'port', 'udp', 'password', 'uuid'].filter(
    (key) => key === 'name' || supported.has(key)
  )
}

export async function editNode(
  name: string,
  revision: string,
  patch: z.output<typeof nodePatchSchema>
): Promise<unknown> {
  const node = await getLocalNode(name)
  assertRevision(node, revision)
  const editable = editableNodeFields(node)
  if (Object.keys(patch).some((key) => !editable.includes(key))) {
    throw new McpToolError(
      'This node type does not support one or more requested fields. Read editableFields first.',
      'INVALID_ARGUMENT'
    )
  }
  await saveLocalNode(name, { ...node, ...patch }, node)
  return { success: true }
}

export const groupPatchSchema = z
  .strictObject({
    name: displayNameSchema.optional(),
    proxies: z
      .array(displayNameSchema)
      .min(1)
      .max(200)
      .refine((items) => new Set(items).size === items.length, 'Duplicate members are not allowed.')
      .optional(),
    hidden: z.boolean().optional()
  })
  .refine(nonEmptyPatch, 'Provide at least one editable field.')

export async function readGroup(name: string): Promise<unknown> {
  const { group, outbounds } = await getLocalProxyGroup(name)
  return {
    name: publicScalar(group.name),
    type: publicScalar(group.type),
    proxies: Array.isArray(group.proxies)
      ? group.proxies.filter((item) => typeof item === 'string')
      : [],
    hidden: publicScalar(group.hidden),
    availableOutbounds: outbounds,
    revision: revisionOf(group)
  }
}

export async function editGroup(
  name: string,
  revision: string,
  patch: z.output<typeof groupPatchSchema>
): Promise<unknown> {
  const { group, outbounds } = await getLocalProxyGroup(name)
  assertRevision(group, revision)
  if (patch.proxies?.some((proxy) => proxy === name || !outbounds.includes(proxy))) {
    throw new McpToolError(
      'Group members must be existing outbounds and cannot include the group itself.',
      'INVALID_ARGUMENT'
    )
  }
  await saveLocalProxyGroup(name, { ...group, ...patch }, group)
  return { success: true }
}

export async function readRules(offset: number, limit: number): Promise<unknown> {
  const { rules, outbounds } = await getLocalRulesEditor()
  return {
    items: rules
      .slice(offset, offset + limit)
      .map((rule, index) => ({ index: offset + index, rule })),
    total: rules.length,
    nextOffset: offset + limit < rules.length ? offset + limit : null,
    outbounds,
    revision: revisionOf(rules)
  }
}

const ruleTypeSchema = z.enum([
  'DOMAIN',
  'DOMAIN-SUFFIX',
  'DOMAIN-KEYWORD',
  'IP-CIDR',
  'IP-CIDR6',
  'GEOIP',
  'SRC-IP-CIDR',
  'SRC-PORT',
  'DST-PORT',
  'PROCESS-NAME',
  'NETWORK',
  'MATCH'
])
export const ruleEditSchema = z
  .strictObject({
    revision: revisionSchema,
    action: z.enum(['add', 'edit', 'remove']),
    index: z.number().int().min(0).max(100000),
    rule: z
      .strictObject({
        type: ruleTypeSchema,
        payload: z
          .string()
          .min(1)
          .max(1024)
          .regex(/^[^,()\p{Cc}\p{Cf}]+$/u)
          .optional(),
        target: displayNameSchema,
        noResolve: z.boolean().default(false)
      })
      .optional()
  })
  .superRefine((value, ctx) => {
    if (value.action !== 'remove' && !value.rule)
      ctx.addIssue({ code: 'custom', message: 'A structured rule is required.' })
    if (value.action === 'remove' && value.rule)
      ctx.addIssue({ code: 'custom', message: 'Remove does not accept a rule.' })
    if (value.rule && value.rule.type !== 'MATCH' && !value.rule.payload)
      ctx.addIssue({ code: 'custom', message: 'This rule type requires a payload.' })
    if (value.rule?.type === 'MATCH' && (value.rule.payload || value.rule.noResolve))
      ctx.addIssue({ code: 'custom', message: 'MATCH accepts only a target.' })
    if (
      value.rule?.noResolve &&
      !['IP-CIDR', 'IP-CIDR6', 'GEOIP', 'SRC-IP-CIDR'].includes(value.rule.type)
    )
      ctx.addIssue({ code: 'custom', message: 'noResolve is only supported for IP-based rules.' })
  })

export async function editRules(input: z.output<typeof ruleEditSchema>): Promise<unknown> {
  const { rules, outbounds } = await getLocalRulesEditor()
  assertRevision(rules, input.revision)
  if (input.index > rules.length || (input.action !== 'add' && input.index === rules.length)) {
    throw new McpToolError('Rule index is outside the current list.', 'NOT_FOUND')
  }
  if (input.action === 'remove') {
    await saveLocalRules({ action: 'remove', index: input.index }, rules)
  } else {
    const rule = input.rule
    if (!rule) throw new McpToolError('A structured rule is required.', 'INVALID_ARGUMENT')
    if (!outbounds.includes(rule.target))
      throw new McpToolError('Rule target is not an existing outbound.', 'INVALID_ARGUMENT')
    const value = [
      rule.type,
      ...(rule.type === 'MATCH' ? [] : [rule.payload]),
      rule.target,
      ...(rule.noResolve ? ['no-resolve'] : [])
    ].join(',')
    await saveLocalRules({ action: input.action, index: input.index, value }, rules)
  }
  return { success: true }
}
