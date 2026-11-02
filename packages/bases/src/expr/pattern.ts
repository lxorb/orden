/** What a regular expression in a base may cost.
 *
 *  A base is a file, and it may arrive from a shared space: whoever opens it, or a
 *  note with its fence, runs its patterns on the UI thread, and the answer is
 *  synchronous, so nothing can stop one that has started. `/(a+)+$/` over twenty-eight
 *  `a`s took thirty seconds. So a pattern is measured before it is run, without running
 *  it, from its source alone: how many ways backtracking may try to read one value.
 *
 *  Two things come out of that. A pattern whose ways grow exponentially with the value
 *  - a repeat around something that can itself match more than one way, or a
 *  backreference - is refused when it is compiled, like one that does not parse. And a
 *  pattern whose ways grow as a power of the value's length - `.*.*x` - reads values
 *  only up to the length where that stays small; a longer one is no match.
 *
 *  Deliberately over-careful: `(\d+,)*` is safe and is refused, because telling it from
 *  `(\d+\d?,?)*` is the work of a far larger analyser, and a filter in a base rarely
 *  wants either. */

/** How many steps one value may be read in, at worst: a fraction of a second. */
const MOST_STEPS = 1e8

/** A pattern that cannot read a value this long is no use to anybody. */
const SHORTEST_READ = 16

/** How a part of a pattern can read a value. */
interface Cost {
  /** How many repeats in it the length of the value decides. Infinite when refused. */
  open: number
  /** How many ways the rest of it can go, whatever the length of the value. */
  ways: number
  /** The character it must start with, or null where that is not one known character. */
  first: string | null
}

const REFUSED: Cost = { open: Number.POSITIVE_INFINITY, ways: 1, first: null }

const GROUP_OPENING = /^\?(?:[a-z-]*:|<[^=!>][^>]*>|=|!|<=|<!)/

const COUNTED = /^\{(\d+)(,(\d*))?\}/

function measure(source: string, flags: string): Cost {
  let at = 0

  function alternatives(): Cost {
    const branches = [sequence()]
    while (source[at] === '|') {
      at++
      branches.push(sequence())
    }
    if (branches.length === 1) return branches[0]!

    const firsts = branches.map((one) => one.first)
    // Told apart by the first character, only one branch is ever tried on a given
    // spot, so backtracking has no second way to read it: `(foo|bar)+` is linear.
    const told = !firsts.includes(null) && new Set(firsts).size === firsts.length
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

  function atom(): Cost {
    const one = source[at] ?? ''
    at++

    if (one === '\\') {
      const next = source[at] ?? ''
      at++
      // A backreference can make the same pattern match any way at all.
      if (/[1-9]/.test(next) || (next === 'k' && source[at] === '<')) return REFUSED
      return { open: 0, ways: 1, first: /[\p{P}\p{S}]/u.test(next) ? next : null }
    }
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
    return { open: 0, ways: 1, first: one.toLowerCase() }
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

const measured = new WeakMap<RegExp, number>()

/** How long a value this pattern may read, or 0 when it reads none. Steps are the
 *  scan from every start, times each open repeat over the value, times the ways. */
export function longestInput(pattern: RegExp): number {
  const kept = measured.get(pattern)
  if (kept !== undefined) return kept

  const { open, ways } = measure(pattern.source, pattern.flags)
  const longest = (MOST_STEPS / ways) ** (1 / (open + 1))
  const answer = longest >= SHORTEST_READ ? Math.floor(longest) : 0
  measured.set(pattern, answer)
  return answer
}

/** Whether this pattern may be run over this value. */
export function mayRead(pattern: RegExp, value: string): boolean {
  return value.length <= longestInput(pattern)
}
