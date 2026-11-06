import { edits, wordEdits } from './diff'

export interface Span {
  from: number
  to: number
}

export interface Edit extends Span {
  insert: string
}

export type Whose = 'local' | 'remote'

export interface Meeting {
  base: Span
  local: readonly Edit[]
  remote: readonly Edit[]
  size: number
}

export type Settle = Whose | 'both'

export interface Analysis {
  local: readonly Edit[]
  remote: readonly Edit[]
  identical: readonly Edit[]
  meetings: readonly Meeting[]
  alone: { local: readonly Edit[]; remote: readonly Edit[] }
}

export interface Merged extends Analysis {
  text: string
}

function isInsertion(edit: Edit): boolean {
  return edit.from === edit.to
}

function sameEdit(one: Edit, other: Edit): boolean {
  return one.from === other.from && one.to === other.to && one.insert === other.insert
}

function shared(one: string, other: string): number {
  const [first, second] = one < other ? [one, other] : [other, one]
  return wordEdits(first, second).reduce((left, edit) => left - (edit.to - edit.from), first.length)
}

const ONE_PASSAGE = 16

const HELD_WHOLE = 8

function samePassage(one: string, other: string): boolean {
  if (shared(one, other) > ONE_PASSAGE) return true
  const [shorter, longer] = one.trim().length <= other.trim().length ? [one, other] : [other, one]
  const words = shorter.trim()
  return words.length >= HELD_WHOLE && longer.includes(words)
}

function meets(one: Edit, other: Edit): boolean {
  if (isInsertion(one) && isInsertion(other)) {
    return one.from === other.from && samePassage(one.insert, other.insert)
  }
  const [insertion, span] = isInsertion(one) ? [one, other] : [other, one]
  if (isInsertion(insertion)) {
    if (span.from < insertion.from && insertion.from < span.to) return true
    const edge = insertion.from === span.from || insertion.from === span.to
    return edge && samePassage(insertion.insert, span.insert)
  }
  return one.from < other.to && other.from < one.to
}

function lineStart(base: string, at: number): number {
  return at === 0 ? 0 : base.lastIndexOf('\n', at - 1) + 1
}

function lineEnd(base: string, at: number): number {
  const newline = base.indexOf('\n', at)
  return newline === -1 ? base.length : newline + 1
}

function wholeLines(base: string, edit: Edit): boolean {
  const ends = edit.to === edit.from || edit.to === base.length || base.charAt(edit.to - 1) === '\n'
  return (
    lineStart(base, edit.from) === edit.from &&
    ends &&
    (edit.insert === '' || edit.insert.endsWith('\n'))
  )
}

function reach(base: string, edit: Edit): Span {
  if (wholeLines(base, edit)) return { from: edit.from, to: edit.to }
  const keepsEnd =
    edit.to > edit.from && base.charAt(edit.to - 1) === '\n' && edit.insert.endsWith('\n')
  return {
    from: lineStart(base, edit.from),
    to: lineEnd(base, keepsEnd ? edit.to - 1 : edit.to),
  }
}

function breaks(base: string, edit: Edit): boolean {
  return edit.insert.includes('\n') || base.slice(edit.from, edit.to).includes('\n')
}

const WORDY = /[\p{L}\p{N}]/u

function rewrittenLines(base: string, side: readonly Edit[]): boolean[] {
  const out = side.map(() => false)
  let first = 0
  while (first < side.length) {
    const edit = side[first]
    if (!edit) break
    const lines = reach(base, edit)
    let last = first
    for (let next = side[last + 1]; next && next.from < lines.to; next = side[last + 1]) {
      last += 1
      lines.to = Math.max(lines.to, reach(base, next).to)
    }
    const mine = side.slice(first, last + 1)
    let at = lines.from
    let wordy = false
    for (const one of mine) {
      if (WORDY.test(base.slice(at, one.from))) wordy = true
      at = Math.max(at, one.to)
    }
    if (WORDY.test(base.slice(at, lines.to))) wordy = true
    for (const [offset, one] of mine.entries())
      out[first + offset] = !wordy && !wholeLines(base, one)
    first = last + 1
  }
  return out
}

