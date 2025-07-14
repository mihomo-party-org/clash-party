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

export async function webdavBackup(): Promise<boolean> {
  const { createClient } = await import('webdav/dist/node/index.js')
  const {
    webdavUrl = '',
    webdavUsername = '',
    webdavPassword = '',
    webdavDir = 'mihomo-party',
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
      console.error('Failed to clean up old backup files:', error)
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
    webdavDir = 'mihomo-party'
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
    webdavDir = 'mihomo-party'
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
    webdavDir = 'mihomo-party'
  } = await getAppConfig()

  const client = createClient(webdavUrl, {
    username: webdavUsername,
    password: webdavPassword
  })
  await client.deleteFile(`${webdavDir}/${filename}`)
}
