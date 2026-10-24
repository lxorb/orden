/** What changed between two texts, as edits in the first text's coordinates.
 *
 *  The one character diff in this package: the classifier reads it to see where two
 *  sides wrote, and textops reads it to turn a whole text into operations. It is
 *  diff-match-patch underneath, with three things added that the library does not do
 *  on its own.
 *
 *  **The same answer everywhere.** The library gives up after a second by default and
 *  answers with a coarser diff, so how two texts differ would depend on how fast the
 *  machine asking was. A device classifies, and a test replays a seed; both need one
 *  answer. So the clock is off, and the work is bounded another way: long texts are
 *  compared line by line first, the way the library itself does, and only the runs of
 *  lines that differ are compared character by character. A run that is still very
 *  long once its common ends are cut off is a rewrite, and is answered as one
 *  replacement without asking the library at all, because an unclocked diff of two
 *  long unrelated stretches costs the product of their lengths.
 *
 *  **Whole characters.** The library counts UTF-16 code units, and a boundary between
 *  the two halves of an emoji is a boundary it is happy to draw. Yjs is not: splitting
 *  a pair in a shared text replaces both halves with U+FFFD for good. Every edit is
 *  widened until both its ends fall between characters.
 *
 *  **Cost in proportion to the edit.** The common front and back are cut off first by
 *  `fold`, the same trim a room's fold uses, so a word changed in a hundred kilobytes
 *  is a diff of a word. */

import { fold } from '@nib/rooms/fold'
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

/** Past this many code units on either side, a stretch that differs is compared line
 *  by line rather than character by character, and a run of changed lines past it,
 *  once its common ends are cut off, is one replacement. Two unrelated stretches of
 *  this size cost the library about a third of a second on a laptop (measured: 115 ms
 *  at 2,000, 330 ms at 5,000, 830 ms at 10,000), which is the most this lets a diff
 *  cost; two similar ones cost next to nothing (a hundred kilobytes with thirty words
 *  changed: 8 ms). */
const MOST_DIFFED = 5_000

/** The library with its clock off. */
const UNCLOCKED = { diffTimeout: 0 }

function leads(text: string, at: number): boolean {
  const code = text.charCodeAt(at)
  return code >= 0xd800 && code <= 0xdbff
}

/** Two stretches compared character by character, their common ends trimmed first,
 *  and a middle too long to compare answered as one replacement. */
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

/** Two stretches compared character by character and read for a person, the
 *  semantic cleanup kept to what lies between their common ends. Run over the ends
 *  too, its sideways pass slides an edit out across text the two share - `now ` typed
 *  after a space becomes ` now` typed before it - onto a place the other side may
 *  have changed, and the two run together (`nowcall`). */
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

/** The text's lines, each with its line break. */
function linesOf(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? []
}

/** How alike two lines read, from 0 to 1: how much of the two they share, their
 *  line breaks left out; blank lines not at all. `compare` is asked to count
 *  what they share when their common front and back alone do not make them alike,
 *  and says null where that would cost too much. */
function alike(
  one: string,
  other: string,
  compare: (a: string, b: string) => number | null,
): number {
  const a = one.replace(/\r?\n$/, '')
  const b = other.replace(/\r?\n$/, '')
  // A blank line is like every other blank line, and anchors nothing: paired, it
  // would read a paragraph split as text moved across the blank line.
  if (!a.trim() || !b.trim()) return 0
  const shortest = Math.min(a.length, b.length)
  const total = a.length + b.length
  // They cannot share more than the shorter one.
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
  // Words put in at both ends of a line leave it no common front or back.
  const common = compare(a.slice(front, a.length - back), b.slice(front, b.length - back))
  return common === null ? ends : (2 * (front + back + common)) / total
}

/** How many characters of two lines' middles a run compares letter by letter, all
 *  pairs together, before it settles for their common front and back: a few long
 *  lines, or many short ones, at about the cost of one diff of the run. */
const MOST_COMPARED = 4_000

/** Past this many characters of two lines' middles together, they are not compared
 *  letter by letter: two unrelated stretches cost the product of their lengths. */
const MOST_LINE = 400

