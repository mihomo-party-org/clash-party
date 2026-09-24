// GUI window smoke (cloud): boots the real built app with an isolated userData and
// observes BrowserWindow visibility — validates silent-start behaviour incl. the
// #408 class (floating window must not drag the main window open). Scenario via
// PROBE_GUI_SCENARIO=silent|normal. Evidence: probe-artifacts/gui-*.jsonl / .png.
//
// Launched as: electron scripts/probes/gui-window-smoke.mjs
import { app, BrowserWindow } from 'electron'
import { appendFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

const scenario = process.env.PROBE_GUI_SCENARIO === 'normal' ? 'normal' : 'silent'
const repoRoot = process.cwd()
const artifactDir = resolve(repoRoot, 'probe-artifacts')
mkdirSync(artifactDir, { recursive: true })
const jsonl = join(artifactDir, `gui-${scenario}.jsonl`)
const verdictFile = join(artifactDir, `gui-${scenario}-verdict.json`)

writeFileSync(jsonl, '')
writeFileSync(join(artifactDir, `gui-${scenario}-pending`), String(Date.now()))

const userData = join(tmpdir(), `clash-party-gui-smoke-${scenario}-${process.pid}`)
mkdirSync(userData, { recursive: true })
app.setPath('userData', userData)

const configYaml = [
  'modeSelected: true',
  'operationMode: standard',
  `silentStart: ${scenario === 'silent'}`,
  'showFloatingWindow: true',
  'disableTray: true',
  'testProfileOnStart: false',
  'enableTrafficLogger: false',
  'autoQuitWithoutCore: false',
  'controlDns: false',
  'controlSniff: false',
  'controlTun: false',
  'sysProxy:',
  '  enable: false',
  '  mode: manual',
  ''
].join('\n')
const mihomoYaml = 'mixed-port: 17890\n'

writeFileSync(join(userData, 'config.yaml'), configYaml)
writeFileSync(join(userData, 'mihomo.yaml'), mihomoYaml)

// configureAppPaths() (main index, runs at import) forces userData to
// appData/mihomo-party-dev for unpackaged runs — which is how this smoke boots.
// Seed that path too, otherwise getAppConfig() never sees the scenario flags.
try {
  const forcedDevUserData = join(app.getPath('appData'), 'mihomo-party-dev')
  mkdirSync(forcedDevUserData, { recursive: true })
  writeFileSync(join(forcedDevUserData, 'config.yaml'), configYaml)
  writeFileSync(join(forcedDevUserData, 'mihomo.yaml'), mihomoYaml)
  console.log(`PROBE_TRACE seeded_dev_userdata=${forcedDevUserData}`)
} catch (err) {
  console.log(`PROBE_TRACE seed_dev_userdata_failed ${String(err)}`)
}

const mainWindowSeen = []
let ticks = 0
let settled = false

// Attribution: log who calls window.show() and when windows get created/activated.
const origShow = BrowserWindow.prototype.show
BrowserWindow.prototype.show = function show(...args) {
  console.log(
    `PROBE_TRACE show_call bounds=${JSON.stringify(this.getBounds())} stack=${String(new Error().stack).split('\n').slice(1, 5).join(' | ')}`
  )
  return origShow.apply(this, args)
}
app.on('activate', () => console.log('PROBE_TRACE app_activate'))
app.on('second-instance', () => console.log('PROBE_TRACE second_instance'))
app.on('browser-window-created', (_e, win) => {
  console.log(`PROBE_TRACE window_created bounds=${JSON.stringify(win.getBounds())}`)
  win.on('show', () =>
    console.log(`PROBE_TRACE window_show bounds=${JSON.stringify(win.getBounds())}`)
  )
  // Unpacked runs keep is.dev=true → main window auto-opens DevTools; a detached
  // DevTools window would pollute the ≥600×400 visibility heuristic. Keep it docked
  // closed — the smoke only measures app windows.
  win.webContents.on('devtools-opened', () => {
    try {
      win.webContents.closeDevTools()
      console.log('PROBE_TRACE devtools_closed')
    } catch {
      // best-effort
    }
  })
})

function snapshot() {
  return BrowserWindow.getAllWindows().map((w) => ({
    title: w.getTitle(),
    visible: w.isVisible(),
    w: Math.round(w.getBounds().width),
    h: Math.round(w.getBounds().height)
  }))
}

function isMainWindow(entry) {
  return entry.w >= 600 && entry.h >= 400
}

const timer = setInterval(() => {
  ticks += 1
  const snap = snapshot()
  appendFileSync(jsonl, JSON.stringify({ t: ticks, windows: snap }) + '\n')
  for (const entry of snap) {
    if (isMainWindow(entry) && entry.visible) mainWindowSeen.push(ticks)
  }
  if (ticks === 4 && snap.some((e) => e.visible)) {
    // capture evidence once windows exist
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isVisible()) continue
      win
        .capturePage()
        .then((img) => {
          writeFileSync(join(artifactDir, `gui-${scenario}-win${win.id}.png`), img.toPNG())
        })
        .catch(() => {})
    }
  }
}, 1500)

function finish() {
  if (settled) return
  settled = true
  clearInterval(timer)
  const ok = scenario === 'silent' ? mainWindowSeen.length === 0 : mainWindowSeen.length > 0
  const verdict = {
    scenario,
    ok,
    ticks,
    mainWindowVisibleTicks: mainWindowSeen,
    note:
      scenario === 'silent'
        ? 'silentStart must keep the main window hidden even with the floating window on (#408 class)'
        : 'control scenario: main window must appear when silentStart is off'
  }
  writeFileSync(verdictFile, JSON.stringify(verdict, null, 2))
  try {
    rmSync(join(artifactDir, `gui-${scenario}-pending`), { force: true })
  } catch {
    // best-effort marker cleanup
  }
  console.log(`PROBE_GUI_JSON ${JSON.stringify(verdict)}`)
  process.exitCode = ok ? 0 : 1
  app.quit()
  setTimeout(() => app.exit(ok ? 0 : 1), 6000)
}

setTimeout(finish, 16000)
app.on('will-quit', () => console.log('PROBE_GUI_WILL_QUIT'))

await import(pathToFileURL(resolve(repoRoot, 'out/main/index.js')).href)
console.log('PROBE_GUI_MAIN_IMPORTED')
