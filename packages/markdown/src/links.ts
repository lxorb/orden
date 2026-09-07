/** The links between notes, as syntax rather than as HTML.
 *
 *  One place for the grammar, because four parts of Nib read it: the editor
 *  draws wikilinks and follows them, the renderer turns them into anchors for
 *  an export and for a published page, the app rewrites them when a note is
 *  renamed, and the sync service counts them for backlinks. Four readings of
 *  one grammar would drift, and the drift would show as a link that follows in
 *  the editor and comes out as plain text on the web.
 *
 *  Obsidian's spelling exactly, so a note moves between the two apps
 *  unchanged: `[[Note]]`, `[[Note|shown text]]`, `[[Note#Heading]]`,
 *  `[[Note#^blockid]]`, `![[Note]]` for the note's content rather than a link
 *  to it, and `^blockid` at the end of a paragraph to give it a name.
 *
 *  Imported on its own - `@nib/markdown/links` - by the editor, which wants the
 *  grammar and not the renderer that stands on it. */

/** What one link between notes says. */
export interface Wikilink {
  /** The note it names, as written: `Note`, `folder/Note` or `Note.md`. Empty
   *  for a link into the note it is written in, such as `[[#Heading]]`. */
  target: string
  /** The heading after `#`, or null when it names none. */
  heading: string | null
  /** The block after `#^`, or null. */
  block: string | null
  /** The words to show in place of the target, or null to show the target. */
  alias: string | null
  /** `![[…]]` rather than `[[…]]`: the note's content, not a link to it. */
  embed: boolean
}

/** How a link was written, which decides how a rename rewrites it. */
export type LinkKind = 'wikilink' | 'markdown'

/** One link found in some text, and where it sits. */
export interface FoundLink extends Wikilink {
  kind: LinkKind
  /** The whole link, from its `[` or `!` to just past its end. */
  from: number
  to: number
  /** Where `target` sits inside it, which is the only part a rename rewrites. */
  targetFrom: number
  targetTo: number
}

/** Everything between the brackets of a wikilink, in one piece. `[` and `]` are
 *  not among it: Obsidian ends the link at the first `]`, and so does this. */
const INNER = '[^[\\]\\n]+'

/** `[[…]]`, or `![[…]]`. The lookbehind is what makes `\[[Note]]` text: a
 *  backslash escapes the bracket in markdown, and a link nobody wrote must not
 *  be rewritten when a note is renamed. */
const WIKILINK = new RegExp(`(?<!\\\\)(!?)\\[\\[(${INNER})\\]\\]`, 'g')

/** `[label](target)`, with an optional `"title"` and an optional `<>` around a
 *  target that has spaces in it. Only the shape is matched here; whether the
 *  target names a note rather than the web is decided by `isNoteTarget`. */
