/** Which browser this is, as a person would name it.
 *
 *  A caret in a shared note says which device it belongs to, and "Browser" is
 *  the one answer that tells nobody anything: half the people in a space are in
 *  a browser. Chrome, Firefox and Safari beside each other are three devices a
 *  person can tell apart, which is the whole point of the name.
 *
 *  Every name here is a proper noun, so none of them is translated.
 *
 *  Asked of the browser first. `navigator.userAgentData.brands` is a short list
 *  a Chromium browser writes about itself, which is both shorter to read and
 *  more honest than the string: Edge, Brave and Opera all say Chrome in their
 *  user agent, and two of them say it because the web asked them to. The string
 *  is what is left for the browsers that have no brands, which is Firefox and
 *  Safari, and it is read in the order that makes those names mean something. */

interface Brand {
  brand?: string | undefined
}

/** Only the two shapes this reads, so a test hands over an object rather than a
 *  browser. `userAgentData` is not in the DOM types, which is why the whole of
 *  it is optional. */
interface Browser {
  userAgent?: string | undefined
  userAgentData?: { brands?: Brand[] | undefined } | undefined
}

/** The fake brands a browser mixes into the list so that nobody sniffs for an
 *  exact one. Spelled with whatever punctuation it feels like on the day, which
 *  is the point of them, so the shape is matched rather than the spellings. */
const GREASE = /not\W*a\W*brand/i

/** What a brand is called in the list, where that is not what it is called. */
const RENAMED: Record<string, string> = {
  'google chrome': 'Chrome',
  'microsoft edge': 'Edge',
  'samsung internet browser': 'Samsung Internet',
  'yandex browser': 'Yandex',
}

/** The name every Chromium browser also carries. Taken only when it is the one
 *  thing the list says, so a browser that names itself is named. */
const CHROMIUM = 'chromium'

/** How long a name may be, and what it may hold. It travels to everybody else in
 *  the room and is drawn beside a caret, so it is a word or two and nothing that
 *  could be mistaken for markup. */
const LONGEST = 24
const NAME = /^[\p{L}\p{N}][\p{L}\p{N} .+-]*$/u

/** The user agent, read in an order that means something: every Chromium
 *  browser writes Chrome, so the one that is only Chrome is looked for after the
 *  ones that are more than that, and Safari is what is left of WebKit once
 *  Chrome has been ruled out. */
const AGENTS: [RegExp, string][] = [
  [/Edg(?:e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera[/ ]/, 'Opera'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/Vivaldi/, 'Vivaldi'],
  [/YaBrowser/, 'Yandex'],
  [/DuckDuckGo/, 'DuckDuckGo'],
  [/Brave/, 'Brave'],
  [/(?:Firefox|FxiOS)\//, 'Firefox'],
  [/Chromium\//, 'Chromium'],
  [/(?:Chrome|CriOS)\//, 'Chrome'],
  [/Safari\//, 'Safari'],
]

/** A brand as it should read, or null for one that says nothing. */
function nameOf(brand: string): string | null {
  const said = brand.trim()
  if (!said || said.length > LONGEST || !NAME.test(said)) return null

  return RENAMED[said.toLowerCase()] ?? said
}

/** What the browser calls itself, or null where nothing recognisable said.
 *  The caller is left to name it, which is where "Browser" comes from. */
export function browserName(browser: Browser): string | null {
  const brands = browser.userAgentData?.brands ?? []
  const named: string[] = []

  for (const one of brands) {
    const brand = one.brand ?? ''
    if (GREASE.test(brand)) continue

    const name = nameOf(brand)
    if (name) named.push(name)
  }

  // Chromium last, so Edge is Edge and a browser that only says Chromium is
  // still named rather than left as "Browser".
  const own = named.find((name) => name.toLowerCase() !== CHROMIUM) ?? named[0]
  if (own) return own

  const agent = browser.userAgent ?? ''
  return AGENTS.find(([pattern]) => pattern.test(agent))?.[1] ?? null
}
