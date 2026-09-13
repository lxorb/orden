/** The words of the papers in a space, and searching them.
 *
 *  A paper is not a note: its words are inside a PDF, and getting at them is
 *  pdf.js, a worker and a page at a time. So the space search cannot walk them the
 *  way it walks notes - neither the crate nor the browser's own walk has anything
 *  to read - and what nib does instead is take a page's words down the first time
 *  anything reads them and keep them:
 *
 *  In memory for the sitting, which is what the viewer fills as a reader scrolls,
 *  since it reads a page's text for its own find bar anyway. And on disk, keyed by
 *  the file's hash, which is what makes a paper opened last week answer a search
 *  today; see text-cache.ts, which owns the store and the bounds, and extract.ts,
 *  which reads the papers nobody has opened at all in idle time.
 *
 *  What was refused, and why. Reading every PDF in a space when a search runs
 *  would make the first search of a space with twenty papers a minute long, which
 *  is not a search. Nothing here ever waits for a PDF to be taken apart: a search
 *  answers from what is in memory, and everything that puts something there
 *  happens in idle time or because somebody opened the paper.
 *
 *  Matching itself is the shared matcher, so a query means the same thing in a
 *  paper as in a note. Only the rows are built here: a page has no lines, so the
 *  words around the match are what a row shows. */

import { type Hit, Matcher } from '../search/match'
import type { Query } from '../search/query'
import { warm } from '../search/warm.svelte'
import { afterQuiet } from '../timing'
import { forgetPaperText, keepPaperText, paperFiles, paperText, paperTextOf } from './text-cache'

/** One paper, as its words stand in this window. */
interface Paper {
  /** The hash of the file the words came out of, where it is known: the viewer
   *  and the idle pass both have the bytes in hand and both say. Empty for a
   *  paper whose words arrived before anybody said, which is nothing to write
   *  down - a record nobody can check the file against is a record that would
   *  outlive the file. */
  hash: string
  modified: number
  pages: Map<number, string>
  characters: number
  /** Whether the pages have changed since they were last written down. */
  unwritten: boolean
}

/** Every paper this window has words for, by the paper's path. */
const held = new Map<string, Paper>()

/** How much paper text is kept in memory at once.
 *
 *  Less than the store holds, because this is a page and that is a disk: what
 *  comes back after a restart is read smallest first, so as many papers as
 *  possible answer rather than one book filling the whole of it. */
const IN_MEMORY = 4_000_000

/** How long after the last page was read its paper is written down. Long enough
 *  that scrolling through twenty pages is one write, short enough that closing the
 *  tab a moment later has still kept them. */
const SETTLE = 1500

/** How much of a page a row shows, and how much of it comes before the match. A
 *  page is one long run of words, so unlike a note's line there is no natural end
 *  to cut at: the row is a window, and the match sits inside it rather than at the
 *  start of it. */
const WINDOW = 180
const BEFORE = 60

/** The papers written down once the reader has stopped turning pages; see
 *  `pageRead` and `writePapers`. */
const writing = afterQuiet(() => void writePapers(), SETTLE)

/** Which space has had what was taken down in an earlier sitting read back, so
 *  that a search asks for it once rather than per keystroke. */
let hydrated: { root: string; done: Promise<void> } | null = null

/** Which file a paper's words came out of.
 *
 *  Said by whoever has the bytes: the viewer when it opens a paper, and the idle
 *  pass when it reads one nobody has opened. Until something says, a page's words
 *  are held for the sitting and not written down, because a record that cannot be
 *  held against the file is one that would answer for a file that has changed. */
export function paperOpened(path: string, hash: string, modified: number): void {
  const paper = paperAt(path)
  if (paper.hash === hash && paper.modified === modified) return

  // A different file at the same path: what was held was that file's words.
  if (paper.hash && paper.hash !== hash) {
    paper.pages.clear()
    paper.characters = 0
    void forgetPaperText(path)
  }

  paper.hash = hash
  paper.modified = modified
}

function paperAt(path: string): Paper {
  const found = held.get(path)
  if (found) return found

  const made: Paper = { hash: '', modified: 0, pages: new Map(), characters: 0, unwritten: false }
  held.set(path, made)
  return made
}

/** A page's words, as the viewer read them.
 *
 *  The runs are joined with a space rather than with nothing: `textOfRuns` joins
 *  them tight because the find bar counts characters against what is painted, and
 *  nothing here is painted. A space is what keeps two runs from making one word
 *  that neither of them says. */
export function paperRead(path: string, page: number, runs: readonly string[]): void {
  const text = runs.join(' ')
  const paper = paperAt(path)
  const was = paper.pages.get(page)
  if (was === text) return

  paper.pages.set(page, text)
  paper.characters += text.length - (was?.length ?? 0)
  paper.unwritten = true

  hold()
  told()
  // Written down once the reader has stopped turning pages, and only for a paper
  // whose file has been named; see `paperOpened`.
  writing()
}

/** Writes down every paper whose pages have changed since the last time.
 *
 *  Awaited by the idle pass, which reads one paper and writes it before it starts
 *  the next, and by the tests. The viewer's own pages are written on a timer. */
export async function writePapers(): Promise<void> {
  writing.cancel()

  for (const [path, paper] of held) {
    if (!paper.unwritten || !paper.hash || !paper.pages.size) continue

    paper.unwritten = false
    await keepPaperText(paperTextOf(path, paper.hash, paper.modified, paper.pages))
  }
}

/** Reads back what was taken down in an earlier sitting, once per space.
 *
 *  Awaited by the space search before it asks the papers anything, and asked for
 *  in idle time at the search stage of the launch, so the first question about a
 *  space has the answer already. Smallest first: a shelf of papers answers rather
 *  than one book filling everything there is.
 *
 *  A record is read with what the listing says about the file, so a paper written
 *  since it was taken down is dropped rather than answered with; see
 *  text-cache.ts. */
