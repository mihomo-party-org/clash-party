// CI regression runner: executes every probe in scripts/probes/ and summarises.
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const probes = readdirSync(here)
  .filter((f) => /^p.+\.mjs$/.test(f))
  .sort()

const summary = []
for (const probe of probes) {
  const res = spawnSync(process.execPath, [join(here, probe)], { stdio: 'inherit' })
  summary.push({ probe, code: res.status ?? 1 })
}

console.log('\n===== probe summary =====')
for (const s of summary) console.log(`${s.code === 0 ? 'PASS' : 'FAIL'} ${s.probe}`)
const failed = summary.filter((s) => s.code !== 0)
console.log(
  `\ntotal=${summary.length} pass=${summary.length - failed.length} fail=${failed.length}`
)
process.exit(failed.length === 0 ? 0 : 1)
