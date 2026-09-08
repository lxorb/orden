/** LaTeX as the maths Word itself writes: OMML, built out of the `docx`
 *  package's own components.
 *
 *  A formula translated into OMML is a formula Word can lay out, search and let
 *  somebody edit. A picture of one is none of those things, and the TeX source
 *  left as text at least says what was meant. So this reads the subset of TeX a
 *  note actually writes - fractions, roots, sums, integrals, scripts, brackets,
 *  the named functions, and the letters and operators that have a Unicode
 *  character of their own - and turns everything else down.
 *
 *  Strict on purpose. One macro it does not know turns down the whole formula,
 *  and the caller falls back to the source, because half a formula translated is
 *  worse than none: the reader cannot see which half was lost. */

import {
  type MathComponent,
  MathCurlyBrackets,
  MathFraction,
  MathFunction,
  MathIntegral,
  MathRadical,
  MathRoundBrackets,
  MathRun,
  MathSquareBrackets,
  MathSubScript,
  MathSubSuperScript,
  MathSum,
  MathSuperScript,
} from 'docx'

/** The macros that stand for one character. Greek first, then the operators and
 *  the marks a formula is punctuated with. */
const SYMBOLS: Record<string, string> = {
  '\\alpha': 'α',
  '\\beta': 'β',
  '\\gamma': 'γ',
  '\\delta': 'δ',
  '\\epsilon': 'ε',
  '\\varepsilon': 'ε',
  '\\zeta': 'ζ',
  '\\eta': 'η',
  '\\theta': 'θ',
  '\\vartheta': 'ϑ',
  '\\iota': 'ι',
  '\\kappa': 'κ',
  '\\lambda': 'λ',
  '\\mu': 'μ',
  '\\nu': 'ν',
  '\\xi': 'ξ',
  '\\omicron': 'ο',
  '\\pi': 'π',
  '\\varpi': 'ϖ',
  '\\rho': 'ρ',
  '\\varrho': 'ϱ',
  '\\sigma': 'σ',
  '\\varsigma': 'ς',
  '\\tau': 'τ',
  '\\upsilon': 'υ',
  '\\phi': 'φ',
  '\\varphi': 'ϕ',
  '\\chi': 'χ',
  '\\psi': 'ψ',
  '\\omega': 'ω',
  '\\Alpha': 'Α',
  '\\Beta': 'Β',
  '\\Gamma': 'Γ',
  '\\Delta': 'Δ',
  '\\Epsilon': 'Ε',
  '\\Zeta': 'Ζ',
  '\\Eta': 'Η',
  '\\Theta': 'Θ',
  '\\Iota': 'Ι',
  '\\Kappa': 'Κ',
  '\\Lambda': 'Λ',
  '\\Mu': 'Μ',
  '\\Nu': 'Ν',
  '\\Xi': 'Ξ',
  '\\Omicron': 'Ο',
  '\\Pi': 'Π',
  '\\Rho': 'Ρ',
  '\\Sigma': 'Σ',
  '\\Tau': 'Τ',
  '\\Upsilon': 'Υ',
  '\\Phi': 'Φ',
  '\\Chi': 'Χ',
  '\\Psi': 'Ψ',
  '\\Omega': 'Ω',
  '\\times': '×',
  '\\cdot': '⋅',
  '\\div': '÷',
  '\\pm': '±',
  '\\mp': '∓',
  '\\leq': '≤',
  '\\le': '≤',
  '\\geq': '≥',
  '\\ge': '≥',
  '\\neq': '≠',
  '\\ne': '≠',
  '\\approx': '≈',
  '\\equiv': '≡',
  '\\to': '→',
  '\\rightarrow': '→',
  '\\leftarrow': '←',
  '\\infty': '∞',
  '\\partial': '∂',
  '\\nabla': '∇',
  '\\prod': '∏',
  '\\in': '∈',
  '\\notin': '∉',
  '\\subset': '⊂',
  '\\cup': '∪',
  '\\cap': '∩',
  '\\forall': '∀',
  '\\exists': '∃',
  '\\therefore': '∴',
  '\\deg': '°',
  '\\circ': '∘',
  '\\ldots': '…',
  '\\cdots': '⋯',
}

/** The names Word sets upright and spaces as a function rather than as a
 *  product of single letters. */
const FUNCTIONS = new Set(['\\sin', '\\cos', '\\tan', '\\log', '\\ln', '\\exp', '\\max', '\\min'])

/** TeX's spacing hints. Word spaces a formula itself, so each comes to an
 *  ordinary space, or to nothing where TeX was taking space away. */
const SPACERS: Record<string, string> = {
  '\\,': ' ',
  '\\;': ' ',
  '\\:': ' ',
  '\\ ': ' ',
  '\\quad': '  ',
  '\\qquad': '    ',
  '\\!': '',
}

