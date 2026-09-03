import { getControledMihomoConfig } from '../config'
import { DEFAULT_MIHOMO_PORTS } from '../../shared/appConfig'
import * as chromeRequest from './chromeRequest'

export async function getImageDataURL(url: string): Promise<string> {
  const { 'mixed-port': port = DEFAULT_MIHOMO_PORTS.mixed } = await getControledMihomoConfig()
  const res = await chromeRequest.get(url, {
    responseType: 'arraybuffer',
    // 用户关闭混合端口时配置里存的是 0（不是 undefined，解构默认值兜不住），此时必须直连，否则会请求 127.0.0.1:0
    proxy:
      port !== 0
        ? {
            protocol: 'http',
            host: '127.0.0.1',
            port
          }
        : false
  })
  const mimeType = res.headers['content-type']
  const dataURL = `data:${mimeType};base64,${Buffer.from(res.data as Buffer).toString('base64')}`
  return dataURL
}
