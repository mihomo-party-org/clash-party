import { AsyncLocalStorage } from 'node:async_hooks'
import { runDirectSpeedtest } from '../utils/hy2Bandwidth'

const silentHy2Storage = new AsyncLocalStorage<boolean>()

export function runInSilentHy2Context<T>(fn: () => Promise<T>): Promise<T> {
  return silentHy2Storage.run(true, fn)
}

export function isSilentHy2Context(): boolean {
  return silentHy2Storage.getStore() === true
}

interface PendingPromptEntry {
  prompt: IHy2BandwidthPrompt
  resolve: (policy: IHy2BandwidthPolicy) => void
  timer: NodeJS.Timeout
}

let activePromptEntry: PendingPromptEntry | null = null
let promptQueueChain: Promise<void> = Promise.resolve()
let activeSpeedtestAbortController: AbortController | null = null

const PROMPT_TIMEOUT_MS = 300_000 // 5 minutes

export async function requestHy2BandwidthPolicy(params: {
  profileId: string
  profileName: string
  inspection: IHy2ProfileInspection
  savedPolicy: IHy2BandwidthPolicy | null
}): Promise<IHy2BandwidthPolicy> {
  const runPrompt = () =>
    new Promise<IHy2BandwidthPolicy>((resolve) => {
      const promptId = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
      const fallbackPolicy: IHy2BandwidthPolicy = params.savedPolicy ?? {
        mode: 'keep',
        updatedAt: Date.now()
      }

      const finish = (policy: IHy2BandwidthPolicy) => {
        if (activePromptEntry?.prompt.promptId === promptId) {
          clearTimeout(activePromptEntry.timer)
          activePromptEntry = null
        }
        resolve(policy)
      }

      const timer = setTimeout(() => {
        finish(fallbackPolicy)
      }, PROMPT_TIMEOUT_MS)

      const prompt: IHy2BandwidthPrompt = {
        promptId,
        profileId: params.profileId,
        profileName: params.profileName,
        hy2Count: params.inspection.hy2Count,
        names: params.inspection.names,
        firstUpMbps: params.inspection.firstUpMbps,
        firstDownMbps: params.inspection.firstDownMbps,
        savedPolicy: params.savedPolicy
      }

      activePromptEntry = {
        prompt,
        resolve: finish,
        timer
      }

      import('../window')
        .then(({ mainWindow }) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('hy2BandwidthPrompt', prompt)
          }
        })
        .catch(() => {})
    })

  const resPromise = promptQueueChain.then(runPrompt, runPrompt)
  promptQueueChain = resPromise.then(
    () => {},
    () => {}
  )
  return resPromise
}

export async function takeHy2BandwidthPrompt(): Promise<IHy2BandwidthPrompt | null> {
  return activePromptEntry?.prompt ?? null
}

export async function resolveHy2BandwidthPrompt(
  promptId: string,
  policy: IHy2BandwidthPolicy
): Promise<boolean> {
  if (activePromptEntry && activePromptEntry.prompt.promptId === promptId) {
    const sanitized: IHy2BandwidthPolicy = {
      mode: policy?.mode === 'bbr' || policy?.mode === 'brutal' ? policy.mode : 'keep',
      upMbps:
        typeof policy?.upMbps === 'number' && policy.upMbps > 0
          ? Math.round(policy.upMbps)
          : undefined,
      downMbps:
        typeof policy?.downMbps === 'number' && policy.downMbps > 0
          ? Math.round(policy.downMbps)
          : undefined,
      updatedAt: Date.now()
    }
    activePromptEntry.resolve(sanitized)
    return true
  }
  return false
}

export async function runHy2Speedtest(): Promise<IHy2SpeedtestResult> {
  abortHy2Speedtest()
  const ac = new AbortController()
  activeSpeedtestAbortController = ac

  try {
    const { mainWindow } = await import('../window')
    const result = await runDirectSpeedtest({
      signal: ac.signal,
      onProgress: (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('hy2BandwidthSpeedtestProgress', progress)
        }
      }
    })
    return result
  } finally {
    if (activeSpeedtestAbortController === ac) {
      activeSpeedtestAbortController = null
    }
  }
}

export async function abortHy2Speedtest(): Promise<void> {
  if (activeSpeedtestAbortController) {
    activeSpeedtestAbortController.abort()
    activeSpeedtestAbortController = null
  }
}
