/** What an address is: one a web tab may open, and how a page's address reads.
 *
 *  Pure, and the only place either question is answered: the bar, the note that
 *  holds a web tab's address and the link that opens one all go through here, so a
 *  space cannot end up holding an address the bar would not have gone to. What the
 *  crate then refuses is the same rule said in Rust, because a link inside the page
 *  is judged by it too; see `allowed` in src-tauri/src/web_tabs.rs. What somebody typed
 *  means is typed.ts, which only the bar and the palette need, so none of it is in
 *  front of the first paint. */

/** Chrome's "View page source": a page's own address behind it. */
const SOURCE = /^view-source:/i

/** Whether an address is one a web tab may open: the web, and not the app.
 *
 *  The app's own origins are refused because a tab holding Orden inside Orden is a
 *  page whose script sits beside the app's, and every other scheme is refused
 *  because a tab is a browser and not a way to reach this machine. The crate says
 *  the same thing again on every navigation, which is what makes it true for the
 *  links inside the page as well as for this field. */
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

  return !['tauri.localhost', 'ipc.localhost', 'asset.localhost', 'nib.localhost'].includes(
    parsed.hostname.toLowerCase(),
  )
}

/** How a host reads, once idn.ts has been loaded: most sessions never meet a name that is
 *  not ASCII, and what decides about one is a table too large to read before the first
 *  paint. Until then such a name reads as punycode, which is the safe way to be wrong. */
let reading: ((host: string) => string) | null = null

/** Called by idn.ts as it arrives. */
export function hostsReadBy(read: (host: string) => string): void {
  reading = read
}

function readable(host: string): string {
  if (!host.includes('xn--')) return host
  if (reading) return reading(host)
  void import('./idn')
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

  // Orden's own pages read as their whole address, as `chrome://history` does; see
  // own-pages.ts.
  if (parsed.protocol === 'nib:') return url

  const host = read(parsed.host).replace(/^www\./i, '')
  return parsed.protocol === 'http:' ? `http://${host}` : host
}

/** The origin, plainly, for the bar to show while nobody is typing in it.
 *
 *  The host and nothing else, because the host is the part that says who is
 *  answering and the rest is where a reader stops reading. `www.` goes, the way
 *  every browser drops it. An `http:` page keeps its scheme in front, because that
 *  is the one thing about an address worth warning somebody about. For showing, and
 *  never for keeping anything under: see `originKey`. */
export function plainOrigin(url: string): string {
  return origin(url, readable)
}

/** The same origin as what a site's grants, size and sound are kept under, always as `URL`
 *  spells it: what is safe to show may change, and a site must not lose what it was
 *  allowed when it does. Shown through `shownSite` in idn.ts. */
export function originKey(url: string): string {
  return origin(url, (host) => host)
}

/** The picture a site keeps at its root, which every browser looks for when a page names
 *  none; null for an address with no root to look in - a page a tab is opening that is
 *  not yet an address a browser would read, which once took the whole pane down. */
export function favicon(address: string): string | null {
  try {
    return new URL('/favicon.ico', address).href
  } catch {
    return null
  }
}
