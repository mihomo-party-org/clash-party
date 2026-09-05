import { copyFile, open, rename, stat, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { mihomoWorkDir, mihomoTestDir } from '../utils/dirs'
import { managerLogger } from '../utils/logger'
import { downloadGitHubAsset } from '../utils/github'

const MODEL_FILE = 'Model.bin'

const MODEL_BASE_URL = 'https://github.com/vernesong/mihomo/releases/download/LightGBM-Model'

// 内核在 HomeDir 里只认死 Model.bin 这个文件名，三种尺寸下载后都要落成同一个名字。
const MODEL_ASSETS: Record<SmartModelVariant, string> = {
  standard: 'Model.bin',
  middle: 'Model-middle.bin',
  large: 'Model-large.bin'
}

// 只看文件头尾判断完整性，不把整个模型（最大 26MB）读进内存。真正的校验是把模型加载一遍，
// 那件事只有内核做得到；这里是启发式，冲着实际发生过的那种残片去的——中断的下载与完整
// 文件开头一模一样（都是 tree），只有结尾能分开。误判方向是安全的：把好模型判成坏的，
// 用户重下一次即可；把残片当好的放过去，内核就再也起不来了。
const MODEL_PROBE_SIZE = 64
const MODEL_HEADER = 'tree'
const MODEL_FOOTER = '[/target_enhance]'

async function modelLooksComplete(filePath: string, size: number): Promise<boolean> {
  if (size <= MODEL_PROBE_SIZE * 2) return false
  const handle = await open(filePath, 'r')
  try {
    const head = Buffer.alloc(MODEL_PROBE_SIZE)
    const tail = Buffer.alloc(MODEL_PROBE_SIZE)
    await handle.read(head, 0, MODEL_PROBE_SIZE, 0)
    await handle.read(tail, 0, MODEL_PROBE_SIZE, size - MODEL_PROBE_SIZE)
    return (
      head.toString('latin1').startsWith(MODEL_HEADER) &&
      tail.toString('latin1').trimEnd().endsWith(MODEL_FOOTER)
    )
  } finally {
    await handle.close()
  }
}

async function isSourceNewer(sourcePath: string, targetPath: string): Promise<boolean> {
  try {
    const [sourceStats, targetStats] = await Promise.all([stat(sourcePath), stat(targetPath)])
    return sourceStats.mtime > targetStats.mtime
  } catch {
    return true
  }
}

// Smart 内核在工作目录找不到 Model.bin 时会联网下载模型。而配置检查（mihomo -t）跑在独立的
// test 目录里，该目录从不包含模型；这次检查又发生在旧内核已经停止、系统代理已经撤下之后，
// 于是下载必然超时失败，每次重启白白多等约 20 秒，且失败不留文件，下次重启重演一遍。
// 正式工作目录已有模型时先同步过去，跳过这次注定失败的下载。
export async function syncSmartModelToTestDir(): Promise<void> {
  const source = path.join(mihomoWorkDir(), MODEL_FILE)
  if (!existsSync(source)) return

  const target = path.join(mihomoTestDir(), MODEL_FILE)
  if (existsSync(target) && !(await isSourceNewer(source, target))) return

  try {
    await copyFile(source, target)
  } catch (error) {
    managerLogger.warn('Failed to sync Model.bin into test dir', error)
  }
}

export async function getSmartModelStatus(): Promise<ISmartModelStatus> {
  const target = path.join(mihomoWorkDir(), MODEL_FILE)
  try {
    const stats = await stat(target)
    return {
      state: (await modelLooksComplete(target, stats.size)) ? 'ready' : 'damaged',
      size: stats.size,
      modified: stats.mtimeMs
    }
  } catch {
    return { state: 'missing', size: 0 }
  }
}

// 下载分三步走，每一步都是冲着「别把用户搞得比现在更惨」去的：先下到临时文件，验过了再
// 改名顶上去（同目录改名是原子的，内核要么读到旧模型、要么读到新模型，不会读到半个）；
// 验不过就什么都不动，旧模型哪怕过时也强过一个让内核起不来的残片；不先删旧的再下新的，
// 网断在中间时用户至少还剩原来那个。
export async function downloadSmartModel(variant: SmartModelVariant): Promise<ISmartModelStatus> {
  const target = path.join(mihomoWorkDir(), MODEL_FILE)
  const temp = `${target}.download`

  try {
    await downloadGitHubAsset(`${MODEL_BASE_URL}/${MODEL_ASSETS[variant]}`, temp)
    const { size } = await stat(temp)
    if (!(await modelLooksComplete(temp, size))) {
      throw new Error('Downloaded Smart model is incomplete')
    }
    await rename(temp, target)
  } catch (error) {
    await unlink(temp).catch(() => {})
    managerLogger.warn('Failed to download Model.bin', error)
    throw error
  }

  await syncSmartModelToTestDir()
  return getSmartModelStatus()
}
