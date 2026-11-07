import { readProperties } from '@orden/markdown/properties'
import { closesFence, fenceMark } from '@orden/markdown/fences'
import { type Block, blocksOf, contentOf } from './blocks'
import { edits, wordEdits } from './diff'
import {
  analyse,
  type Analysis,
  type Edit,
  type Meeting,
  type Settle,
  sharedPoints,
  type Span,
  type Whose,
  written,
} from './merge3'

export const CONTESTED = 80

export const REWRITTEN = 16

export type Verdict = 'clean' | 'minor' | 'diverged'

export type Broken = 'front-matter' | 'fence'

export interface Times {
  local: number
  remote: number
}

export interface Overlap {
  base: Span
  local: Span
  remote: Span
  size: number
  newer: Whose
  asks: 'size' | 'block' | null
}

export interface Divergence {
  verdict: Verdict
  overlaps: readonly Overlap[]
  resolution: string | null
  broken: Broken | null
  settled: 'newer' | 'both'
}

export interface Excerpt {
  text: string
  marks: [number, number][]
}

function startIn(at: number, sideEdits: readonly Edit[]): number {
  let shift = 0
  for (const edit of sideEdits) {
    if (edit.from >= at) break
    if (edit.to > at) return edit.from + shift
    shift += edit.insert.length - (edit.to - edit.from)
  }
  return at + shift
}

function endIn(at: number, sideEdits: readonly Edit[]): number {
  let shift = 0
  for (const edit of sideEdits) {
    if (edit.from >= at) break
    if (edit.to > at) return edit.from + shift + edit.insert.length
    shift += edit.insert.length - (edit.to - edit.from)
  }
  return at + shift
}

function spanIn(base: Span, sideEdits: readonly Edit[]): Span {
  return { from: startIn(base.from, sideEdits), to: endIn(base.to, sideEdits) }
}

function intersects(edit: Edit, span: Span): boolean {
  if (edit.from === edit.to) return span.from <= edit.from && edit.from <= span.to
  return edit.from < span.to && edit.to > span.from
}

function writtenIn(block: Block, sideEdits: readonly Edit[]): number {
  let sum = 0
  for (const edit of sideEdits) {
    if (!intersects(edit, block)) continue
    sum += edit.insert.length
    sum += Math.max(0, Math.min(edit.to, block.to) - Math.max(edit.from, block.from))
  }
  return sum
}

function deletedBy(words: Block, sideEdits: readonly Edit[]): Edit | null {
  return (
    sideEdits.find(
      (edit) => edit.from <= words.from && edit.to >= words.to && !edit.insert.trim(),
    ) ?? null
  )
}

function rewrittenBlocks(base: string, analysis: Analysis): Span[] {
  const out: Span[] = []
  const shared = (edit: Edit) =>
    analysis.identical.some(
      (one) => one.from === edit.from && one.to === edit.to && one.insert === edit.insert,
    )
  const mine = analysis.local.filter((edit) => !shared(edit))
  const theirs = analysis.remote.filter((edit) => !shared(edit))

  for (const block of blocksOf(base)) {
    for (const [gone, kept] of [
      [analysis.local, theirs],
      [analysis.remote, mine],
    ] as const) {
      const deletion = deletedBy(contentOf(base, block), gone)
      if (!deletion) continue

      const writing = kept.filter((edit) => intersects(edit, block))
      if (writtenIn(block, writing) <= REWRITTEN) continue

      const all = [deletion, ...writing]
      out.push({
        from: all.map((edit) => edit.from).reduce((low, one) => Math.min(low, one), block.from),
        to: all.map((edit) => edit.to).reduce((high, one) => Math.max(high, one), block.to),
      })
    }
  }

  return out
}

function sizeOver(span: Span, analysis: Analysis): number {
  const inside = (edit: Edit) => intersects(edit, span)
  const written = [...analysis.local, ...analysis.remote]
    .filter(inside)
    .reduce((sum, edit) => sum + edit.insert.length, 0)
  return written + (span.to - span.from)
}

function frontMatterParses(text: string): boolean {
  return readProperties(text) !== null
}

function fenceOpen(text: string): boolean {
  let open: string | null = null
  for (const line of text.split('\n')) {
    const clean = line.replace(/\r$/, '')
    if (open) {
      if (closesFence(clean, open)) open = null
    } else {
      open = fenceMark(clean)
    }
  }
  return open !== null
}

function brokenBy(local: string, remote: string, merges: readonly string[]): Broken | null {
  if (frontMatterParses(local) && frontMatterParses(remote)) {
    if (merges.some((merge) => !frontMatterParses(merge))) return 'front-matter'
  }
  if (!fenceOpen(local) && !fenceOpen(remote)) {
    if (merges.some(fenceOpen)) return 'fence'
  }
  return null
}

