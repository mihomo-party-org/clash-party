import { randomUUID } from 'crypto'
import {
  getPluginItem,
  addPluginItem,
  updatePluginItem,
  removePluginItem,
  patchPluginItem as patchConfig
} from '../../config/plugin'
import { upsertPluginProfile, removePluginProfileContent } from '../../config/profile'
import { getAppConfig } from '../../config/app'
import { mainWindow } from '../../window'
import { parseDescriptor } from './descriptor'
import { discoverGateway } from './discovery'
import { browserLogin, CLIENT_ID } from './oauth'
import { generateDevice } from './device'
import { enroll, fetchConfig, revoke, GatewayError, type GatewayTarget } from './gateway'
import {
  writeVault,
  readVault,
  removeVault,
  hasVaultMaterial,
  ensureVaultWritable,
  VaultUnavailableError
} from './vault'
import { computeBackoff } from './backoff'
import { MAX_PLUGIN_FILE_BYTES } from './constants'
import { fetchRemotePlugin } from './remote'

const DEFAULT_PLUGIN_INTERVAL_MIN = 1440 // 24h

function notifyRenderer(): void {
  mainWindow?.webContents.send('pluginConfigUpdated')
  mainWindow?.webContents.send('profileConfigUpdated')
}

interface NetOpts {
  timeout: number
  proxy?: { host: string; port: number }
}

async function netOpts(item?: IPluginItem): Promise<NetOpts> {
  const { subscriptionTimeout = 30000, pluginUseProxy: globalUseProxy = false } =
    await getAppConfig()
  const useProxy = typeof item?.useProxy === 'boolean' ? item.useProxy : globalUseProxy
  if (!useProxy) return { timeout: subscriptionTimeout }
  const { getControledMihomoConfig } = await import('../../config/controledMihomo')
  const { 'mixed-port': port = 7890 } = await getControledMihomoConfig()
  return { timeout: subscriptionTimeout, proxy: { host: '127.0.0.1', port } }
}

function readDescriptor(fileBytesB64: string): IPluginDescriptor {
  if (Buffer.byteLength(fileBytesB64, 'base64') > MAX_PLUGIN_FILE_BYTES) {
    throw new Error('Plugin file too large')
  }
  const text = Buffer.from(fileBytesB64, 'base64').toString('utf-8')
  return parseDescriptor(text)
}

// 预览：仅解析 + 校验，返回安装确认页展示子集。不建记录、不落盘、不联网。
export async function previewPlugin(fileBytesB64: string): Promise<IPluginDescriptorPreview> {
  const d = readDescriptor(fileBytesB64)
  return {
    name: d.provider.name,
    icon: d.provider.icon,
    site: d.provider.site,
    loginUrl: d.loginUrl,
    spec: d.spec
  }
}

// 安装：解析 + 建 needs-login 记录（无 profileId、不联网）
export async function installPlugin(fileBytesB64: string): Promise<IPluginItem> {
  const d = readDescriptor(fileBytesB64)
  const { pluginUseProxy = false } = await getAppConfig()
  const now = Date.now()
  const record: IPluginItem = {
    id: randomUUID(),
    name: d.provider.name,
    icon: d.provider.icon,
    site: d.provider.site,
    loginUrl: d.loginUrl,
    spec: d.spec,
    status: 'needs-login',
    interval: DEFAULT_PLUGIN_INTERVAL_MIN,
    autoUpdate: true,
    useProxy: pluginUseProxy,
    created: now,
    updated: now
  }
  await addPluginItem(record)
  notifyRenderer()
  return record
}

export async function installRemotePlugin(url: string): Promise<IPluginItem> {
  return installPlugin(await fetchRemotePlugin(url))
}

// 写订阅 profile + 回填 profileId + 置 active + 清失败状态（首次登录与复用设备登录共用）
async function finishLogin(id: string, record: IPluginItem, content: string): Promise<void> {
  const profileId = record.profileId ?? randomUUID()
  await upsertPluginProfile(
    {
      profileId,
      pluginId: id,
      name: record.name,
      interval: record.interval ?? DEFAULT_PLUGIN_INTERVAL_MIN,
      autoUpdate: record.autoUpdate ?? true
    },
    content
  )
  await updatePluginItem({
    ...record,
    profileId,
    status: 'active',
    updated: Date.now(),
    failureCount: 0,
    lastUpdateErrorType: undefined,
    lastUpdateErrorAt: undefined,
    nextRetryAt: undefined
  })
  notifyRenderer()
}

// 把登录过程中的底层错误映射为脱敏类别，避免网关 host / DNS / TLS 细节经 IPC 泄露到 renderer（spec §8/§13）。
function sanitizeLoginError(e: unknown): Error {
  if (e instanceof GatewayError) {
    return new Error(e.kind === 'revoked' ? 'PLUGIN_LOGIN_REVOKED' : 'PLUGIN_LOGIN_NETWORK')
  }
  return new Error('PLUGIN_LOGIN_FAILED')
}

