import { spawnSync } from 'node:child_process'

const isWin = process.platform === 'win32'
const windowsShell = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe'

const runners = [
  {
    probe: 'pnpm',
    run(command) {
      return `pnpm ${command}`
    }
  },
  {
    probe: 'corepack',
    run(command) {
      return `corepack pnpm ${command}`
    }
  }
]

const checks = [
  {
    name: 'Format Check',
    command: 'run format:check',
    help: 'Formatting issues were reported above. Review the listed files and fix them before committing again.'
  },
  {
    name: 'Lint Check',
    command: 'run lint:check',
    help: 'Lint errors were reported above. Review them and fix the affected code before committing again.'
  },
  {
    name: 'Type Check',
    command: 'run typecheck',
    help: 'Type errors were reported above. Review them and fix the affected code before committing again.'
  }
]

function spawnCommand(command, { stdio = 'inherit' } = {}) {
  if (isWin) {
    return spawnSync(windowsShell, ['/d', '/s', '/c', command], {
      cwd: process.cwd(),
      stdio
    })
  }

  return spawnSync('sh', ['-lc', command], {
    cwd: process.cwd(),
    stdio
  })
}

function commandExists(command) {
  const probe = isWin ? `where ${command}` : `command -v ${command}`
  const result = spawnCommand(probe, { stdio: 'ignore' })
  return !result.error && result.status === 0
}

function printDivider() {
  console.log('========================================')
}

const runner = runners.find(({ probe }) => commandExists(probe))

if (!runner) {
  console.error('[pre-commit] Unable to find pnpm or corepack in PATH.')
  process.exit(1)
}

printDivider()
console.log('[pre-commit] Running checks before commit')
printDivider()

for (const check of checks) {
  console.log(`\n[pre-commit] ${check.name}`)
  const result = spawnCommand(runner.run(check.command))

  if (result.error) {
    console.error(`\n[pre-commit] Failed to run "${check.command}".`)
    console.error(result.error.message)
    process.exit(1)
  }

  if (result.status !== 0) {
    console.error(`\n[pre-commit] ${check.name.toUpperCase()} FAILED`)
    console.error(`[pre-commit] ${check.help}`)
    console.error('[pre-commit] Commit aborted.')
    process.exit(result.status ?? 1)
  }

  console.log(`[pre-commit] ${check.name} passed.`)
}

console.log('\n[pre-commit] All checks passed. Proceeding with commit.')
