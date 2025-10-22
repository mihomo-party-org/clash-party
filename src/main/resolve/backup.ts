import { getAppConfig } from '../config'
import dayjs from 'dayjs'
import AdmZip from 'adm-zip'
import {
  appConfigPath,
  controledMihomoConfigPath,
  dataDir,
  overrideConfigPath,
  overrideDir,
  profileConfigPath,
  profilesDir,
  subStoreDir,
  themesDir
} from '../utils/dirs'
import { systemLogger } from '../utils/logger'
import { Cron } from 'croner'
import { dialog } from 'electron'
import { existsSync } from 'fs'
import i18next from 'i18next'

let backupCronJob: Cron | null = null

export async function webdavBackup(): Promise<boolean> {
  const { createClient } = await import('webdav/dist/node/index.js')
  const {
    webdavUrl = '',
    webdavUsername = '',
    webdavPassword = '',
    webdavDir = 'clash-party',
    webdavMaxBackups = 0
  } = await getAppConfig()
  const zip = new AdmZip()

  zip.addLocalFile(appConfigPath())
  zip.addLocalFile(controledMihomoConfigPath())
  zip.addLocalFile(profileConfigPath())
  zip.addLocalFile(overrideConfigPath())
  zip.addLocalFolder(themesDir(), 'themes')
  zip.addLocalFolder(profilesDir(), 'profiles')
  zip.addLocalFolder(overrideDir(), 'override')
  zip.addLocalFolder(subStoreDir(), 'substore')
  const date = new Date()
  const zipFileName = `${process.platform}_${dayjs(date).format('YYYY-MM-DD_HH-mm-ss')}.zip`

  const client = createClient(webdavUrl, {
    username: webdavUsername,
    password: webdavPassword
  })
  try {
    await client.createDirectory(webdavDir)
  } catch {
    // ignore
  }

  const result = await client.putFileContents(`${webdavDir}/${zipFileName}`, zip.toBuffer())

  if (webdavMaxBackups > 0) {
    try {
      const files = await client.getDirectoryContents(webdavDir, { glob: '*.zip' })
      const fileList = Array.isArray(files) ? files : files.data

      const currentPlatformFiles = fileList.filter((file) => {
        return file.basename.startsWith(`${process.platform}_`)
      })

      currentPlatformFiles.sort((a, b) => {
        const timeA = a.basename.match(/_(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})\.zip$/)?.[1] || ''
        const timeB = b.basename.match(/_(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})\.zip$/)?.[1] || ''
        return timeB.localeCompare(timeA)
      })

      if (currentPlatformFiles.length > webdavMaxBackups) {
        const filesToDelete = currentPlatformFiles.slice(webdavMaxBackups)

        for (let i = 0; i < filesToDelete.length; i++) {
          const file = filesToDelete[i]
          await client.deleteFile(`${webdavDir}/${file.basename}`)

          if (i < filesToDelete.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 500))
          }
        }
      }
    } catch (error) {
      await systemLogger.error('Failed to clean up old backup files', error)
    }
  }

  return result
}

export async function webdavRestore(filename: string): Promise<void> {
  const { createClient } = await import('webdav/dist/node/index.js')
  const {
    webdavUrl = '',
    webdavUsername = '',
    webdavPassword = '',
    webdavDir = 'clash-party'
  } = await getAppConfig()

  const client = createClient(webdavUrl, {
    username: webdavUsername,
    password: webdavPassword
  })
  const zipData = await client.getFileContents(`${webdavDir}/${filename}`)
  const zip = new AdmZip(zipData as Buffer)
  zip.extractAllTo(dataDir(), true)
}

export async function listWebdavBackups(): Promise<string[]> {
  const { createClient } = await import('webdav/dist/node/index.js')
  const {
    webdavUrl = '',
    webdavUsername = '',
    webdavPassword = '',
    webdavDir = 'clash-party'
  } = await getAppConfig()

  const client = createClient(webdavUrl, {
    username: webdavUsername,
    password: webdavPassword
  })
  const files = await client.getDirectoryContents(webdavDir, { glob: '*.zip' })
  if (Array.isArray(files)) {
    return files.map((file) => file.basename)
  } else {
    return files.data.map((file) => file.basename)
  }
}

