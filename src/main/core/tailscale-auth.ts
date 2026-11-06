export interface TailscaleAuthRequest {
  name: string
  url: string
}

export type TailscaleLogEvent =
  { type: 'auth'; request: TailscaleAuthRequest } | { type: 'done'; name: string }

const logPrefix = '[Tailscale]('
const authMarker = ') To start this tsnet server, restart with TS_AUTHKEY set, or go to: '
const authDoneMarker = ') AuthLoop: state is Starting; done'

export function parseTailscaleLog(line: string): TailscaleLogEvent | undefined {
  const prefixIndex = line.indexOf(logPrefix)
  if (prefixIndex < 0) return undefined

  const rest = line.slice(prefixIndex + logPrefix.length)
  const doneMarkerIndex = rest.indexOf(authDoneMarker)
  if (doneMarkerIndex > 0) {
    return { type: 'done', name: rest.slice(0, doneMarkerIndex) }
  }

  const authMarkerIndex = rest.indexOf(authMarker)
  if (authMarkerIndex <= 0) return undefined

  const name = rest.slice(0, authMarkerIndex)
  let url = rest.slice(authMarkerIndex + authMarker.length).trim()
  const urlEnd = findUrlEnd(url)
  if (urlEnd >= 0) url = url.slice(0, urlEnd)

  if (!name || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    return undefined
  }

  return { type: 'auth', request: { name, url } }
}

function findUrlEnd(url: string): number {
  for (let index = 0; index < url.length; index++) {
    const code = url.charCodeAt(index)
    if (
      code <= 32 ||
      url[index] === '"' ||
      url[index] === "'" ||
      url[index] === '<' ||
      url[index] === '>'
    ) {
      return index
    }
  }

  return -1
}
