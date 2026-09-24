import { Cron } from 'croner'
import {
  addProfileItem,
  getAppConfig,
  getCurrentProfileItem,
  getProfileConfig,
  getProfileItem
} from '../config'
import { logger } from '../utils/logger'

const intervalPool: Record<string, Cron | NodeJS.Timeout> = {}
const delayedUpdatePool: Record<string, NodeJS.Timeout> = {}
const updatingProfileIds = new Set<string>()

// 定时触发的订阅刷新至少间隔 1 分钟
const MIN_INTERVAL_MS = 60 * 1000
const MAX_TIMER_DELAY_MS = 2_147_483_647

function safeIntervalMs(minutes: unknown): number {
  const requestedMs = Number(minutes) * 60 * 1000
  if (!Number.isFinite(requestedMs) || requestedMs <= 0) return MIN_INTERVAL_MS
  return Math.min(Math.max(requestedMs, MIN_INTERVAL_MS), MAX_TIMER_DELAY_MS)
}

function intervalDelayMs(interval: unknown): number | undefined {
  const minutes = Number(interval)
  if (!Number.isFinite(minutes) || minutes <= 0) return undefined
  return safeIntervalMs(minutes)
}

async function updateProfile(id: string): Promise<void> {
  if (updatingProfileIds.has(id)) return
  updatingProfileIds.add(id)
  try {
    const item = await getProfileItem(id)
    if (item && item.type === 'remote') {
      await addProfileItem(item)
      // 后台定时更新完成后主动通知渲染层，否则订阅列表的更新时间/流量要等窗口重新聚焦才刷新（#1570）
      // 动态 import 避免与 window.ts 形成静态循环依赖
      const { mainWindow } = await import('../window')
      mainWindow?.webContents.send('profileConfigUpdated')
    } else if (item && item.type === 'plugin' && item.pluginId) {
      const { updatePluginProfile } = await import('../resolve/plugin')
      await updatePluginProfile(item.pluginId)
    }
  } finally {
    updatingProfileIds.delete(id)
  }
}

async function auditPluginProfileVault(item: IProfileItem): Promise<void> {
  if (item.type !== 'plugin' || !item.pluginId) return
  try {
    const { auditPluginVault } = await import('../resolve/plugin')
    await auditPluginVault(item.pluginId)
  } catch (e) {
    await logger.warn(`[ProfileUpdater] Failed to audit plugin vault ${item.pluginId}:`, e)
  }
}

function updateTask(itemId: string, logLabel: string): () => Promise<void> {
  return async () => {
    try {
      await updateProfile(itemId)
    } catch (e) {
      await logger.warn(`[ProfileUpdater] Failed to update ${logLabel}:`, e)
    }
  }
}

function scheduleProfileUpdate(item: IProfileItem): void {
  if ((item.type !== 'remote' && item.type !== 'plugin') || !item.autoUpdate || !item.interval)
    return

  const itemId = item.id
  const logLabel = `profile ${itemId}`
  const delayMs = intervalDelayMs(item.interval)
  if (delayMs) {
    intervalPool[itemId] = setInterval(updateTask(itemId, logLabel), delayMs)
    return
  }

  if (typeof item.interval !== 'string') return

  const cronExpression = item.interval.trim()
  // 只接受 5 段 cron；6 段 cron 带秒，会绕过 UI 造成秒级刷新。
  if (cronExpression.split(/\s+/).length !== 5) return

  try {
    intervalPool[itemId] = new Cron(cronExpression, updateTask(itemId, logLabel))
  } catch {
    // ignore invalid cron
  }
}

function scheduleDelayedCurrentUpdate(item: IProfileItem): void {
  const delayMs = intervalDelayMs(item.interval)
  if (!delayMs) return

  const itemId = item.id
  delayedUpdatePool[itemId] = setTimeout(
    async () => {
      delete delayedUpdatePool[itemId]
      try {
        await updateProfile(itemId)
      } catch (e) {
        await logger.warn(`[ProfileUpdater] Failed to update current profile:`, e)
      }
    },
    Math.min(delayMs + 10000, MAX_TIMER_DELAY_MS)
  )
}

export async function initProfileUpdater(): Promise<void> {
  const { autoUpdateProfileOnStart = true } = await getAppConfig()
  const { items = [], current } = await getProfileConfig()
  const currentItem = await getCurrentProfileItem()

  for (const item of items.filter((i) => i.id !== current)) {
    await auditPluginProfileVault(item)

    if (item.type === 'remote' && item.autoUpdate && item.interval) {
      await addProfileUpdater(item)

      if (autoUpdateProfileOnStart) {
        try {
          await addProfileItem(item)
        } catch (e) {
          await logger.warn(`[ProfileUpdater] Failed to init profile ${item.name}:`, e)
        }
      }
    }

    if (item.type === 'plugin' && item.autoUpdate && item.interval) {
      await addProfileUpdater(item)
    }
  }

  await auditPluginProfileVault(currentItem)

  if (currentItem?.type === 'remote' && currentItem.autoUpdate && currentItem.interval) {
    const currentId = currentItem.id
    await addProfileUpdater(currentItem)

    if (autoUpdateProfileOnStart) {
      try {
        await addProfileItem(currentItem)
      } catch (e) {
        await logger.warn(`[ProfileUpdater] Failed to init current profile:`, e)
      }
    }

    const latestCurrentItem = (await getProfileItem(currentId)) ?? currentItem
    scheduleDelayedCurrentUpdate(latestCurrentItem)
  }

  if (
    currentItem?.type === 'plugin' &&
    currentItem.autoUpdate &&
    currentItem.interval &&
    currentItem.id !== 'default'
  ) {
    await addProfileUpdater(currentItem)
  }
}

export async function addProfileUpdater(item: IProfileItem): Promise<void> {
  await removeProfileUpdater(item.id)
  scheduleProfileUpdate(item)
}

// CLI / 计划任务入口：强制刷新全部可更新订阅（#884）
export function findSubscriptionUpdateFlag(args: string[]): boolean {
  return args.some((arg) => arg.toLowerCase() === '--update-subscription')
}

export async function forceUpdateAllProfiles(): Promise<void> {
  const { items = [] } = await getProfileConfig()
  const targets = items.filter((i) => i.type === 'remote' || (i.type === 'plugin' && !!i.pluginId))
  await Promise.allSettled(targets.map((i) => updateProfile(i.id)))
}

export async function removeProfileUpdater(id: string): Promise<void> {
  if (intervalPool[id]) {
    if (intervalPool[id] instanceof Cron) {
      ;(intervalPool[id] as Cron).stop()
    } else {
      clearInterval(intervalPool[id] as NodeJS.Timeout)
    }
    delete intervalPool[id]
  }
  if (delayedUpdatePool[id]) {
    clearTimeout(delayedUpdatePool[id])
    delete delayedUpdatePool[id]
  }
}
