import { net, session } from 'electron'

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  headers?: Record<string, string>
  body?: string | Buffer
  proxy?:
    | {
        protocol: 'http' | 'https' | 'socks5'
        host: string
        port: number
      }
    | false
  timeout?: number
  responseType?: 'text' | 'json' | 'arraybuffer'
  followRedirect?: boolean
  maxRedirects?: number
}

export interface Response<T = unknown> {
  data: T
  status: number
  statusText: string
  headers: Record<string, string>
  url: string
}

// 复用单个 session 用于代理请求
let proxySession: Electron.Session | null = null
let currentProxyUrl: string | null = null
let proxySetupPromise: Promise<void> | null = null

async function getProxySession(proxyUrl: string): Promise<Electron.Session> {
  if (!proxySession) {
    proxySession = session.fromPartition('proxy-requests', { cache: false })
  }
  if (currentProxyUrl !== proxyUrl) {
    proxySetupPromise = proxySession.setProxy({ proxyRules: proxyUrl })
    currentProxyUrl = proxyUrl
  }
  if (proxySetupPromise) {
    await proxySetupPromise
  }
  return proxySession
}

/**
 * Make HTTP request using Chromium's network stack (via electron.net)
 * This provides better compatibility, HTTP/2 support, and system certificate integration
 */
export async function request<T = unknown>(
  url: string,
  options: RequestOptions = {}
): Promise<Response<T>> {
  const {
    method = 'GET',
    headers = {},
    body,
    proxy,
    timeout = 30000,
    responseType = 'text',
    followRedirect = true,
    maxRedirects = 20
  } = options

  return new Promise((resolve, reject) => {
    let sessionToUse: Electron.Session = session.defaultSession

    // Set up proxy if specified
    const setupProxy = async (): Promise<void> => {
      if (proxy) {
        const proxyUrl = `${proxy.protocol}://${proxy.host}:${proxy.port}`
        sessionToUse = await getProxySession(proxyUrl)
      }
    }

    const cleanup = (): void => {}

    setupProxy()
      .then(() => {
        const req = net.request({
          method,
          url,
          session: sessionToUse,
          redirect: followRedirect ? 'follow' : 'manual',
          useSessionCookies: true
        })

        // Set request headers
        Object.entries(headers).forEach(([key, value]) => {
          req.setHeader(key, value)
        })

        // Timeout handling
        let timeoutId: NodeJS.Timeout | undefined
        if (timeout > 0) {
          timeoutId = setTimeout(() => {
            req.abort()
            cleanup()
            reject(new Error(`Request timeout after ${timeout}ms`))
          }, timeout)
        }

        const chunks: Buffer[] = []
        let redirectCount = 0

        req.on('redirect', () => {
          redirectCount++
          if (redirectCount > maxRedirects) {
            req.abort()
            cleanup()
            if (timeoutId) clearTimeout(timeoutId)
            reject(new Error(`Too many redirects (>${maxRedirects})`))
          }
        })

        req.on('response', (res) => {
          const { statusCode, statusMessage } = res

          // Extract response headers
          const responseHeaders: Record<string, string> = {}
          const rawHeaders = res.rawHeaders || []
          for (let i = 0; i < rawHeaders.length; i += 2) {
            responseHeaders[rawHeaders[i].toLowerCase()] = rawHeaders[i + 1]
          }

          res.on('data', (chunk: Buffer) => {
            chunks.push(chunk)
          })

          res.on('end', () => {
            cleanup()
            if (timeoutId) clearTimeout(timeoutId)

            const buffer = Buffer.concat(chunks)
            let data: unknown

            try {
              switch (responseType) {
                case 'json':
                  data = JSON.parse(buffer.toString('utf-8'))
                  break
                case 'arraybuffer':
                  data = buffer
                  break
                case 'text':
                default:
                  data = buffer.toString('utf-8')
              }

              resolve({
                data: data as T,
                status: statusCode,
                statusText: statusMessage,
                headers: responseHeaders,
                url: url
              })
            } catch (error: unknown) {
              reject(new Error(`Failed to parse response: ${String(error)}`))
            }
          })

          res.on('error', (error: unknown) => {
            cleanup()
            if (timeoutId) clearTimeout(timeoutId)
            reject(error)
          })
        })

        req.on('error', (error: unknown) => {
          cleanup()
          if (timeoutId) clearTimeout(timeoutId)
          reject(error)
        })

        req.on('abort', () => {
          cleanup()
          if (timeoutId) clearTimeout(timeoutId)
          reject(new Error('Request aborted'))
        })

        // Send request body
        if (body) {
          if (typeof body === 'string') {
            req.write(body, 'utf-8')
          } else {
            req.write(body)
          }
        }

        req.end()
      })
      .catch((error: unknown) => {
        cleanup()
        reject(new Error(`Failed to setup proxy: ${String(error)}`))
      })
  })
}

/**
 * Convenience method for GET requests
 */
export const get = <T = unknown>(
  url: string,
  options?: Omit<RequestOptions, 'method' | 'body'>
): Promise<Response<T>> => request<T>(url, { ...options, method: 'GET' })

/**
 * Convenience method for POST requests
 */
export const post = <T = unknown>(
  url: string,
  data: unknown,
  options?: Omit<RequestOptions, 'method' | 'body'>
): Promise<Response<T>> => {
  const body = typeof data === 'string' ? data : JSON.stringify(data)
  const headers = options?.headers || {}
  if (typeof data !== 'string' && !headers['content-type']) {
    headers['content-type'] = 'application/json'
  }
  return request<T>(url, { ...options, method: 'POST', body, headers })
}

/**
 * Convenience method for PUT requests
 */
export const put = <T = unknown>(
  url: string,
  data: unknown,
  options?: Omit<RequestOptions, 'method' | 'body'>
): Promise<Response<T>> => {
  const body = typeof data === 'string' ? data : JSON.stringify(data)
  const headers = options?.headers || {}
  if (typeof data !== 'string' && !headers['content-type']) {
    headers['content-type'] = 'application/json'
  }
  return request<T>(url, { ...options, method: 'PUT', body, headers })
}

/**
 * Convenience method for DELETE requests
 */
export const del = <T = unknown>(
  url: string,
  options?: Omit<RequestOptions, 'method' | 'body'>
): Promise<Response<T>> => request<T>(url, { ...options, method: 'DELETE' })

/**
 * Convenience method for PATCH requests
 */
export const patch = <T = unknown>(
  url: string,
  data: unknown,
  options?: Omit<RequestOptions, 'method' | 'body'>
): Promise<Response<T>> => {
  const body = typeof data === 'string' ? data : JSON.stringify(data)
  const headers = options?.headers || {}
  if (typeof data !== 'string' && !headers['content-type']) {
    headers['content-type'] = 'application/json'
  }
  return request<T>(url, { ...options, method: 'PATCH', body, headers })
}
