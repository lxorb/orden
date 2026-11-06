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

const FUNCTIONS = new Set(['\\sin', '\\cos', '\\tan', '\\log', '\\ln', '\\exp', '\\max', '\\min'])

const SPACERS: Record<string, string> = {
  '\\,': ' ',
  '\\;': ' ',
  '\\:': ' ',
  '\\ ': ' ',
  '\\quad': '  ',
  '\\qquad': '    ',
  '\\!': '',
}

const ALIGNMENT = new Set(['\\\\', '&'])

const DELIMITERS: Record<string, string> = { '(': ')', '[': ']', '\\{': '\\}' }

const SCRIPTS = new Set(['^', '_'])

const TOKEN = /\\[a-zA-Z]+|\\[\s\S]|\s+|[\s\S]/g

const PLAIN = /^[\p{L}\p{N}+\-=<>/|.,;:!?'*]$/u

interface Reader {
  readonly tokens: readonly string[]
  at: number
}

function peek(reader: Reader, ahead = 0): string | undefined {
  return reader.tokens[reader.at + ahead]
}

function tokensOf(tex: string): string[] {
  return (tex.match(TOKEN) ?? []).filter((token) => !/^\s+$/.test(token))
}

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

function bracketsOf(open: string, children: MathComponent[]): MathComponent | null {
  if (open === '(') return new MathRoundBrackets({ children })
  if (open === '[') return new MathSquareBrackets({ children })
  if (open === '\\{') return new MathCurlyBrackets({ children })

  return null
}

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

function scriptedOf(reader: Reader, base: MathComponent[]): MathComponent[] | null {
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

export function ommlFor(tex: string): MathComponent[] | null {
  const components = componentsUntil({ tokens: tokensOf(tex), at: 0 }, null)

  return components?.length ? components : null
}
