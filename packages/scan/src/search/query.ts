export type Unit = 'line' | 'block' | 'section' | 'task' | 'task-todo' | 'task-done'

const LINE_KINDS: readonly Unit[] = ['task', 'task-todo', 'task-done']

export function aKindOfLine(unit: Unit): boolean {
  return LINE_KINDS.includes(unit)
}

type Compare = 'has' | 'is' | 'null' | 'lt' | 'lte' | 'gt' | 'gte' | 'range'

export type Query =
  | { kind: 'all'; of: Query[] }
  | { kind: 'any'; of: Query[] }
  | { kind: 'not'; of: Query }
  | { kind: 'text'; text: string; fold: boolean }
  | { kind: 'content'; text: string; fold: boolean }
  | { kind: 'regex'; source: string; fold: boolean; refused?: true }
  | { kind: 'path'; text: string; fold: boolean }
  | { kind: 'file'; text: string; fold: boolean }
  | { kind: 'tag'; tag: string }
  | { kind: 'property'; name: string; value: string | null; compare: Compare; upto?: string }
  | { kind: 'scope'; unit: Unit; of: Query }

const NOTHING: Query = { kind: 'all', of: [] }

export function isEmpty(query: Query): boolean {
  return query.kind === 'all' && query.of.length === 0
}

const VALUED = ['path', 'file', 'tag', 'content'] as const

const UNITS: Record<string, Unit> = {
  line: 'line',
  block: 'block',
  section: 'section',
  task: 'task',
  'task-todo': 'task-todo',
  'task-done': 'task-done',
}

const FIELD = /^([A-Za-z][A-Za-z-]*):/

const FLAGS = /^(?!.*(.).*\1)[dgimsuyv]*$/u

export const OPERATORS: readonly string[] = [
  'tag:',
  'path:',
  'file:',
  'content:',
  'task:',
  'task-todo:',
  'task-done:',
  'line:',
  'block:',
  'section:',
  'case:',
]

class Parser {
  private at = 0
  private folding = true
  private depth = 0

  constructor(private readonly source: string) {}

  parse(): Query {
    const parts: Query[] = []

    while (this.at < this.source.length) {
      const before = this.at
      const one = this.expression()
      if (!isEmpty(one)) parts.push(one)
      if (this.at === before) this.at++
      this.skipSpace()
    }

    return join('all', parts)
  }

  private expression(): Query {
    const branches: Query[] = []

    for (;;) {
      const one = this.conjunction()
      if (one) branches.push(one)
      if (!this.takeOr()) break
    }

    return join('any', branches)
  }

  private conjunction(): Query | null {
    const terms: Query[] = []

    for (;;) {
      this.skipSpace()
      if (this.at >= this.source.length) break
      if (this.depth > 0 && this.source.charAt(this.at) === ')') break
      if (this.atOr()) break

      const before = this.at
      const one = this.term()
      if (one) terms.push(one)
      if (this.at === before) this.at++
    }

    const joined = join('all', terms)
    return isEmpty(joined) ? null : joined
  }

  private term(): Query | null {
    const here = this.source.charAt(this.at)

    if (here === '-') {
      this.at++
      const inner = this.term()
      return inner ? { kind: 'not', of: inner } : null
    }

    if (here === '(') return this.group()
    const stray = this.depth === 0 ? /^\)+(?=\s|$)/u.exec(this.source.slice(this.at)) : null
    if (stray) {
      this.at += stray[0].length
      return null
    }
    if (here === '"') return this.text(this.phrase())

    if (here === '/') {
      const found = this.regex()
      if (found) return found
    }

    if (here === '[') {
      const found = this.property()
      if (found) return found
    }

