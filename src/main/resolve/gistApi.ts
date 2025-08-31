import axios from 'axios'
import { getAppConfig, getControledMihomoConfig } from '../config'
import { getRuntimeConfigStr } from '../core/factory'

interface GistInfo {
  id: string
  description: string
  html_url: string
}

async function listGists(token: string): Promise<GistInfo[]> {
  const { 'mixed-port': port = 7890 } = await getControledMihomoConfig()
  const res = await axios.get('https://api.github.com/gists', {
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
  return res.data as GistInfo[]
}

async function createGist(token: string, content: string): Promise<void> {
  const { 'mixed-port': port = 7890 } = await getControledMihomoConfig()
  return await axios.post(
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
  const { 'mixed-port': port = 7890 } = await getControledMihomoConfig()
  return await axios.patch(
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
    const gist = gists.find(
      (gist) => gist.description === 'Auto Synced Clash Party Runtime Config'
    )
    if (!gist) throw new Error('Gist not found')
    return gist.html_url
  }
}

export async function uploadRuntimeConfig(): Promise<void> {
  const { githubToken } = await getAppConfig()
  if (!githubToken) return
  const gists = await listGists(githubToken)
  const gist = gists.find((gist) => gist.description === 'Auto Synced Clash Party Runtime Config')
  const config = await getRuntimeConfigStr()
  if (gist) {
    await updateGist(githubToken, gist.id, config)
  } else {
    await createGist(githubToken, config)
  }
}
