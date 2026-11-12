const LOOPBACK = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i

const NATIVE_SCHEMES = ['cursor://', 'vscode://', 'vscode-insiders://', 'windsurf://']

export function redirectAllowed(uri: string): boolean {
  if (LOOPBACK.test(uri)) return true
  if (NATIVE_SCHEMES.some((scheme) => uri.toLowerCase().startsWith(scheme))) return true

  try {
    const parsed = new URL(uri)
    return parsed.protocol === 'https:' && !parsed.hash
  } catch {
    return false
  }
}

export function sameRedirect(registered: string, given: string): boolean {
  if (registered === given) return true
  if (!LOOPBACK.test(registered) || !LOOPBACK.test(given)) return false

  const withoutPort = (uri: string) =>
    uri.replace(/^(http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])):\d+/i, '$1')
  return withoutPort(registered) === withoutPort(given)
}

export function describeDestination(uri: string): string {
  if (LOOPBACK.test(uri)) return 'an app on this computer'

  const scheme = NATIVE_SCHEMES.find((one) => uri.toLowerCase().startsWith(one))
  if (scheme) return `the ${scheme.slice(0, -3)} app`

  try {
    return new URL(uri).hostname
  } catch {
    return uri
  }
}

export function fallbackName(uri: string): string {
  if (LOOPBACK.test(uri)) return 'the app'
  try {
    const parsed = new URL(uri)
    return parsed.protocol === 'https:' ? parsed.hostname : 'the app'
  } catch {
    return 'the app'
  }
}

export function privateHost(hostname: string): boolean {
  const bare = /^\d+(\.\d+)*$/.test(hostname) || hostname.startsWith('[') || hostname.includes(':')
  return bare || hostname === 'localhost' || hostname.endsWith('.localhost')
}
