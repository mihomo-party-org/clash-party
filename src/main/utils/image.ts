import * as chromeRequest from './chromeRequest'
import { getControledMihomoConfig } from '../config'

export async function getImageDataURL(url: string): Promise<string> {
  const { 'mixed-port': port = 7890 } = await getControledMihomoConfig()
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