export async function papersFor(root: string, modified?: Map<string, number>): Promise<void> {
  if (hydrated?.root === root) return hydrated.done

  const done = (async () => {
    const inside = root.endsWith('/') ? root : `${root}/`

    for (const file of await paperFiles()) {
      if (!file.path.startsWith(inside)) continue
      if (characters() + file.size > IN_MEMORY) break
      if (held.get(file.path)?.pages.size) continue

      const record = await paperText(file.path, modified?.get(file.path))
      if (!record) continue

      const paper = paperAt(file.path)
      paper.hash = record.hash
      paper.modified = record.modified
      for (const [page, text] of record.pages) paper.pages.set(page, text)
      paper.characters = record.characters
      paper.unwritten = false
    }

    told()
  })()

  hydrated = { root, done }
  return done
}

/** Forgets a paper, for one that has been renamed, moved or deleted. Its words go
 *  from the store as well: they were that path's words, and the path has gone. */
export function paperGone(path: string): void {
  held.delete(path)
  told()
  void forgetPaperText(path)
}

/** A paper, or a folder of them, that has moved.
 *
 *  The words follow the file, because they are the file's: what was read out of
 *  those bytes is still what is in them wherever they sit. The record moves with
 *  them, the way a PDF's highlights follow it; see `move_highlights` in paths.rs. */
export function paperMoved(from: string, to: string): void {
  const moving = [...held.keys()].filter((path) => path === from || path.startsWith(`${from}/`))

  for (const path of moving) {
    const paper = held.get(path)
    if (!paper) continue

    held.delete(path)
    held.set(to + path.slice(from.length), { ...paper, unwritten: true })
    void forgetPaperText(path)
  }

  if (!moving.length) return

  told()
  void writePapers()
}

/** Says what is held, so that the panel's diagnostics line says both halves of
 *  what a search reads; see search/warmth.ts. */
function told(): void {
  warm.holdingPapers(papersHeld())
}

/** What is held, for the panel's diagnostics and for a test. */
export function papersHeld(): { papers: number; characters: number; cap: number } {
  return { papers: papersRead(), characters: characters(), cap: IN_MEMORY }
}

/** How many papers have words worth searching. For the drive, and for a test. */
export function papersRead(): number {
  let read = 0
  for (const paper of held.values()) {
    if (paper.pages.size) read += 1
  }

  return read
}

function characters(): number {
  let sum = 0
  for (const paper of held.values()) sum += paper.characters
  return sum
}

/** Memory held to `IN_MEMORY`, the largest paper first: a paper let go of is one
 *  the store still has, so it comes back the next time the space is opened. */
function hold(): void {
  if (characters() <= IN_MEMORY) return

  const biggest = [...held.entries()].sort((one, other) => other[1].characters - one[1].characters)
  for (const [path, paper] of biggest) {
    if (characters() <= IN_MEMORY) return
    // Never the paper whose pages are still unwritten: those words are only here.
    if (paper.unwritten) continue

    held.delete(path)
  }
}

/** The words around one match, and where the match sits in them. */
function windowOf(body: string, from: number): { text: string; at: number } {
  const start = Math.max(0, from - BEFORE)
  const cut = body.slice(start, start + WINDOW)
  const lead = cut.length - cut.trimStart().length
  const text = cut.trim()

  return { text, at: from - start - lead }
}

/** Whether a paper is one the space leaves out: the path itself, or something
 *  inside a folder that is. The same reading the notes get; a list of papers is a
 *  handful, so the list is walked here rather than the path's own ancestors. */
function leftOut(relative: string, excluded: readonly string[]): boolean {
  return excluded.some((one) => relative === one || relative.startsWith(`${one}/`))
}

/** What the papers of one space answer, as the rows the panel draws.
 *
 *  A row carries its page rather than a line, which is what says it is a paper: the
 *  panel opens it there, and a paper has no lines to go to. */
export function searchPapers(
  root: string,
  query: Query,
  limit: number,
  excluded: readonly string[] = [],
): Hit[] {
  if (!held.size || limit <= 0) return []

  const matcher = new Matcher(query)
  const out: Hit[] = []
  const inside = root.endsWith('/') ? root : `${root}/`

  for (const [path, paper] of held) {
    if (out.length >= limit) break
    if (!path.startsWith(inside)) continue

    const relative = path.slice(inside.length)
    if (leftOut(relative, excluded)) continue

    const name = relative.split('/').pop() ?? relative

    for (const [page, body] of [...paper.pages].sort((one, other) => one[0] - other[0])) {
      if (out.length >= limit) break
      if (!body.trim()) continue

      const spans = matcher.spans({ path, relative, name, body })
      if (!spans) continue

      // A page answers once: it is one place in the paper, and a row per word
      // found on it would be a page of rows about one page.
      const first = spans[0]
      const { text, at } = first
        ? windowOf(body, first.from)
        : { text: body.slice(0, WINDOW).trim(), at: -1 }

      const length = first ? first.to - first.from : 0
      out.push({
        path,
        name,
        page,
        // A paper has no lines. Nothing reads this for a paper - the page is what
        // opens one - and zero is what a row with no line says.
        line: 0,
        text,
        ranges: at >= 0 && length > 0 ? [{ from: at, to: at + length }] : [],
      })
    }
  }

  return out
}

/** For the tests: nothing read, as at launch. What is in the store stays there,
 *  which is what the store is for. */
export function forgetPapers(): void {
  held.clear()
  hydrated = null
  writing.cancel()
}
