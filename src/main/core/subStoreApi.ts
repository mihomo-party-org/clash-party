import * as chromeRequest from '../utils/chromeRequest'
import { subStorePort } from '../resolve/server'
import { getAppConfig } from '../config'

export async function subStoreSubs(): Promise<ISubStoreSub[]> {
  const { useCustomSubStore = false, customSubStoreUrl = '' } = await getAppConfig()
  const baseUrl = useCustomSubStore ? customSubStoreUrl : `http://127.0.0.1:${subStorePort}`
  const res = await chromeRequest.get(`${baseUrl}/api/subs`, { responseType: 'json' })
  return res.data.data as ISubStoreSub[]
}

export async function subStoreCollections(): Promise<ISubStoreSub[]> {
  const { useCustomSubStore = false, customSubStoreUrl = '' } = await getAppConfig()
  const baseUrl = useCustomSubStore ? customSubStoreUrl : `http://127.0.0.1:${subStorePort}`
  const res = await chromeRequest.get(`${baseUrl}/api/collections`, { responseType: 'json' })
  return res.data.data as ISubStoreSub[]
}
