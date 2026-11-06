import { normalise } from './paths'
import { mimeOfPath, UNKNOWN_TYPE } from '../mime'

export const ASSET_ROUTE = '/asset/'

export function assetType(path: string, stored?: string): string {
  return mimeOfPath(path) ?? stored ?? UNKNOWN_TYPE
}

export function assetRoute(path: string): string {
  const inside = normalise(path).slice(1)
  return ASSET_ROUTE + inside.split('/').map(encodeURIComponent).join('/')
}

export function assetStorePath(url: string): string | null {
  const at = url.indexOf(ASSET_ROUTE)
  if (at !== 0 && !(at > 0 && /^[a-z][a-z\d+.-]*:\/\/[^/]*$/i.test(url.slice(0, at)))) return null

  const written = url.slice(at + ASSET_ROUTE.length).split(/[?#]/)[0] ?? ''
  if (!written) return null

  try {
    return normalise(written.split('/').map(decodeURIComponent).join('/'))
  } catch {
    return null
  }
}
