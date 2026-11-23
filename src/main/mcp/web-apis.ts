import { webcrypto } from 'node:crypto'
import { Blob } from 'node:buffer'
import { ReadableStream, TransformStream, WritableStream } from 'node:stream/web'
import { TextDecoder, TextEncoder } from 'node:util'
import { fetch, Headers, Request, Response, FormData, File } from 'undici'

// Electron 22's Node runtime lacks Fetch globals. Initialize these before the
// transport adapter evaluates its Headers/Request/Response subclasses.
const fallbacks = {
  fetch,
  Headers,
  Request,
  Response,
  FormData,
  File,
  Blob,
  ReadableStream,
  TransformStream,
  WritableStream,
  TextEncoder,
  TextDecoder,
  crypto: webcrypto
}

for (const [name, value] of Object.entries(fallbacks)) {
  if (typeof Reflect.get(globalThis, name) === 'undefined') {
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true })
  }
}
