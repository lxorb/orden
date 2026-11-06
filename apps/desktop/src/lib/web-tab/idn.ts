import { hostsReadBy } from './address'

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

const WITHOUT_MARKS = ['Armenian', 'Cyrillic', 'Greek']

const LATIN =
  'a-zà-öø-ÿāăąćĉċčďđēĕėęěĝğġģĥħĩīĭįĵķĺļľłńņňŋōŏőœŕŗřśŝşšţťŧũūŭůűųŵŷźżžșțơưẁẃẅ\\u1EA1-\\u1EF9'
const CJK = '\\p{Script=Han}'

const TOGETHER = [
  LATIN,
  ...WITHOUT_MARKS.map((one) => `\\p{Script=${one}}`),
  ...WITH_MARKS.map((one) => `\\p{Script=${one}}\\p{M}`),
  `${LATIN}${CJK}\\p{Script=Hiragana}\\p{Script=Katakana}\\u30FC`,
  `${LATIN}${CJK}\\p{Script=Bopomofo}`,
  `${LATIN}${CJK}\\p{Script=Hangul}`,
]

let allowed: RegExp[] | null = null
function isAllowed(label: string): boolean {
  if (label.includes('ς')) return false
  allowed ??= TOGETHER.map((one) => new RegExp(`^[${one}0-9-]+$`, 'u'))
  return allowed.some((one) => one.test(label))
}

const KNOWN = new Set(
  (
    'adobe amazon apple bing binance chase chatgpt cloudflare coinbase commerzbank discord dhl' +
    ' dropbox ebay facebook github gitlab gmail google hsbc icloud instagram linkedin live' +
    ' mastercard microsoft netflix notion office openai outlook paypal postbank reddit revolut' +
    ' sparkasse spotify stripe telegram tiktok twitch twitter visa wellsfargo whatsapp wikipedia' +
    ' yahoo youtube zoom'
  ).split(' '),
)

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

function decoded(input: string): string | null {
  const dash = input.lastIndexOf('-')
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

function isSameLabel(shown: string, label: string): boolean {
  try {
    return new URL(`http://${shown}/`).hostname === label
  } catch {
    return false
  }
}

function labelAs(label: string, ending: string): string {
  if (!label.startsWith('xn--')) return label
  const shown = decoded(label.slice(4))
  if (!shown || !isSameLabel(shown, label)) return label
  if (!isAllowed(shown) || KNOWN.has(plainLatin(shown))) return label
  const passes = LOOKALIKES.some((one) => one.letters.test(shown) && !one.endings.test(ending))
  return passes ? label : shown
}

export function shownHost(host: string): string {
  if (!host.includes('xn--')) return host

  const port = /:\d+$/.exec(host)?.[0] ?? ''
  const labels = host.slice(0, host.length - port.length).split('.')
  const last = labels.at(-1) ?? ''
  const tld = last.startsWith('xn--') ? (decoded(last.slice(4)) ?? last) : last
  return labels.map((one) => labelAs(one, tld)).join('.') + port
}

export function shownSite(site: string): string {
  const scheme = /^(?:view-source:)?(?:http:\/\/)?/.exec(site)?.[0] ?? ''
  return scheme + shownHost(site.slice(scheme.length))
}

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

export function meantBy(said: string, url: string | null): string {
  return url !== null && said === shownUrl(url) ? url : said
}

hostsReadBy(shownHost)
