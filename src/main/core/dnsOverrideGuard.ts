import { createHash } from 'crypto'
import { dialog } from 'electron'
import i18next from 'i18next'
import { getAppConfig, getProfile, getProfileConfig, syncAppConfigAfterApply } from '../config'
import { mainWindow } from '../window'
import { createLogger } from '../utils/logger'
import { DEFAULT_CONTROL_DNS } from '../../shared/appConfig'
import { isLocalProfile } from '../../shared/local-config'

const guardLogger = createLogger('DnsOverrideGuard')

const PROFILE_DNS_FIELDS = [
  'proxy-server-nameserver',
  'proxy-server-nameserver-policy',
  'nameserver-policy'
] as const

type ProfileDnsField = (typeof PROFILE_DNS_FIELDS)[number]
export type ProfileDnsFields = Partial<Record<ProfileDnsField, unknown>>

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasContent(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (isPlainObject(value)) return Object.keys(value).length > 0
  return false
}

// 仅探测原始订阅 dns 下的受保护字段。
export function detectProfileDns(profile: unknown): ProfileDnsFields | null {
  if (!isPlainObject(profile) || !isPlainObject(profile.dns)) return null
  const fields: ProfileDnsFields = {}
  for (const key of PROFILE_DNS_FIELDS) {
    const value = profile.dns[key]
    if (hasContent(value)) fields[key] = value
  }
  return Object.keys(fields).length > 0 ? fields : null
}

// 指纹忽略映射键顺序，保留数组顺序。
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    )
  }
  return value
}

// 确认指纹：订阅标识 + 受保护 DNS 内容。
export function profileDnsFingerprint(profileId: string, fields: ProfileDnsFields): string {
  return createHash('sha256')
    .update(JSON.stringify({ profileId, fields: canonicalize(fields) }))
    .digest('hex')
}

// 手动请求仅在内核应用成功后提交。
interface ControlDnsRequest {
  controlDns: boolean
  confirmation: string | null
  applied?: DnsOverrideGuardResult
}

// 确认、请求和待通知状态仅保留在本次进程内。
let confirmedFingerprint: string | null = null
let pendingRequest: ControlDnsRequest | null = null
let pendingAutoDisabledNotice = false

export interface DnsOverrideGuardResult {
  controlDns: boolean
  autoDisabled: boolean
  fingerprint: string | null
  request: ControlDnsRequest | null
}

// 生成保护判定；候选校验（runtime=false）不修改确认，也不使用暂存请求。
export function evaluateDnsOverrideGuard(
  profileId: string,
  profile: unknown,
  controlDns: boolean,
  runtime: boolean,
  guardEnabled = true
): DnsOverrideGuardResult {
  const fields = detectProfileDns(profile)
  const fingerprint = fields ? profileDnsFingerprint(profileId, fields) : null
  if (!guardEnabled) {
    return {
      controlDns,
      autoDisabled: false,
      fingerprint,
      request: runtime ? pendingRequest : null
    }
  }
  if (runtime && confirmedFingerprint !== null && confirmedFingerprint !== fingerprint) {
    confirmedFingerprint = null
  }
  const request = runtime ? pendingRequest : null
  const enabled = request ? request.controlDns : controlDns
  const confirmed =
    fingerprint !== null &&
    (confirmedFingerprint === fingerprint || request?.confirmation === fingerprint)
  const autoDisabled = enabled && fingerprint !== null && !confirmed
  return { controlDns: enabled && !autoDisabled, autoDisabled, fingerprint, request }
}

// 应用后的保存失败只记日志，不影响已完成的操作。
async function persistControlDns(controlDns: boolean): Promise<void> {
  try {
    await syncAppConfigAfterApply({ controlDns })
  } catch (error) {
    guardLogger.error('Failed to persist DNS override state after apply', error)
  }
}

function notifyRenderer(autoDisabled: boolean): void {
  mainWindow?.webContents.send('appConfigUpdated')
  if (autoDisabled) mainWindow?.webContents.send('dnsOverrideAutoDisabled')
}

