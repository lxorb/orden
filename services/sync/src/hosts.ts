/** The names the service answers on.
 *
 *  One service under two names. `APP_ORIGIN` is the one every link it writes
 *  names; `OTHER_ORIGINS` are the ones it keeps answering on as itself, which is
 *  how a rename leaves nothing behind: every installed app, every connector and
 *  every link already sent keeps the name it was given, and a name that is
 *  answered directly - never through a redirect - is one a POST, a socket and an
 *  OAuth client all keep working on. The blogs' roots are the same two names, so
 *  `x.<either>` is the same site.
 *
 *  Each is a list in a var, comma-separated, so which name is the one links name
 *  is a line in wrangler.jsonc rather than a change here. */

import type { Env } from './types'

/** A var's comma-separated list, as values: no blanks, no repeats. */
function listed(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((one) => one.trim())
    .filter(Boolean)
}

/** An origin as a URL spells it, which is how a request's is compared: the case
 *  goes, and so does a trailing slash. A value that is no URL is left out. */
function originOf(value: string): string | null {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

/** Every origin the service answers on as itself, the one links name first. */
export function origins(env: Env): string[] {
  const all = [env.APP_ORIGIN, ...listed(env.OTHER_ORIGINS)]
    .map(originOf)
    .filter((one): one is string => one !== null)
  return [...new Set(all)]
}

/** Whether an origin is one of the service's own. */
export function isOwnOrigin(env: Env, origin: string): boolean {
  const asked = originOf(origin)
  return asked !== null && origins(env).includes(asked)
}

/** The origin a request reached the service at, where that is one of its own,
 *  and the one links name otherwise. What a server says about itself to a client
 *  - its issuer, its resource, where its endpoints are - is said in the name the
 *  client used, because the client checks the answer against that name. */
export function originAt(env: Env, url: string): string {
  const asked = originOf(url)
  return asked !== null && origins(env).includes(asked) ? asked : (originOf(env.APP_ORIGIN) ?? '')
}

/** Every root domain that hands out blog subdomains, `BLOG_ROOT` first. */
export function blogRoots(env: Env): string[] {
  return [
    ...new Set([env.BLOG_ROOT, ...listed(env.OTHER_BLOG_ROOTS)].map((one) => one.toLowerCase())),
  ]
}

/** The blog root a hostname is, or sits under, where it is one of them. The
 *  hostname is compared as `hostnameOf` in blog.ts writes it. The longest root
 *  wins, so a root inside another is never mistaken for a name under it. */
export function blogRootOf(env: Env, hostname: string): string | null {
  const roots = blogRoots(env)
    .filter((root) => hostname === root || hostname.endsWith(`.${root}`))
    .sort((a, b) => b.length - a.length)
  return roots[0] ?? null
}
