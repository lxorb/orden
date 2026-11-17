const MOST_BYTES = 48 * 1024

const MOST_RULES = 160
const MOST_DECLARATIONS = 600

const TOKEN_BLOCKS = new Set([':root', '[data-theme=light]', '[data-theme=dark]'])

const TOKEN_PROPERTIES = new Set(['color-scheme'])

const PROSE_ROOT = '#write'

const PROSE_PARTS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'a',
  'strong',
  'em',
  'del',
  'mark',
  'code',
  'pre',
  'pre code',
  'blockquote',
  'ul',
  'ol',
  'li',
  'hr',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'img',
  'dt',
  'dd',
])

const PROSE_PROPERTIES = new Set([
  'color',
  'background',
  'background-color',
  'border',
  'border-color',
  'border-style',
  'border-width',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-radius',
  'box-shadow',
  'font-family',
  'font-feature-settings',
  'font-size',
  'font-style',
  'font-variant',
  'font-weight',
  'letter-spacing',
  'line-height',
  'margin',
  'opacity',
  'padding',
  'text-decoration',
  'text-decoration-color',
  'text-shadow',
  'text-transform',
  'text-underline-offset',
  'word-spacing',
])

const DANGEROUS = /url\s*\(|image-set\s*\(|element\s*\(|attr\s*\(|expression\s*\(|javascript:|\\/i

function bracketsClose(value: string): boolean {
  let depth = 0
  let quote = ''

  for (const letter of value) {
    if (quote) {
      if (letter === quote) quote = ''
      continue
    }

    if (letter === '"' || letter === "'") quote = letter
    else if (letter === '(') depth++
    else if (letter === ')' && --depth < 0) return false
  }

  return depth === 0
}

function usableValue(value: string): boolean {
  if (!value || DANGEROUS.test(value)) return false
  if (/\/\*|\*\//.test(value) || /\p{Cc}/u.test(value)) return false
  if (!bracketsClose(value)) return false

  const doubles = value.split('"').length - 1
  const singles = value.split("'").length - 1
  return doubles % 2 === 0 && singles % 2 === 0
}

export function usablePaletteValue(value: string): boolean {
  return usableValue(value) && !/[{};]/.test(value)
}

const TOKEN = /^--[a-z0-9-]+$/i

export interface Reviewed {
  css: string
  variants: ('light' | 'dark')[]
  refused: string[]
}

interface Rule {
  selectors: string[]
  declarations: [string, string][]
}

function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ')
}

function selectorOf(text: string): string {
  return text
    .replace(/['"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s*([[\]=])\s*/g, '$1')
}

export function declarationsOf(body: string): [string, string][] {
  const found: [string, string][] = []
  let depth = 0
  let quote = ''
  let start = 0

  const take = (end: number) => {
    const text = body.slice(start, end).trim()
    start = end + 1
    if (!text) return

    const colon = text.indexOf(':')
    if (colon < 0) return

    found.push([text.slice(0, colon).trim(), text.slice(colon + 1).trim()])
  }

  for (let at = 0; at < body.length; at++) {
    const letter = body[at]

    if (quote) {
      if (letter === quote) quote = ''
      continue
    }

    if (letter === '"' || letter === "'") quote = letter
    else if (letter === '(') depth++
    else if (letter === ')') depth = Math.max(0, depth - 1)
    else if (letter === ';' && depth === 0) take(at)
  }

  take(body.length)
  return found
}

export function closes(css: string, from: number): number {
  let depth = 1
  let quote = ''

  for (let at = from + 1; at < css.length; at++) {
    const letter = css[at]

    if (quote) {
      if (letter === quote) quote = ''
      continue
    }

    if (letter === '"' || letter === "'") quote = letter
    else if (letter === '{') depth++
    else if (letter === '}' && --depth === 0) return at
  }

  return css.length
}

function scan(css: string): { rules: Rule[]; stray: string[] } {
  const rules: Rule[] = []
  const stray: string[] = []
  let at = 0

  while (at < css.length) {
    const open = css.indexOf('{', at)
    if (open < 0) {
      if (css.slice(at).trim()) stray.push(css.slice(at).trim().slice(0, 40))
      break
    }

    const whole = css.slice(at, open)
    const close = closes(css, open)
    const body = css.slice(open + 1, close)
    const unfinished = close === css.length

    at = close + 1

    const statements = whole.split(';')
    const prelude = (statements.pop() ?? '').trim()
    for (const one of statements) {
      if (one.trim()) stray.push(one.trim().slice(0, 40))
    }

    if (unfinished || body.includes('{') || prelude.startsWith('@') || !prelude) {
      stray.push(prelude.slice(0, 40) || '{')
      continue
    }

    rules.push({
      selectors: prelude.split(',').map(selectorOf).filter(Boolean),
      declarations: declarationsOf(body),
    })
  }

  return { rules, stray }
}

function kindOf(selector: string): 'tokens' | 'prose' | null {
  if (TOKEN_BLOCKS.has(selector)) return 'tokens'
  if (selector === PROSE_ROOT) return 'prose'

  const rest = selector.startsWith(`${PROSE_ROOT} `) ? selector.slice(PROSE_ROOT.length + 1) : null
  return rest !== null && PROSE_PARTS.has(rest) ? 'prose' : null
}

function allowed(kind: 'tokens' | 'prose', property: string): boolean {
  const name = property.toLowerCase()
  if (kind === 'tokens') return TOKEN.test(name) || TOKEN_PROPERTIES.has(name)
  return PROSE_PROPERTIES.has(name)
}

export function review(css: string): Reviewed {
  const refused: string[] = []
  const bytes = new TextEncoder().encode(css).length

  if (bytes > MOST_BYTES) {
    return {
      css: '',
      variants: [],
      refused: [`the file is larger than ${Math.round(MOST_BYTES / 1024)} kB`],
    }
  }

  const { rules, stray } = scan(withoutComments(css))
  for (const one of stray) refused.push(`${one || 'a block'} is not a theme rule`)

  const kept: string[] = []
  const variants = new Set<'light' | 'dark'>()
  let declarations = 0

  for (const rule of rules) {
    if (kept.length >= MOST_RULES) {
      refused.push(`only the first ${MOST_RULES} rules are read`)
      break
    }

    const good = rule.selectors.filter((one) => kindOf(one) !== null)
    for (const one of rule.selectors.filter((selector) => kindOf(selector) === null)) {
      refused.push(`${one} is not a selector a theme may set`)
    }

    if (!good.length) continue

    const kinds = new Set(good.map((one) => kindOf(one)))
    if (kinds.size > 1) {
      refused.push(`${good.join(', ')} mixes the tokens with the prose`)
      continue
    }

    const kind = kindOf(good[0] ?? '') ?? 'tokens'
    const lines: string[] = []

    for (const [property, value] of rule.declarations) {
      if (declarations >= MOST_DECLARATIONS) break

      if (!allowed(kind, property)) {
        refused.push(`${property} is not a property a theme may set`)
        continue
      }

      if (!usableValue(value)) {
        refused.push(`${property} is not a value a theme may set`)
        continue
      }

      lines.push(`  ${property}: ${value};`)
      declarations++
    }

    if (!lines.length) continue

    for (const selector of good) {
      if (selector === '[data-theme=light]') variants.add('light')
      if (selector === '[data-theme=dark]') variants.add('dark')
    }

    kept.push(`${good.join(',\n')} {\n${lines.join('\n')}\n}`)
  }

  if (declarations >= MOST_DECLARATIONS) {
    refused.push(`only the first ${MOST_DECLARATIONS} declarations are read`)
  }

  return { css: kept.join('\n\n'), variants: [...variants], refused }
}
