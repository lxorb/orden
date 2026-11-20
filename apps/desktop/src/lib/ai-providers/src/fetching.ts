import { isDesktop } from '../../platform/src/api'

export async function providerFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (__EVEN_PLUGIN__ || !isDesktop) return await fetch(url, init)
  const { nativeFetch } = await import('./native-fetch')
  return await nativeFetch(url, init)
}
