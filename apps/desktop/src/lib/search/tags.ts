/** Every tag a note uses, once per use, and where each one sits in it.
 *
 *  One rule, four readers: the tag tree under an empty search field, the `tag:`
 *  operator, the browser's stand-in for `space_tags`, and renaming a tag across
 *  a space. The Rust side keeps the twin of this in tags.rs, and the tests hold
 *  the two to the same answers.
 *
 *  A tag is written two ways, which is Obsidian's pair and so what a file
 *  written by either app says. Inline, `#work/nib`: a heading is not one because
 *  it has a space after the hash and a tag never does, a tag starts a word, and
 *  its name is not all digits, which is what rules out `#42`. And in the
 *  front matter, under `tags:`, as a list on the line or as items under it,
 *  where the hash is optional because YAML would read it as a comment.
 *
 *  A tag's slashes make it a path: `work/nib/canvas` sits under `work/nib`,
 *  which sits under `work`, to any depth. Nothing here knows that - a tag is one
 *  string to this module - but tag-tree.ts and the `tag:` operator both read the
 *  slashes, so the characters that may appear in one are what decides how deep a
 *  tree can go. */

import { CodeBlocks, WORDS } from '@orden/markdown/fences'
import { type FrontMatterBlock, frontMatterBlock } from '@orden/markdown/front-matter'
import { codeSpans, inCode, TAG_NAME, tagAt } from '@orden/markdown/tags'

/** Where one use of a tag sits: the offsets of its name, the hash not included,
 *  so a rename splices a new path in and leaves whatever hung off the old one. */
export interface TagUse {
  /** The name as written, without the hash. */
  tag: string
  from: number
  to: number
}

/** What a tag's name may hold: the grammar `@orden/markdown` reads tags with. */
const NAME = new RegExp(`^${TAG_NAME}$`, 'u')

/** A hash; whether it opens a tag, and how long its name is, is `tagAt`'s to say. */
const HASH = /#/g

/** `tags:` or `tag:` at the left margin of the front matter, and what follows
 *  it on the line. Both spellings, because Obsidian takes both. */
const KEY = /^tags?:(.*)$/i

/** One item of a list written under its key. */
const ITEM = /^\s*-\s*(.*?)\s*$/