function distance(one: string, other: string): number {
  return edits(one, other, 'operations').reduce(
    (sum, edit) => sum + (edit.to - edit.from) + edit.insert.length,
    0,
  )
}

function resolved(
  base: string,
  analysis: Analysis,
  settle: (meeting: Meeting) => Settle,
  merged: string,
): string {
  const order = new Map<number, Whose>()
  const write = () => written(base, analysis, { settle, first: (at) => order.get(at) ?? 'local' })
  let best = write()
  let cost = distance(merged, best)
  for (const point of sharedPoints(analysis)) {
    if (cost === 0) break
    order.set(point, 'remote')
    const text = write()
    const far = distance(merged, text)
    if (far < cost) {
      best = text
      cost = far
    } else {
      order.delete(point)
    }
  }
  return best
}

const RUN = 4

function runsOf(text: string): Map<string, number> {
  const bare = text.replace(/[^\p{L}\p{N}]+/gu, '')
  const counts = new Map<string, number>()
  for (let at = 0; at + RUN <= bare.length; at += 1) {
    const run = bare.slice(at, at + RUN)
    counts.set(run, (counts.get(run) ?? 0) + 1)
  }
  return counts
}

function runsByLine(text: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const line of text.split('\n')) {
    for (const [run, count] of runsOf(line)) counts.set(run, (counts.get(run) ?? 0) + count)
  }
  return counts
}

function repeats(references: readonly string[], merge: string): boolean {
  const known = references.map(runsByLine)
  for (const [run, count] of runsByLine(merge)) {
    if (count < 2) continue
    if (known.every((one) => count > (one.get(run) ?? 0))) return true
  }
  return false
}

function excess(references: readonly string[], merge: string): number {
  const known = references.map(runsByLine)
  let over = 0
  for (const [run, count] of runsByLine(merge)) {
    if (count < 2) continue
    over += Math.max(
      0,
      count -
        known.map((one) => one.get(run) ?? 0).reduce((high, one) => Math.max(high, one), -Infinity),
    )
  }
  return over
}

function rewritten(base: string, side: string, words: (edit: Edit) => string): string {
  let out = ''
  let at = 0
  for (const edit of edits(base, side, 'semantic')) {
    out += base.slice(at, edit.from) + words(edit)
    at = edit.to
  }
  return out + base.slice(at)
}

function withoutWord(text: string, word: string): string {
  const parts = text.split(/(\s+)/)
  const at = parts.indexOf(word)
  if (at < 0) return text
  const space = parts[at + 1] !== undefined ? at + 1 : at - 1
  return parts.filter((_, index) => index !== at && index !== space).join('')
}

function wordsOf(text: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const word of text.split(/\s+/)) if (word) counts.set(word, (counts.get(word) ?? 0) + 1)
  return counts
}

function putTwice(
  base: string,
  local: string,
  remote: string,
  older: Whose,
  resolution: string,
): { local: string; remote: string } | null {
  const [mine, theirs] = older === 'local' ? [local, remote] : [remote, local]
  const said = wordsOf(resolution)
  const [before, ours, others] = [wordsOf(base), wordsOf(mine), wordsOf(theirs)]
  const moved = [...said].filter(([word, count]) => {
    if (!/[\p{L}\p{N}]/u.test(word)) return false
    const inBase = before.get(word) ?? 0
    const inMine = ours.get(word) ?? 0
    const inTheirs = others.get(word) ?? 0
    return (
      inBase > 0 && inMine <= inBase && inTheirs <= inBase && count > Math.max(inMine, inTheirs)
    )
  })

  const theirInserts = edits(base, theirs, 'semantic')
  const fixed = rewritten(base, mine, (edit) => {
    let words = edit.insert
    for (const [word] of moved) words = withoutWord(words, word)
    for (const other of theirInserts) {
      if (other.from !== edit.from || other.to !== edit.to) continue
      const ahead = overlapOf(other.insert, words)
      const behind = ahead === null ? overlapOf(words, other.insert) : null
      if (ahead !== null) words = words.slice(ahead.length)
      else if (behind !== null) words = words.slice(0, words.length - behind.length)
    }
    return words
  })
  if (fixed === mine) return null
  return older === 'local' ? { local: fixed, remote } : { local, remote: fixed }
}

