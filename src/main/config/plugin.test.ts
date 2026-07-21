import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

let TMP = ''
vi.mock('../utils/dirs', () => ({
  pluginConfigPath: () => join(TMP, 'plugin.yaml'),
  appConfigPath: () => join(TMP, 'app.yaml')
}))

import {
  getPluginConfig,
  addPluginItem,
  getPluginItem,
  updatePluginItem,
  patchPluginItem,
  removePluginItem
} from './plugin'

function item(id: string): IPluginItem {
  return {
    id,
    name: 'X',
    loginUrl: 'https://panel.x.com/oauth/authorize',
    spec: 'cpx-plugin/2',
    profileId: `prof-${id}`,
    status: 'active',
    created: 1,
    updated: 1
  }
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'cpxcfg-'))
  writeFileSync(join(TMP, 'app.yaml'), '{}')
})
afterEach(() => rmSync(TMP, { recursive: true, force: true }))

describe('plugin config CRUD', () => {
  it('starts empty', async () => {
    expect((await getPluginConfig(true)).items).toEqual([])
  })
  it('adds and reads back an item', async () => {
    await addPluginItem(item('a'))
    expect((await getPluginItem('a'))?.name).toBe('X')
    expect((await getPluginConfig(true)).items).toHaveLength(1)
  })
  it('updates an item', async () => {
    await addPluginItem(item('a'))
    await updatePluginItem({ ...item('a'), status: 'needs-reauth' })
    expect((await getPluginItem('a'))?.status).toBe('needs-reauth')
  })
  it('patches an item', async () => {
    await addPluginItem(item('a'))
    await patchPluginItem('a', { useProxy: true })
    expect((await getPluginItem('a'))?.useProxy).toBe(true)
  })
  it('removes an item', async () => {
    await addPluginItem(item('a'))
    await removePluginItem('a')
    expect(await getPluginItem('a')).toBeUndefined()
  })
  it('does not poison the write queue when update throws', async () => {
    await expect(updatePluginItem(item('missing'))).rejects.toThrow()
    await addPluginItem(item('after'))
    expect((await getPluginItem('after'))?.id).toBe('after')
  })
  it('addPluginItem upserts an existing id', async () => {
    await addPluginItem(item('dup'))
    await addPluginItem({ ...item('dup'), name: 'renamed' })
    const cfg = await getPluginConfig(true)
    expect(cfg.items.filter((i) => i.id === 'dup')).toHaveLength(1)
    expect((await getPluginItem('dup'))?.name).toBe('renamed')
  })
})