function glued(base: string, one: Edit, other: Edit): boolean {
  if (!isInsertion(one) && !isInsertion(other)) {
    const [first, then] = one.to === other.from ? [one, other] : [other, one]
    if (first.to !== then.from) return false
    const left = first.insert ? first.insert.slice(-1) : base.charAt(first.from - 1)
    const right = then.insert ? then.insert.charAt(0) : base.charAt(then.to)
    return /\S/.test(left) && /\S/.test(right)
  }
  const [insertion, span] = isInsertion(one) ? [one, other] : [other, one]
  if (!isInsertion(insertion) || isInsertion(span)) return false
  const word = (char: string) => /^[\p{L}\p{N}]/u.test(char)
  if (insertion.from === span.to) {
    const left = span.insert ? span.insert.slice(-1) : base.charAt(span.from - 1)
    return word(left) && word(insertion.insert.charAt(0))
  }
  if (insertion.from === span.from) {
    const right = span.insert ? span.insert.charAt(0) : base.charAt(span.to)
    return word(insertion.insert.slice(-1)) && word(right)
  }
  return false
}

function sameLine(
  base: string,
  one: Edit,
  other: Edit,
  lines: { rewritten: readonly [boolean, boolean]; bare: (span: Span) => boolean },
): boolean {
  const oneWhole = wholeLines(base, one)
  const otherWhole = wholeLines(base, other)
  if (oneWhole && otherWhole) return false
  const a = reach(base, one)
  const b = reach(base, other)
  const reached = (): boolean => {
    if (a.from === a.to) return b.from < a.from && a.from < b.to
    if (b.from === b.to) return a.from < b.from && b.from < a.to
    return a.from < b.to && b.from < a.to
  }
  if (oneWhole || otherWhole) return reached()
  if (glued(base, one, other)) return true
  if (lines.rewritten[0] || lines.rewritten[1]) return reached()
  if (reached() && lines.bare({ from: Math.min(a.from, b.from), to: Math.max(a.to, b.to) })) {
    return true
  }
  if (isInsertion(one) && isInsertion(other) && one.from === other.from) {
    if (!WORDY.test(base.slice(a.from, one.from))) return true
    const after = (edit: Edit) => edit.insert.startsWith('\n')
    const words = (edit: Edit) => !edit.insert.includes('\n')
    if (after(one) && (after(other) || words(other))) return false
    if (after(other) && words(one)) return false
  }
  if (breaks(base, one) || breaks(base, other)) {
    if (one.from <= other.to && other.from <= one.to) return true
    const between =
      one.to <= other.from ? base.slice(one.to, other.from) : base.slice(other.to, one.from)
    return reached() && !WORDY.test(between)
  }
  return false
}

function paired(mine: readonly Edit[], theirs: readonly Edit[]) {
  const identical: Edit[] = []
  const local: Edit[] = []
  const remote: Edit[] = []
  let one = 0
  let other = 0

  while (one < mine.length || other < theirs.length) {
    const left = mine[one]
    const right = theirs[other]

    if (left && right && sameEdit(left, right)) {
      identical.push(left)
      one++
      other++
    } else if (
      left &&
      (!right || left.from < right.from || (left.from === right.from && left.to <= right.to))
    ) {
      local.push(left)
      one++
    } else if (right) {
      remote.push(right)
      other++
    }
  }

  return { identical, local, remote }
}

