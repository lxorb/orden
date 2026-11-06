import { fold } from '@orden/rooms/fold'
import {
  DIFF_DELETE,
  DIFF_EQUAL,
  DIFF_INSERT,
  diffCharsToLines,
  diffCleanupEfficiency,
  diffCleanupMerge,
  diffCleanupSemantic,
  diffLinesToChars,
  diffMain,
  type Diff,
} from 'diff-match-patch-es'
import type { Edit, Span } from './merge3'
import { charAt, charBefore, isWordChar, tokens, wordEnd, wordStart } from './words'

const MOST_DIFFED = 5_000

const UNCLOCKED = { diffTimeout: 0 }

function leads(text: string, at: number): boolean {
  const code = text.charCodeAt(at)
  return code >= 0xd800 && code <= 0xdbff
}

function characters(old: string, now: string): Diff[] {
  const middle = fold(old, now)
  if (!middle) return old ? [[DIFF_EQUAL, old]] : []

  const before = old.slice(middle.from, middle.to)
  const out: Diff[] = []
  if (middle.from) out.push([DIFF_EQUAL, old.slice(0, middle.from)])

  if (before.length > MOST_DIFFED || middle.insert.length > MOST_DIFFED) {
    if (before) out.push([DIFF_DELETE, before])
    if (middle.insert) out.push([DIFF_INSERT, middle.insert])
  } else {
    out.push(...diffMain(before, middle.insert, UNCLOCKED, false))
  }

  if (middle.to < old.length) out.push([DIFF_EQUAL, old.slice(middle.to)])
  return out
}

function tidied(old: string, now: string): Diff[] {
  const middle = fold(old, now)
  if (!middle) return old ? [[DIFF_EQUAL, old]] : []
  const inner = characters(old.slice(middle.from, middle.to), middle.insert)
  diffCleanupMerge(inner)
  diffCleanupSemantic(inner)
  const out: Diff[] = []
  if (middle.from) out.push([DIFF_EQUAL, old.slice(0, middle.from)])
  out.push(...inner)
  if (middle.to < old.length) out.push([DIFF_EQUAL, old.slice(middle.to)])
  return out
}

function linesOf(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? []
}

function alike(
  one: string,
  other: string,
  compare: (a: string, b: string) => number | null,
): number {
  const a = one.replace(/\r?\n$/, '')
  const b = other.replace(/\r?\n$/, '')
  if (!a.trim() || !b.trim()) return 0
  const shortest = Math.min(a.length, b.length)
  const total = a.length + b.length
  if (2 * shortest < total * ONE_LINE) return 0
  let front = 0
  while (front < shortest && a.charCodeAt(front) === b.charCodeAt(front)) front++
  let back = 0
  while (
    back < shortest - front &&
    a.charCodeAt(a.length - 1 - back) === b.charCodeAt(b.length - 1 - back)
  ) {
    back++
  }
  const ends = (2 * (front + back)) / total
  if (ends >= ONE_LINE) return ends
  const common = compare(a.slice(front, a.length - back), b.slice(front, b.length - back))
  return common === null ? ends : (2 * (front + back + common)) / total
}

const MOST_COMPARED = 4_000

const MOST_LINE = 400

const ONE_LINE = 0.8

const MOST_PAIRED = 400

function paired(gone: string, come: string): Diff[] {
  const before = linesOf(gone)
  const after = linesOf(come)
  const n = before.length
  const m = after.length
  if (!n || !m || (n === 1 && m === 1) || n * m > MOST_PAIRED) return tidied(gone, come)

  const plain = tidied(gone, come)
  if (plain.every(([operation, text]) => operation === DIFF_EQUAL || !text.trim())) return plain

  let budget = MOST_COMPARED
  const compare = (a: string, b: string): number | null => {
    if (a.length + b.length > Math.min(budget, MOST_LINE)) return null
    budget -= a.length + b.length
    return diffMain(a, b, UNCLOCKED, false).reduce(
      (sum, [operation, text]) => sum + (operation === DIFF_EQUAL ? text.length : 0),
      0,
    )
  }
  const scores = new Float64Array(n * m).fill(-1)
  const score = (i: number, j: number) => {
    const known = scores[i * m + j] ?? -1
    if (known >= 0) return known
    const how = alike(before[i] ?? '', after[j] ?? '', compare)
    const pair = how >= ONE_LINE ? how : 0
    scores[i * m + j] = pair
    return pair
  }
  const best = Array.from({ length: n + 1 }, () => new Float64Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    const row = best[i] as Float64Array
    const below = best[i + 1] as Float64Array
    for (let j = m - 1; j >= 0; j--) {
      const pair = score(i, j)
      row[j] = Math.max(below[j] ?? 0, row[j + 1] ?? 0, pair ? pair + (below[j + 1] ?? 0) : 0)
    }
  }

  const out: Diff[] = []
  let gap = { gone: '', come: '' }
  const close = () => {
    if (gap.gone && gap.come) out.push(...tidied(gap.gone, gap.come))
    else if (gap.gone) out.push([DIFF_DELETE, gap.gone])
    else if (gap.come) out.push([DIFF_INSERT, gap.come])
    gap = { gone: '', come: '' }
  }
  if (!(best[0]?.[0] ?? 0)) return plain
  let i = 0
  let j = 0
  while (i < n || j < m) {
    const here = best[i]?.[j] ?? 0
    const pair = i < n && j < m ? score(i, j) : 0
    if (pair && Math.abs(here - (pair + (best[i + 1]?.[j + 1] ?? 0))) < 1e-9) {
      close()
      out.push(...tidied(before[i] ?? '', after[j] ?? ''))
      i++
      j++
    } else if (i < n && (j >= m || Math.abs(here - (best[i + 1]?.[j] ?? 0)) < 1e-9)) {
      gap.gone += before[i] ?? ''
      i++
    } else {
      gap.come += after[j] ?? ''
      j++
    }
  }
  close()
  return cost(plain) * 3 <= cost(out) * 2 ? plain : out
}

