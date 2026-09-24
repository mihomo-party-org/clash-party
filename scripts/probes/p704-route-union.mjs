// #704: override "+route-exclude-address" appends must survive the GUI TUN layer.
// Regression gate (after-fix behaviour + merge semantics) using the real deepMerge.
import { deepMerge } from '../../src/main/utils/merge.ts'
import { ok, section, finish, read } from './lib.mjs'

section('source')
const factory = read('src/main/core/factory.ts')
ok(
  '704_union_present',
  factory.includes("['route-exclude-address', 'route-address']") &&
    factory.includes('new Set([...fromControlled, ...fromProfile])')
)
const unionAt = factory.indexOf('route-exclude-address', factory.indexOf('route'))
const mergeAt = factory.indexOf('deepMerge(currentProfile, controledMihomoConfig)')
ok('704_union_before_controlled_merge', unionAt > 0 && mergeAt > 0 && unionAt < mergeAt)

section('behaviour (real deepMerge)')
const clone = (o) => JSON.parse(JSON.stringify(o))
const overridePatch = {
  tun: {
    'exclude-interface+': ['Tailscale'],
    '+route-exclude-address': ['100.64.0.0/10', '10.0.0.0/8']
  }
}
const base = { tun: { enable: true, 'route-exclude-address': ['192.168.0.0/16'] } }

function mergedPipeline(profile, patch, controlled) {
  const withOverride = deepMerge(clone(profile), clone(patch), true)
  let controlledCopy = clone(controlled)
  const controlledTun = controlledCopy.tun
  if (controlledTun) {
    const mergedTun = { ...controlledTun }
    for (const key of ['route-exclude-address', 'route-address']) {
      const fromControlled = mergedTun[key]
      if (!Array.isArray(fromControlled)) continue
      const fromProfile = Array.isArray(withOverride.tun?.[key]) ? withOverride.tun[key] : []
      mergedTun[key] = [...new Set([...fromControlled, ...fromProfile])]
    }
    controlledCopy = { ...controlledCopy, tun: mergedTun }
  }
  return deepMerge(withOverride, controlledCopy)
}

const emptyGui = mergedPipeline(base, overridePatch, {
  tun: { enable: true, stack: 'mixed', 'route-exclude-address': [] }
}).tun['route-exclude-address']
ok(
  '704_override_entries_survive_empty_gui',
  new Set(emptyGui).has('100.64.0.0/10') &&
    new Set(emptyGui).has('10.0.0.0/8') &&
    new Set(emptyGui).has('192.168.0.0/16'),
  `result=${JSON.stringify(emptyGui)}`
)
const nonEmptyGui = mergedPipeline(base, overridePatch, {
  tun: { enable: true, stack: 'mixed', 'route-exclude-address': ['172.16.0.0/12'] }
}).tun['route-exclude-address']
ok(
  '704_unions_gui_entries',
  nonEmptyGui.length === 4 && new Set(nonEmptyGui).has('172.16.0.0/12'),
  `result=${JSON.stringify(nonEmptyGui)}`
)
ok(
  '704_exclude_interface_unaffected',
  JSON.stringify(
    mergedPipeline(base, overridePatch, { tun: { enable: true } }).tun['exclude-interface']
  ) === JSON.stringify(['Tailscale'])
)

finish('p704-route-union')