    const before = this.at
    const field = this.field()
    if (field || this.at !== before) return field
    return this.text(this.bare())
  }

  private group(): Query | null {
    this.at++
    this.depth++
    const inner = this.expression()
    this.depth--
    this.skipSpace()
    if (this.source.charAt(this.at) === ')') this.at++

    return isEmpty(inner) ? null : inner
  }

  private field(): Query | null {
    const found = FIELD.exec(this.source.slice(this.at))
    const [whole, word] = found ?? []
    if (whole === undefined || word === undefined) return null

    const name = word.toLowerCase()
    const unit = UNITS[name]
    const valued = VALUED.find((one) => one === name)
    if (name !== 'case' && !unit && !valued) return null

    this.at += whole.length

    if (name === 'case') {
      this.folding = false
      return /^(?:[\s)]|$)/u.test(this.source.slice(this.at)) ? null : this.term()
    }

    if (unit) {
      const inner = this.source.charAt(this.at) === '(' ? this.group() : this.term()
      if (inner) return { kind: 'scope', unit, of: inner }

      return aKindOfLine(unit) ? { kind: 'scope', unit, of: NOTHING } : null
    }

    const value = this.source.charAt(this.at) === '"' ? this.phrase() : this.bare()
    if (!value) return null

    if (valued === 'tag') return { kind: 'tag', tag: value.replace(/^#/, '').toLowerCase() }
    if (valued === 'content') return { kind: 'content', text: value, fold: this.folding }
    return { kind: valued === 'path' ? 'path' : 'file', text: value, fold: this.folding }
  }

  private property(): Query | null {
    const end = this.source.indexOf(']', this.at)
    if (end === -1) return null

    const inner = this.source.slice(this.at + 1, end)
    const colon = inner.indexOf(':')
    const name = (colon === -1 ? inner : inner.slice(0, colon)).trim().toLowerCase()
    if (!name || name.includes('[')) return null
    if (!/^(?:[\s)]|$)/.test(this.source.slice(end + 1))) return null
    if (colon === -1 && Array.from(inner).length === 1) return null

    this.at = end + 1
    const said = colon === -1 ? '' : inner.slice(colon + 1).trim()
    return { kind: 'property', name, ...held(said) }
  }

  private regex(): Query | null {
    let at = this.at + 1
    let source = ''
    let inClass = false
    let passed = false

    while (at < this.source.length) {
      const here = this.source.charAt(at)

      if (here === '\\' && at + 1 < this.source.length) {
        source += here + this.source.charAt(at + 1)
        at += 2
        continue
      }

      if (here === '\n') break
      if (passed && /\s/.test(here)) return null

      if (here === '/' && !inClass) {
        let after = at + 1
        let flags = ''
        while (after < this.source.length && /[A-Za-z]/.test(this.source.charAt(after))) {
          flags += this.source.charAt(after)
          after++
        }

        const ends = after >= this.source.length || /[\s)]/.test(this.source.charAt(after))
        if (!ends && /\s/.test(this.source.charAt(at - 1))) return null
        if (ends && !FLAGS.test(flags)) return null
        if (ends) {
          this.at = after
          return { kind: 'regex', source, fold: flags.includes('i') }
        }
        passed = true
      }

      if (here === '[') inClass = true
      else if (here === ']') inClass = false

      source += here
      at++
    }

    return null
  }

  private phrase(): string {
    this.at++
    let out = ''

    while (this.at < this.source.length) {
      const here = this.source.charAt(this.at)

      if (here === '\\' && this.at + 1 < this.source.length) {
        out += this.source.charAt(this.at + 1)
        this.at += 2
        continue
      }

      this.at++
      if (here === '"') return out
      out += here
    }

    return out
  }

  private bare(): string {
    let out = ''
    let open = 0

    while (this.at < this.source.length) {
      const here = this.source.charAt(this.at)

      if (here === '\\' && this.at + 1 < this.source.length) {
        out += this.source.charAt(this.at + 1)
        this.at += 2
        continue
      }

      if ((here === ')' && this.depth > 0 && open === 0) || /\s/.test(here)) break
      if (here === '(') open++
      else if (here === ')' && open > 0) open--

      out += here
      this.at++
    }

    return out
  }

  private text(text: string): Query | null {
    return text ? { kind: 'text', text, fold: this.folding } : null
  }

  private skipSpace() {
    while (this.at < this.source.length && /\s/.test(this.source.charAt(this.at))) this.at++
  }

  private atOr(): boolean {
    return /^OR(\s|\)|$)/.test(this.source.slice(this.at))
  }

  private takeOr(): boolean {
    this.skipSpace()
    if (!this.atOr()) return false

    this.at += 2
    return true
  }
}

const COMPARISONS: readonly [string, Compare][] = [
  ['<=', 'lte'],
  ['>=', 'gte'],
  ['<', 'lt'],
  ['>', 'gt'],
  ['=', 'is'],
]

function held(said: string): { value: string | null; compare: Compare; upto?: string } {
  if (said.toLowerCase() === 'null') return { value: null, compare: 'null' }

  for (const [mark, compare] of COMPARISONS) {
    if (!said.startsWith(mark)) continue

    const rest = said.slice(mark.length).trim()
    return rest ? { value: rest, compare } : { value: null, compare: 'has' }
  }

  const dots = said.indexOf('..')
  if (dots > 0) {
    const from = said.slice(0, dots).trim()
    const to = said.slice(dots + 2).trim()
    if (from && to) return { value: from, compare: 'range', upto: to }
  }

  return { value: said || null, compare: 'has' }
}

function join(kind: 'all' | 'any', parts: Query[]): Query {
  const [first] = parts
  if (!first) return NOTHING
  if (parts.length === 1) return first

  return { kind, of: parts }
}

export function parseQuery(source: string): Query {
  return new Parser(source).parse()
}
