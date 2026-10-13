/** A host typed with no scheme is tried over https first, and over plain http when
 *  nothing answers there - Chrome's HTTPS-Upgrades, typed navigations only.
 *
 *  Emil, 2026-10-13 (#235): an address the bar gave `https:` to was the only one it
 *  ever tried, so a site that serves plain http alone opened on the engine's error page.
 *  Chrome tries the secure one and, when the connection itself fails - refused, reset,
 *  timed out, nothing that speaks TLS on the other end - goes to the plain one. A
 *  certificate error is not that: a site that does answer over https with a certificate
 *  that is wrong is shown as wrong, never quietly swapped for a connection with no
 *  certificate at all. An address typed with its scheme is gone to as written, and a
 *  link inside a page is the page's.
 *
 *  Pure: the bar keeps what this answers on the tab's page (`Page.upgrade`) and the
 *  engine's word on how the page arrived (`arrived` in heard.ts) settles it. */

import { typedAddress } from './address'

/** Why a page did not arrive, as the crate says it (web_page.rs): nothing answered on the
 *  connection, the certificate was wrong, or anything else. */
export type Failure = 'unreachable' | 'certificate' | 'other'

/** An https address nib chose for a host typed with no scheme, and where to go when
 *  nothing answers there. */
export interface Upgrade {
  tried: string
  fallback: string
}

/** What happens when a page arrives while an upgrade is pending. */
export type Settled = 'fallback' | 'done' | 'unrelated'

const SECURE = 'https://'

/** The upgrade going to `url` is, for an address that was typed: one wherever a host was
 *  typed with no scheme and the bar went to it over https - because the bar gave it
 *  `https:` (`webAddress`), or because the field completed it to a page this device
 *  visited over https. The second is how a dev server stays unreachable after one visit
 *  that never arrived: `localhost:8765` once went to `https://localhost:8765`, the field
 *  remembers what was typed, and offers it back. `url` is where Enter went. */
export function upgradeOf(typed: string, url: string): Upgrade | null {
  const said = typed.trim()
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(said) || typedAddress(said) === null) return null
  if (!url.startsWith(SECURE)) return null
  return { tried: url, fallback: `http://${url.slice(SECURE.length)}` }
}

/** The host a page is on, `www.` aside: the site, whichever of the two the server sent
 *  the reader to. */
function siteOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

/** What a page arriving at `url`, or failing to, means for a pending upgrade: back to
 *  plain http when nothing answered on the connection, finished in any other case - it
 *  arrived, or failed in a way http would not mend - and unrelated when it is a page on
 *  another site, such as the one the tab was on finishing as it was left. */
export function settled(upgrade: Upgrade, url: string, failure: Failure | null): Settled {
  const site = siteOf(url)
  if (site === null || site !== siteOf(upgrade.tried)) return 'unrelated'
  return failure === 'unreachable' && url.startsWith('https:') ? 'fallback' : 'done'
}