/** At least this alike, two lines of a run are one line edited. */
const ONE_LINE = 0.8

/** Past this many pairs of lines, a run is read as one stretch, unpaired. */
const MOST_PAIRED = 400

/** A run of changed lines, the lines on one side that are the other's lines edited
 *  paired up in order and read letter by letter one pair at a time, and the rest
 *  read as lines added or taken out - or, where both sides have lines between two
 *  pairs, as those lines rewritten.
 *
 *  Read letter by letter as one stretch, a task added above a task ticked takes the
 *  ticked one's box: `- [ ] milk` against `- [ ] eggs` and `- [x] milk` reads as
 *  ` eggs\n- [x]` put in after the first box, and a tick the other side gave milk
 *  lands on eggs. */
function paired(gone: string, come: string): Diff[] {
  const before = linesOf(gone)
  const after = linesOf(come)
  const n = before.length
  const m = after.length
  if (!n || !m || (n === 1 && m === 1) || n * m > MOST_PAIRED) return tidied(gone, come)

  // The pairs that make the run most alike, in order: a longest common subsequence
  // weighted by how alike each pair reads, each pair read once.
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
  // A line split in two, or two joined, pairs with one of its halves and reads as the
  // rest of it taken out and typed again on a line of its own. Read as one stretch it
  // is the break put in or taken out, and it writes far less: where the run differs
  // only in white space, or that reading writes a third less, it is the one.
  const plain = tidied(gone, come)
  const spaces = plain.every(([operation, text]) => operation === DIFF_EQUAL || !text.trim())
  return spaces || cost(plain) * 3 <= cost(out) * 2 ? plain : out
}

/** How many characters a diff takes out and puts in. */
function cost(diffs: readonly Diff[]): number {
  return diffs.reduce(
    (sum, [operation, text]) => sum + (operation === DIFF_EQUAL ? 0 : text.length),
    0,
  )
}

/** Two long stretches compared line by line, and each run of lines that differs then
 *  character by character. The library's own line mode, with the bound above on the
 *  second step in place of its clock. */
