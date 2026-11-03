import { hostsReadBy } from './address'

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
 *  * Latin only as the letters with diacritics that languages spell with (`LATIN`), and no
 *    letter that is there to look like another: not `ı`, `ȷ`, `ĸ`, `ß`, nor Greek's `ς`;
 *  * Cyrillic, Greek or Armenian made only of letters that look Latin stays punycode,
 *    unless the name's ending is in that writing system or the countries that use it.
 *
 *  **What stays exposed, against Chrome.** Chrome compares every name with thousands of the
 *  most visited sites, by what it looks like. This has `KNOWN`, the few dozen names most
 *  worth impersonating, so `gòogle.com` stays punycode and `bànk-of-somewhere.com` does
 *  not: one diacritic on any name not listed there reads as Unicode, as it does in Firefox.
 *  It cannot be told from `münchen.de` without such a list.
 *
 *  Fetched with the web bar, or by the first such name a tab's title asks about; see
 *  `readable` in address.ts. Only ever does any of this for a host with `xn--` in it. */

/** The writing systems a name may be in: UTS #39's recommended ones. */
const WITH_MARKS = [
  'Arabic',
  'Bengali',
  'Devanagari',
  'Ethiopic',
  'Georgian',
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

/** Three of those whose letters look most like Latin's, where a combining mark is only ever
 *  one more way to dress a lookalike: their accented letters are letters of their own. */
const WITHOUT_MARKS = ['Armenian', 'Cyrillic', 'Greek']

/** Latin as names are written in it, by the letter: Western and Central Europe, the Baltic,
 *  Turkish, Romanian, Welsh, Vietnamese. Lower case because `URL` is. Not the block these
 *  come from, which holds `ı`, `ȷ`, `ĸ`, `ß`, `×`, `÷` and a phonetic `ɑ` beside them. */
const LATIN =
  'a-zà-öø-ÿāăąćĉċčďđēĕėęěĝğġģĥħĩīĭįĵķĺļľłńņňŋōŏőœŕŗřśŝşšţťŧũūŭůűųŵŷźżžșțơưẁẃẅ\\u1EA1-\\u1EF9'
const CJK = '\\p{Script=Han}'

/** What may stand together in a label, each as the inside of a character class. */
const TOGETHER = [
  LATIN,
  ...WITHOUT_MARKS.map((one) => `\\p{Script=${one}}`),
  ...WITH_MARKS.map((one) => `\\p{Script=${one}}\\p{M}`),
  `${LATIN}${CJK}\\p{Script=Hiragana}\\p{Script=Katakana}\\u30FC`,
  `${LATIN}${CJK}\\p{Script=Bopomofo}`,
  `${LATIN}${CJK}\\p{Script=Hangul}`,
]

/** A label holding nothing but one of those. Made the first time a name asks. */
let allowed: RegExp[] | null = null
function isAllowed(label: string): boolean {
  if (label.includes('ς')) return false
  allowed ??= TOGETHER.map((one) => new RegExp(`^[${one}0-9-]+$`, 'u'))
  return allowed.some((one) => one.test(label))
}

/** The names most worth impersonating; see the top of this file. */
const KNOWN = new Set(
  (
    'adobe amazon apple bing binance chase chatgpt cloudflare coinbase commerzbank discord dhl' +
    ' dropbox ebay facebook github gitlab gmail google hsbc icloud instagram linkedin live' +
    ' mastercard microsoft netflix notion office openai outlook paypal postbank reddit revolut' +
    ' sparkasse spotify stripe telegram tiktok twitch twitter visa wellsfargo whatsapp wikipedia' +
    ' yahoo youtube zoom'
  ).split(' '),
)

/** A Latin label with its diacritics taken off, which is what it passes for. */
function plainLatin(label: string): string {
  return label
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replaceAll('ø', 'o')
    .replaceAll('œ', 'oe')
    .replaceAll('æ', 'ae')
    .replaceAll('ł', 'l')
    .replaceAll('đ', 'd')
    .replaceAll('ð', 'd')
    .replaceAll('ħ', 'h')
    .replaceAll('ŧ', 't')
    .replaceAll('ŋ', 'n')
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
  if (!isAllowed(shown) || KNOWN.has(plainLatin(shown))) return label
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

/** A site's key (`originKey` in address.ts) as it is shown. */
export function shownSite(site: string): string {
  const scheme = /^(?:view-source:)?(?:http:\/\/)?/.exec(site)?.[0] ?? ''
  return scheme + shownHost(site.slice(scheme.length))
}

/** The whole address as the field shows it: its name as it reads, and the rest as the engine
 *  said it. An address that puts something in front of the host keeps its punycode, since
 *  what is in front is there to be read as the site. */
export function shownUrl(url: string): string {
  if (!url.includes('xn--')) return url
  const inner = /^view-source:/i.test(url) ? url.slice('view-source:'.length) : null
  if (inner !== null) return `view-source:${shownUrl(inner)}`

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }

  if (parsed.username || parsed.password) return url
  return url.replace(parsed.host, () => shownHost(parsed.host))
}

/** What Enter on the field means: the page itself, where it still says what it said at rest.
 *  The face is for reading, and nothing goes anywhere by it. */
export function meantBy(said: string, url: string | null): string {
  return url !== null && said === shownUrl(url) ? url : said
}

hostsReadBy(shownHost)
