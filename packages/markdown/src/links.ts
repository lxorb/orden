/** The links between notes, as syntax rather than as HTML.
 *
 *  One place for the grammar, because four parts of Orden read it: the editor
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
 *  Imported on its own - `@orden/markdown/links` - by the editor, which wants the
 *  grammar and not the renderer that stands on it. */

import { closingTicks, CodeBlocks, WORDS } from './fences'
import { frontMatterBlock } from './front-matter'

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
  /** Which line it is on, counting from zero.
   *
   *  Carried out of here because this already knows it: the walk that finds the
   *  links goes down the note line by line and has the number in hand. A caller
   *  that wanted it used to count the newlines before the link instead, which is a
   *  pass down the note per link - four hundred megabytes read for a four hundred
   *  kilobyte note with a thousand links in it. See scan-note.perf.test.ts in the
   *  app, and `link.line = index` in links.rs, which is the same answer on the
   *  disk side. */
  line: number
}

/** Everything between the brackets of a wikilink, in one piece. `[` and `]` are
 *  not among it: Obsidian ends the link at the first `]`, and so does this.
 *
 *  Exported because the renderer's own wikilink extension matches the same thing
 *  anchored at the start of what is left, and two spellings of "between the
 *  brackets" would be two grammars. */
export const WIKILINK_INNER = '[^[\\]\\n]+'

/** `[[…]]`, or `![[…]]`, read from just past its `[[`. A `[` after a backslash is passed
 *  over by the walk in `collect`, which is what makes `\\[[Note]]` text: a backslash
 *  escapes the bracket in markdown, and a link nobody wrote must not be rewritten when a
 *  note is renamed. */
const WIKILINK = new RegExp(`(${WIKILINK_INNER})\\]\\]`, 'y')

/** How far a `[label](target)` may run before it is not one. A label is a phrase and
 *  a target is a path, so this is room and then some, and it is what keeps the walk
 *  over a line linear: a `[` that opens nothing moves the walk on by one character,
 *  so a scan to the end of the line is one per `[` on it. The same number as
 *  `LONGEST_LINK` in apps/desktop/src-tauri/src/links.rs. */
const LONGEST_LINK = 1000

/** How deep a target's parentheses may go, which is cmark's own limit. */
const DEEPEST_PARENS = 32

const BLANK = /\s/

/** Whether a character is one `\s` matches, without asking it about the printable ones:
 *  this is asked of every character of a target, of every bracket that opens one. */
function endsTarget(one: string): boolean {
  return (one <= ' ' || one >= '\u0080') && BLANK.test(one)
}

/** One `[label](target)` on a line, and where its parts are. */
interface MarkdownLink {
  label: string
  /** The target as written, its `<>` left off. */
  written: string
  writtenFrom: number
  /** Just past the closing parenthesis. */
  to: number
}

/** The `]` that closes the label each `[` of a line opens, for those that open one. A
 *  label holds balanced brackets and escaped ones, as in CommonMark. A bracket pair that
 *  opens a link of its own means the brackets around it open none, since links do not
 *  nest; `[[` is a wikilink's.
 *
 *  One pass over the line rather than a scan from each `[`: `a[` over a megabyte, which
 *  is one line of a note somebody shared, was a thousand characters read per bracket.
 *  Exported to say so in a test; the twin is `label_ends` in links.rs. */
export function labelEnds(line: string): Map<number, number> {
  const ends = new Map<number, number>()
  const open: number[] = []

  for (let at = 0; at < line.length; at++) {
    const one = line[at]
    if (one === '\\') {
      at++
    } else if (one === '[') {
      if (line[at - 1] === '[' || line[at + 1] === '[') open.length = 0
      if (line[at + 1] !== '[') open.push(at)
    } else if (one === ']') {
      const from = open.pop()
      if (from === undefined) continue
      ends.set(from, at)
      if (line[at + 1] === '(') open.length = 0
    }
  }

  return ends
}

/** Just past a bare target starting at `from`, which ends at a blank or at a `)` it did
 *  not open. -1 when its parentheses do not balance. */
