import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const cwd = process.cwd()
const gitDir = path.join(cwd, '.git')
const hooksDir = path.join(cwd, '.githooks')
const hookFiles = ['pre-commit']

if (!fs.existsSync(gitDir)) {
  console.log('[git-hooks] .git directory not found, skipping hook installation.')
  process.exit(0)
}

if (!fs.existsSync(hooksDir)) {
  console.log('[git-hooks] .githooks directory not found, skipping hook installation.')
  process.exit(0)
}

try {
  execFileSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], {
    cwd,
    stdio: 'inherit'
  })

  for (const hookFile of hookFiles) {
    const hookPath = path.join(hooksDir, hookFile)
    if (fs.existsSync(hookPath)) {
      fs.chmodSync(hookPath, 0o755)
    }
  }

  console.log('[git-hooks] Installed hooks from .githooks.')
} catch (error) {
  console.error('[git-hooks] Failed to install git hooks.')
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