const MARKDOWN_LINK =
  /(?<!\\)(!?)\[((?:[^[\]\\]|\\.)*)\]\(\s*(?:<([^<>\n]*)>|([^\s()]+))\s*(?:"[^"\n]*"|'[^'\n]*')?\s*\)/g

/** A fence opening or closing a code block. */
const FENCE = /^\s{0,3}(?:```|~~~)/

/** A block's name: `^abc123` at the end of it, on its own or after a space. */
const BLOCK_ID = /(?:^|[ \t])\^([A-Za-z0-9-]+)[ \t]*$/

/** The scheme a target names, or the empty string when it names none. `//host`
 *  counts as naming one, since a browser reads it as the page's own scheme. */
function schemeOf(target: string): string {
  if (target.startsWith('//')) return 'https'
  return /^([a-z][a-z\d+.-]*):/i.exec(target)?.[1]?.toLowerCase() ?? ''
}

/** Whether a markdown link's target points inside the space rather than out at
 *  the web. A `#fragment` on its own points inside the note it is written in,
 *  which counts: the Links panel lists it, and no rename touches it. */
export function isNoteTarget(target: string): boolean {
  return schemeOf(target) === ''
}

/** Whether a target names a PDF rather than a note. Here with the rest of the
 *  grammar because all four readers of a link have to agree: the editor follows
 *  `[[paper.pdf]]` to the file, the renderer links to it, the app opens it in a
 *  tab, and the index counts it as a link out. */
export function isPdfTarget(target: string): boolean {
  return /\.pdf$/i.test(target.trim())
}

/** The page a fragment names, or null when it names none.
 *
 *  `[[paper.pdf#page=3]]` is Obsidian's spelling and also the one a browser's own
 *  PDF viewer reads, so the same link works in Nib, in Obsidian and on a
 *  published page. A PDF has no headings to point at, so this is the only
 *  fragment one takes. Pages count from one; `#page=0` names nothing. */
export function pageFragment(fragment: string | null): number | null {
  const digits = fragment === null ? null : /^page=(\d+)$/i.exec(fragment.trim())?.[1]
  if (digits === undefined || digits === null) return null

  const page = Number(digits)
  return page >= 1 ? page : null
}

/** What is between the brackets, as a link. Null when it names nothing to point
 *  at: `[[]]`, or an alias with no target and no heading. */
export function parseWikilink(inner: string, embed = false): Wikilink | null {
  const bar = inner.indexOf('|')
  const named = bar === -1 ? inner : inner.slice(0, bar)
  // Everything after the first bar, so an alias may itself contain one.
  const alias = bar === -1 ? null : inner.slice(bar + 1).trim()

  const hash = named.indexOf('#')
  const target = (hash === -1 ? named : named.slice(0, hash)).trim()
  const fragment = hash === -1 ? '' : named.slice(hash + 1).trim()

  const block = fragment.startsWith('^') ? fragment.slice(1) : null
  const heading = block === null && fragment ? fragment : null

  if (!target && !heading && !block) return null

  // An empty alias is not an alias: `[[Note|]]` shows the target, so that
  // deleting the words after the bar reads as taking the alias away.
  return { target, heading, block, alias: alias === '' ? null : alias, embed }
}

/** The link back as source, which is what a rename writes. */
export function formatWikilink(link: Wikilink): string {
  const alias = link.alias === null ? '' : `|${link.alias}`
  return `${link.embed ? '!' : ''}[[${linkTarget(link)}${alias}]]`
}

/** The part before the bar: the note, and the heading or block inside it. */
export function linkTarget(link: Wikilink): string {
  if (link.block !== null) return `${link.target}#^${link.block}`
  if (link.heading !== null) return `${link.target}#${link.heading}`
  return link.target
}

/** The words a link shows: its alias, or the target as written. */
export function shownText(link: Wikilink): string {
  return link.alias ?? linkTarget(link)
}

/** Which part of the text between the brackets a reader sees, as offsets into
 *  it: the alias when there is one, the target as written otherwise, in both
 *  cases without the space around it.
 *
 *  The editor hides everything on either side of this, which is how `[[Note|a
 *  name]]` reads as `a name` while the caret is away and as itself when the
 *  caret is inside. Here rather than there because it is the same reading of
 *  the same grammar as `shownText` above, and the two must agree. */
export function shownSpan(inner: string): { from: number; to: number } {
  const bar = inner.indexOf('|')
  const aliased = bar !== -1 && inner.slice(bar + 1).trim() !== ''

  let from = aliased ? bar + 1 : 0
  let to = aliased ? inner.length : bar === -1 ? inner.length : bar

  while (from < to && isBlank(inner[from])) from++
  while (to > from && isBlank(inner[to - 1])) to--

  return { from, to }
}

function isBlank(character: string | undefined): boolean {
  return character === ' ' || character === '\t'
}

/** The same text with every code span blanked out, character for character, so
 *  offsets still line up while `[[Note]]` inside backticks is left alone. */
function withoutCode(line: string): string {
  let out = ''
  let at = 0

  while (at < line.length) {
    const tick = line.indexOf('`', at)
    if (tick === -1) {
      out += line.slice(at)
      break
    }

    // A span is closed by a run of backticks the same length as the one that
    // opened it, which is how `` ` `` holds a backtick.
    let openEnd = tick
    while (openEnd < line.length && line[openEnd] === '`') openEnd++
    const marks = line.slice(tick, openEnd)
    const close = line.indexOf(marks, openEnd)

    out += line.slice(at, tick)
    if (close === -1) {
      // Nothing closes it, so the backticks are text like anything else.
      out += line.slice(tick)
      break
    }

    out += ' '.repeat(close + marks.length - tick)
    at = close + marks.length
  }

  return out
}

/** Every link between notes in `text`, in the order they appear.
 *
 *  Code is skipped, both fenced blocks and inline spans: a `[[Note]]` written
 *  as an example is not a link, and renaming a note must not rewrite somebody's
 *  code sample. Links out at the web are skipped too - this is about the space. */
export function findLinks(text: string): FoundLink[] {
  const found: FoundLink[] = []

  for (const row of lines(text)) {
    if (!row.code) collect(withoutCode(row.text), row.from, found)
  }

  return found
}

/** One line of some markdown, and whether it is code. */
interface Row {
  text: string
  /** Where the line starts in the whole text. */
  from: number
  /** Which line it is, counting from zero. */
  line: number
  /** True inside a fence, and on both of its delimiters: neither a link nor a
   *  block name can live in any of those. */
  code: boolean
}

/** Every line of some markdown, so the three walks here do not each carry their
 *  own fence state.
 *
 *  Walked with indexOf rather than split, because this runs over every note in a
 *  space: a large note should not be copied into an array of lines only to be
 *  thrown away again. */
function* lines(text: string): Generator<Row> {
  let fenced = false
  let line = 0
  let at = 0

  for (;;) {
    const end = text.indexOf('\n', at)
    const row = text.slice(at, end === -1 ? text.length : end)
    const fence = FENCE.test(row)
    if (fence) fenced = !fenced

    yield { text: row, from: at, line, code: fenced || fence }

    if (end === -1) break
    at = end + 1
    line++
  }
}

/** The links on one line of prose, added in the order they were written. */
function collect(line: string, offset: number, found: FoundLink[]) {
  const here: FoundLink[] = []

  for (const match of line.matchAll(WIKILINK)) {
    const [whole, bang = '', inner = ''] = match
    const link = parseWikilink(inner, bang === '!')
    if (!link) continue

    const from = offset + match.index
    // Where the target sits: past the `!`, the `[[`, and any space trimmed off
    // the front of it.
    const openTo = from + bang.length + 2
    const targetFrom = openTo + (inner.length - inner.trimStart().length)

    here.push({
      ...link,
      kind: 'wikilink',
      from,
      to: from + whole.length,
      targetFrom,
      targetTo: targetFrom + link.target.length,
    })
  }

  for (const match of line.matchAll(MARKDOWN_LINK)) {
    const [whole, bang = '', label = '', angled, bare] = match
    const written = angled ?? bare ?? ''
    if (!isNoteTarget(written)) continue

    const hash = written.indexOf('#')
    const target = hash === -1 ? written : written.slice(0, hash)
    const fragment = hash === -1 ? '' : written.slice(hash + 1)
    if (!target && !fragment) continue

    const from = offset + match.index
    const targetFrom = from + whole.indexOf(written, label.length + bang.length + 2)

    here.push({
      target: decodeTarget(target),
      heading: fragment || null,
      block: null,
      alias: label,
      embed: bang === '!',
      kind: 'markdown',
      from,
      to: from + whole.length,
      targetFrom,
      targetTo: targetFrom + target.length,
    })
  }

  here.sort((one, other) => one.from - other.from)
  found.push(...here)
}

/** A markdown target as the name it stands for: `My%20Note.md` is a link to
 *  `My Note.md`, and a rename has to recognise it as one. A target that is not
 *  valid encoding is taken as written. */
function decodeTarget(target: string): string {
  try {
    return decodeURI(target)
  } catch {
    return target
  }
}

/** The name a block link points at, when a line ends by naming one. */
export function blockIdOf(line: string): string | null {
  return BLOCK_ID.exec(line)?.[1] ?? null
}

/** The id a heading gets, the way GitHub forms them: lowercase words joined
 *  with hyphens, letters of any script kept.
 *
 *  Here because it is what turns a heading into the thing a link points at:
 *  `[[Note#Some Heading]]` and `[x](Note.md#some-heading)` name the same place,
 *  and only one of the two spells it out. */
export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s+/g, '-') || 'section'
  )
}

