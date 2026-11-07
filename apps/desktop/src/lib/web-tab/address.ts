const SOURCE = /^view-source:/i

export { isWebAddress } from '@orden/scan/web-address'

export function isExtensionPage(url: string): boolean {
  return /^chrome-extension:\/\/[a-p]{32}\//.test(url)
}

let reading: ((host: string) => string) | null = null

export function hostsReadBy(read: (host: string) => string): void {
  reading = read
}

export function readable(host: string): string {
  if (!host.includes('xn--')) return host
  if (reading) return reading(host)
  if (!__EVEN_PLUGIN__) void import('./idn')
  return host
}

function origin(url: string, read: (host: string) => string): string {
  if (SOURCE.test(url)) return `view-source:${origin(url.replace(SOURCE, ''), read)}`

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }

  if (parsed.protocol === 'orden:' || parsed.protocol === 'nib:') return url

  const host = read(parsed.host).replace(/^www\./i, '')
  return parsed.protocol === 'http:' ? `http://${host}` : host
}

export function plainOrigin(url: string): string {
  return origin(url, readable)
}

export function originKey(url: string): string {
  return origin(url, (host) => host)
}

export function favicon(address: string): string | null {
  try {
    return new URL('/favicon.ico', address).href
  } catch {
    return null
  }
}
