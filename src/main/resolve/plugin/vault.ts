import { mkdir, readFile, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { safeStorage } from 'electron'
import { pluginVaultDir, pluginVaultPath } from '../../utils/dirs'
import { atomicWriteFile, KeyedWriteQueue } from '../../utils/safeFile'
import { logger } from '../../utils/logger'
import { abortable } from './abortable'
import {
  parseGatewayOrigin,
  parseGatewayList,
  isValidEndpointPath,
  normalizeEndpointPath
} from './gateway-url'

// safeStorage 不可用时的会话内内存兜底（仅 Linux；重启即丢）。
const memoryVaults = new Map<string, IPluginVault>()

// vault lock（§0.5）：按 id 串行化所有读写。writeVault / updateVault / removeVault / re-encrypt
// 以及 readVault 的 cache-miss 全路径都在锁内，removeVault 之后排队的写与读都不会让 vault 复活。
// 层级固定：先 plugin lock，再 vault lock；vault lock 内不得再取 plugin lock。
const vaultLocks = new KeyedWriteQueue()

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const TEMPORARILY_UNAVAILABLE = 'temporarily unavailable'

export type VaultReadResult =
  | { kind: 'ok'; vault: IPluginVault }
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | { kind: 'unavailable' }

export class VaultUnavailableError extends Error {
  constructor() {
    super('Plugin vault is temporarily unavailable')
    this.name = 'VaultUnavailableError'
  }
}

type StorageMode = 'persistent-async' | 'persistent-sync' | 'memory' | 'unavailable'

type OptionalAsyncSafeStorage = {
  isAsyncEncryptionAvailable?: () => Promise<boolean>
  encryptStringAsync?: (plainText: string) => Promise<Buffer>
  decryptStringAsync?: (encrypted: Buffer) => Promise<{ result: string; shouldReEncrypt: boolean }>
}

const ENDPOINT_KEYS = ['enroll', 'challenge', 'config', 'revoke'] as const

// 写出前归一化：镜像 gateway.gateway = lastGood ?? gateways[0]，直到明确停止支持应用降级（§2.3）。
function normalizeGatewayState(g: IPluginGatewayState): IPluginGatewayState {
  const lastGood = g.lastGood && g.gateways.includes(g.lastGood) ? g.lastGood : undefined
  const out: IPluginGatewayState = {
    gateway: lastGood ?? g.gateways[0],
    gateways: [...g.gateways],
    endpoints: { ...g.endpoints }
  }
  if (lastGood) out.lastGood = lastGood
  return out
}

function normalizeVault(v: IPluginVault): IPluginVault {
  const stale = (v.staleDevices ?? []).map((d) => ({
    deviceId: d.deviceId,
    devicePrivKey: d.devicePrivKey
  }))
  return {
    devicePrivKey: v.devicePrivKey,
    deviceId: v.deviceId,
    gateway: normalizeGatewayState(v.gateway),
    ...(stale.length > 0 ? { staleDevices: stale } : {})
  }
}

function isDeviceKey(v: unknown): v is string {
  return typeof v === 'string' && Buffer.from(v, 'base64').length === 32
}

// 待回收的旧设备列表：逐项校验，坏的条目丢弃（不让畸形私钥进入签名路径），缺失即空
function parseStaleDevices(raw: unknown): IPluginStaleDevice[] {
  if (!Array.isArray(raw)) return []
  const out: IPluginStaleDevice[] = []
  for (const e of raw) {
    if (typeof e !== 'object' || e === null) continue
    const d = e as Record<string, unknown>
    if (
      typeof d.deviceId !== 'string' ||
      !UUID_V4.test(d.deviceId) ||
      !isDeviceKey(d.devicePrivKey)
    ) {
      continue
    }
    out.push({ deviceId: d.deviceId, devicePrivKey: d.devicePrivKey })
  }
  return out
}

// 校验并归一化从磁盘解密出来的 vault（§2.3）：私钥 32 字节、deviceId 为 UUIDv4、网关为 https origin、
// 四个端点为相对 path。接受旧形态（只有 gateway.gateway）并补出 gateways: [gateway]；lastGood ∉ gateways
// 时丢弃该字段。坏/被篡改的数据返回 null，避免畸形私钥/网关进入签名或网络路径。
export function parseVault(raw: unknown): IPluginVault | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  if (typeof o.devicePrivKey !== 'string' || Buffer.from(o.devicePrivKey, 'base64').length !== 32) {
    return null
  }
  if (typeof o.deviceId !== 'string' || !UUID_V4.test(o.deviceId)) return null
  const g = o.gateway as Record<string, unknown> | undefined
  if (!g) return null
  const primary = parseGatewayOrigin(g.gateway)
  if (!primary) return null
  let gateways: string[]
  if (g.gateways === undefined) {
    gateways = [primary]
  } else {
    const list = parseGatewayList(g.gateways)
    if (!list) return null
    gateways = list
  }
  const e = g.endpoints as Record<string, unknown> | undefined
  if (!e) return null
  const endpoints = {} as IGatewayEndpoints
  for (const k of ENDPOINT_KEYS) {
    const v = e[k]
    if (!isValidEndpointPath(v)) return null
    endpoints[k] = normalizeEndpointPath(v)
  }
  // lastGood 与列表同样经 parseGatewayOrigin 归一化后再比较归属（normalizeGatewayState），
  // 否则大小写 / 默认端口 / 尾部斜杠的差异会让有效首选网关被静默丢弃
  const lastGood = parseGatewayOrigin(g.lastGood) ?? undefined
  return normalizeVault({
    devicePrivKey: o.devicePrivKey,
    deviceId: o.deviceId,
    gateway: { gateway: primary, gateways, endpoints, lastGood },
    staleDevices: parseStaleDevices(o.staleDevices)
  })
}