// 按实际成功应用的配置提交开关、确认及通知。
export async function syncControlDnsAfterApply(applied: DnsOverrideGuardResult): Promise<void> {
  const { request } = applied
  if (request && pendingRequest === request) {
    pendingRequest = null
    request.applied = applied
    confirmedFingerprint = applied.controlDns ? applied.fingerprint : null
    if (applied.autoDisabled) {
      guardLogger.info('Profile changed while enabling DNS override, kept disabled')
      pendingAutoDisabledNotice = true
    }
    await persistControlDns(applied.controlDns)
    notifyRenderer(applied.autoDisabled)
    return
  }
  // 并发更新可能晚于确认提交完成，仍需按实际来源使旧确认失效。
  if (confirmedFingerprint !== null && applied.fingerprint !== confirmedFingerprint) {
    confirmedFingerprint = null
  }
  if (!applied.autoDisabled) return
  const { controlDns = DEFAULT_CONTROL_DNS } = await getAppConfig()
  if (!controlDns) return
  if (applied.fingerprint !== null && applied.fingerprint === confirmedFingerprint) return

  guardLogger.info('Current profile carries custom DNS fields, DNS override disabled')
  pendingAutoDisabledNotice = true
  await persistControlDns(false)
  notifyRenderer(true)
}

// 窗口可见时领取通知；隐藏或最小化时保留。
export async function takeDnsOverrideAutoDisabledNotice(): Promise<boolean> {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    !mainWindow.isVisible() ||
    mainWindow.isMinimized()
  ) {
    return false
  }
  // 读取与清除之间不可插入 await，避免重复领取。
  const pending = pendingAutoDisabledNotice
  pendingAutoDisabledNotice = false
  return pending
}

// 从含自定义 DNS 的订阅切到本地配置时，DNS 改由本地配置提供，与开启 DNS 覆写同样需要确认。
export async function localSwitchNeedsDnsConfirm(targetId: string): Promise<boolean> {
  try {
    const { disableDnsOverrideGuard = false } = await getAppConfig()
    if (disableDnsOverrideGuard) return false
    const { current, items } = await getProfileConfig()
    if (!current || current === targetId) return false
    const find = (id: string): IProfileItem | undefined => items.find((item) => item.id === id)
    if (!isLocalProfile(find(targetId)) || isLocalProfile(find(current))) return false
    return detectProfileDns(await getProfile(current)) !== null
  } catch (error) {
    // 检测失败不阻止切换。
    await guardLogger.warn('Failed to inspect profile DNS before switching to local profile', error)
    return false
  }
}

// 托盘无页面弹窗，用系统对话框给出同样的提示；返回是否仍要切换。
export async function confirmLocalSwitchDns(): Promise<boolean> {
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: i18next.t('dns.overrideGuard.confirmTitle'),
    message: i18next.t('dns.overrideGuard.confirmTitle'),
    detail: i18next.t('dns.overrideGuard.confirmContent'),
    buttons: [i18next.t('dns.overrideGuard.keepOff'), i18next.t('dns.overrideGuard.enableAnyway')],
    defaultId: 0,
    cancelId: 0
  })
  return response === 1
}

async function inspectCurrentProfileDns(): Promise<string | null> {
  const { current } = await getProfileConfig(true)
  const fields = detectProfileDns(await getProfile(current))
  return fields ? profileDnsFingerprint(current ?? 'default', fields) : null
}

// 手动切换：校验当前来源的确认，暂存请求并等待内核应用。
export async function setControlDns(
  enabled: boolean,
  confirmation?: string
): Promise<IControlDnsApplyResult> {
  const { disableDnsOverrideGuard = false } = await getAppConfig()
  let request: ControlDnsRequest
  if (enabled) {
    const source = await inspectCurrentProfileDns()
    if (
      !disableDnsOverrideGuard &&
      source !== null &&
      confirmedFingerprint !== source &&
      confirmation !== source
    ) {
      return { status: 'confirm-required', confirmation: source }
    }
    request = { controlDns: true, confirmation: source }
  } else {
    request = { controlDns: false, confirmation: null }
  }
  pendingRequest = request
  try {
    const { mihomoHotReloadConfig } = await import('./mihomoApi')
    await mihomoHotReloadConfig()
  } finally {
    if (pendingRequest === request) pendingRequest = null
  }
  const applied = request.applied
  // 合并到既有重启时，本请求可能未参与配置生成。
  if (!applied) throw new Error('Core is busy, DNS override change was not applied')
  if (enabled && applied.autoDisabled && applied.fingerprint !== null) {
    // 应用期间来源变化，需重新确认。
    return { status: 'confirm-required', confirmation: applied.fingerprint }
  }
  return { status: 'applied' }
}
