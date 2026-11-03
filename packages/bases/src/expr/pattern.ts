/** What a regular expression may cost in a base somebody else could have written.
 *
 *  A base is a file, and it may arrive from a shared space: whoever opens it, or a
 *  note with its fence, runs its patterns on the UI thread, and the answer is
 *  synchronous, so nothing can stop one that has started. `/(a+)+$/` over twenty-eight
 *  `a`s took thirty seconds.
 *
 *  So a base marked `guarded` - the app marks one that is not the reader's own; see
 *  `LiveView.load` - answers to three limits, and every other base to none. Its
 *  patterns are measured from their source without running them, and one whose ways
 *  grow out of hand is refused: `refusedPattern` names it, and the view says it cannot
 *  be read rather than answering wrongly. No value longer than `LONGEST_VALUE` is read,
 *  and no more than `MOST_MS` of any second goes on patterns; past either, that one
 *  value answers nothing.
 *
 *  Deliberately over-careful, and only where it is asked for: `^[a-z]+(-[a-z]+)*$` is
 *  safe and is refused in a guarded base, because telling it from `(a+-?)*` is the work
 *  of a far larger analyser. What stays exposed: a base copied in from elsewhere to a
 *  space of the reader's own is the reader's own, as raw HTML in a note is. */

import { BasesError } from '../errors'
import { parseExpression } from './parse'

/** How long a value a guarded base may read, in characters. */
const LONGEST_VALUE = 1000

/** How many steps one read may take at worst: a fraction of a second. */
const MOST_STEPS = 2e8

/** How much of each second a guarded base may spend reading patterns. */
const MOST_MS = 250

/** How a part of a pattern can read a value. */
interface Cost {
  /** How many repeats in it the length of the value decides. Infinite when refused. */
  open: number
  /** How many ways the rest of it can go, whatever the length of the value. */
  ways: number
  /** The one character it must start with, or null where that is not known. */
  first: string | null
}

const REFUSED: Cost = { open: Number.POSITIVE_INFINITY, ways: 1, first: null }

const GROUP_OPENING = /^\?(?:[a-z-]*:|<[^=!>][^>]*>|=|!|<=|<!)/

const COUNTED = /^\{(\d+)(,(\d*))?\}/

const SYNTAX = /[\\^$.*+?()[\]{}|/]/g

/** Whether the engine, folding case as it does under any flag a group may turn on,
 *  can take one character for the other. Asked of the engine because folding is not
 *  `toLowerCase`: `σ` and `ς` are one letter, so are `µ` and `μ`, and `ſ` and `s` only
 *  under `u`. */
function sameLetter(one: string, other: string): boolean {
  const pattern = `^${one.replace(SYNTAX, '\\$&')}$`
  return new RegExp(pattern, 'i').test(other) || new RegExp(pattern, 'iu').test(other)
}

function apart(firsts: readonly (string | null)[]): boolean {
  return firsts.every(
    (one, at) =>
      one !== null &&
      firsts.slice(at + 1).every((other) => other !== null && !sameLetter(one, other)),
  )
}

function measure(source: string, flags: string): Cost {
  const unicode = flags.includes('u') || flags.includes('v')
  let at = 0

  function alternatives(): Cost {
    const opening = sequence()
    const branches = [opening]
    while (source[at] === '|') {
      at++
      branches.push(sequence())
    }
    if (branches.length === 1) return opening

    // Told apart by the first character, only one branch is ever tried on a given
    // spot, so backtracking has no second way to read it: `(foo|bar)+` is linear.
    const told = apart(branches.map((one) => one.first))
    return {
      open: Math.max(...branches.map((one) => one.open)),
      ways: told
        ? Math.max(...branches.map((one) => one.ways))
        : branches.reduce((sum, one) => sum + one.ways, 0),
      first: null,
    }
  }

  function sequence(): Cost {
    const all: Cost = { open: 0, ways: 1, first: null }
    let start = true

    while (at < source.length && source[at] !== '|' && source[at] !== ')') {
      const one = repeated(atom())
      all.open += one.open
      all.ways *= one.ways
      if (start) all.first = one.first
      start = false
    }

    return all
  }

  /** The character an escape stands for, or null where it stands for several or for
   *  none, with `at` left past it. */
  function escaped(): Cost {
    const next = String.fromCodePoint(source.codePointAt(at) ?? 0)
    at += next.length
    const none: Cost = { open: 0, ways: 1, first: null }

    // A backreference can make the same pattern match any way at all.
    if (/[1-9]/.test(next) || (next === 'k' && source[at] === '<')) return REFUSED

    if (next === 'x' || next === 'u') {
      const braced =
        unicode && next === 'u' ? /^\{([0-9a-f]+)\}/i.exec(source.slice(at, at + 12)) : null
      const plain = (next === 'x' ? /^[0-9a-f]{2}/i : /^[0-9a-f]{4}/i).exec(
        source.slice(at, at + 4),
      )
      const written = braced?.[1] ?? plain?.[0]
      if (written === undefined) return { ...none, first: next }
      at += (braced ?? plain)?.[0].length ?? 0
      return { ...none, first: String.fromCodePoint(Number.parseInt(written, 16)) }
    }
    if (unicode && (next === 'p' || next === 'P')) {
      at += /^\{[^}]*\}/.exec(source.slice(at, at + 64))?.[0].length ?? 0
      return none
    }
    return /[\p{P}\p{S}]/u.test(next) ? { ...none, first: next } : none
  }

  function atom(): Cost {
    const one = String.fromCodePoint(source.codePointAt(at) ?? 0)
    at += one.length

    if (one === '\\') return escaped()
    if (one === '[') {
      skipClass()
      return { open: 0, ways: 1, first: null }
    }
    if (one === '(') {
      const opening = GROUP_OPENING.exec(source.slice(at, at + 64))?.[0] ?? ''
      at += opening.length
      const inner = alternatives()
      at++
      // A look around reads no character of its own for what follows it to differ by.
      const looks = /^\?(?:=|!|<=|<!)/.test(opening)
      return looks ? { ...inner, first: null } : inner
    }
    if (one === '.' || one === '^' || one === '$') return { open: 0, ways: 1, first: null }
    return { open: 0, ways: 1, first: one }
  }

  /** Past a `[...]`. Only the `v` flag lets a class hold a class. */
  function skipClass() {
    let depth = 1
    while (at < source.length && depth > 0) {
      const one = source[at]
      if (one === '\\') at++
      else if (one === ']') depth--
      else if (one === '[' && flags.includes('v')) depth++
      at++
    }
  }

  /** What a quantifier after an atom makes of it. */
  function repeated(one: Cost): Cost {
    const mark = source[at]
    const counted = mark === '{' ? COUNTED.exec(source.slice(at, at + 32)) : null
    if (mark !== '*' && mark !== '+' && mark !== '?' && !counted) return one

    let least: number
    let most: number
    if (counted) {
      least = Number(counted[1])
      most =
        counted[2] === undefined
          ? least
          : counted[3]
            ? Number(counted[3])
            : Number.POSITIVE_INFINITY
      at += counted[0].length
    } else {
      least = mark === '+' ? 1 : 0
      most = mark === '?' ? 1 : Number.POSITIVE_INFINITY
      at++
    }
    // Lazy costs what greedy costs: it only tries the same ways in the other order.
    if (source[at] === '?') at++

    const first = least === 0 ? null : one.first
    if (least === most) return { open: one.open * most, ways: one.ways ** most, first }
    if (most === 1) return { open: one.open, ways: one.ways * 2, first }

    // The repeat that makes it exponential: one count of the outer around more than
    // one way of the inner is a choice per iteration.
    if (one.open > 0 || one.ways > 1) return REFUSED

    const range = most - least
    return range <= 8 ? { open: 0, ways: range + 1, first } : { open: 1, ways: 1, first }
  }

  return alternatives()
}