function isTemporarilyUnavailable(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes(TEMPORARILY_UNAVAILABLE)
}

// Linux：只有系统 secret store（libsecret / kwallet）才是安全后端。没有可用的密码管理器时 Electron 回退到
// basic_text——用固定密钥"加密"，等于明文——不能把设备私钥持久化到它，也不能向它自动重加密：走内存兜底。
// 异步 API 的 isAsyncEncryptionAvailable 在初始化完成后就返回 true，不区分后端，所以要单独看后端名。
const SECURE_LINUX_BACKENDS = new Set(['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'])

function linuxBackendIsSecure(): boolean {
  if (process.platform !== 'linux') return true
  const s = safeStorage as typeof safeStorage & { getSelectedStorageBackend?: () => string }
  if (typeof s.getSelectedStorageBackend !== 'function') return false // 无法确认 → 不落盘
  try {
    return SECURE_LINUX_BACKENDS.has(s.getSelectedStorageBackend())
  } catch {
    return false
  }
}

// 后端名只是启动时的选择：选中的 secret store 之后仍可能初始化失败并回退到固定密钥。Chromium 用固定密钥
// 加密的密文带确定性的 "v10" 前缀（系统 secret store 为 "v11"）：首次判定时加密一段金丝雀，按前缀识别实际
// 使用的密钥提供者。结果按进程缓存。金丝雀加密本身抛错（keyring 暂时锁定等）不算判定、不缓存：固定密钥后端
// 不会抛错，抛错说明 secret store 此刻不可用——随后的解密 / 加密会在各自路径上如实失败，不会有任何数据以
// 未经确认的密钥落盘，而一次暂时的加密失败也不应让本可成功的读取变成 unavailable。
const FIXED_KEY_CIPHERTEXT_PREFIX = 'v10'
let linuxFixedKeyBackend: boolean | undefined

async function linuxUsesFixedKey(mode: 'persistent-async' | 'persistent-sync'): Promise<boolean> {
  if (process.platform !== 'linux') return false
  if (linuxFixedKeyBackend !== undefined) return linuxFixedKeyBackend
  try {
    const canary =
      mode === 'persistent-async'
        ? await safeStorage.encryptStringAsync('plugin-vault-canary')
        : safeStorage.encryptString('plugin-vault-canary')
    linuxFixedKeyBackend = canary.subarray(0, 3).toString('latin1') === FIXED_KEY_CIPHERTEXT_PREFIX
    return linuxFixedKeyBackend
  } catch {
    return false
  }
}

