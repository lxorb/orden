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
 *  The app's own origins are refused because a tab holding nib inside nib is a
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

/** The origin, plainly, for the bar to show while nobody is typing in it.
 *
 *  The host and nothing else, because the host is the part that says who is
 *  answering and the rest is where a reader stops reading. `www.` goes, the way
 *  every browser drops it. An `http:` page keeps its scheme in front, because that
 *  is the one thing about an address worth warning somebody about. */
export function plainOrigin(url: string): string {
  if (SOURCE.test(url)) return `view-source:${plainOrigin(url.replace(SOURCE, ''))}`

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }

  // nib's own pages read as their whole address, as `chrome://history` does; see
  // own-pages.ts.
  if (parsed.protocol === 'nib:') return url

  const host = parsed.host.replace(/^www\./i, '')
  return parsed.protocol === 'http:' ? `http://${host}` : host
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
