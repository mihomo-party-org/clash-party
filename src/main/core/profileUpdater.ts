import { addProfileItem, getCurrentProfileItem, getProfileConfig } from '../config'
import { Cron } from 'croner'

const intervalPool: Record<string, Cron | NodeJS.Timeout> = {}

export async function initProfileUpdater(): Promise<void> {
  const { items, current } = await getProfileConfig()
  const currentItem = await getCurrentProfileItem()
  
  for (const item of items.filter((i) => i.id !== current)) {
    if (item.type === 'remote' && item.interval) {
      if (typeof item.interval === 'number') {
        // 数字间隔使用setInterval
        intervalPool[item.id] = setInterval(
          async () => {
            try {
              await addProfileItem(item)
            } catch (e) {
              /* ignore */
            }
          },
          item.interval * 60 * 1000
        )
      } else if (typeof item.interval === 'string') {
        // 字符串间隔使用Cron
        intervalPool[item.id] = new Cron(item.interval, async () => {
          try {
            await addProfileItem(item)
          } catch (e) {
            /* ignore */
          }
        })
      }
      
      try {
        await addProfileItem(item)
      } catch (e) {
        /* ignore */
      }
    }
  }

  if (currentItem?.type === 'remote' && currentItem.interval) {
    if (typeof currentItem.interval === 'number') {
      intervalPool[currentItem.id] = setInterval(
        async () => {
          try {
            await addProfileItem(currentItem)
          } catch (e) {
            /* ignore */
          }
        },
        currentItem.interval * 60 * 1000
      )
      
      setTimeout(
        async () => {
          try {
            await addProfileItem(currentItem)
          } catch (e) {
            /* ignore */
          }
        },
        currentItem.interval * 60 * 1000 + 10000 // +10s
      )
    } else if (typeof currentItem.interval === 'string') {
      intervalPool[currentItem.id] = new Cron(currentItem.interval, async () => {
        try {
          await addProfileItem(currentItem)
        } catch (e) {
          /* ignore */
        }
      })
    }

    try {
      await addProfileItem(currentItem)
    } catch (e) {
      /* ignore */
    }
  }
}

export async function addProfileUpdater(item: IProfileItem): Promise<void> {
  if (item.type === 'remote' && item.interval) {
    if (intervalPool[item.id]) {
      if (intervalPool[item.id] instanceof Cron) {
        (intervalPool[item.id] as Cron).stop()
      } else {
        clearInterval(intervalPool[item.id] as NodeJS.Timeout)
      }
    }

    if (typeof item.interval === 'number') {
      intervalPool[item.id] = setInterval(
        async () => {
          try {
            await addProfileItem(item)
          } catch (e) {
            /* ignore */
          }
        },
        item.interval * 60 * 1000
      )
    } else if (typeof item.interval === 'string') {
      intervalPool[item.id] = new Cron(item.interval, async () => {
        try {
          await addProfileItem(item)
        } catch (e) {
          /* ignore */
        }
      })
    }
  }
}

export async function removeProfileUpdater(id: string): Promise<void> {
  if (intervalPool[id]) {
    if (intervalPool[id] instanceof Cron) {
      (intervalPool[id] as Cron).stop()
    } else {
      clearInterval(intervalPool[id] as NodeJS.Timeout)
    }
    delete intervalPool[id]
  }
}