function cost(diffs: readonly Diff[]): number {
  return diffs.reduce(
    (sum, [operation, text]) => sum + (operation === DIFF_EQUAL ? 0 : text.length),
    0,
  )
}

function lines(old: string, now: string): Diff[] {
  const { chars1, chars2, lineArray } = diffLinesToChars(old, now)
  const coarse = diffMain(chars1, chars2, UNCLOCKED, false)
  diffCharsToLines(coarse, lineArray)
  diffCleanupSemantic(coarse)

  const out: Diff[] = []
  let gone = ''
  let come = ''
  const flush = () => {
    if (gone || come) out.push(...characters(gone, come))
    gone = ''
    come = ''
  }

  for (const [operation, text] of coarse) {
    if (operation === DIFF_DELETE) gone += text
    else if (operation === DIFF_INSERT) come += text
    else {
      flush()
      out.push([DIFF_EQUAL, text])
    }
  }

  flush()
  return out
}

function editsOf(diffs: readonly Diff[], offset: number): Edit[] {
  const out: Edit[] = []
  let at = offset
  let open: Edit | null = null

  for (const [operation, text] of diffs) {
    if (operation === DIFF_DELETE || operation === DIFF_INSERT) {
      open ??= { from: at, to: at, insert: '' }
      if (operation === DIFF_DELETE) {
        at += text.length
        open.to = at
      } else {
        open.insert += text
      }
      continue
    }

    if (open) out.push(open)
    open = null
    at += text.length
  }

  if (open) out.push(open)
  return out
}

function whole(old: string, edits: readonly Edit[]): Edit[] {
  const out: Edit[] = []

  for (const edit of edits) {
    let { from, to, insert } = edit
    if (from > 0 && leads(old, from - 1)) {
      from -= 1
      insert = old.charAt(from) + insert
    }
    if (to > 0 && to < old.length && leads(old, to - 1)) {
      insert += old.charAt(to)
      to += 1
    }

    const last = out.at(-1)
    if (last && last.to >= from) {
      last.insert += old.slice(last.to, from) + insert.slice(Math.max(0, last.to - from))
      last.to = Math.max(last.to, to)
    } else {
      out.push({ from, to, insert })
    }
  }

  return out
}

function slid(old: string, list: readonly Edit[]): Edit[] {
  const cuts = (from: number, insert: string) =>
    (isWordChar(charBefore(old, from)) && isWordChar(charAt(insert, 0))) ||
    (isWordChar(charBefore(insert, insert.length)) && isWordChar(charAt(old, from)))
  return list.map((edit, index) => {
    if (edit.from !== edit.to) return edit
    const lineStart = edit.from === 0 || old.charAt(edit.from - 1) === '\n'
    if (lineStart && edit.insert.endsWith('\n')) return edit
    const before = list[index - 1]
    const after = list[index + 1]
    const floor = before ? before.to + 1 : 0
    const limit = after ? after.from - 1 : old.length
    let { from, insert } = edit
    for (let char = charBefore(old, from); char && char !== '\n'; char = charBefore(old, from)) {
      if (from - char.length < floor || !insert.endsWith(char)) break
      insert = char + insert.slice(0, -char.length)
      from -= char.length
    }
    let best = { from, insert }
    let clean = !cuts(from, insert)
    for (let char = charAt(old, from); char && char !== '\n'; char = charAt(old, from)) {
      if (from + char.length > limit || !insert.startsWith(char)) break
      insert = insert.slice(char.length) + char
      from += char.length
      if (!cuts(from, insert) || !clean) {
        best = { from, insert }
        clean = !cuts(from, insert)
      }
    }
    return { from: best.from, to: best.from, insert: best.insert }
  })
}

export type Tidy = 'semantic' | 'operations'

