/** Where a client may be sent back to, and how the consent page describes it.
 *
 *  This is the one part of the flow that decides whether a browser leaves for
 *  somewhere a stranger named, so it says no by default: an address is either
 *  loopback, one of the schemes a desktop editor answers on, or HTTPS. */

const LOOPBACK = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i

/** Editors that answer on a scheme of their own rather than a port. */
const NATIVE_SCHEMES = ['cursor://', 'vscode://', 'vscode-insiders://', 'windsurf://']

/** Anything else must be HTTPS, as OAuth 2.1 requires; the consent page names
 *  the host either way, so a person sees where they are about to be sent. */
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

/** A native client listens on whichever port was free when it started, so a
 *  loopback address matches with the port left out (RFC 8252, 7.3). */
export function sameRedirect(registered: string, given: string): boolean {
  if (registered === given) return true
  if (!LOOPBACK.test(registered) || !LOOPBACK.test(given)) return false

  const withoutPort = (uri: string) =>
    uri.replace(/^(http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])):\d+/i, '$1')
  return withoutPort(registered) === withoutPort(given)
}

/** How the consent page describes the destination. */
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

/** A name for a client that gave none: its host, or something that still
 *  reads as a sentence on the consent page. */
export function fallbackName(uri: string): string {
  if (LOOPBACK.test(uri)) return 'the app'
  try {
    const parsed = new URL(uri)
    return parsed.protocol === 'https:' ? parsed.hostname : 'the app'
  } catch {
    return 'the app'
  }
}

/** Whether a host is one nobody publishes a description of a client at: this
 *  machine, or a bare address. A client id that is a URL is fetched, so the
 *  only names worth following are public ones. */
export function privateHost(hostname: string): boolean {
  // An address rather than a name: all digits and dots, or bracketed, or with
  // the colons of an IPv6 address in it.
  const bare = /^\d+(\.\d+)*$/.test(hostname) || hostname.startsWith('[') || hostname.includes(':')
  return bare || hostname === 'localhost' || hostname.endsWith('.localhost')
}