function grouped(base: string, local: readonly Edit[], remote: readonly Edit[]): Meeting[] {
  const parent = new Map<number, number>()
  const root = (at: number): number => {
    let node = at
    while (parent.get(node) !== undefined && parent.get(node) !== node) {
      node = parent.get(node) ?? node
    }
    return node
  }
  const join = (one: number, other: number) => {
    const a = root(one)
    const b = root(other)
    if (a !== b) parent.set(Math.max(a, b), Math.min(a, b))
  }

  const reaches = remote.map((edit) => reach(base, edit))
  const mineRewritten = rewrittenLines(base, local)
  const theirsRewritten = rewrittenLines(base, remote)
  const reachedBy: number[] = []
  for (const span of reaches) reachedBy.push(Math.max(reachedBy.at(-1) ?? 0, span.to))

  const taken: Span[] = []
  for (const edit of [...local, ...remote].sort((a, b) => a.from - b.from)) {
    if (edit.from === edit.to) continue
    const last = taken.at(-1)
    if (last && last.to >= edit.from) last.to = Math.max(last.to, edit.to)
    else taken.push({ from: edit.from, to: edit.to })
  }
  const asked = new Map<string, boolean>()
  const bare = (span: Span): boolean => {
    const key = `${span.from}:${span.to}`
    const known = asked.get(key)
    if (known !== undefined) return known
    let at = span.from
    let words = false
    for (const one of taken) {
      if (one.to <= at) continue
      if (one.from >= span.to) break
      if (WORDY.test(base.slice(at, one.from))) words = true
      at = Math.max(at, one.to)
      if (words || at >= span.to) break
    }
    if (!words && at < span.to && WORDY.test(base.slice(at, span.to))) words = true
    asked.set(key, !words)
    return !words
  }

  const touched = new Set<number>()
  let window = 0
  for (const [index, edit] of local.entries()) {
    const mine = reach(base, edit)
    while (window < remote.length && (reachedBy[window] ?? 0) < mine.from) window++

    for (let at = window; at < remote.length; at++) {
      const other = remote[at]
      const theirs = reaches[at]
      if (!other || !theirs || theirs.from > mine.to) break
      const rewritten = [!!mineRewritten[index], !!theirsRewritten[at]] as const
      if (!meets(edit, other) && !sameLine(base, edit, other, { rewritten, bare })) continue

      touched.add(index)
      touched.add(local.length + at)
      join(index, local.length + at)
    }
  }

  const groups = new Map<number, { local: Edit[]; remote: Edit[] }>()
  for (const node of [...touched].sort((a, b) => a - b)) {
    const key = root(node)
    const group = groups.get(key) ?? { local: [], remote: [] }
    groups.set(key, group)

    const isLocal = node < local.length
    const edit = isLocal ? local[node] : remote[node - local.length]
    if (edit) (isLocal ? group.local : group.remote).push(edit)
  }

  const meetings: Meeting[] = []
  for (const group of groups.values()) {
    const all = [...group.local, ...group.remote]
    const from = Math.min(...all.map((edit) => edit.from))
    const to = Math.max(...all.map((edit) => edit.to))
    const written = all.reduce((sum, edit) => sum + edit.insert.length, 0)

    meetings.push({ base: { from, to }, ...group, size: written + (to - from) })
  }

  return meetings.sort((a, b) => a.base.from - b.base.from)
}

function apart(base: string, side: readonly Edit[], other: readonly Edit[]): Edit[] {
  const points = new Set(other.filter((one) => one.from === one.to).map((one) => one.from))
  return side.flatMap((edit) => {
    if (edit.from === edit.to || (!points.has(edit.from) && !points.has(edit.to))) return [edit]
    const finer = edits(base.slice(edit.from, edit.to), edit.insert, 'operations').map((one) => ({
      from: one.from + edit.from,
      to: one.to + edit.from,
      insert: one.insert,
    }))
    return finer.length > 1 && finer.every((one) => one.from === one.to) ? finer : [edit]
  })
}

export function analyse(base: string, local: string, remote: string): Analysis {
  const roughMine = edits(base, local, 'semantic')
  const roughTheirs = edits(base, remote, 'semantic')
  const mine = apart(base, roughMine, roughTheirs)
  const theirs = apart(base, roughTheirs, roughMine)
  const { identical, local: onlyMine, remote: onlyTheirs } = paired(mine, theirs)
  const meetings = grouped(base, onlyMine, onlyTheirs)

  const met = new Set<Edit>(meetings.flatMap((meeting) => [...meeting.local, ...meeting.remote]))
  return {
    local: mine,
    remote: theirs,
    identical,
    meetings,
    alone: {
      local: onlyMine.filter((edit) => !met.has(edit)),
      remote: onlyTheirs.filter((edit) => !met.has(edit)),
    },
  }
}

interface Piece extends Edit {
  rank: number
}

function both(base: string, meeting: Meeting, first: Whose): string {
  const { from, to } = meeting.base
  const gone = new Uint8Array(to - from)
  const inserts = new Map<number, string[]>()

  const sides: [Whose, readonly Edit[]][] = [
    ['local', meeting.local],
    ['remote', meeting.remote],
  ]
  if (first === 'remote') sides.reverse()

  for (const [, list] of sides) {
    for (const edit of list) {
      gone.fill(1, edit.from - from, edit.to - from)
      if (!edit.insert) continue
      const here = inserts.get(edit.from) ?? []
      here.push(edit.insert)
      inserts.set(edit.from, here)
    }
  }

  let out = ''
  for (let at = from; at <= to; at++) {
    out += (inserts.get(at) ?? []).join('')
    if (at < to && !gone[at - from]) out += base.charAt(at)
  }
  return out
}

export interface Writing {
  settle: (meeting: Meeting) => Settle
  first?: (at: number) => Whose
}

