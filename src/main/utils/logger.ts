import { logPath } from './dirs'
import { appendToFileWithLimit } from './logFile'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

let appLogDisabled = false

export function setAppLogDisabled(value: boolean): void {
  appLogDisabled = value === true
}

class Logger {
  private moduleName: string

  constructor(moduleName: string) {
    this.moduleName = moduleName
  }

  private formatTimestamp(): string {
    return new Date().toISOString()
  }

  private formatError(error: unknown): string {
    if (error === undefined || error === null) return ''
    return String(error)
  }

  private formatErrorSuffix(error: unknown): string {
    const formattedError = this.formatError(error)
    return formattedError ? `: ${formattedError}` : ''
  }

  private formatLogMessage(level: LogLevel, message: string, error?: unknown): string {
    const timestamp = this.formatTimestamp()
    return `[${timestamp}] [${level.toUpperCase()}] [${this.moduleName}] ${message}${this.formatErrorSuffix(error)}\n`
  }

  private async writeToFile(level: LogLevel, message: string, error?: unknown): Promise<void> {
    if (appLogDisabled) return
    try {
      const appLogPath = logPath()
      const logMessage = this.formatLogMessage(level, message, error)
      await appendToFileWithLimit(appLogPath, logMessage)
    } catch (logError) {
      // 如果写入日志文件失败，仍然输出到控制台
      console.error(`[Logger] Failed to write to log file: ${this.formatError(logError)}`)
      console.error(
        `[Logger] Original message: [${level.toUpperCase()}] [${this.moduleName}] ${message}${this.formatErrorSuffix(error)}`
      )
    }
  }

  private logToConsole(level: LogLevel, message: string, error?: unknown): void {
    const formattedMessage = `[${this.moduleName}] ${message}${this.formatErrorSuffix(error)}`

    switch (level) {
      case 'debug':
        console.debug(formattedMessage)
        break
      case 'info':
        console.log(formattedMessage)
        break
      case 'warn':
        console.warn(formattedMessage)
        break
      case 'error':
        console.error(formattedMessage)
        break
    }
  }

  async debug(message: string, error?: unknown): Promise<void> {
    await this.writeToFile('debug', message, error)
    this.logToConsole('debug', message, error)
  }

  async info(message: string, error?: unknown): Promise<void> {
    await this.writeToFile('info', message, error)
    this.logToConsole('info', message, error)
  }

  async warn(message: string, error?: unknown): Promise<void> {
    await this.writeToFile('warn', message, error)
    this.logToConsole('warn', message, error)
  }

  async error(message: string, error?: unknown): Promise<void> {
    await this.writeToFile('error', message, error)
    this.logToConsole('error', message, error)
  }

  // 兼容原有的 logFloatingWindow 函数签名
  async log(message: string, error?: unknown): Promise<void> {
    if (error) {
      await this.error(message, error)
    } else {
      await this.info(message)
    }
  }
}

// 创建不同模块的日志实例
export const createLogger = (moduleName: string): Logger => {
  return new Logger(moduleName)
}

// 统一的应用日志实例 - 所有模块共享同一个日志文件
export const appLogger = createLogger('app')

// 为了保持向后兼容性，创建各模块的日志实例（都指向同一个应用日志）
export const floatingWindowLogger = createLogger('floating-window')
export const mainWindowLogger = createLogger('main-window')
export const coreLogger = createLogger('mihomo-core')
export const apiLogger = createLogger('mihomo-api')
export const configLogger = createLogger('config')
export const systemLogger = createLogger('system')
export const trafficLogger = createLogger('traffic-monitor')
export const trayLogger = createLogger('tray')
export const initLogger = createLogger('init')
export const ipcLogger = createLogger('ipc')
export const proxyLogger = createLogger('sysproxy')
export const managerLogger = createLogger('manager')
export const factoryLogger = createLogger('factory')
export const overrideLogger = createLogger('override')

// 默认日志实例
export const logger = appLogger