function bareTargetEnd(line: string, from: number, stop: number): number {
  let depth = 0
  let at = from

  while (at < stop) {
    const one = line[at] ?? ''
    if (endsTarget(one)) break
    if (one === '\\') {
      at += 2
      continue
    }
    if (one === '(' && ++depth > DEEPEST_PARENS) return -1
    if (one === ')') {
      if (depth === 0) break
      depth--
    }
    at++
  }

  return at < stop && depth === 0 ? at : -1
}

/** The `[label](target)` opened by the `[` at `open`, with an optional `"title"` and an
 *  optional `<>` around a target that has spaces in it. Only the shape is read here;
 *  whether the target names a note rather than the web is decided by `isNoteTarget`.
 *
 *  The twin of `markdown_link` in apps/desktop/src-tauri/src/links.rs. By hand rather
 *  than a pattern, because a target's parentheses and a label's brackets balance. */
function markdownLinkAt(
  line: string,
  open: number,
  ends: ReadonlyMap<number, number>,
): MarkdownLink | null {
  const stop = Math.min(line.length, open + LONGEST_LINK)
  const skipBlanks = (from: number) => {
    let at = from
    while (at < stop && endsTarget(line[at] ?? '')) at++
    return at
  }

  const close = ends.get(open)
  if (close === undefined || close >= stop || line[close + 1] !== '(') return null

  let at = skipBlanks(close + 2)
  let writtenFrom = at
  let writtenTo: number

  if (line[at] === '<') {
    writtenFrom = at + 1
    writtenTo = writtenFrom
    while (writtenTo < stop && line[writtenTo] !== '>' && line[writtenTo] !== '<') writtenTo++
    if (writtenTo >= stop || line[writtenTo] !== '>') return null
    at = writtenTo + 1
  } else {
    writtenTo = bareTargetEnd(line, at, stop)
    if (writtenTo <= at) return null
    at = writtenTo
  }

  at = skipBlanks(at)
  const quote = line[at]
  if (quote === '"' || quote === "'") {
    at = line.indexOf(quote, at + 1) + 1
    if (at === 0 || at >= stop) return null
    at = skipBlanks(at)
  }

  if (at >= stop || line[at] !== ')') return null

  return {
    label: line.slice(open + 1, close),
    written: line.slice(writtenFrom, writtenTo),
    writtenFrom,
    to: at + 1,
  }
}

/** How many links one note is read for. Far past any note anybody writes - a map of
 *  content points at a few hundred things - and a bound on what one file can cost
 *  every surface that renders it. The crate keeps the same number; see `MOST_LINKS`
 *  in apps/desktop/src-tauri/src/links.rs. */
export const MOST_LINKS = 5000

/** A block's name: `^abc123` at the end of it, on its own or after a space. */
const BLOCK_ID = /(?:^|[ \t])\^([A-Za-z0-9-]+)[ \t]*(?=\r?$)/

/** The scheme a target names, or the empty string when it names none. `//host`
 *  counts as naming one, since a browser reads it as the page's own scheme. */
function schemeOf(target: string): string {
  if (target.startsWith('//')) return 'https'
  return /^([a-z][a-z\d+.-]*):/i.exec(target)?.[1]?.toLowerCase() ?? ''
}

/** A name to compare: composed, as APFS compares, so a typed `Ü` finds the `U` and
 *  combining mark some Mac tools name a file with; then folded. */
