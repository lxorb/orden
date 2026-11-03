/** What somebody typed in the address field or the palette means: an address, with the
 *  scheme a browser would give it, or words to search for.
 *
 *  Pure. Every address it answers is one `isWebAddress` takes (address.ts), so the bar
 *  cannot go where a tab may not. */

import { isWebAddress } from './address'

/** Where a few words go when they are not an address.
 *
 *  A browser's address bar searches, and a field that did nothing for `svelte docs`
 *  would read as broken. Google, which is Emil's call and the answer most hands
 *  expect from an address bar: the results are the ones somebody typing a few words
 *  is picturing, and a browser that quietly searches somewhere else reads as a
 *  browser that found nothing. It was DuckDuckGo, for asking the least - no account,
 *  no profile, nothing kept - and that reasoning still stands; it simply is not the
 *  reasoning of the person typing.
 *
 *  The default and the first of Chrome's list, which the reader may change in Settings;
 *  see engines.ts. `%s` is where the words go, as in Chrome's own custom engines. */
export const SEARCH = 'https://www.google.com/search?q=%s'

/** Where the words go in a search engine's address. */
export const WORDS = '%s'

/** The address a few words go to on an engine whose search is `engine`. */
function searchOn(engine: string, words: string): string {
  return engine.replaceAll(WORDS, encodeURIComponent(words))
}

/** Something that could be a host: dotted labels, an address, `localhost`, or one word
 *  with a port - `nas:5000` - each with a path after it. Deliberately not a guess at
 *  every address on the web - a string with a space in it is words, and a single word
 *  with no dot and no port is words too. */
