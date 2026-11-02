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

/** How a name in another writing system reads: as itself, as Chrome has it, unless it could
 *  pass for a name it is not.
 *
 *  `URL` and the engine say a host in punycode, `xn--mnchen-3ya.de`, which nobody reads
 *  and which is exactly why a browser does not show it, and why it must where the letters
 *  would lie: `аррӏе.com` is all Cyrillic and reads as a company it is not. Chrome's rule,
 *  label by label (its IDN policy, after UTS #39 at the "highly restrictive" level):
 *
 *  * one writing system, or Latin with the ones written beside it in East Asia;
 *  * letters and marks only, and ASCII digits and hyphens with them;
 *  * Cyrillic, Greek or Armenian made only of letters that look Latin stays punycode,
 *    unless the name's ending is in that writing system or the countries that use it.
 *
 *  Chrome compares a name with the most visited sites as well, which is a list this does
 *  not ship: `gòogle.com` is one writing system and reads as itself here, as in Firefox.
 *
 *  Here rather than in a file of its own, since a tab's name is drawn in front of the first
 *  paint; and only ever does any of this for a host with `xn--` in it. */

/** The writing systems a name may be in: UTS #39's recommended ones. */
const SCRIPTS = [
  'Arabic',
  'Armenian',
  'Bengali',
  'Devanagari',
  'Ethiopic',
  'Georgian',
  'Greek',
  'Cyrillic',
  'Gujarati',
  'Gurmukhi',
  'Hebrew',
  'Kannada',
  'Khmer',
  'Lao',
  'Malayalam',
  'Myanmar',
  'Oriya',
  'Sinhala',
  'Tamil',
  'Telugu',
  'Thai',
  'Tibetan',
]

/** Latin as names are written in it, with its accents: not the phonetic alphabet, whose
 *  `ɑ` and `ɡ` are only there to look like `a` and `g`. */
const LATIN = 'a-z\\u00C0-\\u024F\\u1E00-\\u1EFF'
const CJK = '\\p{Script=Han}'

/** What may stand together in a label, each as the inside of a character class. */
const TOGETHER = [
  LATIN,
  ...SCRIPTS.map((one) => `\\p{Script=${one}}`),
  `${LATIN}${CJK}\\p{Script=Hiragana}\\p{Script=Katakana}\\u30FC`,
  `${LATIN}${CJK}\\p{Script=Bopomofo}`,
  `${LATIN}${CJK}\\p{Script=Hangul}`,
]

/** A label holding nothing but one of those, its marks being anyone's. Made the first
 *  time a name asks: most sessions never meet one. */
let allowed: RegExp[] | null = null
function isAllowed(label: string): boolean {
  allowed ??= TOGETHER.map((one) => new RegExp(`^[${one}\\p{M}0-9-]+$`, 'u'))
  return allowed.some((one) => one.test(label))
}

/** Letters that look Latin, each with the endings a name made of them may read under. */
const LOOKALIKES: { letters: RegExp; endings: RegExp }[] = [
  {
    letters: /^[аысԁеԍһіюјкӏорԗԛѕԝхуъьҽпгѵѡ0-9-]+$/u,
    endings: /^(?:bg|by|kz|ru|su|ua|uz|\p{Script=Cyrillic}+)$/u,
  },
  { letters: /^[αικνρυωηοτ0-9-]+$/u, endings: /^(?:gr|\p{Script=Greek}+)$/u },
  { letters: /^[ագզէլհյոսւօՙ0-9-]+$/u, endings: /^(?:am|\p{Script=Armenian}+)$/u },
]

const BASE = 36
const T_MIN = 1
const T_MAX = 26
const SKEW = 38
const DAMP = 700
const INITIAL_N = 128
const INITIAL_BIAS = 72

/** What a punycode label's part after `xn--` spells (RFC 3492), or null for nonsense. */
function decoded(input: string): string | null {
  const dash = input.lastIndexOf('-')
  // The part in front of the last hyphen is ASCII, by what punycode is.
  const out = dash > 0 ? Array.from(input.slice(0, dash), (one) => one.charCodeAt(0)) : []
  let [n, i, bias] = [INITIAL_N, 0, INITIAL_BIAS]

  let at = dash > 0 ? dash + 1 : 0
  while (at < input.length) {
    const before = i
    let weight = 1
    for (let k = BASE; ; k += BASE) {
      const char = input.charCodeAt(at++)
      const digit =
        char >= 48 && char <= 57 ? char - 22 : char >= 97 && char <= 122 ? char - 97 : BASE
      if (at > input.length || digit >= BASE) return null
      i += digit * weight
      const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias
      if (digit < t) break
      weight *= BASE - t
    }

    const length = out.length + 1
    let delta = before === 0 ? Math.floor((i - before) / DAMP) : (i - before) >> 1
    delta += Math.floor(delta / length)
    let k = 0
    while (delta > ((BASE - T_MIN) * T_MAX) >> 1) {
      delta = Math.floor(delta / (BASE - T_MIN))
      k += BASE
    }
    bias = k + Math.floor(((BASE - T_MIN + 1) * delta) / (delta + SKEW))

    n += Math.floor(i / length)
    if (n > 0x10ffff) return null
    i %= length
    out.splice(i++, 0, n)
  }
  return String.fromCodePoint(...out)
}

/** Whether what a label decodes to spells that same label again. A name whose letters the
 *  parser would change into others is not the name it reads as. */
function isSameLabel(shown: string, label: string): boolean {
  try {
    return new URL(`http://${shown}/`).hostname === label
  } catch {
    return false
  }
}

/** How one label reads, under the ending it is in. */
function labelAs(label: string, ending: string): string {
  if (!label.startsWith('xn--')) return label
  const shown = decoded(label.slice(4))
  if (!shown || !isSameLabel(shown, label)) return label
  if (!isAllowed(shown)) return label
  const passes = LOOKALIKES.some((one) => one.letters.test(shown) && !one.endings.test(ending))
  return passes ? label : shown
}

/** A host as it reads, port and all, from the way `URL` spells it. */
export function shownHost(host: string): string {
  if (!host.includes('xn--')) return host

  const port = /:\d+$/.exec(host)?.[0] ?? ''
  const labels = host.slice(0, host.length - port.length).split('.')
  const last = labels.at(-1) ?? ''
  const tld = last.startsWith('xn--') ? (decoded(last.slice(4)) ?? last) : last
  return labels.map((one) => labelAs(one, tld)).join('.') + port
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

  // Orden's own pages read as their whole address, as `chrome://history` does; see
  // own-pages.ts.
  if (parsed.protocol === 'nib:') return url

  const host = shownHost(parsed.host).replace(/^www\./i, '')
  return parsed.protocol === 'http:' ? `http://${host}` : host
}

/** The whole address as the field shows it: its name as it reads (see `shownHost`), and the rest
 *  as the engine said it. An address that puts something in front of the host keeps its
 *  punycode, since what is in front is there to be read as the site. */
export function shownUrl(url: string): string {
  if (!url.includes('xn--')) return url
  if (SOURCE.test(url)) return `view-source:${shownUrl(url.replace(SOURCE, ''))}`

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }

  if (parsed.username || parsed.password) return url
  return url.replace(parsed.host, shownHost(parsed.host))
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
