/** What a note knows about itself, written the way nib writes it.
 *
 *  Dates are the reason this exists. Every one of these exports knows when each
 *  note was written, and the moment it is imported every file on disk says it
 *  was written today: an import is a thousand files all made at once, and the
 *  file's own timestamps are the import's from then on. So what the export knew
 *  goes into the note, where it survives sync, a copy and another import.
 *
 *  `date` is the key nib already reads - an export uses it for the document's
 *  date - and it holds the day the note was made. `updated` is only written when
 *  the export knew a different last-edited day, and it is the export's own fact
 *  rather than a feature: nothing in the app reads it, and a note that never
 *  changed after it was written does not carry it. */

import {
  frontMatterBlock,
  frontMatterKeys,
  type FrontMatterRow,
  writeFrontMatter,
} from '@nib/markdown/front-matter'
import { TAG_NAME } from '@nib/markdown/tags'

export interface Meta {
  /** The day it was made, `YYYY-MM-DD`. */
  date?: string | null
  /** The day it was last edited, when that is a different day. */
  updated?: string | null
  tags?: readonly string[]
  /** Anything else the export carried under its own name: a database's columns,
   *  the address a page came from. A column that held numbers, a yes-or-no or a
   *  list of pages is written as one; everything else as the words it said. */
  extra?: readonly (readonly [string, Property])[]
}

/** What one of those holds. */
export type Property = FrontMatterRow[1]

/** A front matter block, or nothing at all when there is nothing to say. Which
 *  rows there are is decided here - only what the export knew - and how each value
 *  is spelled is @nib/markdown/front-matter's, shared with a web tab's clip so that a
 *  clipped page and an imported note say the same thing the same way. */
export function frontMatterFor(meta: Meta): string {
  const rows: FrontMatterRow[] = []

  if (meta.date) rows.push(['date', meta.date])
  if (meta.updated && meta.updated !== meta.date) rows.push(['updated', meta.updated])

  const { tags, words } = tagList(meta.tags ?? [])
  if (tags.length) rows.push(['tags', tags])
  if (words.length) rows.push(['labels', words])

  // Two properties that come out as one key - `Status` and `status`, or a `Date`
  // beside the note's own date - would be one key written twice, which is front
  // matter no reader takes at all, so the second steps aside under a name of its
  // own. A name with nothing in it to keep, a `⭐`, is called after its place
  // rather than left out with its value.
  const taken = new Set(rows.map(([key]) => key))
  for (const [at, [key, value]] of (meta.extra ?? []).entries()) {
    if (said(value)) rows.push([freeKey(propertyName(key) || `property-${at + 1}`, taken), value])
  }

  const written = writeFrontMatter(rows)
  return written ? `${written}\n\n` : ''
}

/** Whether a value says anything: a blank one is not written, a `false` is. */
function said(value: Property): boolean {
  if (typeof value === 'string') return value.trim() !== ''
  if (typeof value === 'number' || typeof value === 'boolean') return true
  return value.length > 0
}

/** A whole note: its properties, its title as a heading, and its words.
 *
 *  The heading is written because a new note in nib opens with one, so an
 *  imported note that did not carry a title would be the one note in the space
 *  with nothing at the top. A body that already opens with a heading keeps its
 *  own.
 *
 *  A body that already opens with properties of its own - a Bear note or a Logseq
 *  page somebody gave a block - keeps that block as the one the note opens with,
 *  and what the export knew goes into it, under the keys it does not say already:
 *  a second block under the first would be words to every reader, the note's own
 *  keys among them, and the heading goes below it rather than above it.
 *
 *  Only `own` words are asked, the Markdown a person wrote in a format that can
 *  carry a block. Words an import made itself, out of a web page, a note in XML or
 *  a JSON, never open with one: a `---` there is a rule (an `<hr>`), and a rule, a
 *  `Note: a draft` and another rule are words. */
export function noteText(title: string | null, body: string, meta: Meta = {}, own = false): string {
  // Only the blank lines above the words go: the first line's own indent is what
  // makes a note that opens with an indented code block open with code.
  const all = body.replace(/^(?:[ \t]*\r?\n)+/, '').replace(/\s+$/, '')
  const block = own ? ownBlock(all) : null
  const words = block ? all.slice(block.to).replace(/^(?:[ \t]*\r?\n)+/, '') : all
  const heads = /^#{1,6}\s/.test(words)
  const head = title && !heads ? `# ${title}\n\n` : ''
  const props = block ? `${withMeta(all, block.close, meta)}\n\n` : frontMatterFor(meta)

  return `${props}${head}${words}${words ? '\n' : ''}`
}

/** A key's line, as @nib/markdown/front-matter reads one: an unindented line up to
 *  its first colon with a blank or nothing after it. */