/** One value inside a written-out list: `[a, b]`, `a, b` and `a b` all read. */
const VALUE = /[^\s,[\]'"]+/g

/** Every use of every tag in the note, in the order they appear. */
export function tagUses(body: string): TagUse[] {
  const out: TagUse[] = []
  const front = frontMatterBlock(body)

  if (front) readFront(body, front, out)
  readInline(body, front, out)

  return out
}

/** Every tag a note uses, once per use, with the hash. What the counts and the
 *  `tag:` operator read. */
export function tagsIn(body: string): string[] {
  return tagUses(body).map((use) => `#${use.tag}`)
}

/** Where `path` and everything under it sits in the note, as the span of the
 *  `path` part alone. `#work/nib/canvas` answers with the span of `work/nib`
 *  when asked about `work/nib`, so writing another path over it keeps the
 *  `/canvas` that hung off it.
 *
 *  Folded, because the operator is: a note that wrote `#Work/Nib` is under the
 *  same node of the tree as one that wrote `#work/nib`, and a rename has to
 *  reach both. */
export function tagSpans(body: string, path: string): { from: number; to: number }[] {
  const wanted = path.toLowerCase()
  if (!wanted) return []

  return tagUses(body)
    .filter((use) => {
      const folded = use.tag.toLowerCase()
      return folded === wanted || folded.startsWith(`${wanted}/`)
    })
    .map((use) => ({ from: use.from, to: use.from + wanted.length }))
}

/** Where `path` and everything under it has to be cut from to be gone: the hash
 *  as well as the name, the space that was holding the tag apart from its
 *  neighbours, and, for a tag written as an item of the front matter list, the
 *  whole line it was the whole of.
 *
 *  A tag taken out of a sentence should leave the sentence reading as it did,
 *  which is what the widening is for: `words #tag words` has to come back as
 *  `words words` rather than with two spaces in the middle of it. */
export function tagCuts(body: string, path: string): { from: number; to: number }[] {
  const wanted = path.toLowerCase()
  if (!wanted) return []

  const out: { from: number; to: number }[] = []

  for (const use of tagUses(body)) {
    const folded = use.tag.toLowerCase()
    if (folded !== wanted && !folded.startsWith(`${wanted}/`)) continue

    out.push(widened(body, use))
  }

  return out
}

/** One use, grown out to what taking it away has to remove.
 *
 *  A tag sits between separators, and a tag taken out has to take one of them
 *  with it or leave the note saying `words  words` or `[, other]`. Which side is
 *  eaten is whichever side there is one on, the following comma first, because
 *  that is the one a list would otherwise be left holding. */
function widened(body: string, use: TagUse): { from: number; to: number } {
  const hash = body.charAt(use.from - 1) === '#' ? use.from - 1 : use.from
  // The marks round a tag they are the whole of go with it: `~~#todo~~` taken
  // away is nothing, not a `~~~~` that would open a fence.
  const marks = pairOf(body, hash, use.to)
  const from = hash - marks
  const to = use.to + marks
  const line = body.lastIndexOf('\n', from - 1) + 1
  const end = body.indexOf('\n', to)
  const after = end === -1 ? body.length : end

  // A list item that held nothing but this tag is a line with nothing left to
  // say, so the line goes with it.
  if (/^\s*-\s*$/.test(body.slice(line, from)) && body.slice(to, after).trim() === '') {
    return { from: line, to: end === -1 ? body.length : end + 1 }
  }

  // The comma this tag was in front of, and the space after it.
  if (body.charAt(to) === ',') {
    return { from, to: to + 1 + spaces(body, to + 1, after) }
  }

  // Or the separator behind it: the space, and the comma the space followed.
  const before = /(,?[ \t]+|,)$/.exec(body.slice(line, from))
  if (before) return { from: from - before[0].length, to }

  // Or, for a tag that opened its line, the space in front of what follows it.
  return { from, to: to + spaces(body, to, after) }
}

/** How many marks of emphasis, strike or highlight stand on both sides of
 *  `from`..`to`, the same ones mirrored, or 0. */
function pairOf(body: string, from: number, to: number): number {
  let count = 0
  while (
    from - count > 0 &&
    '*_~='.includes(body.charAt(from - count - 1)) &&
    body.charAt(from - count - 1) === body.charAt(to + count)
  ) {
    count++
  }
  return count
}

/** How many spaces or tabs run from `at`, without leaving the line. */
function spaces(body: string, at: number, stop: number): number {
  let over = 0
  while (at + over < stop && /[ \t]/.test(body.charAt(at + over))) over++
  return over
}

/** The tags under a `tags:` key, whether they are on its line or in items
 *  beneath it. Where the block sits is the one reader every other part of the app
 *  reads it with; see `frontMatterBlock` in @orden/markdown. */
function readFront(body: string, front: FrontMatterBlock, out: TagUse[]) {
  let at = front.body.from

  while (at > 0 && at < front.close) {
    const end = body.indexOf('\n', at)
    const stop = end === -1 || end > front.close ? front.close : end
    // A CRLF line's `\r`, which `KEY` cannot match, ends past every name.
    const line = body.slice(at, stop).replace(/\r$/, '')
    const found = KEY.exec(line)

    if (found) {
      const [, rest = ''] = found
      // What is on the key's own line, then whatever items follow it.
      readValues(at + line.length - rest.length, rest, out)
      at = readItems(body, stop + 1, front, out)
      continue
    }

    if (end === -1) break
    at = end + 1
  }
}

/** The `- item` lines under a key, stopping at the first line that is not one.
 *  Answers where it stopped, so the caller reads on from there. */
function readItems(body: string, from: number, front: FrontMatterBlock, out: TagUse[]): number {
  let at = from

  while (at > 0 && at < front.close) {
    const end = body.indexOf('\n', at)
    const stop = end === -1 || end > front.close ? front.close : end
    const line = body.slice(at, stop).replace(/\r$/, '')
    const item = ITEM.exec(line)
    if (!item) return at

    const [, value = ''] = item
    readValues(at + line.indexOf(value), value, out)
    if (end === -1) return front.close
    at = end + 1
  }

  return at
}

/** Every name in a written-out value, at the offsets it holds in the note. */
function readValues(from: number, text: string, out: TagUse[]) {
  for (const found of text.matchAll(VALUE)) {
    const [whole] = found

    // The hash is optional here, because YAML reads one as a comment; a value
    // that has one is the same tag as a value that has not.
    const hashed = whole.startsWith('#')
    const name = hashed ? whole.slice(1) : whole
    if (!NAME.test(name)) continue

    const at = from + found.index + (hashed ? 1 : 0)
    out.push({ tag: name, from: at, to: at + name.length })
  }
}

/** Every `#tag` in the note's own words. The front matter is left out of this
 *  pass: a hash there is a YAML comment, and the tags it holds have been read
 *  already. Code is left out too, fenced or indented, where a `#` is a comment or a heading
 *  in some other language, and so is inline code, which shows what is in it as
 *  written. A code span runs on across the lines of a paragraph, so the spans are
 *  cut a block at a time. Raw HTML and autolinks, which CommonMark reads before a
 *  backtick, are not looked for: a backtick in an attribute can hide a tag. */
function readInline(body: string, front: FrontMatterBlock | null, out: TagUse[]) {
  for (const [from, to] of blocksOf(body, front ? front.to : 0)) {
    const block = body.slice(from, to)
    if (!block.includes('#')) continue

    const code = codeSpans(block)
    for (const found of block.matchAll(HASH)) {
      const at = found.index
      if (inCode(code, at)) continue
      const name = tagAt(block, at)
      if (name === null) continue

      // Past the hash, so the span is the name.
      const start = from + at + 1
      out.push({ tag: name, from: start, to: start + name.length })
    }
  }
}

/** A line that opens a block of its own, which no code span reaches into: a list
 *  item, a quote or a heading. */
const OPENS_BLOCK = /^ {0,3}(?:(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)|>|#{1,6}(?:[ \t]|$))/

/** A heading, which is one line long. */
const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/

/** Where each block of words from `at` on starts and ends: a paragraph's lines, a
 *  list item's or a heading's. A blank line, a line of code and a line that opens
 *  a block end one, and code is in none. What is code is judged as the renderer
 *  judges it, fences in quotes and list items and indented code included; see
 *  `CodeBlocks` in @orden/markdown's fences.ts. */
function blocksOf(body: string, at: number): [number, number][] {
  const out: [number, number][] = []
  const code = new CodeBlocks()
  let start = -1

  while (at <= body.length) {
    const end = body.indexOf('\n', at)
    const stop = end === -1 ? body.length : end
    const line = body.slice(at, stop)
    const words = code.line(line) === WORDS
    const blank = line.trim() === ''

    if (start !== -1 && (!words || blank || OPENS_BLOCK.test(line))) {
      out.push([start, at - 1])
      start = -1
    }
    if (words && !blank) {
      if (start === -1) start = at
      if (HEADING.test(line)) {
        out.push([start, stop])
        start = -1
      }
    }

    if (end === -1) break
    at = end + 1
  }
  if (start !== -1) out.push([start, body.length])
  return out
}
