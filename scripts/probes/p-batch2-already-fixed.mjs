// Batch-2 already-fixed pinning: #1143 tray status colour with traffic display,
// #1080 restore icon when traffic display is off, #323 WebDAV CJK Basic auth.
import { ok, section, finish, read } from './lib.mjs'

section('source')
const connCard = read('src/renderer/src/components/sider/conn-card.tsx')
const tray = read('src/main/resolve/tray.ts')
const backup = read('src/main/resolve/backup.ts')

ok(
  '1143_status_colour_sync_present',
  connCard.includes('#1143') && connCard.includes('syncTrayStyle')
)
ok('1143_colored_flag_from_style', connCard.includes('trayIconColored = style.colored'))
ok(
  '1080_restore_on_toggle_off',
  connCard.includes('hasShowTrafficRef') && connCard.includes('updateTrayIcon()')
)
ok('1080_traffic_mode_gated_in_main', tray.includes('macTrafficIconEnabled'))
ok(
  '323_utf8_basic_auth_header',
  backup.includes("Buffer.from(`${webdavUsername}:${webdavPassword}`, 'utf-8').toString('base64')")
)

finish('p-batch2-already-fixed')
