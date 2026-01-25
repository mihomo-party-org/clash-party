import { createWriteStream, createReadStream, existsSync, rmSync } from 'fs'
import { writeFile } from 'fs/promises'
import { execSync } from 'child_process'
import { platform } from 'os'
import { join } from 'path'
import { createGunzip } from 'zlib'
import AdmZip from 'adm-zip'
import { stopCore } from '../core/manager'
import { mihomoCoreDir } from './dirs'
import * as chromeRequest from './chromeRequest'
import { createLogger } from './logger'

const log = createLogger('GitHub')

export interface GitHubTag {
  name: string
  zipball_url: string
  tarball_url: string
}

interface VersionCache {
  data: GitHubTag[]
  timestamp: number
}

const CACHE_EXPIRY = 5 * 60 * 1000

const GITHUB_API_CONFIG = {
  BASE_URL: 'https://api.github.com',
  API_VERSION: '2022-11-28',
  TAGS_PER_PAGE: 100
}

const PLATFORM_MAP: Record<string, string> = {
  'win32-x64': 'mihomo-windows-amd64-compatible',
  'win32-ia32': 'mihomo-windows-386',
  'win32-arm64': 'mihomo-windows-arm64',
  'darwin-x64': 'mihomo-darwin-amd64-compatible',
  'darwin-arm64': 'mihomo-darwin-arm64',
  'linux-x64': 'mihomo-linux-amd64-compatible',
  'linux-arm64': 'mihomo-linux-arm64'
}

const versionCache = new Map<string, VersionCache>()

/**
 * 获取 GitHub 仓库的标签列表（带缓存）
 * @param owner 仓库所有者
 * @param repo 仓库名称
 * @param forceRefresh 是否强制刷新缓存
 * @returns 标签列表
 */
export async function getGitHubTags(
  owner: string,
  repo: string,
  forceRefresh = false
): Promise<GitHubTag[]> {
  const cacheKey = `${owner}/${repo}`

  // 检查缓存
  if (!forceRefresh && versionCache.has(cacheKey)) {
    const cache = versionCache.get(cacheKey)
    if (cache && Date.now() - cache.timestamp < CACHE_EXPIRY) {
      log.debug(`Returning cached tags for ${owner}/${repo}`)
      return cache.data
    }
  }

  try {
    log.debug(`Fetching tags for ${owner}/${repo}`)
    const response = await chromeRequest.get<GitHubTag[]>(
      `${GITHUB_API_CONFIG.BASE_URL}/repos/${owner}/${repo}/tags?per_page=${GITHUB_API_CONFIG.TAGS_PER_PAGE}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': GITHUB_API_CONFIG.API_VERSION
        },
        responseType: 'json',
        timeout: 10000
      }
    )

    // 更新缓存
    versionCache.set(cacheKey, {
      data: response.data,
      timestamp: Date.now()
    })

    log.debug(`Successfully fetched ${response.data.length} tags for ${owner}/${repo}`)
    return response.data
  } catch (error) {
    log.error(`Failed to fetch tags for ${owner}/${repo}`, error)
    if (error instanceof Error) {
      throw new Error(`GitHub API error: ${error.message}`)
    }
    throw new Error('Failed to fetch version list')
  }
}

/**
 * 清除版本缓存
 * @param owner 仓库所有者
 * @param repo 仓库名称
 */
export function clearVersionCache(owner: string, repo: string): void {
  const cacheKey = `${owner}/${repo}`
  const hasCache = versionCache.has(cacheKey)
  versionCache.delete(cacheKey)
  log.debug(`Cache ${hasCache ? 'cleared' : 'not found'} for ${owner}/${repo}`)
}

/**
 * 下载 GitHub Release 资产
 * @param url 下载 URL
 * @param outputPath 输出路径
 */
async function downloadGitHubAsset(url: string, outputPath: string): Promise<void> {
  try {
    log.debug(`Downloading asset from ${url}`)
    const response = await chromeRequest.get(url, {
      responseType: 'arraybuffer',
      timeout: 30000
    })

    await writeFile(outputPath, Buffer.from(response.data as Buffer))
    log.debug(`Successfully downloaded asset to ${outputPath}`)
  } catch (error) {
    log.error(`Failed to download asset from ${url}`, error)
    if (error instanceof Error) {
      throw new Error(`Download error: ${error.message}`)
    }
    throw new Error('Failed to download core file')
  }
}

/**
 * 安装特定版本的 mihomo 核心
 * @param version 版本号
 */
export async function installMihomoCore(version: string): Promise<void> {
  try {
    log.info(`Installing mihomo core version ${version}`)

    const plat = platform()
    const arch = process.arch

    // 映射平台和架构到 GitHub Release 文件名
    const key = `${plat}-${arch}`
    const name = PLATFORM_MAP[key]

    if (!name) {
      throw new Error(`Unsupported platform "${plat}-${arch}"`)
    }

    const isWin = plat === 'win32'
    const urlExt = isWin ? 'zip' : 'gz'
    const downloadURL = `https://github.com/MetaCubeX/mihomo/releases/download/${version}/${name}-${version}.${urlExt}`

    const coreDir = mihomoCoreDir()
    const tempZip = join(coreDir, `temp-core.${urlExt}`)
    const exeFile = `${name}${isWin ? '.exe' : ''}`
    const targetFile = `mihomo-specific${isWin ? '.exe' : ''}`
    const targetPath = join(coreDir, targetFile)

    // 如果目标文件已存在，先停止核心
    if (existsSync(targetPath)) {
      log.debug('Stopping core before extracting new core file')
      // 先停止核心
      await stopCore(true)
    }

    // 下载文件
    await downloadGitHubAsset(downloadURL, tempZip)

    // 解压文件
    if (urlExt === 'zip') {
      log.debug(`Extracting ZIP file ${tempZip}`)
      const zip = new AdmZip(tempZip)
      const entries = zip.getEntries()
      const entry = entries.find((e) => e.entryName.includes(exeFile))

      if (entry) {
        zip.extractEntryTo(entry, coreDir, false, true, false, targetFile)
        log.debug(`Successfully extracted ${exeFile} to ${targetPath}`)
      } else {
        throw new Error(`Executable file not found in zip: ${exeFile}`)
      }
    } else {
      // 处理.gz 文件
      log.debug(`Extracting GZ file ${tempZip}`)
      const readStream = createReadStream(tempZip)
      const writeStream = createWriteStream(targetPath)

      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          log.error('Gzip decompression failed', error)
          reject(new Error(`Gzip decompression failed: ${error.message}`))
        }

        readStream
          .pipe(createGunzip().on('error', onError))
          .pipe(writeStream)
          .on('finish', () => {
            log.debug('Gunzip finished')
            try {
              execSync(`chmod 755 ${targetPath}`)
              log.debug('Chmod binary finished')
            } catch (chmodError) {
              log.warn('Failed to chmod binary', chmodError)
            }
            resolve()
          })
          .on('error', onError)
      })
    }

    // 清理临时文件
    log.debug(`Cleaning up temporary file ${tempZip}`)
    rmSync(tempZip)

    log.info(`Successfully installed mihomo core version ${version}`)
  } catch (error) {
    log.error('Failed to install mihomo core', error)
    throw new Error(
      `Failed to install core: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}
