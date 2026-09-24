import { existsSync, readFileSync } from 'fs'
import { pluginConfigPath } from '../utils/dirs'
import { atomicWriteFile, WriteQueue } from '../utils/safeFile'
import { parse, stringify } from '../utils/yaml'
import { makeFallbackId, normalizeConfigIds } from './normalizeIds'

let pluginConfig: IPluginConfig | undefined
const writeQueue = new WriteQueue()

// 插件记录的调度默认值：安装时写入 interval；autoUpdate 缺省视为开启
export const DEFAULT_PLUGIN_INTERVAL_MIN = 1440 // 24h

// profile 侧的调度字段以插件记录为准；这里是唯一的解析点（缺省值只在此处出现）
export function pluginSchedule(item?: IPluginItem): { interval: number; autoUpdate: boolean } {
  return {
    interval: item?.interval ?? DEFAULT_PLUGIN_INTERVAL_MIN,
    autoUpdate: item?.autoUpdate ?? true
  }
}

// §5.3：discoverySeq / discoveryDigest 是成对的提交标记，同时存在或同时缺失；半截状态视为未设置。
export function normalizeDiscoveryMarker(item: IPluginItem): void {
  const seqOk = Number.isSafeInteger(item.discoverySeq) && (item.discoverySeq as number) >= 1
  const digestOk =
    typeof item.discoveryDigest === 'string' && /^[0-9a-f]{64}$/.test(item.discoveryDigest)
  if (seqOk && digestOk) return
  delete item.discoverySeq
  delete item.discoveryDigest
}

// 从磁盘读取并规范化，赋给全局缓存。只能在 writeQueue 内调用（loadLocked / update 内）。
function loadUnlocked(): void {
  if (existsSync(pluginConfigPath())) {
    pluginConfig = parseSync()
  } else {
    pluginConfig = { items: [] }
  }
  if (typeof pluginConfig !== 'object' || pluginConfig === null) pluginConfig = { items: [] }
  if (!Array.isArray(pluginConfig.items)) pluginConfig.items = []
  pluginConfig = normalizeConfigIds(pluginConfig, makeFallbackId)
  for (const item of pluginConfig.items) normalizeDiscoveryMarker(item)
}

function parseSync(): IPluginConfig {
  return parse<IPluginConfig>(readFileSync(pluginConfigPath(), 'utf-8'))
}

export async function getPluginConfig(force = false): Promise<IPluginConfig> {
  // 磁盘加载必须与写入串行：否则一次迟到的冷启动读取会用旧内容覆盖已提交的更新缓存，
  // 让签名发现的 seq 回退检查（index.ts 从此缓存读 discoverySeq）失效。命中缓存的读取无需入队。
  if (force || !pluginConfig) {
    await writeQueue.run(async () => {
      if (force || !pluginConfig) loadUnlocked()
    })
  }
  return JSON.parse(
    JSON.stringify(normalizeConfigIds(pluginConfig ?? { items: [] }, makeFallbackId))
  ) as IPluginConfig
}

async function update(updater: (c: IPluginConfig) => IPluginConfig): Promise<void> {
  await writeQueue.run(async () => {
    if (!pluginConfig) loadUnlocked()
    const current = JSON.parse(
      JSON.stringify(normalizeConfigIds(pluginConfig ?? { items: [] }, makeFallbackId))
    ) as IPluginConfig
    const next = updater(current)
    await atomicWriteFile(pluginConfigPath(), stringify(next), { encoding: 'utf8' })
    pluginConfig = next
  })
}

export async function getPluginItem(id: string): Promise<IPluginItem | undefined> {
  const { items } = await getPluginConfig()
  return items.find((i) => i.id === id)
}

export async function addPluginItem(newItem: IPluginItem): Promise<void> {
  await update((c) => {
    const idx = c.items.findIndex((i) => i.id === newItem.id)
    if (idx === -1) c.items.push(newItem)
    else c.items[idx] = newItem
    return c
  })
}

export async function updatePluginItem(newItem: IPluginItem): Promise<void> {
  await update((c) => {
    const idx = c.items.findIndex((i) => i.id === newItem.id)
    if (idx === -1) throw new Error('Plugin not found')
    c.items[idx] = newItem
    return c
  })
}

export async function patchPluginItem(id: string, patch: Partial<IPluginItem>): Promise<void> {
  await update((c) => {
    const idx = c.items.findIndex((i) => i.id === id)
    if (idx === -1) throw new Error('Plugin not found')
    c.items[idx] = { ...c.items[idx], ...patch }
    return c
  })
}

export async function removePluginItem(id: string): Promise<void> {
  await update((c) => {
    c.items = c.items.filter((i) => i.id !== id)
    return c
  })
}