export function sharedPoints(analysis: Analysis): number[] {
  const side = (whose: Whose) => [
    ...analysis.alone[whose],
    ...analysis.meetings.flatMap((meeting) => meeting[whose]),
  ]
  const mine = new Set(side('local').map((edit) => edit.from))
  const points = new Set<number>()
  for (const edit of side('remote')) if (mine.has(edit.from)) points.add(edit.from)
  return [...points].sort((a, b) => a - b)
}

export function written(base: string, analysis: Analysis, writing: Writing): string {
  const first = writing.first ?? (() => 'local')
  const rankOf = (whose: Whose, at: number) => (whose === first(at) ? 0 : 1)
  const pieces: Piece[] = []

  for (const edit of analysis.alone.local)
    pieces.push({ ...edit, rank: rankOf('local', edit.from) })
  for (const edit of analysis.alone.remote)
    pieces.push({ ...edit, rank: rankOf('remote', edit.from) })
  for (const edit of analysis.identical) pieces.push({ ...edit, rank: 0 })

  for (const meeting of analysis.meetings) {
    const settled = writing.settle(meeting)
    if (settled === 'both') {
      const insert = both(base, meeting, first(meeting.base.from))
      pieces.push({ ...meeting.base, insert, rank: 0 })
      continue
    }
    for (const edit of meeting[settled]) pieces.push({ ...edit, rank: rankOf(settled, edit.from) })
  }

  const inside = (piece: Piece) => (wholeLines(base, piece) ? 0 : 1)
  const replaces = (piece: Piece) => (piece.to > piece.from ? 1 : 0)
  const opens = (piece: Piece) => (piece.insert.startsWith('\n') ? 1 : 0)
  pieces.sort(
    (a, b) =>
      a.from - b.from ||
      inside(a) - inside(b) ||
      replaces(a) - replaces(b) ||
      opens(a) - opens(b) ||
      a.rank - b.rank ||
      a.to - b.to,
  )

  let out = ''
  let at = 0
  for (const piece of pieces) {
    out += base.slice(at, piece.from) + piece.insert
    at = Math.max(at, piece.to)
  }

  return out + base.slice(at)
}

function inWord(text: string, at: number): boolean {
  return WORDY.test(text.charAt(at - 1)) && WORDY.test(text.charAt(at))
}

function heldIn(words: string, other: string): boolean {
  const these = words.trim()
  if (!these) return false
  const from = other.length - other.trimStart().length
  const to = other.trimEnd().length
  for (let at = other.indexOf(these); at !== -1; at = other.indexOf(these, at + 1)) {
    if (inWord(other, at) || inWord(other, at + these.length)) continue
    if (at === from || at + these.length === to || these.length >= HELD_WHOLE) return true
  }
  return false
}

function linesAlike(one: string, other: string): string {
  let at = 0
  while (at < one.length && one.charAt(at) === other.charAt(at)) at++
  if (at === 0) return ''
  return one.slice(0, one.lastIndexOf('\n', at - 1) + 1)
}

export function mergedOn(base: string, local: string, remote: string): string {
  const analysis = analyse(base, local, remote)
  const mine = [...analysis.alone.local, ...analysis.meetings.flatMap((one) => one.local)]
  const theirs = [...analysis.alone.remote, ...analysis.meetings.flatMap((one) => one.remote)]
  const told = new Map<Edit, Edit | null>()

  for (const one of mine) {
    const other = theirs.find((edit) => edit.from === one.from && edit.to === one.to)
    if (!other) continue
    const [shorter, longer] = one.insert.length <= other.insert.length ? [one, other] : [other, one]
    if (heldIn(shorter.insert, longer.insert)) {
      told.set(shorter, null)
      continue
    }
    const alike = linesAlike(one.insert, other.insert)
    if (alike) told.set(other, { ...other, insert: other.insert.slice(alike.length) })
  }

  const left = (side: readonly Edit[]) =>
    side.flatMap((edit) => {
      const said = told.has(edit) ? told.get(edit) : edit
      return said ? [said] : []
    })
  return written(
    base,
    {
      ...analysis,
      meetings: analysis.meetings.map((one) => ({
        ...one,
        local: left(one.local),
        remote: left(one.remote),
      })),
      alone: { local: left(analysis.alone.local), remote: left(analysis.alone.remote) },
    },
    { settle: () => 'both' },
  )
}

export function merge3(
  base: string,
  local: string,
  remote: string,
  settle: (meeting: Meeting) => Settle = () => 'both',
): Merged {
  const analysis = analyse(base, local, remote)
  return {
    ...analysis,
    text: written(base, analysis, { settle }),
  }
}
