import { BasesError } from '../errors'
import { parseExpression } from './parse'

const LONGEST_VALUE = 1000

const MOST_STEPS = 2e8

const MOST_MS = 250

interface Cost {
  open: number
  ways: number
  first: string | null
}

const MOST_STEPS_ONE = 1e6

const MOST_EVALUATING_MS = 500

const STEPS_A_LOOK = 4096

const REFUSED: Cost = { open: Number.POSITIVE_INFINITY, ways: 1, first: null }

function single(first: string | null = null): Cost {
  return { open: 0, ways: 1, first }
}

const GROUP_OPENING = /^\?(?:[a-z-]*:|<[^=!>][^>]*>|=|!|<=|<!)/

const COUNTED = /^\{(\d+)(,(\d*))?\}/

const SYNTAX = /[\\^$.*+?()[\]{}|/]/g

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
    const all = single()
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

  function escaped(): Cost {
    const next = String.fromCodePoint(source.codePointAt(at) ?? 0)
    at += next.length

    if (/[1-9]/.test(next) || (next === 'k' && source[at] === '<')) return REFUSED

    if (next === 'x' || next === 'u') {
      const braced =
        unicode && next === 'u' ? /^\{([0-9a-f]+)\}/i.exec(source.slice(at, at + 12)) : null
      const plain = (next === 'x' ? /^[0-9a-f]{2}/i : /^[0-9a-f]{4}/i).exec(
        source.slice(at, at + 4),
      )
      const found = braced ?? plain
      if (!found) return single(next)
      at += found[0].length
      return single(String.fromCodePoint(Number.parseInt(found[1] ?? found[0], 16)))
    }
    if (unicode && (next === 'p' || next === 'P')) {
      at += /^\{[^}]*\}/.exec(source.slice(at, at + 64))?.[0].length ?? 0
      return single()
    }
    return single(/[\p{P}\p{S}]/u.test(next) ? next : null)
  }

  function atom(): Cost {
    const one = String.fromCodePoint(source.codePointAt(at) ?? 0)
    at += one.length

    if (one === '\\') return escaped()
    if (one === '[') {
      skipClass()
      return single()
    }
    if (one === '(') {
      const opening = GROUP_OPENING.exec(source.slice(at, at + 64))?.[0] ?? ''
      at += opening.length
      const inner = alternatives()
      at++
      return /^\?(?:=|!|<=|<!)/.test(opening) ? { ...inner, first: null } : inner
    }
    return single(one === '.' || one === '^' || one === '$' ? null : one)
  }

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
    if (source[at] === '?') at++

    const first = least === 0 ? null : one.first
    if (least === most) return { open: one.open * most, ways: one.ways ** most, first }
    if (most === 1) return { open: one.open, ways: one.ways * 2, first }

    if (one.open > 0 || one.ways > 1) return REFUSED

    const range = most - least
    return range <= 8 ? { open: 0, ways: range + 1, first } : { open: 1, ways: 1, first }
  }

  return alternatives()
}

const measured = new WeakMap<RegExp, boolean>()

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

let guarding = 0
let spent = 0
let since = Number.NEGATIVE_INFINITY

export function underGuard<T>(guarded: boolean | undefined, run: () => T): T {
  if (!guarded) return run()
  guarding++
  try {
    return run()
  } finally {
    guarding--
  }
}

export function readPattern<T>(pattern: RegExp, value: string, read: () => T): T {
  if (guarding === 0) return read()

  if (value.length > LONGEST_VALUE || !patternAllowed(pattern)) {
    throw refuse(`/${pattern.source}/ could take too long on this value`)
  }

  const start = performance.now()
  if (start - since >= 1000 || start < since) {
    since = start
    spent = 0
  }
  if (spent >= MOST_MS) throw refuse(`/${pattern.source}/ has run for long enough`)
  try {
    return read()
  } finally {
    spent += performance.now() - start
  }
}

let evaluating = false
let stepsOne = 0
let stepsUnseen = 0
let evaluatingMs = 0
let lookedAt = 0
let evaluatingSince = Number.NEGATIVE_INFINITY
let refused = 0

function refuse(message: string): BasesError {
  refused++
  return new BasesError(message)
}

function tooLong(): BasesError {
  return refuse('This takes too long to answer')
}

export function refusing<T>(run: () => T): { value: T; partial: boolean } {
  const before = refused
  const value = run()
  return { value, partial: refused > before }
}

export function evaluation<T, A>(run: (arg: A) => T, arg: A, weigh: (made: T) => void): T {
  if (guarding === 0 || evaluating) return run(arg)

  lookedAt = performance.now()
  if (lookedAt - evaluatingSince >= 1000 || lookedAt < evaluatingSince) {
    evaluatingSince = lookedAt
    evaluatingMs = 0
  }
  stepsOne = 0
  evaluating = true
  try {
    const made = run(arg)
    weigh(made)
    return made
  } finally {
    evaluating = false
  }
}

export function spend(steps: number): void {
  if (guarding === 0 || !evaluating) return
  if (!(stepsOne + steps <= MOST_STEPS_ONE)) throw tooLong()
  stepsOne += steps
  stepsUnseen += steps
  if (stepsUnseen >= STEPS_A_LOOK) {
    stepsUnseen = 0
    const now = performance.now()
    evaluatingMs += Math.max(0, now - lookedAt)
    lookedAt = now
  }
  if (evaluatingMs >= MOST_EVALUATING_MS) throw tooLong()
}

export function stepsOfText(length: number): number {
  return length / 16
}
