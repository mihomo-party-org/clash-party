import { appendFile, open, stat, writeFile } from 'fs/promises'
import { Writable } from 'stream'

const MB = 1024 * 1024
const DEFAULT_MAX_LOG_FILE_SIZE_MB = 10
const MIN_MAX_LOG_FILE_SIZE_MB = 1
const TRUNCATE_MARKER = Buffer.from('\n[LOG] File truncated because size limit reached.\n')
// 触顶压缩后保留的内容比例。压缩后文件回落到约 maxBytes * RATIO 大小，
// 使后续写入重新走廉价的 appendFile 分支，把压缩频率从「每次写入」降到
// 「每写满约该比例的上限一次」，整体 I/O 从 O(n²) 降为 O(n)。
const COMPACTION_RETAIN_RATIO = 0.5

// 日志文件路径既可以是固定字符串，也可以是一个在每次写入时求值的工厂函数。
// 对于内核 / sub-store 这类长连接日志流，必须传入工厂函数，否则路径会在流创建
// 时被固化，导致日志永远写入同一个文件、无法按日期轮转。
type LogFilePath = string | (() => string)

interface LogFileState {
  queue: Promise<void>
  size: number | null
}

const logFileStates = new Map<string, LogFileState>()

let globalMaxLogFileSizeBytes = DEFAULT_MAX_LOG_FILE_SIZE_MB * MB

function getLogFileState(filePath: string): LogFileState {
  const existing = logFileStates.get(filePath)
  if (existing) return existing

  const created: LogFileState = {
    queue: Promise.resolve(),
    size: null
  }
  logFileStates.set(filePath, created)
  return created
}

export function normalizeMaxLogFileSizeMB(value: unknown): number {
  const num = Number(value)
  if (!Number.isFinite(num)) return DEFAULT_MAX_LOG_FILE_SIZE_MB
  return Math.max(MIN_MAX_LOG_FILE_SIZE_MB, Math.floor(num))
}

export function setGlobalMaxLogFileSizeMB(value: unknown): void {
  const normalized = normalizeMaxLogFileSizeMB(value)
  globalMaxLogFileSizeBytes = normalized * MB
}

export function getGlobalMaxLogFileSizeBytes(): number {
  return globalMaxLogFileSizeBytes
}

async function readTail(filePath: string, bytes: number): Promise<Buffer> {
  if (bytes <= 0) return Buffer.alloc(0)

  try {
    const file = await open(filePath, 'r')
    try {
      const fileStat = await file.stat()
      const readSize = Math.min(bytes, fileStat.size)
      if (readSize <= 0) return Buffer.alloc(0)

      const buffer = Buffer.alloc(readSize)
      await file.read(buffer, 0, readSize, fileStat.size - readSize)
      return buffer
    } finally {
      await file.close()
    }
  } catch {
    return Buffer.alloc(0)
  }
}

async function getCurrentSize(filePath: string, state: LogFileState): Promise<number> {
  if (state.size !== null) return state.size

  try {
    const fileStat = await stat(filePath)
    state.size = fileStat.size
  } catch {
    state.size = 0
  }

  return state.size
}

async function appendToFileWithLimitInternal(
  filePath: string,
  data: Buffer,
  state: LogFileState,
  maxBytes: number
): Promise<void> {
  if (data.length === 0) return

  if (maxBytes <= 0) {
    await appendFile(filePath, data)
    const size = await getCurrentSize(filePath, state)
    state.size = size + data.length
    return
  }

  if (data.length >= maxBytes) {
    const sliced = data.subarray(data.length - maxBytes)
    await writeFile(filePath, sliced)
    state.size = sliced.length
    return
  }

  const size = await getCurrentSize(filePath, state)
  if (size + data.length <= maxBytes) {
    await appendFile(filePath, data)
    state.size = size + data.length
    return
  }

  // 触顶后只保留约 maxBytes * COMPACTION_RETAIN_RATIO 的最近内容，使压缩后文件
  // 远低于上限，接下来的多次写入都能走廉价的 appendFile，避免「文件一旦到达上限后
  // 每写一行都重读 + 重写整个文件」的 O(n²) I/O 放大。
  const retainBudget = Math.floor(maxBytes * COMPACTION_RETAIN_RATIO)
  const keepBytes = Math.max(0, retainBudget - data.length - TRUNCATE_MARKER.length)
  const tail = await readTail(filePath, keepBytes)
  let rewritten = Buffer.concat([tail, TRUNCATE_MARKER, data])

  if (rewritten.length > maxBytes) {
    rewritten = rewritten.subarray(rewritten.length - maxBytes)
  }

  await writeFile(filePath, rewritten)
  state.size = rewritten.length
}

export async function appendToFileWithLimit(
  filePath: string,
  data: string | Buffer,
  maxBytes = getGlobalMaxLogFileSizeBytes()
): Promise<void> {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data)
  const state = getLogFileState(filePath)

  state.queue = state.queue
    .catch(() => {
      // Keep queue alive after previous failures.
    })
    .then(() => appendToFileWithLimitInternal(filePath, buffer, state, maxBytes))

  await state.queue
}

class CappedLogWritable extends Writable {
  private readonly resolvePath: () => string
  private readonly maxBytes: number

  constructor(filePath: LogFilePath, maxBytes: number) {
    super()
    this.resolvePath = typeof filePath === 'function' ? filePath : (): string => filePath
    this.maxBytes = maxBytes
  }

  _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding)
    // 每次写入时重新解析路径，使日志能按当前日期自动轮转（与 app 日志一致）。
    appendToFileWithLimit(this.resolvePath(), buffer, this.maxBytes).then(
      () => callback(),
      (error) => callback(error as Error)
    )
  }
}

export function createCappedLogWritableStream(
  filePath: LogFilePath,
  maxBytes = getGlobalMaxLogFileSizeBytes()
): Writable {
  return new CappedLogWritable(filePath, maxBytes)
}