/** The row and column marks of an aligned block. A formula written on one line
 *  has no rows to line up, so they say nothing here. */
const ALIGNMENT = new Set(['\\\\', '&'])

/** What `\left` and `\right` may stand between, opener to closer. */
const DELIMITERS: Record<string, string> = { '(': ')', '[': ']', '\\{': '\\}' }

const SCRIPTS = new Set(['^', '_'])

/** A macro word, a macro of one character, a run of space, or a single
 *  character. The order is the whole rule: `\quad` must beat `\q`, and `\ ` must
 *  beat the space it ends with. */
const TOKEN = /\\[a-zA-Z]+|\\[\s\S]|\s+|[\s\S]/g

/** The characters that stand for themselves: letters, digits, and the marks a
 *  formula is punctuated with. Brackets and braces are structure, not text, so
 *  they are not here. */
const PLAIN = /^[\p{L}\p{N}+\-=<>/|.,;:!?'*]$/u

/** Where the parser has got to. `at` moves; the tokens do not. */
interface Reader {
  readonly tokens: readonly string[]
  at: number
}

function peek(reader: Reader, ahead = 0): string | undefined {
  return reader.tokens[reader.at + ahead]
}

/** The formula as tokens, with the whitespace between them dropped: OMML spaces
 *  a formula by what it is, not by what was typed. */
function tokensOf(tex: string): string[] {
  return (tex.match(TOKEN) ?? []).filter((token) => !/^\s+$/.test(token))
}

/** One or more plain characters as a single run. A run stops before a character
 *  that carries a script, because in TeX the script binds to that one character
 *  and nothing before it. */
function plainRun(reader: Reader): MathComponent[] {
  let text = ''

  for (;;) {
    const token = peek(reader)
    if (token === undefined || !PLAIN.test(token)) break

    const carries = SCRIPTS.has(peek(reader, 1) ?? '')
    if (carries && text !== '') break

    text += token
    reader.at++
    if (carries) break
  }

  return [new MathRun(text)]
}

/** The bracket pair an opener comes to, or null for one Word has no pair for. */
function bracketsOf(open: string, children: MathComponent[]): MathComponent | null {
  if (open === '(') return new MathRoundBrackets({ children })
  if (open === '[') return new MathSquareBrackets({ children })
  if (open === '\\{') return new MathCurlyBrackets({ children })

  return null
}

/** Everything up to `close`, with `close` itself eaten. */
function groupOf(reader: Reader, close: string): MathComponent[] | null {
  const inner = componentsUntil(reader, close)
  if (inner === null || peek(reader) !== close) return null

  reader.at++
  return inner
}

function bracketOf(reader: Reader, open: string): MathComponent[] | null {
  const close = DELIMITERS[open]
  if (close === undefined) return null

  const inner = groupOf(reader, close)
  if (inner === null) return null

  const brackets = bracketsOf(open, inner)
  return brackets === null ? null : [brackets]
}

/** `\left( … \right)`. The pair has to match: Word's brackets come as pairs, and
 *  a `\left(` closed by a `\right]` is not one of them. */
function delimitedOf(reader: Reader): MathComponent[] | null {
  const open = peek(reader)
  if (open === undefined || DELIMITERS[open] === undefined) return null
  reader.at++

  const inner = componentsUntil(reader, '\\right')
  if (inner === null || peek(reader) !== '\\right' || peek(reader, 1) !== DELIMITERS[open]) {
    return null
  }
  reader.at += 2

  const brackets = bracketsOf(open, inner)
  return brackets === null ? null : [brackets]
}

/** What a script, a `\frac` or a `\sqrt` takes: a braced group, a bracketed
 *  thing, or the single character after it, which is TeX's own rule. */
function argumentOf(reader: Reader): MathComponent[] | null {
  const token = peek(reader)
  if (token === undefined) return null

  if (PLAIN.test(token)) {
    reader.at++
    return [new MathRun(token)]
  }

  return atomOf(reader, null)
}

function fractionOf(reader: Reader): MathComponent[] | null {
  const numerator = argumentOf(reader)
  if (numerator === null) return null

  const denominator = argumentOf(reader)
  if (denominator === null) return null

  return [new MathFraction({ numerator, denominator })]
}

function radicalOf(reader: Reader): MathComponent[] | null {
  let degree: MathComponent[] | null = null

  if (peek(reader) === '[') {
    reader.at++
    degree = groupOf(reader, ']')
    if (degree === null) return null
  }

  const children = argumentOf(reader)
  if (children === null) return null

  return [new MathRadical(degree === null ? { children } : { children, degree })]
}

/** What a sum or an integral is written between. Either may be missing; a
 *  formula that names one twice, or names one and then does not say what, is not
 *  a formula and comes back as null. */
interface Limits {
  sub: MathComponent[] | null
  sup: MathComponent[] | null
}

function limitsOf(reader: Reader): Limits | null {
  let sub: MathComponent[] | null = null
  let sup: MathComponent[] | null = null

  for (;;) {
    const token = peek(reader)

    if (token === '_' && sub === null) {
      reader.at++
      sub = argumentOf(reader)
      if (sub === null) return null
    } else if (token === '^' && sup === null) {
      reader.at++
      sup = argumentOf(reader)
      if (sup === null) return null
    } else return { sub, sup }
  }
}

/** A sum or an integral: the sign, its limits, and the rest of the group as what
 *  it runs over, which is what TeX means by writing them side by side.
 *
 *  `\sum` on its own reaches here too rather than coming out as the character
 *  `∑`, and Word draws the same sign either way, with room kept for the limits
 *  the note did not give it. */
function naryOf(
  reader: Reader,
  stop: string | null,
  sign: 'sum' | 'integral',
): MathComponent[] | null {
  const limits = limitsOf(reader)
  if (limits === null) return null

  const children = componentsUntil(reader, stop)
  if (children === null) return null

  const options = {
    children,
    ...(limits.sub === null ? {} : { subScript: limits.sub }),
    ...(limits.sup === null ? {} : { superScript: limits.sup }),
  }

  return [sign === 'sum' ? new MathSum(options) : new MathIntegral(options)]
}

function functionOf(reader: Reader, macro: string): MathComponent[] | null {
  const children = argumentOf(reader)
  if (children === null) return null

  return [new MathFunction({ name: [new MathRun(macro.slice(1))], children })]
}

/** One thing standing on its own, before any script that follows it. `stop` is
 *  where the group being read ends, which a sum needs so it knows how far its
 *  body reaches. */
function atomOf(reader: Reader, stop: string | null): MathComponent[] | null {
  const token = peek(reader)
  if (token === undefined) return null
  if (PLAIN.test(token)) return plainRun(reader)

  reader.at++

  switch (token) {
    case '{':
      return groupOf(reader, '}')
    case '(':
    case '[':
    case '\\{':
      return bracketOf(reader, token)
    case '\\left':
      return delimitedOf(reader)
    case '\\frac':
    case '\\dfrac':
    case '\\tfrac':
      return fractionOf(reader)
    case '\\sqrt':
      return radicalOf(reader)
    case '\\sum':
      return naryOf(reader, stop, 'sum')
    case '\\int':
      return naryOf(reader, stop, 'integral')
    default:
      break
  }

  if (ALIGNMENT.has(token)) return []

  const spacer = SPACERS[token]
  if (spacer !== undefined) return spacer === '' ? [] : [new MathRun(spacer)]

  const symbol = SYMBOLS[token]
  if (symbol !== undefined) return [new MathRun(symbol)]

  if (FUNCTIONS.has(token)) return functionOf(reader, token)

  return null
}

/** The atom with whatever `^` and `_` follow it folded into it. Both at once are
 *  one component, which is how Word stacks them over each other rather than one
 *  after the other. */
function scriptedOf(reader: Reader, base: MathComponent[]): MathComponent[] | null {
  // An alignment mark leaves nothing behind to raise or lower. The script after
  // it is then a formula written wrong, and it is turned down where it is read.
  if (base.length === 0) return base

  let sub: MathComponent[] | null = null
  let sup: MathComponent[] | null = null

  while (SCRIPTS.has(peek(reader) ?? '')) {
    const script = peek(reader)
    reader.at++

    const argument = argumentOf(reader)
    if (argument === null) return null

    if (script === '^') {
      if (sup !== null) return null
      sup = argument
    } else {
      if (sub !== null) return null
      sub = argument
    }
  }

  if (sub !== null && sup !== null) {
    return [new MathSubSuperScript({ children: base, subScript: sub, superScript: sup })]
  }
  if (sup !== null) return [new MathSuperScript({ children: base, superScript: sup })]
  if (sub !== null) return [new MathSubScript({ children: base, subScript: sub })]

  return base
}

/** Components until `stop`, which is left unread for the caller to eat. A `stop`
 *  of null reads to the end of the formula; anything else missing its `stop` is
 *  a formula that never closed. */
function componentsUntil(reader: Reader, stop: string | null): MathComponent[] | null {
  const out: MathComponent[] = []

  for (;;) {
    const token = peek(reader)
    if (token === undefined) return stop === null ? out : null
    if (token === stop) return out

    const base = atomOf(reader, stop)
    if (base === null) return null

    const scripted = scriptedOf(reader, base)
    if (scripted === null) return null

    out.push(...scripted)
  }
}

/** The formula as OMML, or null when the TeX uses anything this does not know.
 *  A formula that comes to nothing is null too: an empty `<m:oMath>` says less
 *  than the source it replaced. */
export function ommlFor(tex: string): MathComponent[] | null {
  const components = componentsUntil({ tokens: tokensOf(tex), at: 0 }, null)

  return components?.length ? components : null
}
