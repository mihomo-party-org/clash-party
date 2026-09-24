// #2167: DNS-override confirmation fingerprint must survive restart.
import { ok, section, finish, read } from './lib.mjs'

section('source')
const guard = read('src/main/core/dnsOverrideGuard.ts')
const factory = read('src/main/core/factory.ts')
const types = read('src/shared/types.d.ts')
ok(
  '2167_guard_persists_confirmation',
  guard.includes('dnsOverrideConfirmedFingerprint') &&
    guard.includes('persistConfirmedFingerprint') &&
    guard.includes('ensureDnsOverrideGuardHydrated')
)
ok('2167_persist_on_commit', guard.includes('persistConfirmedFingerprint(confirmedFingerprint)'))
ok(
  '2167_factory_hydrates_before_evaluate',
  factory.includes('ensureDnsOverrideGuardHydrated()') &&
    factory.indexOf('ensureDnsOverrideGuardHydrated()') <
      factory.indexOf('evaluateDnsOverrideGuard(')
)
ok('2167_types_declare_field', types.includes('dnsOverrideConfirmedFingerprint?: string | null'))

section('guard decision model')
function decide({ fingerprint, controlDns, confirmedFingerprint }) {
  const confirmed = fingerprint !== null && confirmedFingerprint === fingerprint
  const autoDisabled = controlDns && fingerprint !== null && !confirmed
  return { controlDns: controlDns && !autoDisabled, autoDisabled }
}
const fp = 'fp-profile-dns-v1'
const restart = decide({ fingerprint: fp, controlDns: true, confirmedFingerprint: fp })
ok('2167_restart_keeps_override', !restart.autoDisabled && restart.controlDns)
const changed = decide({ fingerprint: 'fp-v2', controlDns: true, confirmedFingerprint: fp })
ok('2167_profile_change_still_guards', changed.autoDisabled && !changed.controlDns)
const unconfirmed = decide({ fingerprint: fp, controlDns: true, confirmedFingerprint: null })
ok('2167_unconfirmed_still_guards', unconfirmed.autoDisabled)

finish('p2167-guard-persist')
