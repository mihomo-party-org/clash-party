import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSmartOverride } from './smartOverride'

const mocks = vi.hoisted(() => ({
  appConfig: {} as Record<string, unknown>,
  addOverrideItem: vi.fn()
}))

vi.mock('../utils/logger', () => ({
  overrideLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))
vi.mock('./app', () => ({
  getAppConfig: () => Promise.resolve(mocks.appConfig)
}))
vi.mock('./override', () => ({
  addOverrideItem: mocks.addOverrideItem,
  removeOverrideItem: vi.fn(),
  getOverrideItem: () => Promise.resolve(undefined),
  getOverride: () => Promise.resolve('')
}))

interface Group {
  name: string
  type: string
  proxies: string[]
  tolerance?: number
  'prefer-asn'?: boolean
  'sample-rate'?: number
}

// 生成的覆写是一段 `function main(config)`，这里取出来真正执行，
// 断言的是转换后的配置，而不是模板文本。
const run = async (config: { proxies?: { name: string }[]; 'proxy-groups': Group[] }) => {
  await createSmartOverride()
  const script = mocks.addOverrideItem.mock.calls[0][0].file as string
  const main = new Function(`${script}\nreturn main`)() as (c: unknown) => {
    'proxy-groups': Group[]
  }
  return main(config)['proxy-groups']
}

const urlTestGroup = (): Group => ({ name: '自动选择', type: 'url-test', proxies: ['A', 'B'] })

beforeEach(() => {
  mocks.appConfig = {
    core: 'mihomo-smart',
    enableSmartCore: true,
    enableSmartOverride: true,
    smartCoreUseLightGBM: true,
    smartCoreCollectData: false,
    smartCoreStrategy: 'sticky-sessions',
    smartCollectorSize: 100
  }
  mocks.addOverrideItem.mockReset()
})

describe('smart group options', () => {
  it('writes nothing extra while the settings are at their defaults', async () => {
    const [group] = await run({ 'proxy-groups': [urlTestGroup()] })

    expect(group.type).toBe('smart')
    expect('tolerance' in group).toBe(false)
    expect('prefer-asn' in group).toBe(false)
    expect('sample-rate' in group).toBe(false)
  })

  it('applies tolerance, prefer-asn and sample-rate when they are set', async () => {
    mocks.appConfig.smartTolerance = 50
    mocks.appConfig.smartPreferASN = true
    mocks.appConfig.smartSampleRate = 0.3

    const [group] = await run({ 'proxy-groups': [urlTestGroup()] })

    expect(group.tolerance).toBe(50)
    expect(group['prefer-asn']).toBe(true)
    expect(group['sample-rate']).toBe(0.3)
  })

  it('applies them to a group that is already smart', async () => {
    mocks.appConfig.smartTolerance = 80

    const [group] = await run({
      'proxy-groups': [{ name: '已有', type: 'smart', proxies: ['A'] }]
    })

    expect(group.tolerance).toBe(80)
  })

  it('applies them to the group it creates from scratch', async () => {
    mocks.appConfig.smartPreferASN = true

    const [group] = await run({ proxies: [{ name: 'A' }], 'proxy-groups': [] })

    expect(group.type).toBe('smart')
    expect(group['prefer-asn']).toBe(true)
  })

  it('ignores a sample rate that is out of range', async () => {
    mocks.appConfig.smartSampleRate = 1

    const [group] = await run({ 'proxy-groups': [urlTestGroup()] })

    expect('sample-rate' in group).toBe(false)
  })
})
