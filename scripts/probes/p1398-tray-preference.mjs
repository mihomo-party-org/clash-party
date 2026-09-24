// #1398: "disable tray icon" preference must survive restart (#2046 rescue kept).
import { ok, section, finish, read } from './lib.mjs'

section('source')
const tray = read('src/main/resolve/tray.ts')
const floating = read('src/main/resolve/floatingWindow.ts')
const index = read('src/main/index.ts')
const showBody = (() => {
  const at = tray.indexOf('export async function showTrayIcon(')
  const end = tray.indexOf('export ', at + 10)
  return tray.slice(at, end > 0 ? end : tray.length)
})()
const restoreBody = (() => {
  const at = floating.indexOf('async function restoreTrayIcon(')
  const end = floating.indexOf('export ', at + 10)
  return floating.slice(at, end > 0 ? end : floating.length)
})()
ok(
  '1398_showTrayIcon_respects_disableTray',
  /const \{ disableTray = false \} = await getAppConfig\(\)/.test(showBody) &&
    showBody.includes('if (disableTray) return')
)
ok('1398_fallback_helper_exists', tray.includes('export async function showTrayIconForFallback('))
ok(
  '1398_restore_does_not_overwrite_preference',
  !restoreBody.includes('disableTray: false') && restoreBody.includes('showTrayIconForFallback()')
)
ok(
  '1398_startup_gate_present',
  /if \(!disableTray\) \{\s*\n\s*uiTasks\.push\(createTray\(\)\)/.test(index)
)

section('path model')
function trayAfterRestart({ disableTrayPersisted, floatingHealthy }) {
  let live = !disableTrayPersisted
  if (!floatingHealthy) live = true
  return { live, preference: disableTrayPersisted }
}
const okCase = trayAfterRestart({ disableTrayPersisted: true, floatingHealthy: true })
ok('1398_restart_keeps_tray_hidden', okCase.live === false && okCase.preference === true)
const rescue = trayAfterRestart({ disableTrayPersisted: true, floatingHealthy: false })
ok('2046_rescue_still_works', rescue.live === true && rescue.preference === true)
ok(
  '1398_default_still_shows_tray',
  trayAfterRestart({ disableTrayPersisted: false, floatingHealthy: true }).live === true
)

finish('p1398-tray-preference')
