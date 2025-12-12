import { writeFile } from 'fs/promises'
import { logPath } from './dirs'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

class Logger {
  private moduleName: string

  constructor(moduleName: string) {
    this.moduleName = moduleName
  }

  private formatTimestamp(): string {
    return new Date().toISOString()
  }

  private formatLogMessage(level: LogLevel, message: string, error?: any): string {
    const timestamp = this.formatTimestamp()
    const errorStr = error ? `: ${error}` : ''
    return `[${timestamp}] [${level.toUpperCase()}] [${this.moduleName}] ${message}${errorStr}\n`
  }

  private async writeToFile(level: LogLevel, message: string, error?: any): Promise<void> {
    try {
      const appLogPath = logPath()
      const logMessage = this.formatLogMessage(level, message, error)
      await writeFile(appLogPath, logMessage, { flag: 'a' })
    } catch (logError) {
      // 如果写入日志文件失败，仍然输出到控制台
      console.error(`[Logger] Failed to write to log file:`, logError)
      console.error(
        `[Logger] Original message: [${level.toUpperCase()}] [${this.moduleName}] ${message}`,
        error
      )
    }
  }

  private logToConsole(level: LogLevel, message: string, error?: any): void {
    const prefix = `[${this.moduleName}] ${message}`

    switch (level) {
      case 'debug':
        console.debug(prefix, error || '')
        break
      case 'info':
        console.log(prefix, error || '')
        break
      case 'warn':
        console.warn(prefix, error || '')
        break
      case 'error':
        console.error(prefix, error || '')
        break
    }
  }

  async debug(message: string, error?: any): Promise<void> {
    await this.writeToFile('debug', message, error)
    this.logToConsole('debug', message, error)
  }

  async info(message: string, error?: any): Promise<void> {
    await this.writeToFile('info', message, error)
    this.logToConsole('info', message, error)
  }

  async warn(message: string, error?: any): Promise<void> {
    await this.writeToFile('warn', message, error)
    this.logToConsole('warn', message, error)
  }

  async error(message: string, error?: any): Promise<void> {
    await this.writeToFile('error', message, error)
    this.logToConsole('error', message, error)
  }

  // 兼容原有的 logFloatingWindow 函数签名
  async log(message: string, error?: any): Promise<void> {
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
