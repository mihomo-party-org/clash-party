import { writeFile } from 'fs/promises'
import { dialog } from 'electron'
import * as chromeRequest from '../utils/chromeRequest'
import { getAppConfig, getControledMihomoConfig } from '../config'
import { DEFAULT_MIHOMO_PORTS } from '../../shared/appConfig'
import { getRuntimeConfigStr } from '../core/factory'
import { encryptAgeContent, generateAgeKeyPair } from '../utils/age'

interface GistInfo {
  id: string
  description: string
  html_url: string
}

interface GistAgeKeyPair {
  secretKey: string
  recipient: string
}

async function listGists(token: string): Promise<GistInfo[]> {
  const { 'mixed-port': port = DEFAULT_MIHOMO_PORTS.mixed } = await getControledMihomoConfig()
  const res = await chromeRequest.get('https://api.github.com/gists', {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28'
    },
    proxy: {
      protocol: 'http',
      host: '127.0.0.1',
      port
    },
    responseType: 'json'
  })
  return Array.isArray(res.data) ? res.data : []
}

async function createGist(token: string, content: string): Promise<void> {
  const { 'mixed-port': port = DEFAULT_MIHOMO_PORTS.mixed } = await getControledMihomoConfig()
  await chromeRequest.post(
    'https://api.github.com/gists',
    {
      description: 'Auto Synced Clash Party Runtime Config',
      public: false,
      files: { 'clash-party.yaml': { content } }
    },
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28'
      },
      proxy: {
        protocol: 'http',
        host: '127.0.0.1',
        port
      }
    }
  )
}

async function updateGist(token: string, id: string, content: string): Promise<void> {
  const { 'mixed-port': port = DEFAULT_MIHOMO_PORTS.mixed } = await getControledMihomoConfig()
  await chromeRequest.patch(
    `https://api.github.com/gists/${id}`,
    {
      description: 'Auto Synced Clash Party Runtime Config',
      files: { 'clash-party.yaml': { content } }
    },
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28'
      },
      proxy: {
        protocol: 'http',
        host: '127.0.0.1',
        port
      }
    }
  )
}

export async function getGistUrl(): Promise<string> {
  const { githubToken } = await getAppConfig()
  if (!githubToken) return ''
  const gists = await listGists(githubToken)
  const gist = gists.find((gist) => gist.description === 'Auto Synced Clash Party Runtime Config')
  if (gist) {
    return gist.html_url
  } else {
    await uploadRuntimeConfig()
    const gists = await listGists(githubToken)
    const gist = gists.find((gist) => gist.description === 'Auto Synced Clash Party Runtime Config')
    if (!gist) throw new Error('Gist not found')
    return gist.html_url
  }
}

export async function uploadRuntimeConfig(): Promise<void> {
  const { githubToken, gistAgeEncrypt = false, gistAgeRecipient } = await getAppConfig()
  if (!githubToken) return
  const gists = await listGists(githubToken)
  const gist = gists.find((gist) => gist.description === 'Auto Synced Clash Party Runtime Config')
  const runtimeConfig = await getRuntimeConfigStr()
  const config = gistAgeEncrypt
    ? await encryptAgeContent(runtimeConfig, gistAgeRecipient, 'gist runtime config')
    : runtimeConfig
  if (gist) {
    await updateGist(githubToken, gist.id, config)
  } else {
    await createGist(githubToken, config)
  }
}

export async function generateGistAgeKeyPair(): Promise<GistAgeKeyPair> {
  return await generateAgeKeyPair()
}

export async function exportGistAgeSecretKey(): Promise<boolean> {
  const { gistAgeSecretKey } = await getAppConfig()
  if (!gistAgeSecretKey) {
    throw new Error('Gist Age private key has not been generated')
  }

  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Export Gist Age Private Key',
    defaultPath: 'clash-party-gist-age-secret-key.txt',
    filters: [{ name: 'Text File', extensions: ['txt'] }]
  })

  if (canceled || !filePath) return false

  await writeFile(filePath, `${gistAgeSecretKey.trim()}\n`, 'utf-8')
  return true
}
