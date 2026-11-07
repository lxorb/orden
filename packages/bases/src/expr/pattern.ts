import { backtracksWildly, patternCost } from '@orden/markdown/pattern-cost'
import { BasesError } from '../errors'
import { parseExpression } from './parse'

const LONGEST_VALUE = 1000

const MOST_STEPS = 2e8

const MOST_MS = 250

const MOST_STEPS_ONE = 1e6

const MOST_EVALUATING_MS = 500

const STEPS_A_LOOK = 4096

const measured = new WeakMap<RegExp, boolean>()

export function patternAllowed(pattern: RegExp): boolean {
  const kept = measured.get(pattern)
  if (kept !== undefined) return kept

  let allowed = false
  try {
    const { open, ways } = patternCost(pattern.source, pattern.flags)
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

const wild = new WeakMap<RegExp, boolean>()

function wildly(pattern: RegExp): boolean {
  let held = wild.get(pattern)
  if (held === undefined) {
    held = backtracksWildly(pattern.source, pattern.flags)
    wild.set(pattern, held)
  }
  return held
}

export function readPattern<T>(pattern: RegExp, value: string, read: () => T): T {
  if (guarding === 0) {
    if (wildly(pattern)) throw refuse(`/${pattern.source}/ could take too long on this value`)
    return read()
  }

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
