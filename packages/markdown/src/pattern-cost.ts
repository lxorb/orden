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
  }

  const REFUSED: Cost = { ...PLAIN, open: Number.POSITIVE_INFINITY }

  const ZERO: Cost = { ...PLAIN, literal: true, zero: true }

  function single(first: string | null = null, unit: string | null = null, lead = ''): Cost {
    return { ...PLAIN, first, head: unit, tail: unit, unit, lead, literal: lead !== '' }
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

      while (at < source.length && source[at] !== '|' && source[at] !== ')') {
        const one = repeated(atom())
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
          ? { ...ZERO, open: inner.open, ways: inner.ways, loop: inner.loop }
          : inner
      }
      if (one === '^' || one === '$') return { ...ZERO }
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
      if (!lenient || one.open !== 1 || one.ways !== 1 || one.loop === null) return false
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

      const first = least === 0 ? null : one.first
      const kept = {
        ...PLAIN,
        first,
        head: least === 0 ? null : one.head,
        tail: least === 0 ? null : one.tail,
        lead: least === 0 ? '' : one.lead,
        zero: one.zero,
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

      if (one.open > 0 || one.ways > 1) return delimited(one) ? { ...kept, open: 1 } : REFUSED

      const range = most - least
      return range <= 8 ? { ...kept, ways: range + 1 } : { ...kept, open: 1, loop: one.unit }
    }

    return alternatives()
  }

  const MOST_WAYS = 1e4

  function backtracksWildly(source: string, flags = ''): boolean {
    try {
      const { open, ways } = patternCost(source, flags, false, true)
      return open === Number.POSITIVE_INFINITY || ways > MOST_WAYS
    } catch {
      return true
    }
  }

  return { patternCost, backtracksWildly }
}

export const { patternCost, backtracksWildly } = patternJudge()
