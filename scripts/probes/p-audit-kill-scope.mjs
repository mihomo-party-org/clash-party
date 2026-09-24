// AUDIT-01: leftover-core cleanup must never touch processes outside our sidecar dir.
import { ok, section, finish, read } from './lib.mjs'

section('source')
const init = read('src/main/utils/init.ts')
const body = (() => {
  const at = init.indexOf('async function killOldMihomoProcesses(')
  const end = init.indexOf('async function initFiles(')
  return init.slice(at, end > 0 ? end : init.length)
})()
ok(
  'audit01_path_filter_present',
  body.includes('mihomoCoreDir()') && body.includes('ExecutablePath')
)
ok(
  'audit01_kills_only_inside_core_dir',
  body.includes('normalizedExe.startsWith(coreDir + path.sep)')
)
ok('audit01_fail_closed', body.includes('查询失败时保守处理') && !body.includes('tasklist'))
ok('audit01_names_still_cover_specific', body.includes("'mihomo-specific.exe'"))

section('selection model')
function newSelect(procs, coreDir) {
  return procs
    .filter(
      (p) =>
        p.self !== true &&
        p.exePath &&
        p.exePath.toLowerCase().startsWith(coreDir.toLowerCase() + '\\')
    )
    .map((p) => p.pid)
}
const coreDir = 'C:\\app\\resources\\sidecar'
const procs = [
  { pid: 100, name: 'mihomo.exe', exePath: 'C:\\app\\resources\\sidecar\\mihomo.exe', self: false },
  {
    pid: 200,
    name: 'mihomo.exe',
    exePath: 'D:\\clash party\\resources\\sidecar\\mihomo.exe',
    self: false
  },
  { pid: 300, name: 'mihomo-alpha.exe', exePath: null, self: false },
  {
    pid: 400,
    name: 'mihomo.exe',
    exePath: 'C:\\app\\resources\\sidecar-evil\\mihomo.exe',
    self: false
  }
]
const out = newSelect(procs, coreDir)
ok('audit01_kills_own_leftover', out.includes(100), `pids=${out}`)
ok(
  'audit01_spares_foreign_unknown_sibling',
  !out.includes(200) && !out.includes(300) && !out.includes(400)
)

finish('p-audit-kill-scope')