/** A heading line, and the trailing hashes some styles close one with. */
const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/
const CLOSING_HASHES = /\s*#+\s*$/

/** Every heading in a note, in order, as the words it shows. What a link may
 *  point at inside a note, which is why it lives here rather than with the
 *  outline: the browser's stand-in for the link scanner reads it, and so does the
 *  slice below, and the two have to agree on what counts as a heading. */
export function headingsOf(text: string): string[] {
  const found: string[] = []

  for (const row of lines(text)) {
    if (row.code) continue
    const [, hashes = '', words = ''] = HEADING.exec(row.text) ?? []
    if (hashes) found.push(words.replace(CLOSING_HASHES, '').trim())
  }

  return found
}

/** The part of a note a link points into: the section under the heading it
 *  names, the block it names, or the whole note when it names neither. Null when
 *  the note has no such heading or block, which is a thing worth saying rather
 *  than showing an empty frame.
 *
 *  Here rather than in the editor because the same slice is needed wherever a
 *  note is read: an embed in the editor, an exported document, a published page. */
export function sectionOf(
  source: string,
  link: Pick<Wikilink, 'heading' | 'block'>,
): string | null {
  if (link.block !== null) return blockSection(source, link.block)
  if (link.heading !== null) return headingSection(source, link.heading)
  return source
}

