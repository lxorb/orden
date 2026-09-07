/** What a theme is allowed to be.
 *
 *  A theme from the store is a stylesheet somebody else wrote, applied to the
 *  whole app. So it is not applied as it arrives: it is read here, and what
 *  comes out the other side is only the rules this file recognised. Everything
 *  else is dropped and named, so the person installing it is told rather than
 *  left with a theme that quietly does less than it says.
 *
 *  Two things are being defended. The obvious one is anything that runs or
 *  fetches: a `url()` phones home with the reader's address, an `@import` pulls
 *  in a stylesheet nobody reviewed. The quieter one is the app's own shape - a
 *  theme that may set `position` or `display` can move the sidebar off the
 *  screen or hide the title bar, and a person who installed a colour scheme did
 *  not agree to that. So a theme states colours, and it states them in two
 *  places only: the token blocks, and the prose of a note.
 *
 *  The registry runs the same rules on every submission, which is where a theme
 *  author finds out. This copy is what makes them true on the machine. */

/** Bigger than any theme written against tokens, small enough that a stylesheet
 *  with something else hiding in it does not get read at all. */
const MOST_BYTES = 48 * 1024

/** A theme with more rules than this is not a theme. */
const MOST_RULES = 160
const MOST_DECLARATIONS = 600

/** The blocks that carry tokens: the shared ones, and one per scheme. Written
 *  without quotes and without spaces, which is how `selectorOf` hands them
 *  over, so `[data-theme="dark"]` and `[data-theme='dark']` are one selector. */
const TOKEN_BLOCKS = new Set([':root', '[data-theme=light]', '[data-theme=dark]'])

/** What a token block may say besides a token of its own. `color-scheme` is how
 *  a theme tells the browser which way its scrollbars and form controls go, and
 *  a theme that sets colours without it gets the wrong ones. */
const TOKEN_PROPERTIES = new Set(['color-scheme'])

/** The prose of a note, and nothing else in the app. `#write` is the surface
 *  the renderer and the editor both draw into; a rule here reaches the words
 *  and never the chrome around them. */
const PROSE_ROOT = '#write'

/** What may follow `#write`: the elements a note is made of. A theme that wants
 *  serif headings or a heavier quote bar says so here. */
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

/** What a prose rule may set: how the words look, never where they are.
 *
 *  Absent on purpose: `position`, `display`, `inset`, `z-index`, `transform`,
 *  `visibility`, `overflow`, `width`, `height`, `content`, `animation` and
 *  `transition`. Those are the app's layout and the app's motion, and a theme
 *  that could set them could take a pane away or hold a menu open. */
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

/** Anything in a value that would reach outside the stylesheet, or run.
 *
 *  `url()` and `image-set()` fetch; `element()` and `attr()` read the page;
 *  `expression()` is Internet Explorer's way of running script from CSS and
 *  costs nothing to refuse; a backslash is how a keyword is spelled to slip
 *  past a check like this one. */