async function storageMode(): Promise<StorageMode> {
  if (!linuxBackendIsSecure()) return 'memory'
  const asyncStorage = safeStorage as typeof safeStorage & OptionalAsyncSafeStorage
  let mode: 'persistent-async' | 'persistent-sync' | undefined
  if (
    typeof asyncStorage.isAsyncEncryptionAvailable === 'function' &&
    typeof asyncStorage.encryptStringAsync === 'function' &&
    typeof asyncStorage.decryptStringAsync === 'function'
  ) {
    try {
      if (await asyncStorage.isAsyncEncryptionAvailable()) mode = 'persistent-async'
    } catch {
      // Fall through to the platform-specific unavailable behavior below.
    }
  } else {
    // Win7/Catalina 兼容包仍使用 Electron 22/32，只有同步 safeStorage API。
    try {
      if (safeStorage.isEncryptionAvailable()) mode = 'persistent-sync'
    } catch {
      // Fall through to the platform-specific unavailable behavior below.
    }
  }
  if (mode && (await linuxUsesFixedKey(mode))) return 'memory'
  if (mode) return mode
  return process.platform === 'linux' ? 'memory' : 'unavailable'
}

export async function isVaultPersistent(): Promise<boolean> {
  const mode = await storageMode()
  return mode === 'persistent-async' || mode === 'persistent-sync'
}

// 在打开 OAuth/enroll 前验证实际加密调用可用。兼容包的同步探测可能触发一次
// Keychain 授权，但发生在浏览器登录和服务端创建设备之前。
export async function ensureVaultWritable(): Promise<void> {
  const mode = await storageMode()
  if (mode === 'memory') return
  if (mode === 'unavailable') throw new VaultUnavailableError()

  try {
    if (mode === 'persistent-async') {
      await safeStorage.encryptStringAsync('plugin-vault-preflight')
    } else {
      safeStorage.encryptString('plugin-vault-preflight')
    }
  } catch {
    throw new VaultUnavailableError()
  }
}

// 启动审计只看内存或文件是否存在，绝不触发 safeStorage/Keychain 访问。
export function hasVaultMaterial(id: string): boolean {
  return memoryVaults.has(id) || existsSync(pluginVaultPath(id))
}

export function withVaultLock<T>(
  id: string,
  task: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  return vaultLocks.run(id, task, signal)
}

async function writeVaultRaw(id: string, vault: IPluginVault): Promise<void> {
  const mode = await storageMode()
  if (mode === 'memory') {
    memoryVaults.set(id, vault)
    return
  }
  if (mode === 'unavailable') throw new VaultUnavailableError()

  let encrypted: Buffer
  try {
    encrypted =
      mode === 'persistent-async'
        ? await safeStorage.encryptStringAsync(JSON.stringify(vault))
        : safeStorage.encryptString(JSON.stringify(vault))
  } catch {
    throw new VaultUnavailableError()
  }

  await mkdir(pluginVaultDir(), { recursive: true })
  await atomicWriteFile(pluginVaultPath(id), encrypted, { mode: 0o600 })
  memoryVaults.set(id, vault)
}

async function writeVaultUnlocked(id: string, vault: IPluginVault): Promise<void> {
  return writeVaultRaw(id, normalizeVault(vault))
}

export function writeVault(id: string, vault: IPluginVault, signal?: AbortSignal): Promise<void> {
  return withVaultLock(id, () => writeVaultUnlocked(id, vault), signal)
}

async function bestEffortReEncrypt(id: string, vault: IPluginVault): Promise<void> {
  try {
    const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(vault))
    await atomicWriteFile(pluginVaultPath(id), encrypted, { mode: 0o600 })
  } catch (error) {
    await logger.warn(`[PluginVault] Failed to rotate encrypted vault ${id}`, error)
  }
}

