import { typedAddress } from '@orden/scan/typed'

export type Failure = 'offline' | 'unknown' | 'unreachable' | 'slow' | 'certificate' | 'blocked' | 'other'
export interface Upgrade {
  tried: string
  fallback: string
}
type Settled = 'fallback' | 'done' | 'unrelated'
const SECURE = 'https://'
export function upgradeOf(typed: string, url: string): Upgrade | null {
  const said = typed.trim()
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(said) || typedAddress(said) === null) return null
  if (!url.startsWith(SECURE)) return null
  return { tried: url, fallback: `http://${url.slice(SECURE.length)}` }
}
function siteOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}
export function settled(upgrade: Upgrade, url: string, failure: Failure | null): Settled {
  const site = siteOf(url)
  if (site === null || site !== siteOf(upgrade.tried)) return 'unrelated'
  return (failure === 'unreachable' || failure === 'slow') && url.startsWith('https:') ? 'fallback' : 'done'
}
