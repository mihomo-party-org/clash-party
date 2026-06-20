import { getControledMihomoConfig } from '../config'
import { DEFAULT_MIHOMO_PORTS } from '../../shared/appConfig'
import * as chromeRequest from './chromeRequest'

export async function getImageDataURL(url: string): Promise<string> {
  const { 'mixed-port': port = DEFAULT_MIHOMO_PORTS.mixed } = await getControledMihomoConfig()
  const res = await chromeRequest.get(url, {
    responseType: 'arraybuffer',
    proxy: {
      protocol: 'http',
      host: '127.0.0.1',
      port
    }
  })
  const mimeType = res.headers['content-type']
  const dataURL = `data:${mimeType};base64,${Buffer.from(res.data as Buffer).toString('base64')}`
  return dataURL
}