function overlapOf(first: string, then: string): string | null {
  for (let length = Math.min(first.length, then.length); length > 0; length--) {
    const piece = then.slice(0, length)
    if (!first.endsWith(piece)) continue
    if (piece.replace(/\s+/g, '').length < RUN) return null
    const next = then.charAt(length)
    if (next === '' || /\s/.test(next)) return piece
  }
  return null
}

export function diverge(
  base: string,
  local: string,
  remote: string,
  times: Times,
  merged?: string,
): Divergence {
  const first = divergeOnce(base, local, remote, times, merged)
  if (first.resolution === null || !repeats([local, remote], first.resolution)) return first

  const older: Whose = times.local > times.remote ? 'remote' : 'local'
  const fixed = putTwice(base, local, remote, older, first.resolution)
  if (!fixed) return first
  const again = divergeOnce(base, fixed.local, fixed.remote, times, merged)
  if (again.resolution === null) return first
  if (cutsLines(base, [local, remote], first.resolution, again.resolution)) return first
  if (losesWords(base, [local, remote], first.resolution, again.resolution)) return first
  if (excess([local, remote], again.resolution) >= excess([local, remote], first.resolution)) {
    return first
  }
  return { ...first, resolution: again.resolution, settled: again.settled }
}

function linesIn(text: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const line of text.split('\n')) counts.set(line, (counts.get(line) ?? 0) + 1)
  return counts
}

function losesWords(
  base: string,
  sides: readonly string[],
  before: string,
  after: string,
): boolean {
  const old = wordsOf(base)
  const held = wordsOf(before)
  const kept = wordsOf(after)
  return sides.some((side) =>
    [...wordsOf(side)].some(
      ([word, count]) =>
        !old.has(word) && (kept.get(word) ?? 0) < Math.min(count, held.get(word) ?? 0),
    ),
  )
}

function linesWritten(base: string, side: string): Map<string, number> {
  const wrote = new Uint8Array(side.length)
  let shift = 0
  for (const edit of edits(base, side, 'semantic')) {
    const at = edit.from + shift
    wrote.fill(1, at, at + edit.insert.length)
    shift += edit.insert.length - (edit.to - edit.from)
  }
  const counts = new Map<string, number>()
  let start = 0
  for (const line of side.split('\n')) {
    let words = 0
    let theirs = true
    for (let at = 0; at < line.length; at++) {
      if (!/[\p{L}\p{N}]/u.test(line.charAt(at))) continue
      words += 1
      if (!wrote[start + at]) theirs = false
    }
    if (words && theirs) counts.set(line, (counts.get(line) ?? 0) + 1)
    start += line.length + 1
  }
  return counts
}

function cutsLines(base: string, sides: readonly string[], before: string, after: string): boolean {
  const old = linesIn(base)
  const held = linesIn(before)
  const kept = linesIn(after)
  return sides.some((side) =>
    [...linesWritten(base, side)].some(([line, count]) => {
      if (old.has(line)) return false
      return (kept.get(line) ?? 0) < Math.min(count, held.get(line) ?? 0)
    }),
  )
}

function divergeOnce(
  base: string,
  local: string,
  remote: string,
  times: Times,
  merged?: string,
): Divergence {
  const newer: Whose = times.local > times.remote ? 'local' : 'remote'
  const analysis = analyse(base, local, remote)

  const overlaps: Overlap[] = analysis.meetings.map((meeting: Meeting) => {
    const full = fuller(base, meeting)
    return {
      base: meeting.base,
      local: spanIn(meeting.base, analysis.local),
      remote: spanIn(meeting.base, analysis.remote),
      size: meeting.size,
      newer: full ?? newer,
      asks: full === null && meeting.size > CONTESTED ? 'size' : null,
    }
  })

  for (const span of rewrittenBlocks(base, analysis)) {
    const meeting = overlaps.find(
      (overlap) => overlap.base.from < span.to && span.from < overlap.base.to,
    )
    if (meeting) {
      meeting.asks ??= 'block'
      continue
    }
    overlaps.push({
      base: span,
      local: spanIn(span, analysis.local),
      remote: spanIn(span, analysis.remote),
      size: sizeOver(span, analysis),
      newer,
      asks: 'block',
    })
  }
  overlaps.sort((a, b) => a.base.from - b.base.from)

  const write = (settle: (meeting: Meeting) => Settle) =>
    merged === undefined
      ? [
          written(base, analysis, { settle }),
          written(base, analysis, { settle, first: () => 'remote' }),
        ]
      : [resolved(base, analysis, settle, merged)]
  let checked = write((meeting) => fuller(base, meeting) ?? newer)
  let settled: Divergence['settled'] = 'newer'
  let torn = false
  if (overlaps.length) {
    let kept = merged === undefined ? write(() => 'both') : [merged]
    if (merged !== undefined && repeats([local, remote], merged)) {
      const both = resolved(base, analysis, () => 'both', merged)
      if (excess([local, remote], both) < excess([local, remote], merged)) kept = [both]
    }
    const lines = new Set([base, local, remote].flatMap((text) => text.split('\n')))
    const novel = (texts: readonly string[]) =>
      texts
        .map((text) => text.split('\n').filter((line) => !lines.has(line)).length)
        .reduce((high, one) => Math.max(high, one), -Infinity)
    if (checked.some((text) => repeats([local, remote, ...kept], text))) {
      if (novel(kept) <= novel(checked)) {
        checked = kept
        settled = 'both'
      } else torn = true
    }
  }
  const resolution = checked[0] ?? ''
  const broken = brokenBy(local, remote, checked)

  const asks = torn || broken !== null || overlaps.some((overlap) => overlap.asks !== null)
  const verdict: Verdict = asks ? 'diverged' : overlaps.length ? 'minor' : 'clean'

  return {
    verdict,
    overlaps,
    resolution: verdict === 'diverged' ? null : resolution,
    broken,
    settled,
  }
}

