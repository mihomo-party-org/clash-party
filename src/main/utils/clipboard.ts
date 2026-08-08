import { spawn } from 'child_process'
import { clipboard } from 'electron'
import { isWaylandSession } from './wayland'

function writeWithWlCopy(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('wl-copy', ['--type', 'text/plain;charset=utf-8'], {
      stdio: ['pipe', 'ignore', 'pipe']
    })
    let stderr = ''

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(stderr.trim() || `wl-copy exited with code ${code}`))
      }
    })
    child.stdin.once('error', reject)
    child.stdin.end(text)
  })
}

/**
 * Electron's native Wayland clipboard write can be ignored when the app does
 * not own keyboard focus (for example, when invoked from the tray menu).
 * Packaged Linux builds include wl-copy to handle that case without requiring
 * a system-wide wl-clipboard installation.
 */
export async function writeClipboardText(text: string): Promise<void> {
  if (isWaylandSession()) {
    await writeWithWlCopy(text)
    return
  }

  clipboard.writeText(text)
}
