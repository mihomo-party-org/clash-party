import assert from 'node:assert/strict'
import {
  hasRegistryAutoRunEntry,
  hasScheduledAutoRunTask,
  repairWindowsAutoRun,
  windowsAutoRunAppName
} from '../src/main/sys/windowsAutoRun'

type ExecResult = { stdout: string }

async function testRepairRemovesRegistryEntryWhenTaskExists(): Promise<void> {
  const commands: string[] = []
  const execCommand = async (command: string): Promise<ExecResult> => {
    commands.push(command)
    return { stdout: command.includes('schtasks.exe') ? windowsAutoRunAppName : '' }
  }

  assert.equal(await repairWindowsAutoRun(execCommand), true)
  assert.equal(commands.length, 2)
  assert.match(commands[0], /schtasks\.exe \/query/)
  assert.match(commands[1], /reg delete/)
}

async function testRegistryFallbackDoesNotMasqueradeAsTask(): Promise<void> {
  const commands: string[] = []
  const execCommand = async (command: string): Promise<ExecResult> => {
    commands.push(command)
    if (command.startsWith('reg query')) {
      return { stdout: windowsAutoRunAppName }
    }
    throw new Error('Scheduled task not found')
  }

  assert.equal(await hasScheduledAutoRunTask(execCommand), false)
  assert.equal(await hasRegistryAutoRunEntry(execCommand), true)
  assert.equal(await repairWindowsAutoRun(execCommand), false)
  assert.equal(
    commands.some((command) => command.startsWith('reg delete')),
    false
  )
}

await testRepairRemovesRegistryEntryWhenTaskExists()
await testRegistryFallbackDoesNotMasqueradeAsTask()

process.stdout.write('Windows auto-run verification passed.\n')
