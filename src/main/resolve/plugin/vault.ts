import { mkdir, readFile, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { safeStorage } from 'electron'
import { pluginVaultDir, pluginVaultPath } from '../../utils/dirs'
import { atomicWriteFile } from '../../utils/safeFile'
import { logger } from '../../utils/logger'
import { parseGatewayOrigin, isValidEndpointPath } from './gateway-url'

// safeStorage 不可用时的会话内内存兜底（仅 Linux；重启即丢）。
const memoryVaults = new Map<string, IPluginVault>()

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

// 校验从磁盘解密出来的 vault 结构（私钥 32 字节、deviceId 为 UUIDv4、网关为 https origin、
// 四个端点为相对 path）。坏/被篡改的数据按 invalid 处理，避免畸形私钥/网关进入签名或网络路径。
function isValidVault(v: unknown): v is IPluginVault {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (typeof o.devicePrivKey !== 'string' || Buffer.from(o.devicePrivKey, 'base64').length !== 32) {
    return false
  }
  if (typeof o.deviceId !== 'string' || !UUID_V4.test(o.deviceId)) return false
  const g = o.gateway as Record<string, unknown> | undefined
  if (!g || parseGatewayOrigin(g.gateway) === null) return false
  const e = g.endpoints as Record<string, unknown> | undefined
  if (!e) return false
  for (const k of ['enroll', 'challenge', 'config', 'revoke']) {
    if (!isValidEndpointPath(e[k])) return false
  }
  return true
}

function isTemporarilyUnavailable(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes(TEMPORARILY_UNAVAILABLE)
}

async function storageMode(): Promise<StorageMode> {
  const asyncStorage = safeStorage as typeof safeStorage & OptionalAsyncSafeStorage
  if (
    typeof asyncStorage.isAsyncEncryptionAvailable === 'function' &&
    typeof asyncStorage.encryptStringAsync === 'function' &&
    typeof asyncStorage.decryptStringAsync === 'function'
  ) {
    try {
      if (await asyncStorage.isAsyncEncryptionAvailable()) return 'persistent-async'
    } catch {
      // Fall through to the platform-specific unavailable behavior below.
    }
  } else {
    // Win7/Catalina 兼容包仍使用 Electron 22/32，只有同步 safeStorage API。
    try {
      if (safeStorage.isEncryptionAvailable()) return 'persistent-sync'
    } catch {
      // Fall through to the platform-specific unavailable behavior below.
    }
  }
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

export async function writeVault(id: string, vault: IPluginVault): Promise<void> {
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

async function bestEffortReEncrypt(id: string, vault: IPluginVault): Promise<void> {
  try {
    const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(vault))
    await atomicWriteFile(pluginVaultPath(id), encrypted, { mode: 0o600 })
  } catch (error) {
    await logger.warn(`[PluginVault] Failed to rotate encrypted vault ${id}`, error)
  }
}

export async function readVault(id: string): Promise<VaultReadResult> {
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
    const { result, shouldReEncrypt } =
      mode === 'persistent-async'
        ? await safeStorage.decryptStringAsync(encrypted)
        : { result: safeStorage.decryptString(encrypted), shouldReEncrypt: false }
    const parsed = JSON.parse(result) as unknown
    if (!isValidVault(parsed)) return { kind: 'invalid' }

    memoryVaults.set(id, parsed)
    if (shouldReEncrypt) await bestEffortReEncrypt(id, parsed)
    return { kind: 'ok', vault: parsed }
  } catch (error) {
    if (isTemporarilyUnavailable(error)) return { kind: 'unavailable' }
    return { kind: 'invalid' }
  }
}

export async function removeVault(id: string): Promise<void> {
  memoryVaults.delete(id)
  await rm(pluginVaultPath(id), { force: true })
}
