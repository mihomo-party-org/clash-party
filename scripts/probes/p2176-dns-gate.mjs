// #2176: only pin macOS system DNS to 223.5.5.5 when DNS hijack is active and DNS on.
import { ok, section, finish, read } from './lib.mjs'

section('source')
const manager = read('src/main/core/manager.ts')
const call = manager.indexOf('await setPublicDNS()')
ok(
  '2176_gate_present',
  manager.includes('autoSetDNS && hijackActive && dnsModuleEnabled') &&
    manager.indexOf('autoSetDNS && hijackActive && dnsModuleEnabled') < call
)
ok(
  '2176_reads_generated_runtime',
  manager.includes('const generatedConfig = await getRuntimeConfig()') &&
    manager.includes("generatedConfig.tun?.['dns-hijack']") &&
    manager.includes('generatedConfig.dns?.enable !== false')
)

section('truth table')
function shouldWrite({ tunEnable, autoSetDNS, dnsHijack, dnsEnable }) {
  const hijackActive = Array.isArray(dnsHijack) ? dnsHijack.length > 0 : Boolean(dnsHijack)
  return Boolean(tunEnable) && autoSetDNS && hijackActive && dnsEnable !== false
}
ok(
  '2176_dns_disabled_no_write',
  !shouldWrite({ tunEnable: true, autoSetDNS: true, dnsHijack: ['any:53'], dnsEnable: false })
)
ok(
  '2176_no_dns_config_no_write',
  !shouldWrite({ tunEnable: true, autoSetDNS: true, dnsHijack: [], dnsEnable: undefined })
)
ok(
  '2176_autoset_off_no_write',
  !shouldWrite({ tunEnable: true, autoSetDNS: false, dnsHijack: ['any:53'], dnsEnable: true })
)
ok(
  '2176_tun_off_no_write',
  !shouldWrite({ tunEnable: false, autoSetDNS: true, dnsHijack: ['any:53'], dnsEnable: true })
)
ok(
  '2176_managed_dns_still_writes',
  shouldWrite({ tunEnable: true, autoSetDNS: true, dnsHijack: ['any:53'], dnsEnable: true })
)

finish('p2176-dns-gate')
