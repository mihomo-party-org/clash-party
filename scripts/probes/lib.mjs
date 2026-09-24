// Shared helpers for CI regression probes (scripts/probes/*).
// These run in GitHub Actions — no local execution expected.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const repoRoot = process.cwd()

export function read(rel) {
  return readFileSync(join(repoRoot, rel), 'utf8')
}

const results = []

export function ok(name, cond, detail = '') {
  if (cond) {
    console.log(`PASS ${name}${detail ? ' :: ' + detail : ''}`)
  } else {
    console.log(`FAIL ${name}${detail ? ' :: ' + detail : ''}`)
    results.push(name)
  }
}

export function section(title) {
  console.log(`--- ${title} ---`)
}

export function finish(probeName) {
  const failed = results.length
  console.log(
    failed === 0
      ? `\n${probeName}: ALL PASS`
      : `\n${probeName}: ${failed} FAIL (${results.join(', ')})`
  )
  process.exit(failed === 0 ? 0 : 1)
}

export function saveArtifact(name, content) {
  const dir = resolve(repoRoot, 'probe-artifacts')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, name)
  writeFileSync(file, content)
  return file
}