const measured = new WeakMap<RegExp, boolean>()

/** Whether a guarded base may run this pattern at all: the scan from every start, times
 *  each open repeat over the longest value, times the ways, shared out between the open
 *  repeats' orderings, stays under `MOST_STEPS`. Measured from the source, never run. */
export function patternAllowed(pattern: RegExp): boolean {
  const kept = measured.get(pattern)
  if (kept !== undefined) return kept

  let allowed = false
  try {
    const { open, ways } = measure(pattern.source, pattern.flags)
    let steps = ways
    for (let one = 1; one <= open + 1 && steps <= MOST_STEPS; one++) {
      steps *= LONGEST_VALUE / one
    }
    allowed = steps <= MOST_STEPS
  } catch {
    // Nested past what a walk down it can hold, which is no pattern anybody wrote.
  }
  measured.set(pattern, allowed)
  return allowed
}

/** The first pattern anywhere in a base that `patternAllowed` turns away, as written,
 *  or null. Every string of the base is tried as an expression, since that is what a
 *  filter, a formula, a column, a sort and a colour all are, and any new place one is
 *  kept is then looked at too. */
export function refusedPattern(base: unknown): string | null {
  if (typeof base === 'string') {
    if (!base.includes('/')) return null
    try {
      return refusedIn(parseExpression(base))
    } catch {
      return null
    }
  }
  if (typeof base !== 'object' || base === null) return null
  for (const value of Object.values(base)) {
    const found = refusedPattern(value)
    if (found !== null) return found
  }
  return null
}

function refusedIn(node: unknown): string | null {
  if (typeof node !== 'object' || node === null) return null
  const { type, pattern, flags } = node as { type?: unknown; pattern?: unknown; flags?: unknown }
  if (type === 'regex' && typeof pattern === 'string' && typeof flags === 'string') {
    try {
      if (!patternAllowed(new RegExp(pattern, flags))) return `/${pattern}/`
    } catch {
      // Not a pattern: compiling says so.
    }
    return null
  }
  for (const value of Object.values(node)) {
    const found = refusedIn(value)
    if (found !== null) return found
  }
  return null
}

/** How many answers and cells of guarded bases are running around this moment. */
let guarding = 0
let spent = 0
let since = Number.NEGATIVE_INFINITY

/** Runs part of an answer, with a guarded base's limits on the patterns it reads. */
export function underGuard<T>(guarded: boolean | undefined, run: () => T): T {
  if (!guarded) return run()
  guarding++
  try {
    return run()
  } finally {
    guarding--
  }
}

/** One read of a value by a pattern. Throws, which answers nothing for that value,
 *  where a guarded base may not. */
export function readPattern<T>(pattern: RegExp, value: string, read: () => T): T {
  if (guarding === 0) return read()

  if (value.length > LONGEST_VALUE || !patternAllowed(pattern)) {
    throw new BasesError(`/${pattern.source}/ could take too long on this value`)
  }

  const start = performance.now()
  if (start - since >= 1000 || start < since) {
    since = start
    spent = 0
  }
  if (spent >= MOST_MS) throw new BasesError(`/${pattern.source}/ has run for long enough`)
  try {
    return read()
  } finally {
    spent += performance.now() - start
  }
}