async function readVaultUnlocked(id: string, signal?: AbortSignal): Promise<VaultReadResult> {
  const cached = memoryVaults.get(id)
  if (cached) return { kind: 'ok', vault: cached }

  const path = pluginVaultPath(id)
  if (!existsSync(path)) return { kind: 'missing' }

  const mode = await storageMode()
  // Linux 的内存兜底只适用于本次会话新建的 vault；已有密文在后端恢复前不可读取。
  if (mode === 'memory' || mode === 'unavailable') return { kind: 'unavailable' }

  // 读文件单独 try：文件系统瞬时错误（EBUSY/EPERM/EMFILE 等，Windows 上杀软或索引服务
  // 短暂锁住刚写完的文件很常见）不代表密文损坏，按“暂时不可用”走退避重试；
  // 若归为 invalid，调用方会把健康插件永久标成 needs-reauth，用户被迫重走 OAuth 并占用设备额度。
  let encrypted: Buffer
  try {
    encrypted = await readFile(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
    return { kind: 'unavailable' }
  }

  try {
    // 同步兼容 API（旧 Electron）会阻塞主线程直到返回，任何代码都无法中途打断它——能做的只有
    // 预算已耗尽时不去启动；异步 API 的迟到结果由 readVault 的 abortable 交给调用方之外处理
    if (mode === 'persistent-sync' && signal?.aborted) return { kind: 'unavailable' }
    const { result, shouldReEncrypt } =
      mode === 'persistent-async'
        ? await safeStorage.decryptStringAsync(encrypted)
        : { result: safeStorage.decryptString(encrypted), shouldReEncrypt: false }
    const parsed = parseVault(JSON.parse(result))
    if (!parsed) return { kind: 'invalid' }

    // 缓存并返回归一化后的对象
    memoryVaults.set(id, parsed)
    if (shouldReEncrypt) await bestEffortReEncrypt(id, parsed)
    return { kind: 'ok', vault: parsed }
  } catch (error) {
    if (isTemporarilyUnavailable(error)) return { kind: 'unavailable' }
    return { kind: 'invalid' }
  }
}

// 缓存命中不取锁；cache-miss 全路径（存在检查 → 读取 → 解密 → parse → 更新缓存 → 可选 re-encrypt）在锁内。
// 锁内的读取本身不可中断（解密 / re-encrypt 必须独占，同步 safeStorage API 也无法取消），但调用方不必等它：
// 预算耗尽时按 CPX_TIMEOUT 返回，op 结束、plugin lock 释放。迟到的结果只在锁内填充缓存（那就是 vault 的
// 真实内容，后续等待者拿到的是它）；锁握到读取真正结束，排队的写不会与它并发。
export async function readVault(id: string, signal?: AbortSignal): Promise<VaultReadResult> {
  const cached = memoryVaults.get(id)
  if (cached) return { kind: 'ok', vault: cached }
  return abortable(
    withVaultLock(id, () => readVaultUnlocked(id, signal), signal),
    signal
  )
}

// 在锁内重新读取最新 vault 再应用修改并整体写回（§0.4 提交出口用它提交 gatewayState）。
// vault 不存在 / 不可读时不写任何东西，返回 false——removeVault 之后排队的 updateVault 不会复活它。
export function updateVault(
  id: string,
  mutator: (vault: IPluginVault) => IPluginVault,
  signal?: AbortSignal
): Promise<boolean> {
  return withVaultLock(
    id,
    async () => {
      const current = await readVaultUnlocked(id)
      if (current.kind !== 'ok') return false
      const next = mutator(current.vault)
      // mutator 返回同一对象表示无变化：不重新加密落盘
      if (next !== current.vault) await writeVaultUnlocked(id, next)
      return true
    },
    signal
  )
}

// 登录补偿专用（§2.5）：只删除属于指定设备的 vault——本次登录写入的新 vault 才删，替换失败时仍然有效的
// 旧设备 vault 保留。missing → 无事可做；invalid → 删除（垃圾）；unavailable → 无法核对归属，保留。
export function removeVaultIfDevice(
  id: string,
  deviceId: string,
  signal?: AbortSignal
): Promise<boolean> {
  return withVaultLock(
    id,
    async () => {
      const current = await readVaultUnlocked(id)
      if (current.kind === 'missing' || current.kind === 'unavailable') return false
      if (current.kind === 'ok' && current.vault.deviceId !== deviceId) return false
      memoryVaults.delete(id)
      await rm(pluginVaultPath(id), { force: true })
      return true
    },
    signal
  )
}

export function removeVault(id: string, signal?: AbortSignal): Promise<void> {
  return withVaultLock(
    id,
    async () => {
      memoryVaults.delete(id)
      await rm(pluginVaultPath(id), { force: true })
    },
    signal
  )
}