/** From the heading down to the next one at its level or above it. */
function headingSection(source: string, wanted: string): string | null {
  const lines = source.split('\n')
  const needle = wanted.trim().toLowerCase()
  const slug = slugify(wanted)

  let fenced = false
  let start = -1
  let level = 0

  for (const [index, line] of lines.entries()) {
    if (FENCE.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue

    const [, hashes = '', text = ''] = HEADING.exec(line) ?? []
    if (!hashes) continue

    const title = text.replace(CLOSING_HASHES, '').trim()

    if (start === -1) {
      if (title.toLowerCase() === needle || slugify(title) === slug) {
        start = index
        level = hashes.length
      }
      continue
    }

    if (hashes.length <= level) return lines.slice(start, index).join('\n').trimEnd()
  }

  return start === -1 ? null : lines.slice(start).join('\n').trimEnd()
}

/** The block the name sits at the end of: the run of lines around it, with the
 *  name itself taken off, since it is a marker rather than a word of the text. */
function blockSection(source: string, wanted: string): string | null {
  const found = blockIds(source).find((one) => one.id === wanted)
  if (!found) return null

  const lines = source.split('\n')
  let start = found.line
  let end = found.line
  while (start > 0 && (lines[start - 1] ?? '').trim()) start--
  while (end + 1 < lines.length && (lines[end + 1] ?? '').trim()) end++

  const block = lines.slice(start, end + 1)
  block[found.line - start] = (lines[found.line] ?? '').replace(BLOCK_ID, '')

  return block.join('\n').trimEnd()
}

/** Every block name in a note, with the line it sits on, counting from zero.
 *  Inside a fence a `^word` is code, so fences are skipped here as well. */
export function blockIds(text: string): { id: string; line: number }[] {
  const found: { id: string; line: number }[] = []

  for (const row of lines(text)) {
    if (row.code) continue
    const id = blockIdOf(row.text)
    if (id) found.push({ id, line: row.line })
  }

  return found
}

/** One block of a note: a run of lines with blank ones around it. */
export interface NoteBlock {
  /** The line it starts on, counting from zero. */
  line: number
  /** Its first line as words, so a list of blocks can be read: the markup that
   *  opens the line and the name at the end of the block are both left off,
   *  since neither is something the block says. */
  text: string
  /** The name it already carries, or null for a block nothing links to yet. */
  id: string | null
}

/** How much of a block's first line is worth showing in a list of them. */
const BLOCK_LABEL = 80

/** Every block of a note, in order. What the editor offers after `#^`, where
 *  picking a block that has no name is what gives it one. */
export function blocksOf(text: string): NoteBlock[] {
  const found: NoteBlock[] = []
  let current: NoteBlock | null = null

  for (const row of lines(text)) {
    if (!row.code && row.text.trim() === '') {
      current = null
      continue
    }

    if (!current) {
      current = { line: row.line, text: firstWords(row.text), id: null }
      found.push(current)
    }

    if (row.code) continue
    const id = blockIdOf(row.text)
    if (id) current.id = id
  }

  return found
}

/** The same markdown with the block names taken out.
 *
 *  `^abc123` at the end of a block is a marker for a link to point at, not a
 *  word of the note, so nothing that shows a note shows it: not an export, not a
 *  published page, not an embed. The editor hides it the way it hides any other
 *  syntax mark, and brings it back when the caret is on its line. */
export function withoutBlockIds(text: string): string {
  let out = ''
  let at = 0

  for (const row of lines(text)) {
    if (row.code) continue

    const id = blockIdOf(row.text)
    if (!id) continue

    const end = row.from + row.text.trimEnd().length
    const caret = end - id.length - 1
    // The space that separated it from the words goes with it.
    const before = text[caret - 1]
    const from = before === ' ' || before === '\t' ? caret - 1 : caret

    out += text.slice(at, from)
    at = end
  }

  return at === 0 ? text : out + text.slice(at)
}

/** A block's first line as words: the heading hashes, the bullet, the quote mark
 *  and a name at the end all taken off. */
function firstWords(line: string): string {
  return line
    .replace(BLOCK_ID, '')
    .replace(/^\s*>?\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)?/, '')
    .trim()
    .slice(0, BLOCK_LABEL)
}