function wordSpan(old: string, edit: Edit): Span {
  const gone = old.slice(edit.from, edit.to)
  const opens = isWordChar(charAt(gone, 0)) || isWordChar(charAt(edit.insert, 0))
  const closes =
    isWordChar(charBefore(gone, gone.length)) ||
    isWordChar(charBefore(edit.insert, edit.insert.length))

  return {
    from: opens && isWordChar(charBefore(old, edit.from)) ? wordStart(old, edit.from) : edit.from,
    to: closes && isWordChar(charAt(old, edit.to)) ? wordEnd(old, edit.to) : edit.to,
  }
}

function worded(old: string, now: string, list: readonly Edit[]): Edit[] {
  const out: Edit[] = []
  let shift = 0
  let open: { from: number; to: number; change: number } | null = null

  const close = () => {
    if (!open) return
    const at = open.from + shift
    out.push({
      from: open.from,
      to: open.to,
      insert: now.slice(at, at + open.to - open.from + open.change),
    })
    shift += open.change
    open = null
  }

  for (const edit of list) {
    const span = wordSpan(old, edit)
    const change = edit.insert.length - (edit.to - edit.from)
    if (open && span.from <= open.to) {
      open.to = Math.max(open.to, span.to)
      open.change += change
      continue
    }
    close()
    open = { from: span.from, to: span.to, change }
  }

  close()
  return out
}

export function edits(old: string, now: string, tidy: Tidy): Edit[] {
  const middle = fold(old, now)
  if (!middle) return []

  if (tidy === 'semantic') return worded(old, now, slid(old, whole(old, read(old, now, middle))))

  const before = old.slice(middle.from, middle.to)
  if (!before || !middle.insert) return [middle]

  const long = before.length > MOST_DIFFED || middle.insert.length > MOST_DIFFED
  const diffs = long ? lines(before, middle.insert) : characters(before, middle.insert)
  diffCleanupMerge(diffs)
  diffCleanupEfficiency(diffs)
  return whole(old, editsOf(diffs, middle.from))
}

function read(old: string, now: string, middle: Edit): Edit[] {
  const from = middle.from === 0 ? 0 : old.lastIndexOf('\n', middle.from - 1) + 1
  const ends = middle.to === 0 || middle.to === old.length || old.charAt(middle.to - 1) === '\n'
  const newline = ends ? -1 : old.indexOf('\n', middle.to)
  const to = ends ? middle.to : newline === -1 ? old.length : newline + 1
  const after = old.length - to

  const { chars1, chars2, lineArray } = diffLinesToChars(
    old.slice(from, to),
    now.slice(from, now.length - after),
  )
  const coarse = diffMain(chars1, chars2, UNCLOCKED, false)
  diffCharsToLines(coarse, lineArray)

  let run = { gone: '', come: '', kept: '' }
  const runs = [run]
  for (const [operation, text] of coarse) {
    if (operation === DIFF_EQUAL) {
      run.kept += text
      continue
    }
    if (run.kept) runs.push((run = { gone: '', come: '', kept: '' }))
    if (operation === DIFF_DELETE) run.gone += text
    else run.come += text
  }

  const rewrites = (one: { gone: string; come: string }) => one.gone !== '' && one.come !== ''
  const longest = (one: { gone: string; come: string }) =>
    Math.max(one.gone.length, one.come.length)
  const diffs: Diff[] = []
  const open = { gone: '', come: '' }
  const flush = () => {
    if (!open.gone && !open.come) return
    diffs.push(...paired(open.gone, open.come))
    open.gone = ''
    open.come = ''
  }
  for (const [index, { gone, come, kept }] of runs.entries()) {
    open.gone += gone
    open.come += come
    const next = runs[index + 1]
    const changes = (one: { gone: string; come: string }) => one.gone !== '' || one.come !== ''
    if (
      next &&
      ((rewrites(open) &&
        rewrites(next) &&
        kept.length <= Math.min(longest(open), longest(next))) ||
        (changes(open) && changes(next) && !kept.trim()))
    ) {
      open.gone += kept
      open.come += kept
      continue
    }
    flush()
    if (kept) diffs.push([DIFF_EQUAL, kept])
  }
  flush()
  return editsOf(diffs, from)
}

export function wordEdits(old: string, now: string): Edit[] {
  const codes = new Map<string, string>()
  const spelled = (list: readonly string[]) =>
    list
      .map((token) => {
        let code = codes.get(token)
        if (code === undefined) {
          code = String.fromCharCode(codes.size + 1)
          codes.set(token, code)
        }
        return code
      })
      .join('')

  const oldTokens = tokens(old)
  const nowTokens = tokens(now)
  const oldCodes = spelled(oldTokens)
  const nowCodes = spelled(nowTokens)
  if (codes.size >= 0xd7ff) return edits(old, now, 'semantic')

  const vocabulary = new Map([...codes].map(([token, code]) => [code, token]))
  const spoken = (text: string) =>
    Array.from({ length: text.length }, (_, at) => vocabulary.get(text.charAt(at)) ?? '').join('')
  const diffs: Diff[] = diffMain(oldCodes, nowCodes, UNCLOCKED, false).map(([operation, text]) => [
    operation,
    spoken(text),
  ])

  return editsOf(diffs, 0)
}