export function foldName(name: string): string {
  return name.normalize('NFC').toLowerCase()
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

/** Whether a target names a canvas: the plane of notes and cards Obsidian keeps
 *  in a `.canvas` file, which Orden reads and writes as JSON Canvas 1.0. Like a
 *  PDF it is a file rather than a note, so `[[Board.canvas]]` carries the
 *  extension the way `[[paper.pdf]]` does. */
export function isCanvasTarget(target: string): boolean {
  return /\.canvas$/i.test(target.trim())
}

/** Whether a target names a base: Obsidian's `.base` file, a view of the notes
 *  and tasks of a space (docs/tasks.md 5.11). A file rather than a note, so
 *  `[[Bugs.base]]` carries its extension, and `![[Bugs.base#Board]]` names one of
 *  its views the way a heading is named. */
export function isBaseTarget(target: string): boolean {
  return /\.base$/i.test(target.split('#')[0]?.trim() ?? '')
}

/** Whether a target names a chat: its `.chat` pointer (docs/chats.md 4.2). */
export function isChatTarget(target: string): boolean {
  return /\.chat$/i.test(target)
}

/** Whether a target names an application: its `.application` file (docs/apps.md). */
export function isApplicationTarget(target: string | null): boolean {
  return target !== null && /\.application$/i.test(target)
}

/** Whether a target names an online terminal: its `.term` file
 *  (docs/online-terminal.md 4.5). */
export function isTermTarget(target: string | null): boolean {
  return target !== null && /\.term$/i.test(target)
}

/** Whether a target names a page note: pages of paper written on with a pen, which
 *  Orden keeps in a `.pages` file.
 *
 *  The bytes are a canvas's bytes - JSON Canvas 1.0, one reader, one writer; see
 *  canvas.ts - and the extension is what says which surface opens it and which
 *  panel goes beside it. Two extensions rather than one because the only thing both
 *  ends of a file can see is its name: a tab, a room and a Durable Object all ask
 *  the name what a file is, and a flag inside the JSON would be a question none of
 *  them could ask without reading the file first. */
export function isPagesTarget(target: string): boolean {
  return /\.pages$/i.test(target.trim())
}

/** Whether a target names a website: a shortcut file, which Orden opens as a page in
 *  a tab rather than as words.
 *
 *  Two extensions because two systems already wrote them, and neither is Orden's.
 *  `.url` is the Windows Internet Shortcut - an INI file with an address in it,
 *  which is what Explorer and every browser make when a page is dragged out onto
 *  the desktop - and it is the one Orden writes. `.webloc` is the same idea on macOS,
 *  a plist, which is what Safari makes; Orden reads one and never writes one. See
 *  `@orden/scan/shortcut`. */
export function isWebTarget(target: string): boolean {
  return /\.(url|webloc)$/i.test(target.trim())
}

/** The extensions a picture is written in. `apng` and `ico` are here because a
 *  browser draws them and somebody's notes may hold one. */
const IMAGE = /\.(a?png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i

/** Whether a target names a picture rather than a note, which `![[…]]` embeds as
 *  an image the way `![](…)` does.
 *
 *  Beside the other two kind questions for the same reason they are here: one
 *  reading of a name, so the editor drawing an embed, the renderer writing an
 *  `<img>` and the file list marking a row all agree on what a picture is. */
export function isImageTarget(target: string): boolean {
  return IMAGE.test(target.trim())
}

/** The extensions sound is written in, as far as a browser plays them. `m4a` and
 *  `aac` are the two a phone records into, `opus` and `oga` what a voice memo
 *  turns up as, and `flac` because somebody's notes hold one. */
const AUDIO = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|weba)$/i

/** And moving pictures. `webm` is a container either can be in, and it is in
 *  both lists' spirit but only one of them: what people put in a `.webm` is a
 *  film, and `.weba` is the spelling that says otherwise. `.ogg` goes the other
 *  way for the same reason - it has meant sound since before `.ogv` existed. */
const VIDEO = /\.(mp4|m4v|webm|mov|ogv|mkv|avi)$/i

/** Whether a target names sound rather than a note, which `![[…]]` embeds as a
 *  player the way `![[pic.png]]` embeds a picture. */
export function isAudioTarget(target: string): boolean {
  return AUDIO.test(target.trim())
}

/** Whether a target names a film. */
export function isVideoTarget(target: string): boolean {
  return VIDEO.test(target.trim())
}

/** What kind of thing a `![[…]]` names, which is the whole of what any surface
 *  needs to know to show one. `null` for a note, which is the only kind whose
 *  content has to be read before it can be shown.
 *
 *  One question answered once, because five places ask it: the editor drawing a
 *  block, the editor drawing an inline embed, the renderer writing the markup,
 *  the export deciding what it can carry, and the glasses naming it. Adding a
 *  kind here is what makes it appear on all five. */
export type EmbedKind = 'image' | 'audio' | 'video' | 'pdf' | 'canvas' | 'base'

export function embedKind(target: string): EmbedKind | null {
  if (isImageTarget(target)) return 'image'
  // Before sound, so a container in both lists is read as the one it usually
  // holds; the two lists say which way each of those goes.
  if (isVideoTarget(target)) return 'video'
  if (isAudioTarget(target)) return 'audio'
  if (isPdfTarget(target)) return 'pdf'
  if (isCanvasTarget(target)) return 'canvas'
  if (isBaseTarget(target)) return 'base'

  return null
}

/** Whether a target names a file the app opens in a tab of its own rather than a
 *  note: a PDF, a canvas, a page note, a website, or a base.
 *
 *  These behave alike everywhere a link is read. All resolve through the
 *  files of the space rather than its notes, because a file has no headings and
 *  nothing to be told apart by except its extension; all are followed to the
 *  file itself; and a link to one the space does not hold is a link to nothing,
 *  never a reason to make a note under that name.
 *
 *  Not to be confused with `isNoteTarget`, which asks something else entirely:
 *  whether a target points inside the space at all rather than out at the web. */
export function isTabFile(target: string): boolean {
  return (
    isPdfTarget(target) ||
    isCanvasTarget(target) ||
    isPagesTarget(target) ||
    isWebTarget(target) ||
    isBaseTarget(target)
  )
}

/** Obsidian writes how wide to draw an embed after the bar: `![[pic.png|300]]`,
 *  or `![[pic.png|300x200]]`. Anything else after the bar is what the thing is,
 *  the way alt text is in markdown. */
const SIZE = /^(\d+)(?:x(\d+))?$/

/** The size an embed's alias asks for, or null when the alias is words. Here so
 *  the editor drawing a picture and the renderer writing one agree, down to
 *  which of the two `300x200` means. */
export function embedSize(alias: string | null): { width: number; height: number | null } | null {
  const found = alias === null ? null : SIZE.exec(alias)
  // A width of nothing is a picture nobody would see, which is no thing to ask for.
  if (found && Number(found[1]) === 0) return null
  if (!found) return null

  const height = found[2]
  return { width: Number(found[1]), height: height === undefined ? null : Number(height) }
}

/** The size at the end of a markdown picture's words, where Obsidian writes it:
 *  `![a cat|300](a.png)`, or `![|100x200](a.png)`, its bar escaped in a table. */
export function sizedAlt(alt: string): {
  alt: string
  size: { width: number; height: number | null } | null
} {
  const found = /^(.*?)\\?\|(\d+(?:x\d+)?)$/su.exec(alt)
  const size = found ? embedSize(found[2] ?? '') : null
  return found && size ? { alt: found[1] ?? '', size } : { alt, size: null }
}

/** The page a fragment names, or null when it names none.
 *
 *  `[[paper.pdf#page=3]]` is Obsidian's spelling and also the one a browser's own
 *  PDF viewer reads, so the same link works in Orden, in Obsidian and on a
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
  // `\|` is how a table cell writes the bar, and its backslash names nothing.
  const named = bar === -1 ? inner : inner.slice(0, bar).replace(/\\$/, '')
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

/** The characters a wikilink cannot hold in a name: `#` and `^` open a fragment, `|` an
 *  alias, and a bracket ends the link. Obsidian refuses all five in a link for the same
 *  reason, though a file may be named with them, so a link to such a file is a markdown
 *  link, which both apps read; see link-format.ts in the app. */
const NOT_IN_WIKILINK = /[#^[\]|]/

/** Whether `[[name]]` would read as something other than a link to `name`. */
export function wikilinkCannotName(name: string): boolean {
  return NOT_IN_WIKILINK.test(name)
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
 *  offsets still line up while `[[Note]]` inside backticks is left alone. Exported
 *  beside `lines` for the server's reading of which pictures a note shows, which has
 *  to step over the same code; see services/sync/src/pictures.ts. */
export function withoutCode(line: string): string {
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
    const close = closingTicks(line, openEnd, marks.length)

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
    // A note that says where it points five thousand times has said it; see
    // `MOST_LINKS`. The reading stops rather than the walk, because every caller
    // holds what comes back: a note arrives from a share, a room, a folder somebody
    // synced or a page somebody clipped, and one megabyte of `[[A]]` is two hundred
    // thousand of these objects for one file. The same ceiling the space-wide index
    // in src-tauri/src/links.rs keeps, for the same reason.
    if (found.length >= MOST_LINKS) break
    if (!row.code) collect(withoutCode(row.text), row.from, row.line, found)
  }

  return found.length > MOST_LINKS ? found.slice(0, MOST_LINKS) : found
}

/** One line of some markdown, and whether it is code. */
export interface Row {
  text: string
  /** Where the line starts in the whole text. */
  from: number
  /** Which line it is, counting from zero. */
  line: number
  /** True inside a fence, and on both of its delimiters: neither a link nor a
   *  block name can live in any of those. */
  code: boolean
  /** True on the front matter's lines: YAML, where `#` opens no heading. */
  matter: boolean
  /** The name on a closing fence, as an older build wrote it: see `fenceName`. */
  fenceName: string | null
}

/** Every line of some markdown, so the walks here do not each carry their own
 *  fence state. Exported for the one walk outside this file that has to agree with
 *  these about which lines are code: what an agent's anchor names in a note, which
 *  has to be what a link names; see apps/desktop/src/lib/agents/docs/anchors.ts.
 *
 *  Walked with indexOf rather than split, because this runs over every note in a
 *  space: a large note should not be copied into an array of lines only to be
 *  thrown away again.
 *
 *  Which lines are code is `CodeBlocks` in fences.ts, the reading the renderer
 *  agrees with and the tag and comment walks share. A block closes on its own
 *  mark and nothing else: a line of tildes inside a backtick block is code being
 *  shown, and reading it as the end of the block took the rest of the note for
 *  prose. A fence inside a quote or a list item, and code indented with no fence,
 *  are code as well. The Rust twin is `prose_lines` in src-tauri/src/links.rs,
 *  which fills the desktop's index at launch, so the two read the same links. */
export function* lines(text: string): Generator<Row> {
  const code = new CodeBlocks()
  // The front matter's lines, up to its closing fence, are words and not walked: the
  // page leaves the block out, so a fence in a YAML value opens no code below it.
  const matter = frontMatterBlock(text)
  const wordsAt = matter ? matter.close + 1 : 0
  let line = 0
  let at = 0

  for (;;) {
    const end = text.indexOf('\n', at)
    const row = text.slice(at, end === -1 ? text.length : end)

    const matters = at < wordsAt
    const isCode = !matters && code.line(row) !== WORDS
    yield {
      text: row,
      from: at,
      line,
      code: isCode,
      matter: matters,
      fenceName: isCode ? code.closedName : null,
    }

    if (end === -1) break
    at = end + 1
    line++
  }
}

export function rowsOf(text: string): Row[] {
  return [...lines(text)]
}

/** The links on one line of prose, added in the order they were written. One walk over
 *  its brackets, as `links_on` in links.rs walks them: whichever link opens first has the
 *  line up to its end, so `[x]([[a]])` is a link to `[[a]]` and `[[\\]](x)` a wikilink. */
function collect(line: string, offset: number, at: number, found: FoundLink[]) {
  if (!line.includes('[')) return
  // No `](`, no markdown link, and that is nearly every line with a bracket on it.
  const ends = line.includes('](') ? labelEnds(line) : new Map<number, number>()

  for (let open = line.indexOf('['); open !== -1; open = line.indexOf('[', open + 1)) {
    if (line[open - 1] === '\\') continue

    // A backslash in front of the bang escapes the bang and leaves the link.
    const embed = line[open - 1] === '!' && line[open - 2] !== '\\'
    const from = offset + (embed ? open - 1 : open)

    if (line[open + 1] === '[') {
      WIKILINK.lastIndex = open + 2
      const inner = WIKILINK.exec(line)?.[1]
      if (inner === undefined) continue

      const link = parseWikilink(inner, embed)
      const closed = open + 2 + inner.length + 2
      if (link) {
        // Where the target sits: past the `!`, the `[[`, and any space trimmed off
        // the front of it.
        const targetFrom = offset + open + 2 + (inner.length - inner.trimStart().length)
        found.push({
          ...link,
          kind: 'wikilink',
          from,
          to: offset + closed,
          targetFrom,
          targetTo: targetFrom + link.target.length,
          line: at,
        })
      }
      open = closed - 1
      continue
    }

    const link = markdownLinkAt(line, open, ends)
    if (!link) continue

    const { written, writtenFrom, label } = link
    open = link.to - 1
    if (!isNoteTarget(written)) continue

    const hash = written.indexOf('#')
    const target = hash === -1 ? written : written.slice(0, hash)
    const fragment = hash === -1 ? '' : decodeFragment(written.slice(hash + 1))
    if (!target && !fragment) continue

    const targetFrom = offset + writtenFrom
    // `#^a1b2c3` names a block in a markdown link exactly as in a wikilink, which
    // is how Obsidian writes one and how Orden writes one when the Links setting
    // asks for markdown links; see link-format.ts in the app.
    const block = fragment.startsWith('^') ? fragment.slice(1) : null

    found.push({
      target: decodeTarget(target),
      heading: block === null ? fragment || null : null,
      block,
      alias: label,
      embed,
      kind: 'markdown',
      from,
      to: offset + link.to,
      targetFrom,
      targetTo: targetFrom + target.length,
      line: at,
    })
  }
}

/** One or more percent escapes in a row: how a heading's words are written in a link
 *  when they hold a space or a character a URL cannot. */
const ESCAPES = /(?:%[0-9A-Fa-f]{2})+/g

/** The UTF-8 a run of escapes is read as. Not fatal, so a run that is not valid
 *  encoding comes out as replacement characters rather than as an error. */
const UTF8 = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true })

