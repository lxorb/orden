/** What the search field means, as a small tree.
 *
 *  Obsidian's operators, so a habit from there carries over. Bare words are
 *  ANDed in any order, `"a phrase"` is exact, `-` excludes, `OR` widens,
 *  brackets group and nest, `path:` `file:` `tag:` ask about the note rather
 *  than its words, `/re/` and `/re/i` are regular expressions, `case:` stops
 *  case being folded from there on, `line:(a b)` `block:(a b)` `section:(a b)`
 *  ask for terms near each other, and `[key]` or `[key:value]` asks the note's
 *  front matter.
 *
 *  A space binds tighter than `OR`, so `a b OR c` reads as `(a b) OR c`.
 *
 *  Nothing here throws, because the field is parsed on every keystroke and a
 *  half-typed query is the normal case, not the broken one. A quote nobody
 *  closed runs to the end, a bracket nobody closed closes itself, a slash that
 *  never comes back is an ordinary word, and a field with nothing after it is
 *  dropped rather than matching everything - which is what lets `path:` sit in
 *  the field while its value is still being chosen.
 *
 *  The tree is plain JSON on purpose: it is what crosses to the Rust side, so
 *  a space is walked once with the whole query in hand. See query.rs, which
 *  reads exactly these shapes. */

/** How near two terms have to be for a `line:` `block:` or `section:` group. */
export type Unit = 'line' | 'block' | 'section'

export type Query =
  | { kind: 'all'; of: Query[] }
  | { kind: 'any'; of: Query[] }
  | { kind: 'not'; of: Query }
  /** Words in the note. `fold` is case folded, which is the default. */
  | { kind: 'text'; text: string; fold: boolean }
  | { kind: 'regex'; source: string; fold: boolean }
  | { kind: 'path'; text: string; fold: boolean }
  | { kind: 'file'; text: string; fold: boolean }
  /** Without the hash. A tag matches its own children too, so `tag:work`
   *  finds `#work/2026`. */
  | { kind: 'tag'; tag: string }
  /** Front matter: the key alone, or the key and something its value says. */
  | { kind: 'property'; name: string; value: string | null }
  | { kind: 'scope'; unit: Unit; of: Query }

/** Matches everything and asks nothing, which is what an empty field means. */
const NOTHING: Query = { kind: 'all', of: [] }

export function isEmpty(query: Query): boolean {
  return query.kind === 'all' && query.of.length === 0
}

/** The fields that take a value, and the tree each builds. */
const VALUED = ['path', 'file', 'tag'] as const

const UNITS: Record<string, Unit> = { line: 'line', block: 'block', section: 'section' }

/** `name:` at the cursor, when the name is only letters. */
const FIELD = /^([A-Za-z]+):/

class Parser {
  private at = 0
  /** Turned off by `case:`, and stays off for every term after it. */
  private folding = true

  constructor(private readonly source: string) {}

  parse(): Query {
    const parts: Query[] = []

    // Loops rather than parsing once, so a stray closing bracket costs the
    // bracket and not the rest of the query.
    while (this.at < this.source.length) {
      const before = this.at
      const one = this.expression()
      if (!isEmpty(one)) parts.push(one)
      if (this.at === before) this.at++
      this.skipSpace()
    }

    return join('all', parts)
  }

  /** `a b OR c`: the ORs are the loose joint, the spaces the tight one. */
  private expression(): Query {
    const branches: Query[] = []

    for (;;) {
      const one = this.conjunction()
      if (one) branches.push(one)
      if (!this.takeOr()) break
    }

    return join('any', branches)
  }

