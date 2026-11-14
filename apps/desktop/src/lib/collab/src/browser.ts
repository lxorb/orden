interface Brand {
  brand?: string | undefined
}

interface Browser {
  userAgent?: string | undefined
  userAgentData?: { brands?: Brand[] | undefined } | undefined
}

const GREASE = /not\W*a\W*brand/i

const RENAMED: Record<string, string> = {
  'google chrome': 'Chrome',
  'microsoft edge': 'Edge',
  'samsung internet browser': 'Samsung Internet',
  'yandex browser': 'Yandex',
}

const CHROMIUM = 'chromium'

const LONGEST = 24
const NAME = /^[\p{L}\p{N}][\p{L}\p{N} .+-]*$/u

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

function nameOf(brand: string): string | null {
  const said = brand.trim()
  if (!said || said.length > LONGEST || !NAME.test(said)) return null

  return RENAMED[said.toLowerCase()] ?? said
}

export function browserName(browser: Browser): string | null {
  const brands = browser.userAgentData?.brands ?? []
  const named: string[] = []

  for (const one of brands) {
    const brand = one.brand ?? ''
    if (GREASE.test(brand)) continue

    const name = nameOf(brand)
    if (name) named.push(name)
  }

  const own = named.find((name) => name.toLowerCase() !== CHROMIUM) ?? named[0]
  if (own) return own

  const agent = browser.userAgent ?? ''
  return AGENTS.find(([pattern]) => pattern.test(agent))?.[1] ?? null
}