function fuller(base: string, meeting: Meeting): Whose | null {
  const blank = (list: readonly Edit[]) =>
    list.every((edit) => !edit.insert && !/[\p{L}\p{N}]/u.test(base.slice(edit.from, edit.to)))
  const wrote = (list: readonly Edit[]) => list.some((edit) => edit.insert.trim())
  if (blank(meeting.local) && wrote(meeting.remote)) return 'remote'
  if (blank(meeting.remote) && wrote(meeting.local)) return 'local'
  const [mine] = meeting.local
  const [theirs] = meeting.remote
  if (meeting.local.length !== 1 || meeting.remote.length !== 1 || !mine || !theirs) return null
  if (mine.from !== mine.to || theirs.from !== theirs.to) return null
  const here = mine.insert.trim()
  const there = theirs.insert.trim()
  if (!here || !there) return null
  if (there.includes(here)) return 'remote'
  if (here.includes(there)) return 'local'
  return null
}

const MOST_EXCERPT = 480

const CONTEXT = 80

function passage(text: string, span: Span): Span {
  const lineFrom = span.from === 0 ? 0 : text.lastIndexOf('\n', span.from - 1) + 1
  const newline = text.indexOf('\n', span.to)
  const lineTo = newline === -1 ? text.length : newline
  if (lineTo - lineFrom <= MOST_EXCERPT) return { from: lineFrom, to: lineTo }

  let from = Math.max(lineFrom, span.from - CONTEXT)
  let to = Math.min(lineTo, Math.max(span.to, span.from) + CONTEXT, from + MOST_EXCERPT)
  const space = text.indexOf(' ', from)
  if (from > lineFrom && space !== -1 && space < span.from) from = space + 1
  const back = text.lastIndexOf(' ', to)
  if (to < lineTo && back > span.to) to = back

  return { from: Math.min(from, span.from), to: Math.max(to, Math.min(span.to, lineTo)) }
}

function mark(marks: [number, number][], from: number, to: number) {
  if (to > from) marks.push([from, to])
}

export function excerpt(
  base: string,
  local: string,
  remote: string,
  overlaps: readonly Overlap[],
): { local: Excerpt; remote: Excerpt } {
  let first: Overlap | undefined = overlaps.find((one) => one.asks !== null) ?? overlaps[0]

  if (!first) {
    const mine = edits(base, local, 'semantic')
    const theirs = edits(base, remote, 'semantic')
    const edit = [...mine, ...theirs].sort((a, b) => a.from - b.from)[0]
    if (!edit) return { local: { text: '', marks: [] }, remote: { text: '', marks: [] } }
    first = {
      base: edit,
      local: spanIn(edit, mine),
      remote: spanIn(edit, theirs),
      size: 0,
      newer: 'remote',
      asks: null,
    }
  }

  const here = passage(local, first.local)
  const there = passage(remote, first.remote)
  const mineText = local.slice(here.from, here.to)
  const theirText = remote.slice(there.from, there.to)

  const localMarks: [number, number][] = []
  const remoteMarks: [number, number][] = []
  let shift = 0
  for (const edit of wordEdits(mineText, theirText)) {
    mark(localMarks, edit.from, edit.to)
    mark(remoteMarks, edit.from + shift, edit.from + shift + edit.insert.length)
    shift += edit.insert.length - (edit.to - edit.from)
  }

  return {
    local: { text: mineText, marks: localMarks },
    remote: { text: theirText, marks: remoteMarks },
  }
}