function lines(old: string, now: string): Diff[] {
  const { chars1, chars2, lineArray } = diffLinesToChars(old, now)
  const coarse = diffMain(chars1, chars2, UNCLOCKED, false)
  diffCharsToLines(coarse, lineArray)
  // As the library does: a line kept by chance between two rewritten ones joins them,
  // so the character pass sees the rewrite whole.
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

/** The library's answer, as edits in the old text's coordinates, adjacent deletes
 *  and inserts paired into one replacement. */
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

/** Every edit widened until its ends fall between whole characters of `old`, and
 *  edits that then touch joined into one.
 *
 *  Widening takes the half-character on either side into the edit on both texts at
 *  once: it is the same code unit in both, because it sat in the part the two share.
 *  So `from` moving back one unit prepends that unit to `insert`, and `to` moving on
 *  one appends it. */
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

    // Widening can make two edits touch, and around a stray half-character it can
    // make them share one unit: that unit is already at the end of the first
    // edit's insert and at the start of this one's, so it is taken once.
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

/** Every insertion read at one place among the places it could be read at: words
 *  put in between two others read the same before the space or after it (` now` or
 *  `now `), and so does a word put in before another that starts with its last
 *  letter (` R` after the `R` of `Renew`, or `R ` before it). Two sides that put
 *  words in at one place must be read putting them in at one offset, or neither is
 *  seen to meet the other. Of the places within the line, up to the edits either
 *  side, the furthest on that cuts into no word, as `fold` reads it; else the
 *  furthest on. Lines put in between two lines stay where they are. */
function slid(old: string, list: readonly Edit[]): Edit[] {
  const cuts = (from: number, insert: string) =>
    (isWordChar(charBefore(old, from)) && isWordChar(charAt(insert, 0))) ||
    (isWordChar(charBefore(insert, insert.length)) && isWordChar(charAt(old, from)))
  return list.map((edit, index) => {
    if (edit.from !== edit.to) return edit
    const lineStart = edit.from === 0 || old.charAt(edit.from - 1) === '\n'
    if (lineStart && edit.insert.endsWith('\n')) return edit
    // Never onto the edits either side: touching, they would read as one.
    const before = list[index - 1]
    const after = list[index + 1]
    const floor = before ? before.to + 1 : 0
    const limit = after ? after.from - 1 : old.length
    let { from, insert } = edit
    // Back to the first place it could be read at.
    for (let char = charBefore(old, from); char && char !== '\n'; char = charBefore(old, from)) {
      if (from - char.length < floor || !insert.endsWith(char)) break
      insert = char + insert.slice(0, -char.length)
      from -= char.length
    }
    // Then on through every other, keeping the last that cuts no word.
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

/** Two ways to tidy the library's raw answer, for two readers.
 *
 *  `semantic` is for reading: the coincidental agreements inside a rewritten
 *  sentence - the `e` that `rest` and `sleep` share - are folded into the rewrite,
 *  and every edit that cuts into a word is widened to the whole word. That is what a
 *  person would call the change, and what the classifier has to see: two rewrites of
 *  one sentence must not look like twenty small edits that happen not to touch, and
 *  `noon` changed to `one` must not look like two letters deleted and one typed
 *  just beside the other side's change. Lines are compared as lines first, so a
 *  line added above another taken out is those two edits, not the lines between
 *  them rewritten.
 *
 *  `operations` is for writing into a shared text: only the agreements too short to
 *  be worth two more operations are folded, the library's efficiency cleanup, so a
 *  word retyped is one replacement while a sentence edited in two places stays two
 *  edits, and every character outside them keeps its identity in the shared text. */
export type Tidy = 'semantic' | 'operations'

/** The span an edit covers once widened to whole words at either end where it cut
 *  into one: its first or last changed character is part of a word, and so is the
 *  character beside it that it left alone. */
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

/** Edits widened to whole words, and the ones that then touch joined into one, what
 *  each now inserts read back out of `now`: everything between two edits is text
 *  the two share, so a widened edit's words on the new side are where its ends land
 *  once the edits before it are counted. */
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

/** How `old` becomes `now`, as edits in `old`'s coordinates, in order, none of them
 *  touching another and none of them cutting a character in half. Empty when the two
 *  are the same text. */
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

/** The edits a person would name, between the whole lines around `middle`: lines
 *  added, lines taken out, and lines rewritten, each run of changed lines then read
 *  character by character on its own.
 *
 *  Read letter by letter, a line added above a line taken out is every line between
 *  them rewritten as the one before it, each word replaced by the word above; two
 *  sides that took the same line out would then seem to have rewritten it two ways
 *  (`alpha` over `gone item` on the one, `beta` over it on the other). Only a
 *  line kept between two rewritten ones is joined into them, as the library's
 *  semantic cleanup would, so two rewrites of one passage still read as one. */
function read(old: string, now: string, middle: Edit): Edit[] {
  // The text either side of `middle` is the same in both, so widening it to whole
  // lines takes the same characters into both sides.
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

  // Each run is the lines changed there and the lines kept after them.
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
    // Blank lines kept between two changes are joined into them too: kept, a blank
    // line anchors a paragraph split or joined, and the text either side reads as
    // moved across it.
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

/** How `old` becomes `now` word by word: a word is the same word or a different one,
 *  never a few of its letters. What the modal marks, so a reader sees the words that
 *  differ between two passages rather than the letters. */
export function wordEdits(old: string, now: string): Edit[] {
  const codes = new Map<string, string>()
  const spelled = (list: readonly string[]) =>
    list
      .map((token) => {
        let code = codes.get(token)
        if (code === undefined) {
          // One character per distinct token, below the surrogates so none of them
          // is ever half a pair. A passage long enough to run out is read letter by
          // letter instead.
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
  // Every code is one unit below the surrogates, so a unit is a token.
  const spoken = (text: string) =>
    Array.from({ length: text.length }, (_, at) => vocabulary.get(text.charAt(at)) ?? '').join('')
  const diffs: Diff[] = diffMain(oldCodes, nowCodes, UNCLOCKED, false).map(([operation, text]) => [
    operation,
    spoken(text),
  ])

  return editsOf(diffs, 0)
}
