export interface DataUsageLog {
  id?: number
  timestamp: number
  sourceIP: string
  host: string
  outbound: string
  process: string
  upload: number
  download: number
}

const DB_NAME = 'clashparty_db'
const STORE_NAME = 'data_usage_logs'
const DB_VERSION = 1

export class DataUsageDB {
  private db: IDBDatabase | null = null

  async open(): Promise<IDBDatabase> {
    if (this.db) return this.db

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true })
          store.createIndex('timestamp', 'timestamp', { unique: false })
          store.createIndex('sourceIP', 'sourceIP', { unique: false })
          store.createIndex('host', 'host', { unique: false })
          store.createIndex('outbound', 'outbound', { unique: false })
          store.createIndex('process', 'process', { unique: false })
        }
      }

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result
        resolve(this.db)
      }

      request.onerror = () => reject(request.error)
    })
  }

  async addLogs(logs: DataUsageLog[]): Promise<void> {
    if (logs.length === 0) return
    const db = await this.open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      logs.forEach((log) => store.add(log))
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async query(startTime: number, endTime: number): Promise<DataUsageLog[]> {
    const db = await this.open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readonly')
      const index = tx.objectStore(STORE_NAME).index('timestamp')
      const request = index.openCursor(IDBKeyRange.bound(startTime, endTime))
      const results: DataUsageLog[] = []

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
        if (cursor) {
          results.push(cursor.value)
          cursor.continue()
        } else {
          resolve(results)
        }
      }

      request.onerror = () => reject(request.error)
    })
  }

  async clearAll(): Promise<void> {
    const db = await this.open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite')
      const request = tx.objectStore(STORE_NAME).clear()
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async cleanup(beforeTime: number): Promise<void> {
    const db = await this.open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const request = store.index('timestamp').openKeyCursor(IDBKeyRange.upperBound(beforeTime))

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursor>).result
        if (cursor) {
          store.delete(cursor.primaryKey)
          cursor.continue()
        } else {
          resolve()
        }
      }

      request.onerror = () => reject(request.error)
    })
  }
}

export const db = new DataUsageDB()
