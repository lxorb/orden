const SOURCE = /^view-source:/i

export function isWebAddress(url: string): boolean {
  const inner = url.replace(SOURCE, '')
  if (inner !== url) return !SOURCE.test(inner) && isWebAddress(inner)

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false

  return ![
    'tauri.localhost',
    'ipc.localhost',
    'asset.localhost',
    'orden.localhost',
    'nib.localhost',
  ].includes(parsed.hostname.toLowerCase().replace(/\.+$/, ''))
}

export function isExtensionPage(url: string): boolean {
  return /^chrome-extension:\/\/[a-p]{32}\//.test(url)
}

let reading: ((host: string) => string) | null = null

let loading: (() => unknown) | null = null

export function hostsReadBy(read: (host: string) => string): void {
  reading = read
}

export function hostsReadFrom(load: () => unknown): void {
  loading = load
}

export function readable(host: string): string {
  if (!host.includes('xn--')) return host
  if (reading) return reading(host)
  loading?.()
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

export function keysOf(url: string | null | undefined): [string, string] | null {
  if (!url) return null

  try {
    const at = new URL(url)
    if (at.protocol !== 'https:' && at.protocol !== 'http:') return null
    return [at.origin + at.pathname, at.origin]
  } catch {
    return null
  }
}