const KEY_LINE = /^[^\s#-].*?[ \t]*:(?:\s|$)/

/** A key's line, a line under one, a list's item or a comment: what a block of
 *  properties is made of. */
const BLOCK_LINE = new RegExp(`${KEY_LINE.source}|^(?:[ \\t]|-(?:\\s|$)|#)`)

/** The block of properties a body opens with, or null where it opens with anything
 *  else. Two `---` lines are not enough: a note may open with a rule, a paragraph
 *  and another rule. A block is the fence with a key on the line right under it,
 *  as every app writes one, and nothing between the fences but lines a block is
 *  made of; a rule is followed by a blank line or by words. */
function ownBlock(body: string): ReturnType<typeof frontMatterBlock> {
  const block = frontMatterBlock(body)
  if (!block) return null

  const lines = body.slice(block.body.from, block.body.to).split(/\r?\n/)
  if (!KEY_LINE.test(lines[0] ?? '')) return null
  return lines.every((line) => !line.trim() || BLOCK_LINE.test(line)) ? block : null
}

/** A note's own block with the rows of `meta` it does not say added in front of
 *  its closing fence, and up to that fence: a key in another case is the same key,
 *  since that is how the app reads one (see @nib/markdown/front-matter). */
function withMeta(note: string, close: number, meta: Meta): string {
  const says = new Set(frontMatterKeys(note).map((key) => key.toLowerCase()))
  const nl = note.includes('\r\n') ? '\r\n' : '\n'
  // Every row is written on one line, its key up to the first colon.
  const added = frontMatterFor(meta)
    .split('\n')
    .slice(1)
    .filter((line) => line.includes(': ') && !says.has(line.split(': ')[0]?.toLowerCase() ?? ''))

  const fence = note.slice(close).split(/\r?\n/)[0] ?? '---'
  return `${note.slice(0, close)}${added.map((line) => `${line}${nl}`).join('')}${fence}`
}

/** A note's words as the app that kept them wrote them, to the byte. The blank
 *  lines above them stay, because a `---` that is not on the first line is a rule
 *  and not properties, and so does every line ending, a Windows one included. Only
 *  a last line ending is added where there was none, of the note's own kind. */
export function keptText(body: string): string {
  if (!body || body.endsWith('\n')) return body
  return `${body}${body.includes('\r\n') ? '\r\n' : '\n'}`
}

/** A property name YAML will read as one word, for a column called
 *  `Last edited time`. Letters of every script are letters: a column called
 *  `Größe` or `期限` keeps its name rather than losing it, and with it the
 *  column. */
export function propertyName(key: string): string {
  return key
    .replace(/[^\p{L}\p{M}\p{N}_ /-]+/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
}

/** The key wanted, or the first of `key-2`, `key-3` and on that is not taken yet,
 *  and taken from then on. */
export function freeKey(wanted: string, taken: Set<string>): string {
  let key = wanted
  for (let step = 2; taken.has(key); step += 1) key = `${wanted}-${step}`
  taken.add(key)
  return key
}

/** What a tag's name may hold: the grammar the app reads a tag with, a letter, a
 *  mark, a digit or an emoji, then those and `-`, `_` and `/`, and never only
 *  digits. */
const TAG = new RegExp(`^${TAG_NAME}$`, 'u')

/** What another app called a label, as a tag nib can hold: no spaces, no hash in
 *  front, and the slashes kept, because a nested tag is a nested tag in both. A
 *  character the app's tags cannot hold is a hyphen; one they can, an accent
 *  written as a mark or a `🔥`, stays. */
export function tagName(label: string): string {
  return tidied(label.replace(/[^\p{L}\p{M}\p{N}\p{Extended_Pictographic}\s/_-]+/gu, '-'))
}

/** A label with its blanks as hyphens and its hash off, and nothing else changed. */
function tidied(label: string): string {
  return label
    .trim()
    .replace(/^#+/, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/\/{2,}/g, '/')
}

/** A note's labels as tags, and the words of the ones that cannot be one.
 *
 *  Only blanks and a hash in front are what a label loses on its way to a tag.
 *  One that would lose more - `C++` and `C#`, which would both be `C`, or `2026`,
 *  which is no tag at all - is not made into a tag it never was, nor left out:
 *  its words are kept under `labels`, as it was written. */
function tagList(labels: readonly string[]): { tags: string[]; words: string[] } {
  const tags: string[] = []
  const words: string[] = []

  for (const label of labels) {
    const name = tagName(label)
    const said = label.trim()
    if (name && name === tidied(label) && TAG.test(name)) {
      if (!tags.includes(name)) tags.push(name)
    } else if (said && !words.includes(said)) {
      words.push(said)
    }
  }

  return { tags, words }
}

/** The day a date lands on, `YYYY-MM-DD`, out of whichever shape the export
 *  wrote it in. Null for anything that is not a date, so nothing invents one.
 *
 *  Every format in here writes its own: Evernote stamps `20260101T120000Z`,
 *  Keep counts microseconds since 1970, Roam counts milliseconds, Notion writes
 *  it out in English, and the rest write ISO. */
export function dayOf(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null

  if (typeof value === 'number' || /^\d{10,19}$/.test(value)) {
    const count = Number(value)
    if (!Number.isFinite(count) || count <= 0) return null
    // Seconds, milliseconds and microseconds, told apart by how many digits it
    // takes to be a date anybody has notes from.
    const digits = Math.floor(Math.abs(count)).toString().length
    const millis = digits <= 10 ? count * 1000 : digits <= 13 ? count : count / 1000
    return dayAt(new Date(millis))
  }

  const compact = /^(\d{4})(\d{2})(\d{2})T\d{6}Z?$/.exec(value)
  if (compact) return dayFrom(Number(compact[1]), Number(compact[2]), Number(compact[3]))

  const written = /^(\d{4})[-_/](\d{1,2})[-_/](\d{1,2})/.exec(value)
  if (written) return dayFrom(Number(written[1]), Number(written[2]), Number(written[3]))

  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : dayAt(new Date(parsed))
}

/** The day an instant falls on where the reader is, rather than in UTC. A note
 *  written at eleven at night is that evening's note, and that is the date the
 *  app it came out of showed on it. */
function dayAt(when: Date): string | null {
  if (Number.isNaN(when.getTime())) return null
  return dayFrom(when.getFullYear(), when.getMonth() + 1, when.getDate())
}

/** A day written out, or null for one no note was written on. The range is what
 *  says a number was a date at all: an export with a zero in a timestamp field
 *  would otherwise arrive as the first of January 1970 on a thousand notes. */
function dayFrom(year: number, month: number, day: number): string | null {
  if (year < 1970 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null

  const written = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return `${year}-${written}`
}
