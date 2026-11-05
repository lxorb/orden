/** Whether an address is one a web tab may open: the one rule, here because a
 *  website's file is read by the scan of a space, which the account runs too
 *  (shortcut.ts), so the account can read one too (#1126). The rest of what an address is - how a page's address reads - is
 *  the app's web-tab/address.ts, which hands this on. */

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
    parsed.hostname.toLowerCase().replace(/\.+$/, ''),
  )
}
