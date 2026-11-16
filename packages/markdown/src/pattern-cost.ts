interface Cost {
  open: number
  ways: number
  first: string | null
  head: string | null
  tail: string | null
  loop: string | null
  lead: string
  literal: boolean
  unit: string | null
  zero: boolean
  shape: Shape
}

type Shape =
  | { kind: 'letter'; letters: string | null; literal: boolean }
  | { kind: 'none' }
  | { kind: 'end' }
  | { kind: 'look'; inner: Shape; behind: boolean }
  | { kind: 'row'; parts: Shape[] }
  | { kind: 'either'; branches: Shape[] }
  | { kind: 'again'; of: Shape; least: number; most: number; letters: string | null }

interface Ahead {
  rest: number
  heads: (string | null)[]
  literal: number
  ended: boolean
}

export function patternJudge() {
  const PLAIN: Cost = {
    open: 0,
    ways: 1,
    first: null,
    head: null,
    tail: null,
    loop: null,
    lead: '',
    literal: false,
    unit: null,
    zero: false,
    shape: { kind: 'none' },
  }

  const NOTE = Math.log(200000)

  const LINE = Math.log(2000)

  const WORD = Math.log(30)

  const WORD_STARTS = Math.log(20)

  const TAKING_NOTE = Math.log(10)

  const MOST_COPIES = 10

  const MOST_STEPS = 20000

  const OPEN_END: Ahead = { rest: 0, heads: [], literal: 0, ended: true }

  const BACKWARDS: Ahead = { rest: 0, heads: [], literal: 0, ended: false }

  const REFUSED: Cost = { ...PLAIN, open: Number.POSITIVE_INFINITY }

  const ZERO: Cost = { ...PLAIN, literal: true, zero: true }

  const END: Cost = { ...ZERO, shape: { kind: 'end' } }

  function single(first: string | null = null, unit: string | null = null, lead = ''): Cost {
    return {
      ...PLAIN,
      first,
      head: unit,
      tail: unit,
      unit,
      lead,
      literal: lead !== '',
      shape: { kind: 'letter', letters: unit, literal: lead !== '' },
    }
  }

  const GROUP_OPENING = /^\?(?:[a-z-]*:|<[^=!>][^>]*>|=|!|<=|<!)/

  const COUNTED = /^\{(\d+)(,(\d*))?\}/

  const SYNTAX = /[\\^$.*+?()[\]{}|/]/g

  const SAMPLES = ' \t\n éßÄıſKσ中\u{1f600}'

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

  function leadsApart(leads: readonly string[], fold: boolean): boolean {
    const told = leads.map((one) => (fold ? one.toLowerCase() : one))
    return told.every(
      (one, at) =>
        one !== '' &&
        told
          .slice(at + 1)
          .every((other) => other !== '' && !one.startsWith(other) && !other.startsWith(one)),
    )
  }

  function setsApart(one: string, other: string, flags: string): boolean {
    try {
      const kept = flags.replace(/[^iuvs]/g, '')
      const left = new RegExp(`^(?:${one})$`, kept)
      const right = new RegExp(`^(?:${other})$`, kept)
      const probes = new Set<string>(SAMPLES)
      for (let code = 0; code < 128; code++) probes.add(String.fromCharCode(code))
      for (const letter of one + other) probes.add(letter)
      for (const probe of probes) if (left.test(probe) && right.test(probe)) return false
      return true
    } catch {
      return false
    }
  }

  function reachOfLetters(letters: string | null, flags: string): number {
    if (letters === null) return NOTE
    try {
      const letter = new RegExp(`^(?:${letters})$`, flags.replace(/[^iuvs]/g, ''))
      if (!letter.test('a')) return WORD
      return letter.test('\n') ? NOTE : letter.test(' ') ? LINE : WORD
    } catch {
      return NOTE
    }
  }

  function aheadOf(
    shape: Shape,
    flags: string,
    start: Ahead = OPEN_END,
    traded?: () => void,
  ): Ahead {
    let steps = 0
    const kept = new Map<string, boolean>()

    function trades(letters: string | null, head: string | null): boolean {
      if (letters === null || head === null) return true
      const key = `${letters}\0${head}`
      let held = kept.get(key)
      if (held === undefined) {
        held = !setsApart(letters, head, flags)
        kept.set(key, held)
      }
      return held
    }

    function merged(all: readonly Ahead[]): Ahead {
      const heads = [...new Set(all.flatMap((one) => one.heads))]
      return {
        rest: all.reduce((high, one) => Math.max(high, one.rest), 0),
        heads: heads.length > 16 ? [null] : heads,
        literal: all.reduce((low, one) => Math.min(low, one.literal), Number.POSITIVE_INFINITY),
        ended: all.every((one) => one.ended),
      }
    }

    function nextLine(letters: string | null, ahead: Ahead): boolean {
      const breaks = (head: string | null) =>
        head !== null && (trades('\\n', head) || trades('\\r', head))
      return !trades(letters, '\\n') && ahead.heads.some(breaks)
    }

    function run(letters: string | null, least: number, ahead: Ahead): Ahead {
      if (ahead.ended) {
        return least === 0 ? ahead : { ...ahead, heads: [letters], literal: 0, ended: false }
      }
      const reach = reachOfLetters(letters, flags)
      const overlaps = !ahead.heads.length || ahead.heads.some((head) => trades(letters, head))
      if (overlaps) traded?.()
      const own = overlaps && reach === NOTE ? reach + TAKING_NOTE : reach
      return {
        rest:
          overlaps && ahead.literal < 2
            ? own + ahead.rest
            : nextLine(letters, ahead)
              ? added(own, ahead.rest)
              : Math.max(own, ahead.rest),
        heads: least > 0 ? [letters] : [...new Set([letters, ...ahead.heads])],
        literal: 0,
        ended: false,
      }
    }

    function before(shape: Shape, ahead: Ahead): Ahead {
      if (++steps > MOST_STEPS) throw new Error('too many steps')

      switch (shape.kind) {
        case 'letter':
          return {
            rest: ahead.rest,
            heads: [shape.letters],
            literal: shape.literal ? ahead.literal + 1 : 0,
            ended: false,
          }
        case 'none':
          return ahead
        case 'end':
          return { rest: ahead.rest, heads: ['\\n'], literal: 0, ended: false }
        case 'look': {
          const { rest } = before(shape.inner, shape.behind ? BACKWARDS : OPEN_END)
          const back = shape.behind && rest >= NOTE ? NOTE : 0
          return { ...ahead, rest: ahead.rest + rest + back, ended: false }
        }
        case 'row': {
          const parts = ahead.ended ? withoutGivenBack(flat(shape.parts)) : shape.parts
          return parts.reduceRight((after, part) => before(part, after), ahead)
        }
        case 'either':
          return merged(shape.branches.map((branch) => before(branch, ahead)))
        case 'again': {
          const counted = shape.of.kind === 'letter' ? 8 : MOST_COPIES
          if (shape.least > MOST_COPIES) {
            const rest = run(shape.letters, shape.least - MOST_COPIES, ahead)
            let after = { ...rest, heads: before(shape.of, ahead).heads }
            for (let copy = 0; copy < MOST_COPIES; copy++) after = before(shape.of, after)
            return after
          }
          if (shape.most - shape.least > counted) return run(shape.letters, shape.least, ahead)
          let after = ahead
          for (let copy = shape.least; copy < shape.most; copy++) {
            const taken = before(shape.of, after)
            const rest = taken.rest > after.rest ? added(taken.rest, ahead.rest) : after.rest
            after = { ...merged([after, taken]), rest: Math.max(rest, after.rest) }
          }
          for (let copy = 0; copy < shape.least; copy++) after = before(shape.of, after)
          return after
        }
      }
    }

    return before(shape, start)
  }

  function added(one: number, other: number): number {
    return Math.max(one, other) + Math.log1p(Math.exp(-Math.abs(one - other)))
  }

  function withoutGivenBack(parts: readonly Shape[]): readonly Shape[] {
    for (let at = parts.length - 2; at >= 0; at--) {
      const again = parts[at]
      if (again?.kind !== 'again' || again.least === again.most) continue
      if (again.least === 0) return parts
      const copy = flat([again.of])
      const tail = flat(parts.slice(at + 1))
      const given =
        tail.length <= copy.length &&
        tail.every((part, i) => plain(part) && JSON.stringify(part) === JSON.stringify(copy[i]))
      return given ? [...parts.slice(0, at), { ...again, most: again.least }, ...tail] : parts
    }
    return parts
  }

  function flat(parts: readonly Shape[]): Shape[] {
    return parts.flatMap((part) => (part.kind === 'row' ? flat(part.parts) : [part]))
  }

  function plain(shape: Shape): boolean {
    if (shape.kind === 'letter') return shape.letters !== null
    if (shape.kind === 'again') return plain(shape.of)
    if (shape.kind === 'row') return shape.parts.every(plain)
    return false
  }

  function copiesApart(shape: Shape, flags: string): boolean {
    try {
      const { heads } = aheadOf(shape, flags)
      if (!heads.length || heads.includes(null)) return false
      let traded = false
      const next: Ahead = { rest: 0, heads, literal: 0, ended: false }
      aheadOf(shape, flags, next, () => {
        traded = true
      })
      return !traded
    } catch {
      return false
    }
  }

  function lettersOf(shape: Shape): string | null {
    const all: string[] = []
    const walk = (one: Shape): boolean => {
      switch (one.kind) {
        case 'letter':
          if (one.letters === null) return false
          all.push(one.letters)
          return true
        case 'none':
        case 'end':
        case 'look':
          return true
        case 'row':
          return one.parts.every(walk)
        case 'either':
          return one.branches.every(walk)
        case 'again':
          return walk(one.of)
      }
    }
    if (!walk(shape) || !all.length) return null
    return `(?:${[...new Set(all)].join('|')})`
  }

  function commonLead(leads: readonly string[]): string {
    let shared = leads[0] ?? ''
    for (const one of leads) {
      let at = 0
      while (at < shared.length && at < one.length && shared[at] === one[at]) at++
      shared = shared.slice(0, at)
    }
    return shared
  }

  function same(values: readonly (string | null)[]): string | null {
    const [one] = values
    return one !== undefined && values.every((other) => other === one) ? one : null
  }

  function patternCost(source: string, flags: string, backrefs = true, lenient = false): Cost {
    const unicode = flags.includes('u') || flags.includes('v')
    const fold = flags.includes('i')
    let at = 0

    function alternatives(): Cost {
      const opening = sequence()
      const branches = [opening]
      while (source[at] === '|') {
        at++
        branches.push(sequence())
      }
      if (branches.length === 1) return opening

      const told =
        apart(branches.map((one) => one.first)) ||
        (lenient &&
          leadsApart(
            branches.map((one) => one.lead),
            fold,
          ))
      const open = branches
        .map((one) => one.open)
        .reduce((high, one) => Math.max(high, one), -Infinity)
      return {
        ...PLAIN,
        open,
        ways: told
          ? branches.map((one) => one.ways).reduce((high, one) => Math.max(high, one), -Infinity)
          : branches.reduce((sum, one) => sum + one.ways, 0),
        head: same(branches.map((one) => one.head)),
        tail: same(branches.map((one) => one.tail)),
        loop: open === 1 ? same(branches.map((one) => one.loop)) : null,
        lead: commonLead(branches.map((one) => one.lead)),
        shape: { kind: 'either', branches: branches.map((one) => one.shape) },
      }
    }

    function sequence(): Cost {
      const all: Cost = { ...ZERO }
      const loops: (string | null)[] = []
      let start = true
      let headed = false
      let leading = true
      let counted = 0
      let alone: Cost | null = null
      const parts: Cost[] = []

      while (at < source.length && source[at] !== '|' && source[at] !== ')') {
        const one = repeated(atom())
        parts.push(one)
        all.open += one.open
        all.ways *= one.ways
        if (start) all.first = one.first
        start = false
        if (one.open > 0) loops.push(one.loop)
        if (one.zero) continue

        counted++
        alone = one
        all.zero = false
        if (!headed) all.head = one.head
        headed = true
        all.tail = one.tail
        if (leading) all.lead += one.lead
        if (!one.literal) leading = false
        all.literal &&= one.literal
      }

      all.loop = all.open === 1 && loops.length === 1 ? (loops[0] ?? null) : null
      all.unit = counted === 1 && alone ? alone.unit : null
      all.shape = { kind: 'row', parts: parts.map((one) => one.shape) }
      return all
    }

    function escaped(begin: number): Cost {
      const next = String.fromCodePoint(source.codePointAt(at) ?? 0)
      at += next.length

      if (/[1-9]/.test(next) || (next === 'k' && source[at] === '<'))
        return backrefs ? REFUSED : single()
      if (next === 'b' || next === 'B') return { ...ZERO }

      if (next === 'x' || next === 'u') {
        const braced =
          unicode && next === 'u' ? /^\{([0-9a-f]+)\}/i.exec(source.slice(at, at + 12)) : null
        const plain = (next === 'x' ? /^[0-9a-f]{2}/i : /^[0-9a-f]{4}/i).exec(
          source.slice(at, at + 4),
        )
        const found = braced ?? plain
        if (!found) return single(next, source.slice(begin, at), next)
        at += found[0].length
        const letter = String.fromCodePoint(Number.parseInt(found[1] ?? found[0], 16))
        return single(letter, source.slice(begin, at), letter)
      }
      if (unicode && (next === 'p' || next === 'P')) {
        at += /^\{[^}]*\}/.exec(source.slice(at, at + 64))?.[0].length ?? 0
        return single(null, source.slice(begin, at))
      }
      const punctuation = /[\p{P}\p{S}]/u.test(next) ? next : null
      return single(punctuation, source.slice(begin, at), punctuation ?? '')
    }

    function atom(): Cost {
      const begin = at
      const one = String.fromCodePoint(source.codePointAt(at) ?? 0)
      at += one.length

      if (one === '\\') return escaped(begin)
      if (one === '[') {
        skipClass()
        return single(null, source.slice(begin, at))
      }
      if (one === '(') {
        const opening = GROUP_OPENING.exec(source.slice(at, at + 64))?.[0] ?? ''
        at += opening.length
        const inner = alternatives()
        at++
        return /^\?(?:=|!|<=|<!)/.test(opening)
          ? {
              ...ZERO,
              open: inner.open,
              ways: inner.ways,
              loop: inner.loop,
              shape: { kind: 'look', inner: inner.shape, behind: opening.startsWith('?<') },
            }
          : inner
      }
      if (one === '^') return { ...ZERO }
      if (one === '$') return { ...END }
      if (one === '.') return single(null, '.')
      return single(one, one.replace(SYNTAX, '\\$&'), one)
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

    function delimited(one: Cost): boolean {
      if (!lenient || one.ways !== 1) return false
      if (one.open > 1) return copiesApart(one.shape, flags)
      if (one.open !== 1 || one.loop === null) return false
      const loop = one.loop
      return [one.head, one.tail].some((edge) => edge !== null && setsApart(edge, loop, flags))
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

      const shape: Shape = {
        kind: 'again',
        of: one.shape,
        least,
        most,
        letters: one.unit ?? (one.open > 0 ? lettersOf(one.shape) : null) ?? one.loop,
      }
      const first = least === 0 ? null : one.first
      const kept = {
        ...PLAIN,
        first,
        head: least === 0 ? null : one.head,
        tail: least === 0 ? null : one.tail,
        lead: least === 0 ? '' : one.lead,
        zero: one.zero,
        shape,
      }
      if (least === most) {
        const open = one.open * most
        return {
          ...kept,
          open,
          ways: one.ways ** most,
          loop: open === 1 ? one.loop : null,
          literal: most === 1 && one.literal,
          unit: most === 1 ? one.unit : null,
        }
      }
      if (most === 1) {
        return {
          ...kept,
          open: one.open,
          ways: one.ways * 2,
          loop: one.open === 1 ? one.loop : null,
        }
      }

      if (one.open > 0 || one.ways > 1) {
        if (!delimited(one)) return REFUSED
        return { ...kept, open: 1 }
      }

      const range = most - least
      if (range <= 8) return { ...kept, ways: range + 1 }
      return { ...kept, open: 1, loop: one.unit }
    }

    return alternatives()
  }

  const MOST_WAYS = 1e4

  const MOST_REACH = 22

  function startsOf(source: string, flags: string, lead: string): number {
    if (source.startsWith('^')) return flags.includes('m') ? LINE : 0
    if (lead.length >= 2) return WORD_STARTS
    return lead ? LINE : NOTE
  }

  function backtracksWildly(source: string, flags = ''): boolean {
    try {
      const { open, ways, lead, shape } = patternCost(source, flags, false, true)
      if (open === Number.POSITIVE_INFINITY || ways > MOST_WAYS) return true
      return startsOf(source, flags, lead) + aheadOf(shape, flags).rest > MOST_REACH
    } catch {
      return true
    }
  }

  return { patternCost, backtracksWildly }
}

export const { patternCost, backtracksWildly } = patternJudge()

export function searchBacktracksWildly(source: string, fold: boolean): boolean {
  const flags = fold ? 'i' : ''
  try {
    RegExp(source, 'u')
    return backtracksWildly(source, `${flags}u`)
  } catch {
    return backtracksWildly(source, flags)
  }
}