/** A backslash and the punctuation it escapes, or a run of percent escapes. */
const WRITTEN = /\\([!-/:-@[-`{-~])|(?:%[0-9A-Fa-f]{2})+/g

/** The same UTF-8, for a name: a run that is not valid encoding is no name at all. */
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

function bytesOf(run: string): Uint8Array {
  return Uint8Array.from(run.slice(1).split('%'), (hex) => Number.parseInt(hex, 16))
}

/** A markdown target as the name it stands for: `My%20Note.md` is a link to
 *  `My Note.md` and `C%23.md` a link to `C#.md`, and a rename has to recognise each as
 *  one. Every escape is undone, which `decodeURI` does not do for the characters a URL
 *  reserves, so the link the app writes to `C#.md` reads back as that note. A `%` that
 *  begins no escape is a `%`; a target that is not valid encoding is taken as written.
 *  The twin of `decode` in apps/desktop/src-tauri/src/links.rs.
 *
 *  Split a target from its `#fragment` before reading it: what comes out may hold a
 *  `#` of its own. */
export function decodeTarget(target: string): string {
  try {
    return target.replace(WRITTEN, (run, mark?: string) => mark ?? STRICT_UTF8.decode(bytesOf(run)))
  } catch {
    return target
  }
}

/** A path as a markdown target: the characters a browser or an editor would
 *  otherwise read as something else. `#` opens a fragment and a space ends the
 *  target, and a `)` (`1) Intro.pdf`) ends the link, so those are written out. */
export function encodeTarget(path: string): string {
  return encodeURI(path).replace(/[#?()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

/** The `#fragment` of a link as the words it names. What a note writes in a link is
 *  a URL, so `Some%20Heading` is `Some Heading` and `Why%3F` is `Why?`: every escape
 *  is undone, which `decodeURI` does not do for the characters a URL reserves. A `%`
 *  that does not begin an escape is taken as written. */
export function decodeFragment(fragment: string): string {
  return fragment.replace(ESCAPES, (run) => UTF8.decode(bytesOf(run)))
}

/** The name a block link points at, when a line ends by naming one.
 *
 *  Asked of every line of every note, and of every visible line on every
 *  keystroke by the live preview, so a line with no caret in it at all is
 *  answered by a byte scan rather than by the pattern. Nearly every line is one:
 *  this was the second-most-run pattern in the preview. */
export function blockIdOf(line: string): string | null {
  if (!line.includes('^')) return null
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
const HEADING = /^\s{0,3}(#{1,6})\s+(.*)\r?$/

/** A heading line and everything after its hashes, which is either nothing or a
 *  blank and then the words. `#` alone is an empty heading and `#Title` is not a
 *  heading at all, which is what CommonMark says of both. */
const HEADING_LINE = /^[ \t]{0,3}#{1,6}((?:[ \t].*)?)\r?$/

/** A closing run of hashes, which needs a blank in front of it to be one.
 *
 *  Without the blank, `# C# and F#` lost its last character: the hash there is a
 *  letter of the name rather than the end of the heading. */
const CLOSING_HASHES = /[ \t]+#+[ \t]*$/

/** The words a heading line shows: its opening hashes gone, and the closing ones
 *  gone as well. A line that is not a heading comes back as its own words.
 *
 *  Here with the grammar because it decides what `[[Note#Heading]]` can name. The
 *  editor reads a heading the same way - it draws the note's table of contents and
 *  writes a link to a heading - so both come through this. */
export function headingText(line: string): string {
  const found = HEADING_LINE.exec(line)
  if (found === null) return line.trim()

  return (found[1] ?? '').replace(CLOSING_HASHES, '').trim()
}

/** Every heading in a note, in order, as the words it shows. What a link may
 *  point at inside a note, which is why it lives here rather than with the
 *  outline: the browser's stand-in for the link scanner reads it, and so does the
 *  slice below, and the two have to agree on what counts as a heading. */
export function headingsOf(text: string): string[] {
  const found: string[] = []

  for (const row of lines(text)) {
    if (row.code) continue
    if (HEADING.test(row.text)) found.push(headingText(row.text))
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

  const code = new CodeBlocks()
  let start = -1
  let level = 0

  for (const [index, line] of lines.entries()) {
    if (code.line(line) !== WORDS) continue

    const hashes = HEADING.exec(line)?.[1]
    if (!hashes) continue

    const title = headingText(line)

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
  if (ownLine(lines[found.line] ?? '') && !(lines[found.line - 1] ?? '').trim()) {
    return blockAbove(source, lines, found.line)
  }

  let start = found.line
  let end = found.line
  while (start > 0 && (lines[start - 1] ?? '').trim()) start--
  while (end + 1 < lines.length && (lines[end + 1] ?? '').trim()) end++

  const block = lines.slice(start, end + 1)
  block[found.line - start] = (lines[found.line] ?? '').replace(BLOCK_ID, '')

  return block.join('\n').trimEnd()
}

/** Whether a line holds a block's name and nothing else. */
export function ownLine(line: string): boolean {
  return line.trim().startsWith('^') && blockIdOf(line.trim()) === line.trim().slice(1)
}

/** The block a name on a line of its own stands under, past the blank lines between
 *  them and whatever blank lines a fence holds. */
function blockAbove(source: string, lines: readonly string[], under: number): string {
  const rows = rowsOf(source)
  let end = under - 1
  while (end > 0 && !(lines[end] ?? '').trim()) end--

  let start = end
  while (start > 0 && ((lines[start - 1] ?? '').trim() || rows[start - 1]?.code)) start--

  return lines
    .slice(start, end + 1)
    .join('\n')
    .trimEnd()
}

/** A name no block in the note has yet. Six characters of base 36, which is two
 *  billion names: short enough to read in the middle of a sentence, and it is
 *  only ever compared against the names in one note.
 *
 *  Beside the grammar that reads these rather than beside either of the two
 *  places that write one - the editor, naming a block somebody asked for a link
 *  to, and the app, naming one in a note that is not open - so both give out the
 *  same kind of name. */
export function freeBlockId(taken: ReadonlySet<string>): string {
  for (;;) {
    const id = Math.random().toString(36).slice(2, 8)
    if (id.length === 6 && !taken.has(id)) return id
  }
}

/** Every block name in a note, with the line it sits on, counting from zero.
 *  Inside a fence a `^word` is code, so fences are skipped here as well. */
export function blockIds(text: string): { id: string; line: number }[] {
  const found: { id: string; line: number }[] = []

  for (const row of lines(text)) {
    const id = row.code ? row.fenceName : blockIdOf(row.text)
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

    // A name on a line of its own is the block above's.
    const above = current ? null : found.at(-1)
    if (above && !row.code && ownLine(row.text)) {
      above.id = blockIdOf(row.text)
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
  return replacingBlockIds(text, (kept) => kept)
}

/** The same with each name written over, so every offset in the note stays what it was.
 *  In tabs, since two blanks at the end of a line of words break the line; in blanks on a
 *  closing fence, the one thing a fence closes with. */
export function blockIdsBlanked(text: string): string {
  return replacingBlockIds(
    text,
    (kept, length, row) => kept + (row.code ? ' ' : '\t').repeat(length),
  )
}

/** Around a block's name while a page is rendered. */
const ANCHOR_OPEN = '\uE0F0'
const ANCHOR_CLOSE = '\uE0F1'

/** A table's own line under its head. */
const TABLE_RULE = /^\s*\|?[\s:|-]+\|?\s*$/

/** The same with each name left as a mark `blockAnchorsDrawn` makes an id of, on the lines
 *  `holds` says a mark can stand on: `line` is the line's number, the words what is left
 *  of it. After a blank, so what closes an emphasis is still at the end of a word, and
 *  inside a table row's last cell, since another cell would be dropped. A name on its own
 *  line is a blank line once it is gone, so it goes at the end of the words above and
 *  leaves that blank, or where there are none, stands alone above it. */
export function blockIdsAnchored(
  text: string,
  holds: (line: number, words: string) => boolean,
): string {
  return replacingBlockIds(text, (kept, _length, row, id) => {
    const words = kept.slice(kept.lastIndexOf('\n') + 1)
    if (row.code || !holds(row.line, words) || TABLE_RULE.test(words)) return kept
    const mark = `${ANCHOR_OPEN}${id}${ANCHOR_CLOSE}`
    const after = (held: string) =>
      /\|\s*$/.test(held) ? held.replace(/\|\s*$/, `${mark} |`) : `${held} ${mark}`
    if (words.trim() !== '') return after(kept)
    const start = kept.length - words.length - 1
    const above = start < 0 ? '' : kept.slice(kept.lastIndexOf('\n', start - 1) + 1, start)
    if (above.trim() === '') return `${kept}${mark}\n${words}`
    if (!holds(row.line - 1, above) || TABLE_RULE.test(above)) return kept
    const carriage = kept[start - 1] === '\r' ? 1 : 0
    return `${after(kept.slice(0, start - carriage))}${kept.slice(start - carriage)}`
  })
}

/** Text with the marks of `blockIdsAnchored` gone, as they will be from any tag. */
export function blockMarksOff(text: string): string {
  if (!text.includes(ANCHOR_OPEN)) return text
  return text.replace(new RegExp(`\\s?${ANCHOR_OPEN}[\\w-]+${ANCHOR_CLOSE}`, 'g'), '')
}

/** The marks of `blockIdsAnchored` as the empty elements a page scrolls to. A mark inside a
 *  tag, in an attribute, goes as the name would have: nothing a tag says is a place. */
export function blockAnchorsDrawn(html: string): string {
  if (!html.includes(ANCHOR_OPEN)) return html
  const mark = `${ANCHOR_OPEN}([\\w-]+)${ANCHOR_CLOSE}`
  const anywhere = new RegExp(`\\s?${mark}`, 'g')
  const anchor = (id: string) => `<span id="^${id}"></span>`
  return (
    html
      // No further than the next tag opening, or `<a ` thirty thousand times is read to its
      // end from each one of them. A mark past a stray `<` in a tag is in the one it opens.
      .replace(/<[a-z/](?:"[^"]*"|'[^']*'|[^'"<>])*>/gi, (tag) => tag.replace(anywhere, ''))
      .replace(new RegExp(`<p>\\s*${mark}\\s*</p>`, 'g'), (_, id: string) => anchor(id))
      .replace(new RegExp(mark, 'g'), (_, id: string) => anchor(id))
  )
}

function replacingBlockIds(
  text: string,
  by: (kept: string, length: number, row: Row, id: string) => string,
): string {
  let out = ''
  let at = 0

  for (const row of lines(text)) {
    const id = row.code ? row.fenceName : blockIdOf(row.text)
    if (!id) continue

    const end = row.from + row.text.trimEnd().length
    const caret = end - id.length - 1
    // The space that separated it from the words goes with it.
    const before = text[caret - 1]
    const from = before === ' ' || before === '\t' ? caret - 1 : caret

    out += by(text.slice(at, from), end - from, row, id)
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
