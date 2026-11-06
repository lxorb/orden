import { hostOf, siteOf } from '../../web-tab/web-data'

export type Registrable = (host: string) => string | null

const SCHEMED = /^[a-z][a-z0-9+.-]*:\/\//

const NUMERIC = /^(\d{1,3}\.){3}\d{1,3}$|^\[[0-9a-f:.]+\]$/

export function typedSite(typed: string, registrable: Registrable): string | null {
  const text = typed
    .trim()
    .toLowerCase()
    .replace(/^\[\*\.\]|^\*\./, '')
  if (!text || /\s/.test(text)) return null

  const host = hostOf(SCHEMED.test(text) ? text : `https://${text}`)?.replace(/\.$/, '')
  if (!host) return null
  if (host === 'localhost' || NUMERIC.test(host)) return host
  if (!host.includes('.') || registrable(host) === null) return null

  return siteOf(host, registrable)
}

export async function registrable(): Promise<Registrable> {
  const { getDomain } = await import('tldts')
  return (host) => getDomain(host, { allowPrivateDomains: true })
}
