import { ChildProcess, spawn } from 'child_process'
import path from 'path'
import { existsSync } from 'fs'
import { readFile, rm, writeFile } from 'fs/promises'
import { dataDir, resourcesFilesDir } from '../utils/dirs'
import { getAppConfig } from '../config'
import { verifyProcessOwner } from '../core/process'

let child: ChildProcess

export async function startMonitor(detached = false): Promise<void> {
  if (process.platform !== 'win32') return
  if (existsSync(path.join(dataDir(), 'monitor.pid'))) {
    const pid = parseInt(await readFile(path.join(dataDir(), 'monitor.pid'), 'utf-8'))
    try {
      if (!isNaN(pid)) {
        const isOwner = await verifyProcessOwner(pid, 'TrafficMonitor')
        if (isOwner) {
          process.kill(pid, 'SIGINT')
        }
      }
    } catch {
      // ignore
    } finally {
      await rm(path.join(dataDir(), 'monitor.pid'))
    }
  }
  await stopMonitor()
  const { showTraffic = false } = await getAppConfig()
  if (!showTraffic) return
  child = spawn(path.join(resourcesFilesDir(), 'TrafficMonitor/TrafficMonitor.exe'), [], {
    cwd: path.join(resourcesFilesDir(), 'TrafficMonitor'),
    detached: detached,
    stdio: detached ? 'ignore' : undefined
  })
  if (detached) {
    if (child && child.pid) {
      await writeFile(path.join(dataDir(), 'monitor.pid'), child.pid.toString())
    }
    child.unref()
  }
}

async function stopMonitor(): Promise<void> {
  if (child) {
    child.kill('SIGINT')
  }
}