// 登录（首次登录与重新认证同一入口）。对外抛错经 sanitizeLoginError 脱敏。
export async function loginPlugin(id: string): Promise<void> {
  try {
    await runLogin(id)
  } catch (e) {
    throw sanitizeLoginError(e)
  }
}

// 设备复用仅限「needs-login 且已有 vault」这一种情形：上次 enroll 成功但首份订阅拉取失败留下的
// “孤儿设备”，重拉即可，避免每次重试都 enroll 新设备、消耗服务端设备数上限。
// 其它情形——needs-reauth（显式重新登录）、active（刷新）、无 vault（首装/换机/Linux 无 safeStorage）——
// 一律走全新浏览器登录 + 新设备，与 spec §9「reauth = 再走一次 login 流程、新设备密钥」一致。
async function runLogin(id: string): Promise<void> {
  const record = await getPluginItem(id)
  if (!record) throw new Error('Plugin not found')
  const net = await netOpts(record)

  const existingResult = await readVault(id)
  if (existingResult.kind === 'unavailable') throw new VaultUnavailableError()
  const existing = existingResult.kind === 'ok' ? existingResult.vault : undefined
  if (existing && record.status === 'needs-login') {
    try {
      const content = await fetchWithRediscovery(id, record, existing, net)
      await finishLogin(id, record, content)
      return
    } catch (e) {
      // 孤儿设备已被吊销 → 丢弃旧 vault，落到下面的全新浏览器登录 + 新设备
      if (!(e instanceof GatewayError && e.kind === 'revoked')) throw e
      await removeVault(id)
    }
  }

  // 先确认 Keychain/secret store 可以实际加密，再打开 OAuth 和 enroll，避免用户完成
  // 浏览器登录后才发现私钥无法持久化。旧 Electron 兼容包会在这里走同步探测。
  await ensureVaultWritable()

  const wk = await discoverGateway(record.loginUrl, net)
  const target: GatewayTarget = { gateway: wk.gateway, endpoints: wk.endpoints }
  const dev = generateDevice()
  const oauth = await browserLogin(record.loginUrl)
  await enroll(
    target,
    {
      code: oauth.code,
      code_verifier: oauth.verifier,
      redirect_uri: oauth.redirectUri,
      client_id: CLIENT_ID,
      devicePubKey: dev.pubKeyB64,
      deviceId: dev.deviceId
    },
    net
  )
  const newVault: IPluginVault = {
    devicePrivKey: dev.privKeyB64,
    deviceId: dev.deviceId,
    gateway: target
  }
  try {
    await writeVault(id, newVault)
  } catch (error) {
    // enroll 已成功但凭据无法持久化时，立即用仍在内存中的新密钥回收设备，
    // 避免用户重试登录不断消耗服务端设备额度。
    try {
      await revoke(target, { deviceId: dev.deviceId, privKeyB64: dev.privKeyB64 }, net)
    } catch {
      // best-effort
    }
    throw error
  }
  const content = await fetchConfig(
    target,
    { deviceId: dev.deviceId, privKeyB64: dev.privKeyB64 },
    net
  )
  await finishLogin(id, record, content)
}

// 对一次网关操作做“缓存网关 retired/unreachable（410、gateway_retired，或 DNS/连接/TLS 失败）时，
// 用 loginUrl 重新发现并重试一次”的包装（支撑可轮换网关、旧域名退役自愈，spec §5）。
// 拉订阅与 revoke 共用，确保网关轮换后删除插件仍能解绑服务端设备。
async function withGatewayRediscovery<T>(
  id: string,
  loginUrl: string,
  vault: IPluginVault,
  net: NetOpts,
  op: (target: GatewayTarget) => Promise<T>
): Promise<T> {
  try {
    return await op(vault.gateway)
  } catch (e) {
    if (e instanceof GatewayError && (e.kind === 'retired' || e.kind === 'unreachable')) {
      const wk = await discoverGateway(loginUrl, net)
      const target: GatewayTarget = { gateway: wk.gateway, endpoints: wk.endpoints }
      await writeVault(id, { ...vault, gateway: target })
      return await op(target)
    }
    throw e
  }
}

function fetchWithRediscovery(
  id: string,
  record: IPluginItem,
  vault: IPluginVault,
  net: NetOpts
): Promise<string> {
  const cred = { deviceId: vault.deviceId, privKeyB64: vault.devicePrivKey }
  return withGatewayRediscovery(id, record.loginUrl, vault, net, (target) =>
    fetchConfig(target, cred, net)
  )
}

