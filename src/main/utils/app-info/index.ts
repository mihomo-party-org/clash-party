import path from 'path'
import { app } from 'electron'
import { getLinuxAppInfo } from './linux'
import { findMacAppPath, getMacAppInfo } from './macos'
import { getWindowsAppInfo } from './windows'

const empty: IAppInfo = { name: '', icon: '' }
interface CachedInfo {
  expires: number
  value: Promise<IAppInfo>
}
const paths = new Map<string, CachedInfo>()
const bundles = new Map<string, CachedInfo>()

// Deduplicate in-flight work too. Negative/partial results expire sooner; both caches are bounded.
function cached(
  cache: Map<string, CachedInfo>,
  key: string,
  load: () => Promise<IAppInfo>
): Promise<IAppInfo> {
  const previous = cache.get(key)
  if (previous && previous.expires > Date.now()) return previous.value
  if (cache.size >= 256) cache.delete(cache.keys().next().value as string)
  const entry = { expires: Infinity, value: load().catch(() => empty) }
  cache.set(key, entry)
  void entry.value.then((info) => {
    entry.expires = Date.now() + (info.name && info.icon ? 300_000 : 30_000)
  })
  return entry.value
}

export function getAppInfo(
  metadata: Partial<IMihomoConnectionDetail['metadata']>
): Promise<IAppInfo> {
  if (process.platform === 'linux') return getLinuxAppInfo(metadata)
  let file = metadata.processPath || ''
  if (file === 'mihomo') file = app.getPath('exe')
  if (!file) return Promise.resolve(empty)
  const key = process.platform === 'win32' ? path.win32.normalize(file).toLowerCase() : file
  return cached(paths, key, async () => {
    if (process.platform === 'win32') return getWindowsAppInfo(file)
    if (process.platform === 'darwin') {
      const bundle = await findMacAppPath(file)
      return bundle ? cached(bundles, bundle, () => getMacAppInfo(bundle)) : empty
    }
    return empty
  })
}
