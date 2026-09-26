import fs from 'fs'
import path from 'path'

export type LinuxConnectionMetadata = Partial<IMihomoConnectionDetail['metadata']>

export interface LinuxProcessIdentity {
  executablePath: string
  parentPid: number
  cgroup: string
  appImagePath?: string
}

interface SocketSnapshot {
  endpoints: Map<string, Set<string>>
  pids?: Promise<string[]>
  executables: Map<string, Promise<string>>
  owners: Map<string, Promise<Map<string, number[]>>>
}

interface CachedSocketSnapshot {
  expiresAt: number
  value: Promise<SocketSnapshot>
}

const SOCKET_SNAPSHOT_CACHE_MS = 1000
const MAX_PROC_ROOT_CACHE_SIZE = 4
const socketSnapshots = new Map<string, CachedSocketSnapshot>()

function procAddress(address?: string): string | undefined {
  if (!address) return undefined
  const value = address.split('%')[0]
  const ipv4 = value.split('.').map(Number)
  if (
    ipv4.length === 4 &&
    ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
  ) {
    return ipv4
      .reverse()
      .map((part) => part.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  }

  const sections = value.split('::')
  if (sections.length > 2) return undefined
  const left = sections[0] ? sections[0].split(':') : []
  const right = sections[1] ? sections[1].split(':') : []
  const missing = 8 - left.length - right.length
  if ((sections.length === 1 && missing !== 0) || missing < 0) return undefined
  const words = [...left, ...Array(missing).fill('0'), ...right]
  if (words.length !== 8 || words.some((word) => !/^[\da-f]{1,4}$/i.test(word))) return undefined

  const bytes = words.flatMap((word) => {
    const number = Number.parseInt(word, 16)
    return [number >> 8, number & 0xff]
  })
  return Array.from({ length: 4 }, (_, index) =>
    bytes
      .slice(index * 4, index * 4 + 4)
      .reverse()
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  )
    .join('')
    .toUpperCase()
}

function endpointKey(network: string, address: string, port: string): string {
  return `${network}\0${address}\0${port}`
}

function addEndpoint(
  endpoints: Map<string, Set<string>>,
  network: string,
  address: string,
  port: string,
  inode: string
): void {
  for (const key of [endpointKey(network, address, port), endpointKey(network, '', port)]) {
    const inodes = endpoints.get(key)
    if (inodes) inodes.add(inode)
    else endpoints.set(key, new Set([inode]))
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const run = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await worker(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()))
  return results
}

async function readSocketTables(procRoot: string): Promise<Map<string, Set<string>>> {
  const endpoints = new Map<string, Set<string>>()
  await Promise.all(
    (['tcp', 'tcp6', 'udp', 'udp6'] as const).map(async (file) => {
      let content: string
      try {
        content = await fs.promises.readFile(path.join(procRoot, 'net', file), 'utf8')
      } catch {
        return
      }

      const network = file.startsWith('udp') ? 'udp' : 'tcp'
      for (const line of content.split('\n').slice(1)) {
        const fields = line.trim().split(/\s+/)
        const endpoint = fields[1]?.split(':')
        if (endpoint?.[0] && endpoint[1] && fields[9]) {
          addEndpoint(endpoints, network, endpoint[0], endpoint[1], fields[9])
        }
      }
    })
  )
  return endpoints
}

async function readSocketOwners(
  procRoot: string,
  snapshot: SocketSnapshot,
  processPath: string
): Promise<Map<string, number[]>> {
  const owners = new Map<string, number[]>()
  const pids = await (snapshot.pids ||= fs.promises.readdir(procRoot).then(
    (entries) => entries.filter((entry) => /^\d+$/.test(entry)),
    () => []
  ))
  await mapWithConcurrency(pids, 8, async (entry) => {
    // Mihomo already supplies /proc/<pid>/exe. Only inspect FDs of matching processes.
    // Keep shared helpers separate: their socket owner still determines the application.
    if (processPath) {
      let executable = snapshot.executables.get(entry)
      if (!executable) {
        executable = fs.promises.readlink(path.join(procRoot, entry, 'exe')).catch(() => '')
        snapshot.executables.set(entry, executable)
      }
      if ((await executable) !== processPath) return
    }
    const pid = Number(entry)
    const fdRoot = path.join(procRoot, entry, 'fd')
    let fds: string[]
    try {
      fds = await fs.promises.readdir(fdRoot)
    } catch {
      return
    }

    await mapWithConcurrency(fds, 8, async (fd) => {
      try {
        const inode = (await fs.promises.readlink(path.join(fdRoot, fd))).match(
          /^socket:\[(\d+)\]$/
        )?.[1]
        if (inode) {
          const pids = owners.get(inode)
          if (pids) pids.push(pid)
          else owners.set(inode, [pid])
        }
      } catch {
        // The process may exit or deny access while scanning.
      }
    })
  })
  return owners
}

async function buildSocketSnapshot(procRoot: string): Promise<SocketSnapshot> {
  const endpoints = await readSocketTables(procRoot)
  return { endpoints, executables: new Map(), owners: new Map() }
}

function getSocketSnapshot(procRoot: string): Promise<SocketSnapshot> {
  const cached = socketSnapshots.get(procRoot)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  if (!cached && socketSnapshots.size >= MAX_PROC_ROOT_CACHE_SIZE) {
    socketSnapshots.delete(socketSnapshots.keys().next().value as string)
  }
  const value = buildSocketSnapshot(procRoot)
  const entry = { expiresAt: Number.POSITIVE_INFINITY, value }
  socketSnapshots.set(procRoot, entry)
  void value.then(
    () => {
      entry.expiresAt = Date.now() + SOCKET_SNAPSHOT_CACHE_MS
    },
    () => socketSnapshots.delete(procRoot)
  )
  return value
}

export async function findConnectionPid(
  metadata: LinuxConnectionMetadata,
  procRoot = '/proc'
): Promise<number | undefined> {
  const port = Number(metadata.sourcePort)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return undefined

  const network = metadata.network?.toLowerCase() === 'udp' ? 'udp' : 'tcp'
  const portHex = port.toString(16).padStart(4, '0').toUpperCase()
  const address = procAddress(metadata.sourceIP) || ''
  const snapshot = await getSocketSnapshot(procRoot)
  const inodes = snapshot.endpoints.get(endpointKey(network, address, portHex))
  if (!inodes) return undefined

  const processPath = metadata.processPath || ''
  let owners = snapshot.owners.get(processPath)
  if (!owners) {
    owners = readSocketOwners(procRoot, snapshot, processPath)
    snapshot.owners.set(processPath, owners)
  }
  const socketOwners = await owners
  for (const inode of inodes) {
    for (const pid of socketOwners.get(inode) || []) {
      if (metadata.uid === undefined) return pid
      const status = await readFile(path.join(procRoot, String(pid), 'status'))
      const uid = Number(status.match(/^Uid:\s+(\d+)/m)?.[1])
      if (uid === metadata.uid) return pid
    }
  }
  return undefined
}

async function readFile(file: string): Promise<string> {
  try {
    return await fs.promises.readFile(file, 'utf8')
  } catch {
    return ''
  }
}

export async function getProcessIdentity(
  pid: number,
  procRoot = '/proc'
): Promise<LinuxProcessIdentity | undefined> {
  const processRoot = path.join(procRoot, String(pid))
  const stat = await readFile(path.join(processRoot, 'stat'))
  if (!stat) return undefined
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/)
  const parentPid = Number(fields[1])
  if (!Number.isInteger(parentPid)) return undefined

  let executablePath: string
  try {
    executablePath = await fs.promises.readlink(path.join(processRoot, 'exe'))
  } catch {
    return undefined
  }
  const [environment, cgroup] = await Promise.all([
    readFile(path.join(processRoot, 'environ')),
    readFile(path.join(processRoot, 'cgroup'))
  ])
  return {
    executablePath,
    parentPid,
    cgroup,
    appImagePath: environment
      .split('\0')
      .find((entry) => entry.startsWith('APPIMAGE='))
      ?.slice(9)
  }
}