const DANGEROUS = /url\s*\(|image-set\s*\(|element\s*\(|attr\s*\(|expression\s*\(|javascript:|\\/i

/** What a custom property is called. */
const TOKEN = /^--[a-z0-9-]+$/i

/** What the theme says about itself, written into the file when it is
 *  installed, so an installed theme carries its own name and version and there
 *  is no second file to keep in step with it. */
export interface Stamp {
  id: string
  name: string
  author: string
  version: string
}

export interface Reviewed {
  /** The rules that survived, as a stylesheet ready to apply. */
  css: string
  /** Which schemes the theme states, so the app knows whether it is a pair. */
  variants: ('light' | 'dark')[]
  /** One short phrase per thing dropped, in the order they were met. What the
   *  person installing it is shown. */
  refused: string[]
}

/** A rule as the scanner found it. */
interface Rule {
  selectors: string[]
  declarations: [string, string][]
}

/** Comments taken out, so nothing after this has to think about them. The
 *  scanner below reads braces and semicolons, and a comment can hold both. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ')
}

/** A selector without its quotes or its spare whitespace, so two spellings of
 *  the same thing compare equal. Lower-cased: CSS element names and attribute
 *  selectors are not case-sensitive, and a theme writing `#WRITE H1` means the
 *  same thing as one writing it small. */
function selectorOf(text: string): string {
  return text
    .replace(/['"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s*([[\]=])\s*/g, '$1')
}

/** The declarations of one block, as they were written. A value may hold a
 *  semicolon inside a string or a function, so the split walks rather than
 *  using `split`. */
function declarationsOf(body: string): [string, string][] {
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

/** Where the block opened at `from` closes, counting the braces in between.
 *
 *  The whole of it, not the first `}`: an at-rule or a nested selector has to be
 *  stepped over as one thing, or what is inside it goes on to be read as
 *  top-level rules and walks straight past the whitelist. Quotes are followed for
 *  the same reason: a `}` inside a string is not the end of anything.
 *
 *  Answers the length of the file when nothing closes it, which the caller reads
 *  as an unfinished block. */
function closes(css: string, from: number): number {
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

/** Every flat `selector { ... }` in the sheet, and whatever was not one.
 *
 *  Flat is the whole grammar: a theme has no at-rules and no nesting, so a
 *  brace inside a block is a rule this scanner refuses rather than one it
 *  descends into. */
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

    const prelude = css.slice(at, open).trim()
    const close = closes(css, open)
    const body = css.slice(open + 1, close)
    const unfinished = close === css.length

    at = close + 1

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

/** Whether a selector is one a theme may write, and which kind it is. */
function kindOf(selector: string): 'tokens' | 'prose' | null {
  if (TOKEN_BLOCKS.has(selector)) return 'tokens'
  if (selector === PROSE_ROOT) return 'prose'

  const rest = selector.startsWith(`${PROSE_ROOT} `) ? selector.slice(PROSE_ROOT.length + 1) : null
  return rest !== null && PROSE_PARTS.has(rest) ? 'prose' : null
}

/** Whether a declaration belongs in a block of that kind. */
function allowed(kind: 'tokens' | 'prose', property: string): boolean {
  const name = property.toLowerCase()
  if (kind === 'tokens') return TOKEN.test(name) || TOKEN_PROPERTIES.has(name)
  return PROSE_PROPERTIES.has(name)
}

/** The theme, reduced to what it may do.
 *
 *  Every rule is kept or dropped whole where its selector decides it, and
 *  declaration by declaration where the properties do, so a theme with one bad
 *  line still installs with a sentence about the line. */
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

    // A rule listing both kinds at once would have to satisfy both, and no
    // theme needs it: the first selector decides, and a mixed list has already
    // lost whichever selectors were not allowed.
    const kind = kindOf(good[0] ?? '') ?? 'tokens'
    const lines: string[] = []

    for (const [property, value] of rule.declarations) {
      if (declarations >= MOST_DECLARATIONS) break

      if (!allowed(kind, property)) {
        refused.push(`${property} is not a property a theme may set`)
        continue
      }

      if (DANGEROUS.test(value)) {
        refused.push(`${property} reaches outside the stylesheet`)
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

/** The stamp line an installed theme starts with. One line of JSON inside a
 *  comment: the file is the whole record of the install, so there is nothing to
 *  keep in step and a theme copied to another machine by hand still knows what
 *  it is and which version it is at. */
export function stamped(stamp: Stamp, css: string): string {
  return `/*! nib-theme ${JSON.stringify(stamp)} */\n${css}\n`
}

/** What the stamp said, for a file that has one. Anything else is a theme
 *  somebody wrote by hand, which the store has nothing to say about. */
export function stampOf(css: string): Stamp | null {
  const line = /^\s*\/\*!\s*nib-theme\s*(\{.*?\})\s*\*\//.exec(css)
  if (!line?.[1]) return null

  try {
    const value: unknown = JSON.parse(line[1])
    if (typeof value !== 'object' || value === null) return null

    const { id, name, author, version } = value as Record<string, unknown>
    if (
      typeof id !== 'string' ||
      typeof name !== 'string' ||
      typeof author !== 'string' ||
      typeof version !== 'string'
    ) {
      return null
    }

    return { id, name, author, version }
  } catch {
    return null
  }
}
