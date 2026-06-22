import { createHash } from 'crypto'
import * as chromeRequest from './chromeRequest'

interface GitHubReleaseAsset {
  name: string
  browser_download_url: string
  digest?: string
}

interface GitHubRelease {
  assets: GitHubReleaseAsset[]
}

interface DownloadOptions {
  proxy?: NonNullable<Parameters<typeof chromeRequest.get>[1]>['proxy']
  timeout?: number
  onProgress?: (loaded: number, total: number) => void
}

async function getRelease(owner: string, repo: string, tag: string): Promise<GitHubRelease> {
  const releasePath = tag === 'latest' ? 'latest' : `tags/${encodeURIComponent(tag)}`
  const response = await chromeRequest.get<GitHubRelease>(
    `https://api.github.com/repos/${owner}/${repo}/releases/${releasePath}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      responseType: 'json',
      timeout: 10000
    }
  )
  return response.data
}

function parseSha256Digest(asset: GitHubReleaseAsset): string {
  const digest = asset.digest || ''
  const match = digest.match(/^sha256:([a-fA-F0-9]{64})$/)
  if (!match) {
    throw new Error(`GitHub release asset ${asset.name} does not include a SHA-256 digest`)
  }
  return match[1].toLowerCase()
}

export async function downloadVerifiedGitHubAsset(
  owner: string,
  repo: string,
  tag: string,
  assetName: string,
  options: DownloadOptions = {}
): Promise<Buffer> {
  const release = await getRelease(owner, repo, tag)
  const asset = release.assets.find((item) => item.name === assetName)
  if (!asset) {
    throw new Error(`GitHub release asset not found: ${owner}/${repo} ${tag} ${assetName}`)
  }

  const expectedHash = parseSha256Digest(asset)
  const response = await chromeRequest.get(asset.browser_download_url, {
    responseType: 'arraybuffer',
    timeout: options.timeout ?? 30000,
    proxy: options.proxy,
    headers: { 'Content-Type': 'application/octet-stream' },
    onProgress: options.onProgress
  })
  const data = Buffer.from(response.data as Buffer)
  const actualHash = createHash('sha256').update(data).digest('hex')
  if (actualHash !== expectedHash) {
    throw new Error(`Asset integrity check failed: expected ${expectedHash}, got ${actualHash}`)
  }
  return data
}
