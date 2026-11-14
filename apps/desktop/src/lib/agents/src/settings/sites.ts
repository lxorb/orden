export type Registrable = (host: string) => string | null

const SCHEMED = /^[a-z][a-z0-9+.-]*:\/\//

const NUMERIC = /^(\d{1,3}\.){3}\d{1,3}$|^\[[0-9a-f:.]+\]$/

export function typedSite(typed: string, registrable: Registrable): string | null {
  const text = typed
    .trim()
    .toLowerCase()
    .replace(/^\[\*\.\]|^\*\./, '')
  if (!text || /\s/.test(text)) return null

  const host = hostIn(SCHEMED.test(text) ? text : `https://${text}`)?.replace(/\.$/, '')
  if (!host) return null
  if (host === 'localhost' || NUMERIC.test(host)) return host
  if (!host.includes('.') || registrable(host) === null) return null

  return registrable(host) ?? host
}

function hostIn(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    return parsed.hostname || null
  } catch {
    return null
  }
}

export async function registrable(): Promise<Registrable> {
  const { getDomain } = await import('tldts')
  return (host) => getDomain(host, { allowPrivateDomains: true })
}