async function recordTransientUpdateFailure(record: IPluginItem): Promise<void> {
  const now = Date.now()
  const failureCount = (record.failureCount ?? 0) + 1
  const { nextRetryAt } = computeBackoff(failureCount, now)
  await updatePluginItem({
    ...record,
    lastUpdateErrorType: 'transient',
    lastUpdateErrorAt: now,
    failureCount,
    nextRetryAt
  })
}

// 自动/手动更新（静默，不弹浏览器）
export async function updatePluginProfile(id: string, force = false): Promise<void> {
  const record = await getPluginItem(id)
  if (!record) return
  if (record.status === 'needs-login' || record.status === 'needs-reauth') return
  // active/needs-reauth 态必须有 profileId（spec §10）。损坏/迁移异常导致 active 无 profileId 时，
  // 标 needs-reauth 而非用 undefined 拼出 profiles/undefined.yaml。
  if (!record.profileId) {
    await updatePluginItem({
      ...record,
      status: 'needs-reauth',
      updated: Date.now(),
      nextRetryAt: undefined
    })
    notifyRenderer()
    return
  }
  if (!force && record.nextRetryAt && Date.now() < record.nextRetryAt) return
  const vaultResult = await readVault(id)
  if (vaultResult.kind === 'unavailable') {
    await recordTransientUpdateFailure(record)
    notifyRenderer()
    return
  }
  if (vaultResult.kind !== 'ok') {
    await updatePluginItem({
      ...record,
      status: 'needs-reauth',
      updated: Date.now(),
      nextRetryAt: undefined
    })
    notifyRenderer()
    return
  }
  const vault = vaultResult.vault
  const net = await netOpts(record)
  try {
    const content = await fetchWithRediscovery(id, record, vault, net)
    await upsertPluginProfile(
      {
        profileId: record.profileId!,
        pluginId: id,
        name: record.name,
        interval: record.interval ?? DEFAULT_PLUGIN_INTERVAL_MIN,
        autoUpdate: record.autoUpdate ?? true
      },
      content
    )
    await updatePluginItem({
      ...record,
      status: 'active',
      updated: Date.now(),
      failureCount: 0,
      lastUpdateErrorType: undefined,
      lastUpdateErrorAt: undefined,
      nextRetryAt: undefined
    })
  } catch (e) {
    const now = Date.now()
    if (e instanceof GatewayError && e.kind === 'revoked') {
      await updatePluginItem({
        ...record,
        status: 'needs-reauth',
        lastUpdateErrorType: 'auth',
        lastUpdateErrorAt: now,
        nextRetryAt: undefined
      })
    } else {
      await recordTransientUpdateFailure(record)
    }
  }
  notifyRenderer()
}

// 启动审计只检查 vault 文件/内存是否存在，不触发 safeStorage/Keychain 解密。
// active 但材料缺失（如 Linux 内存兜底重启）→ needs-reauth。
export async function auditPluginVault(id: string): Promise<void> {
  const record = await getPluginItem(id)
  if (!record || record.status !== 'active') return
  if (hasVaultMaterial(id)) return
  await updatePluginItem({
    ...record,
    status: 'needs-reauth',
    updated: Date.now(),
    nextRetryAt: undefined
  })
  notifyRenderer()
}

// best-effort 通知服务端解绑设备。删除插件的两个入口——插件管理 removePlugin 与 profiles 列表
// 删除（profile.ts removeProfileItem 级联）——都经此函数，避免服务端设备绑定残留。失败不抛。
export async function revokePluginDevice(id: string): Promise<void> {
  const vaultResult = await readVault(id)
  if (vaultResult.kind !== 'ok') return
  const vault = vaultResult.vault
  const record = await getPluginItem(id)
  const cred = { deviceId: vault.deviceId, privKeyB64: vault.devicePrivKey }
  const net = await netOpts(record ?? undefined)
  try {
    // 网关轮换后旧 gateway 可能 retired/unreachable：用 loginUrl 重新发现再 revoke，避免设备绑定残留
    if (record) {
      await withGatewayRediscovery(id, record.loginUrl, vault, net, (target) =>
        revoke(target, cred, net)
      )
    } else {
      await revoke(vault.gateway, cred, net)
    }
  } catch {
    // best-effort: 服务端解绑失败不阻塞本地删除
  }
}

export async function removePlugin(id: string): Promise<void> {
  const record = await getPluginItem(id)
  // 先 revoke（需要 vault），再删 vault；之后才删 profile，使级联里的 revoke 成为无 vault 的 no-op，
  // 避免对同一设备重复 revoke。
  await revokePluginDevice(id)
  await removeVault(id)
  if (record?.profileId) await removePluginProfileContent(record.profileId)
  await removePluginItem(id)
  notifyRenderer()
}

export async function patchPluginItem(id: string, patch: Partial<IPluginItem>): Promise<void> {
  await patchConfig(id, patch)
  notifyRenderer()
}