export async function webdavDelete(filename: string): Promise<void> {
  const { createClient } = await import('webdav/dist/node/index.js')
  const {
    webdavUrl = '',
    webdavUsername = '',
    webdavPassword = '',
    webdavDir = 'clash-party'
  } = await getAppConfig()

  const client = createClient(webdavUrl, {
    username: webdavUsername,
    password: webdavPassword
  })
  await client.deleteFile(`${webdavDir}/${filename}`)
}

/**
 * 初始化WebDAV定时备份任务
 */
export async function initWebdavBackupScheduler(): Promise<void> {
  try {
    // 先停止现有的定时任务
    if (backupCronJob) {
      backupCronJob.stop()
      backupCronJob = null
    }

    const { webdavBackupCron } = await getAppConfig()
    
    // 如果配置了Cron表达式，则启动定时任务
    if (webdavBackupCron) {
      backupCronJob = new Cron(webdavBackupCron, async () => {
        try {
          await webdavBackup()
          await systemLogger.info('WebDAV backup completed successfully via cron job')
        } catch (error) {
          await systemLogger.error('Failed to execute WebDAV backup via cron job', error)
        }
      })
      
      await systemLogger.info(`WebDAV backup scheduler initialized with cron: ${webdavBackupCron}`)
      await systemLogger.info(`WebDAV backup scheduler nextRun: ${backupCronJob.nextRun()}`)
    } else {
      await systemLogger.info('WebDAV backup scheduler disabled (no cron expression configured)')
    }
  } catch (error) {
    await systemLogger.error('Failed to initialize WebDAV backup scheduler', error)
  }
}

/**
 * 停止WebDAV定时备份任务
 */
export async function stopWebdavBackupScheduler(): Promise<void> {
  if (backupCronJob) {
    backupCronJob.stop()
    backupCronJob = null
    await systemLogger.info('WebDAV backup scheduler stopped')
  }
}

/**
 * 重新初始化WebDAV定时备份任务
 * 先停止现有任务，然后重新启动
 */
export async function reinitScheduler(): Promise<void> {
  await systemLogger.info('Reinitializing WebDAV backup scheduler...')
  await stopWebdavBackupScheduler()
  await initWebdavBackupScheduler()
  await systemLogger.info('WebDAV backup scheduler reinitialized successfully')
}

/**
 * 导出本地备份
 */
export async function exportLocalBackup(): Promise<boolean> {
  const zip = new AdmZip()
  if (existsSync(appConfigPath())) {
    zip.addLocalFile(appConfigPath())
  }
  if (existsSync(controledMihomoConfigPath())) {
    zip.addLocalFile(controledMihomoConfigPath())
  }
  if (existsSync(profileConfigPath())) {
    zip.addLocalFile(profileConfigPath())
  }
  if (existsSync(overrideConfigPath())) {
    zip.addLocalFile(overrideConfigPath())
  }
  if (existsSync(themesDir())) {
    zip.addLocalFolder(themesDir(), 'themes')
  }
  if (existsSync(profilesDir())) {
    zip.addLocalFolder(profilesDir(), 'profiles')
  }
  if (existsSync(overrideDir())) {
    zip.addLocalFolder(overrideDir(), 'override')
  }
  if (existsSync(subStoreDir())) {
    zip.addLocalFolder(subStoreDir(), 'substore')
  }
  
  const date = new Date()
  const zipFileName = `clash-party-backup-${dayjs(date).format('YYYY-MM-DD_HH-mm-ss')}.zip`
  const result = await dialog.showSaveDialog({
    title: i18next.t('localBackup.export.title'),
    defaultPath: zipFileName,
    filters: [
      { name: 'ZIP Files', extensions: ['zip'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  })
  
  if (!result.canceled && result.filePath) {
    zip.writeZip(result.filePath)
    await systemLogger.info(`Local backup exported to: ${result.filePath}`)
    return true
  }
  return false
}

/**
 * 导入本地备份
 */
export async function importLocalBackup(): Promise<boolean> {
  const result = await dialog.showOpenDialog({
    title: i18next.t('localBackup.import.title'),
    filters: [
      { name: 'ZIP Files', extensions: ['zip'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  })
  
  if (!result.canceled && result.filePaths.length > 0) {
    const filePath = result.filePaths[0]
    const zip = new AdmZip(filePath)
    zip.extractAllTo(dataDir(), true)
    await systemLogger.info(`Local backup imported from: ${filePath}`)
    return true
  }
  return false
}