  /** Terms until the group closes, the query ends, or an `OR` widens it. */
  private conjunction(): Query | null {
    const terms: Query[] = []

    for (;;) {
      this.skipSpace()
      if (this.at >= this.source.length) break
      if (this.source.charAt(this.at) === ')') break
      if (this.atOr()) break

      const before = this.at
      const one = this.term()
      if (one) terms.push(one)
      // A term that read nothing would otherwise spin here. `case:` reads
      // something and yields no term, which is the only ordinary way this
      // loop sees a null.
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
    if (here === '"') return this.text(this.phrase())

    // Each of these hands the cursor back untouched when the thing it was
    // looking for is not there, so the same characters are read as a word.
    if (here === '/') {
      const found = this.regex()
      if (found) return found
    }

    if (here === '[') {
      const found = this.property()
      if (found) return found
    }

    return this.field() ?? this.text(this.bare())
  }

  private group(): Query | null {
    this.at++
    const inner = this.expression()
    this.skipSpace()
    if (this.source.charAt(this.at) === ')') this.at++

    return isEmpty(inner) ? null : inner
  }

  /** `path:` `file:` `tag:` `case:` and the three nearness groups. Null when
   *  what is at the cursor is not one of them, with nothing consumed. */
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
      return null
    }

    if (unit) {
      // `line:(a b)` is the shape that earns the operator; `line:word` is
      // allowed and means the same as the word alone.
      const inner = this.source.charAt(this.at) === '(' ? this.group() : this.term()
      return inner ? { kind: 'scope', unit, of: inner } : null
    }

    const value = this.source.charAt(this.at) === '"' ? this.phrase() : this.bare()
    if (!value) return null

    if (valued === 'tag') return { kind: 'tag', tag: value.replace(/^#/, '').toLowerCase() }
    return { kind: valued === 'path' ? 'path' : 'file', text: value, fold: this.folding }
  }

  /** `[key]` or `[key:value]`. Null with nothing consumed when the bracket
   *  never closes, which is what a name being typed looks like. */
  private property(): Query | null {
    const end = this.source.indexOf(']', this.at)
    if (end === -1) return null

    const inner = this.source.slice(this.at + 1, end)
    const colon = inner.indexOf(':')
    const name = (colon === -1 ? inner : inner.slice(0, colon)).trim().toLowerCase()
    if (!name) return null

    this.at = end + 1
    const value = colon === -1 ? '' : inner.slice(colon + 1).trim()
    return { kind: 'property', name, value: value || null }
  }

  /** `/source/flags`. Null with nothing consumed when the pattern does not
   *  end the word it is in, so `/notes/2026` is the path it looks like rather
   *  than the pattern `notes` and the number 2026. A slash inside a character
   *  class does not close the pattern. */
  private regex(): Query | null {
    let at = this.at + 1
    let source = ''
    let inClass = false

    while (at < this.source.length) {
      const here = this.source.charAt(at)

      if (here === '\\' && at + 1 < this.source.length) {
        source += here + this.source.charAt(at + 1)
        at += 2
        continue
      }

      if (here === '\n') break

      if (here === '/' && !inClass) {
        let after = at + 1
        let flags = ''
        while (after < this.source.length && /[A-Za-z]/.test(this.source.charAt(after))) {
          flags += this.source.charAt(after)
          after++
        }

        const ends = after >= this.source.length || /[\s)]/.test(this.source.charAt(after))
        if (ends) {
          this.at = after
          // A regular expression says for itself whether case matters, which
          // is what the `i` flag is for; `case:` does not reach into one.
          return { kind: 'regex', source, fold: flags.includes('i') }
        }
      }

      if (here === '[') inClass = true
      else if (here === ']') inClass = false

      source += here
      at++
    }

    return null
  }

  /** Everything up to the closing quote, with `\` taking the next character
   *  as it stands. A quote nobody closed takes the rest of the query. */
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

  /** A word: up to the next space or closing bracket, `\` escaping either. */
  private bare(): string {
    let out = ''

    while (this.at < this.source.length) {
      const here = this.source.charAt(this.at)

      if (here === '\\' && this.at + 1 < this.source.length) {
        out += this.source.charAt(this.at + 1)
        this.at += 2
        continue
      }

      if (here === ')' || /\s/.test(here)) break

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

  /** Uppercase only, so the word "or" stays a word to search for. */
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

/** One branch stays itself; several become the joint. */
function join(kind: 'all' | 'any', parts: Query[]): Query {
  const [first] = parts
  if (!first) return NOTHING
  if (parts.length === 1) return first

  return { kind, of: parts }
}

export function parseQuery(source: string): Query {
  return new Parser(source).parse()
}