const HOST =
  /^(?:localhost|\[[0-9a-f:.]+\]|\d{1,3}(?:\.\d{1,3}){3}|[^\s/?#@]+\.[^\s/?#@.]{2,}|[a-z\d-]+(?=:\d))(?::\d{1,5})?(?:[/?#]|$)/i

/** Schemes a word with digits after it is, rather than a host and a port: `tel:123`. */
const NOT_HOSTS = new Set(['tel', 'sms', 'mailto', 'news', 'urn', 'magnet', 'about', 'data'])

/** Names no certificate authority can sign for, which a browser never upgrades: this
 *  machine (`localhost` and what is under it, Chrome's rule since 2016) and a home or an
 *  office network's own (`.local` is the network's own discovery, the rest are the
 *  names a router or a company hands out). */
const OWN_NAMES = /(?:^|\.)(?:localhost|local|lan|internal|home\.arpa)$/i

/** Whether a host, as `URL` spells it, is this machine or the network it is on: an
 *  address for loopback, a private range or a link (IPv4 and IPv6), one of the names
 *  above, or one word with no dot at all, which only a network's own names server
 *  answers. A browser goes to every one of them over plain http: none can have a
 *  certificate, and the dev server, the router and the printer they are serve http. */
function isOwnHost(host: string): boolean {
  const name = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (!name.includes('.') && !name.includes(':')) return true
  if (OWN_NAMES.test(name)) return true

  const four = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(name)
  if (four) {
    const [a, b] = [Number(four[1]), Number(four[2])]
    return (
      a === 127 ||
      a === 10 ||
      a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    )
  }
  // Loopback, unique local (fc00::/7) and link-local (fe80::/10).
  return name === '::1' || /^f[cd][\da-f]{0,2}:/.test(name) || /^fe[89ab][\da-f]?:/.test(name)
}

/** The scheme a host typed with none is given: `http` for this machine, the network it is
 *  on and a port of its own - `example.com:8080` is a server somebody started, and Chrome
 *  never upgrades a port that is not 443 - and `https` for the rest, which is what a
 *  browser tries first in 2026 and falls back from; see upgrade.ts. */
function schemeFor(typed: string): 'http' | 'https' {
  let parsed: URL
  try {
    parsed = new URL(`http://${typed}`)
  } catch {
    return 'https'
  }
  if (isOwnHost(parsed.hostname)) return 'http'
  return parsed.port && parsed.port !== '443' ? 'http' : 'https'
}

/** Whether something typed is a host, and not a scheme of its own with digits after it. */
function isHost(typed: string): boolean {
  if (!HOST.test(typed)) return false
  const word = /^([a-z\d-]+):\d/i.exec(typed)?.[1]
  return !word || !NOT_HOSTS.has(word.toLowerCase())
}

/** A word and a colon at the front, which may be a scheme. */
const SCHEME = /^([a-z][a-z\d+.-]*):/i

/** The schemes a word and a colon is taken for without `//`: the web's, and what a browser
 *  hands to the system or opens itself. */
const KNOWN_SCHEMES = new Set([
  ...NOT_HOSTS,
  'http',
  'https',
  'file',
  'ftp',
  'ws',
  'wss',
  'javascript',
  'vbscript',
  'blob',
  'filesystem',
  'view-source',
  'nib',
])

/** Whether something typed opens with a scheme and is not a few words with a colon in them,
 *  by Chrome's rule: one it knows with nothing but the address after it, or any word with
 *  `//` after it. So `site:github.com orden` and `note: buy milk` are a search. */
function hasScheme(said: string): boolean {
  const word = SCHEME.exec(said)?.[1]
  if (word === undefined) return false

  const rest = said.slice(word.length + 1)
  return rest.startsWith('//') || (KNOWN_SCHEMES.has(word.toLowerCase()) && !/^\s/.test(rest))
}

/** An address half typed into a tab's field and left there: what the field held, what of
 *  it the reader typed, where the caret was, and the address it was typed over, so it
 *  comes back only while the tab is still there. See AddressField.svelte. */
export interface HalfTyped {
  value: string
  typed: string
  from: number
  to: number
  over: string
}

/** A Windows path: a drive letter, relative to that drive or not, or a share. To `URL` it is
 *  a host called `c` or `nas` over http, and with a space in it words for the search engine,
 *  either of which tells the network what is on this machine. It means `file:`, which a tab
 *  does not open. A letter with a port is a host, and one with a space after it is words. */
const WINDOWS_PATH = /^(?:[a-z]:(?!\s)(?!\d{1,5}(?:[/?#]|$))|\\\\)/i

/** A file, or a share on the network, by its scheme, whatever follows it. */
const FILE_SCHEME = /^(?:file|smb|afp|nfs|cifs):/i

/** A path as a Mac or Linux writes one: from the top, from home, or from here. Two slashes
 *  are a host. */
const UNIX_PATH = /^(?:~|\.{1,2})?\/(?!\/)/

/** Whether something typed is a file on this machine or its network, which a tab does not
 *  open, so the bar can say so rather than do nothing where a browser would have opened it. */
export function isLocalFile(typed: string): boolean {
  const said = typed.trim()
  return WINDOWS_PATH.test(said) || FILE_SCHEME.test(said) || UNIX_PATH.test(said)
}

/** One word, a colon and more with no space anywhere: `root:hunter2`, `admin:pa/ss@router.lan`,
 *  `otpauth:totp/x?secret=ABC`. `std::vector` is two colons and a name. */
const WORD_AND_WORD = /^[^\s:/?#@]+:(?!:)\S+$/

/** A name, a colon and at least two words with an `@` further on: `admin:pass word@router.lan`. */
const NAME_AT_HOST = /^[^\s:/?#@]+:\S.*@/

/** A word that says what comes after its colon is secret. */
const NAMES_A_SECRET = /^(?:password|passwd|passcode|passphrase|pwd|secret|token|api[-_]?key)\s*:/i

/** Whether something typed could be a credential, and so goes to no search engine, which
 *  would keep it. Chrome would search for `root:hunter2`, and for a search operator with
 *  nothing after it; this bar does nothing and says so. A phrase is words: a word with a
 *  space after its colon, or `site:github.com orden`, unless the word names a secret or an
 *  `@` follows. */
export function mayBeSecret(typed: string): boolean {
  const said = typed.trim()
  return WORD_AND_WORD.test(said) || NAME_AT_HOST.test(said) || NAMES_A_SECRET.test(said)
}

/** An address with a name that is not ASCII in it, spelled as the page will say it is on,
 *  so that what is typed and where it landed are one row of history. */
function asTheEngineSays(address: string): string {
  return /[^ -~]/.test(address) ? new URL(address).href : address
}

/** The address something typed is, or null for words and for nothing: what the palette
 *  offers to go to, where a few words are a search for a note rather than for the web. */
export function typedAddress(typed: string): string | null {
  const said = typed.trim()
  if (!said || WINDOWS_PATH.test(said)) return null

  const host = said.startsWith('//') ? said.slice(2) : said
  if (said.startsWith('//') || isHost(said)) {
    const guessed = `${schemeFor(host)}://${host}`
    return isWebAddress(guessed) ? asTheEngineSays(guessed) : null
  }

  if (hasScheme(said)) return isWebAddress(said) ? asTheEngineSays(said) : null

  return null
}

/** The address something typed means, or null when it means nothing at all.
 *
 *  A host first, because `localhost:1425` reads as a scheme called `localhost` and is
 *  not one - which is the same special case every browser makes. A host is given the
 *  scheme Chrome would give it (`schemeFor`): `http:` for this machine, the network and
 *  a port of its own, `https:` for the rest, with plain http tried after it when nothing
 *  answers there (upgrade.ts). A host this app refuses is nothing rather than something
 *  to search for. Emil, 2026-10-13 (#235): *"when i input localhost:8765 ... it only
 *  tries https"* - and a dev server, which serves plain http, answered nothing.
 *
 *  Then a scheme, taken as written, so `http://` pages still open and a
 *  `javascript:` one never does. A local path and what could be a secret are nothing too.
 *  Anything left is words, and words are a search on
 *  `engine`, the reader's choice of search engine. */
export function webAddress(typed: string, engine = SEARCH): string | null {
  const said = typed.trim()
  if (!said) return null

  const address = typedAddress(said)
  if (address !== null) return address
  // An address this app refuses is nothing rather than something to search for.
  if (said.startsWith('//') || isHost(said) || hasScheme(said)) return null
  if (isLocalFile(said) || mayBeSecret(said)) return null

  return searchOn(engine, said)
}

/** What Ctrl+Enter means in an address field: the word, as a `.com`.
 *
 *  Every browser has done this since Netscape - `svelte` and Ctrl+Enter is
 *  `https://www.svelte.com` - and a reader who has the habit types it without
 *  thinking. One word only: something with a dot, a space or a scheme in it already
 *  means what it says, and this leaves it alone so the ordinary press decides. */
export function dotCom(typed: string): string | null {
  const said = typed.trim()
  if (!said || /[\s/?#@:.]/.test(said)) return null

  const guessed = `https://www.${said}.com`
  return isWebAddress(guessed) ? guessed : null
}
