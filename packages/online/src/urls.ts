export const LONGEST_URL = 8192

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

function parsed(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

export function isWebUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length > LONGEST_URL) return false
  const one = parsed(url)
  return one !== null && (one.protocol === 'http:' || one.protocol === 'https:')
}

export function loopbackOrigin(url: unknown): string | null {
  if (typeof url !== 'string' || url.length > LONGEST_URL) return null
  const one = parsed(url)
  if (one?.protocol !== 'http:' || !one.port) return null
  return LOOPBACK_HOSTS.has(one.hostname.toLowerCase()) ? one.origin : null
}

export function isLoopbackUrl(url: unknown): url is string {
  return loopbackOrigin(url) !== null
}

export function callbacksIn(url: string): string[] {
  const one = parsed(url)
  if (!one) return []
  const found = new Set<string>()
  for (const value of one.searchParams.values()) {
    const origin = loopbackOrigin(value)
    if (origin) found.add(origin)
  }
  return [...found]
}

export function isCallbackOf(opened: string, landed: string): boolean {
  const origin = loopbackOrigin(landed)
  return origin !== null && callbacksIn(opened).includes(origin)
}

export function hostOf(url: string): string {
  return parsed(url)?.host ?? url
}
