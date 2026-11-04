/** A note as blocks and spans, which is what every export that is not HTML
 *  stands on.
 *
 *  TXT, RTF and Word each need the same reading of the note - a heading is a
 *  heading, a run is bold or it is not, a table has three columns - and none of
 *  them can get that out of HTML without parsing it back. So the note is read
 *  once, through the same grammar the renderer uses, into the plainest shape
 *  that still says everything: blocks in order, each carrying spans.
 *
 *  Pure. Nothing here reads a disk or a window, so every writer built on it is
 *  testable on the note alone. */

import {
  documentTitle,
  frontMatterValue,
  hardBreaks,
  lexMarkdown,
  type Wikilink,
  withoutComments,
} from '@orden/markdown'
import { calloutOf } from '@orden/markdown/callouts'
import { coverOf } from '@orden/markdown/cover'
import { stripFrontMatter } from '@orden/markdown/front-matter'
import { embedKind, embedSize, shownText, withoutBlockIds } from '@orden/markdown/links'
import type { Token, Tokens } from 'marked'
import { stemOf } from './naming'

/** A run of text, and everything that can be true of it at once. Absent means
 *  no: a span carries only the marks it actually has, which keeps the shape a
 *  test asserts on small. */
export interface Span {
  text: string
  bold?: boolean
  italic?: boolean
  strike?: boolean
  code?: boolean
  mark?: boolean
  /** Which of the six palette tones a `==highlight==` was written in - `1` for the
   *  red one and so on, exactly as highlights.ts in @orden/markdown numbers them.
   *  Absent for the plain highlight, which named no colour of its own and is drawn
   *  the way it always was; only meaningful beside `mark`. */
  tone?: number
  sup?: boolean
  sub?: boolean
  /** Where it points, for a link. */
  href?: string
  /** The picture it stands for, with `text` as the words under it. */
  picture?: string
  /** TeX, written between single dollars. */
  maths?: boolean
  /** The label of the footnote it refers to. */
  note?: string
}

export type Align = 'left' | 'center' | 'right' | null

export interface Item {
  spans: Span[]
  /** What sits under the item's own line: a nested list, a second paragraph. */
  blocks: Block[]
  /** `[x]`, `[ ]`, or not a task at all. */
  checked: boolean | null
}

export interface Entry {
  term: Span[]
  details: Span[][]
}

export type Block =
  | { kind: 'heading'; level: number; spans: Span[] }
  | { kind: 'paragraph'; spans: Span[] }
  | { kind: 'code'; language: string; code: string }
  | { kind: 'maths'; tex: string }
  | { kind: 'quote'; label: string | null; blocks: Block[] }
  | { kind: 'list'; ordered: boolean; start: number; items: Item[] }
  | { kind: 'table'; align: Align[]; head: Span[][]; rows: Span[][][] }
  | { kind: 'terms'; entries: Entry[] }
  | { kind: 'rule' }
  | { kind: 'break' }

interface Footnote {
  label: string
  spans: Span[]
}

/** A whole note, ready for a writer. */
export interface Doc {
  title: string
  /** Whether the note named itself, in its front matter or in its first heading,
   *  rather than borrowing the name of the file it is in.
   *
   *  What decides whether a writer prints the title as a line of the document. A
   *  name the note never claimed is already on the file, and putting it at the
   *  top of the text would be a word nobody wrote. */
  named: boolean
  author: string | null
  lang: string
  date: string | null
  blocks: Block[]
  /** The footnote definitions, in the order they were defined. */
  notes: Footnote[]
}

/** The `page-break` divs Typora writes, and the `---` a note may use for one.
 *  Recognised so a writer that has pages can start one. */
const PAGE_BREAK = /page-break-(?:after|before)\s*:\s*always/i

interface Marks {
  bold?: boolean
  italic?: boolean
  strike?: boolean
  mark?: boolean
  tone?: number
  sup?: boolean
  sub?: boolean
  href?: string
}

/** The spans a list of inline tokens comes to, with the marks of everything
 *  around them already folded in. */
function spansOf(tokens: readonly Token[] | undefined, marks: Marks = {}): Span[] {
  const out: Span[] = []
  /** The element in the line being passed over: its words are not shown. */
  let passing: string | null = null
  for (const token of tokens ?? []) {
    if (token.type === 'html') {
      const [, closing, written] = /^<(\/?)([a-z][\w-]*)/i.exec(token.raw.trim()) ?? []
      const name = written?.toLowerCase()
      if (passing !== null) {
        if (closing && name === passing) passing = null
        continue
      }
      if (name && !closing && !token.raw.trimEnd().endsWith('/>')) {
        if (NOT_SHOWN.test(name) || HIDDEN.test(token.raw)) {
          passing = name
          continue
        }
      }
    }
    if (passing === null) out.push(...spansOfToken(token, marks))
  }

  // An empty run says nothing, so it goes - but a picture and a footnote mark
  // both carry what they mean somewhere other than in their text.
  return out.filter(
    (span) => span.text !== '' || span.picture !== undefined || span.note !== undefined,
  )
}

function spansOfToken(token: Token, marks: Marks): Span[] {
  const inner = (extra: Marks = {}) =>
    spansOf((token as Tokens.Generic).tokens, { ...marks, ...extra })

  switch (token.type) {
    case 'strong':
      return inner({ bold: true })
    case 'em':
      return inner({ italic: true })
    case 'del':
      return inner({ strike: true })
    // The tone comes off the token as the number it is; see highlights.ts in
    // @orden/markdown. Absent for the plain highlight, so a span carries only the
    // marks it actually has.
    case 'highlight':
      return inner(
        typeof token.tone === 'number' ? { mark: true, tone: token.tone } : { mark: true },
      )
    case 'superscript':
      return inner({ sup: true })
    case 'subscript':
      return inner({ sub: true })

    case 'link': {
      const link = token as Tokens.Link
      const spans = spansOf(link.tokens, { ...marks, href: link.href })
      return spans.length ? spans : [{ ...marks, href: link.href, text: link.href }]
    }

    case 'image': {
      const image = token as Tokens.Image
      // The words under a picture: its alt text, or its title where it has no
      // alt. Both are strings that may be empty, which is why neither is a
      // nullish fallback.
      const words = image.text === '' ? (image.title ?? '') : image.text
      return [{ ...marks, text: words, picture: image.href }]
    }

    case 'codespan':
      return [{ ...marks, code: true, text: (token as Tokens.Codespan).text }]

    case 'inlineMath':
      return [{ ...marks, maths: true, text: String(token.text ?? '') }]

    case 'footnoteRef':
      return [{ ...marks, note: String(token.id ?? ''), text: '' }]

    case 'wikilink':
    case 'embed': {
      const link = token.link as Wikilink | undefined
      // A document has no space around it, so a wikilink reads as the words it
      // showed - the same answer the HTML export gives.
      return [{ ...marks, text: link ? shownText(link) : token.raw }]
    }

    case 'br':
      return [{ ...marks, text: '\n' }]

    case 'html':
      // A tag in a line is markup, and the words around it are tokens of their own. A
      // line break is the one that says something, and in a table cell the only way to.
      return /^<br\s*\/?>$/i.test(token.raw.trim()) ? [{ ...marks, text: '\n' }] : []

    case 'text':
    case 'escape':
    case 'emoji': {
      const nested = (token as Tokens.Generic).tokens
      if (nested?.length) return spansOf(nested, marks)
      return [{ ...marks, text: String((token as Tokens.Generic).text ?? '') }]
    }

    default: {
      const nested = (token as Tokens.Generic).tokens
      if (nested?.length) return spansOf(nested, marks)

      // A token this does not know may still carry words; anything that carries
      // none says nothing and comes to no span at all.
      const text: unknown = (token as Tokens.Generic).text
      return typeof text === 'string' ? [{ ...marks, text }] : []
    }
  }
}

/** Where an item's own words end and its nested blocks begin. A list item's
 *  tokens are `text` for the line it was written on and blocks for whatever was
 *  indented under it. */
function itemOf(token: Tokens.ListItem, notes: Footnote[]): Item {
  const own: Token[] = []
  const under: Token[] = []

  for (const child of token.tokens) {
    if (child.type === 'text' || child.type === 'paragraph') {
      if (own.length) under.push(child)
      else own.push(child)
    } else under.push(child)
  }

  return {
    spans: spansOf(own),
    blocks: blocksOf(under, notes),
    checked: token.task ? token.checked === true : null,
  }
}

function alignOf(value: string | null | undefined): Align {
  return value === 'left' || value === 'center' || value === 'right' ? value : null
}

/** A quote turned into a callout: what it is called, and its body with the
 *  marker line gone.
 *
 *  What a callout is comes from @orden/markdown/callouts, the one place that
 *  knows; only the cutting is here. Taken off the spans rather than off the
 *  source, because by the time a quote is read the marker is the first few
 *  characters of an inline token and cutting the string would leave the tokens
 *  around it describing the wrong offsets.
 *
 *  Across spans, not just the first one, since a title with a mark in it -
 *  `[!tip] **Mind** the gap` - is more than one span before the body starts. */
function callout(blocks: Block[]): { label: string | null; blocks: Block[] } {
  const first = blocks[0]
  if (first?.kind !== 'paragraph') return { label: null, blocks }

  if (!first.spans.length) return { label: null, blocks }

  // Read off all the spans joined rather than off the first one. A span carries
  // what is shown, so a title with a mark in it - `[!tip] **Mind** the gap` -
  // is several spans, and reading only the first would find half a title and
  // cut half a marker line off the body.
  const shown = first.spans.map((span) => span.text).join('')
  const found = calloutOf(shown)
  if (!found) return { label: null, blocks }

  const spans: Span[] = []
  let left = found.taken
  for (const span of first.spans) {
    if (left <= 0) {
      spans.push(span)
      continue
    }

    if (span.text.length <= left) {
      left -= span.text.length
      continue
    }

    spans.push({ ...span, text: span.text.slice(left) })
    left = 0
  }

  // A marker on a line of its own leaves nothing behind, and an empty paragraph
  // would print as a blank line under the label.
  const rest = spans.length ? [{ ...first, spans }, ...blocks.slice(1)] : blocks.slice(1)

  return { label: found.title || found.label, blocks: rest }
}

function blocksOf(tokens: readonly Token[], notes: Footnote[]): Block[] {
  const out: Block[] = []

  for (const token of tokens) {
    switch (token.type) {
      case 'space':
      case 'def':
      case 'abbrDef':
        break

      case 'footnoteDef':
        notes.push({
          label: String(token.id ?? ''),
          spans: spansOf(token.tokens),
        })
        break

      case 'heading': {
        const heading = token as Tokens.Heading
        out.push({ kind: 'heading', level: heading.depth, spans: spansOf(heading.tokens) })
        break
      }

      case 'paragraph': {
        const spans = spansOf((token as Tokens.Paragraph).tokens)
        if (spans.length) out.push({ kind: 'paragraph', spans })
        break
      }

      case 'text': {
        const spans = spansOf((token as Tokens.Generic).tokens)
        if (spans.length) out.push({ kind: 'paragraph', spans })
        else if (String((token as Tokens.Generic).text ?? '').trim()) {
          out.push({ kind: 'paragraph', spans: [{ text: String((token as Tokens.Generic).text) }] })
        }
        break
      }

      case 'code': {
        const fence = token as Tokens.Code
        out.push({ kind: 'code', language: fence.lang?.trim() ?? '', code: fence.text })
        break
      }

      case 'blockMath':
        out.push({ kind: 'maths', tex: String(token.text ?? '') })
        break

      // `![[…]]` with a line to itself. An embedded picture is a picture, which
      // is how one written `![](…)` reaches a document too - the writers here
      // read `span.picture` and know nothing of brackets. Everything else is a
      // name: a document has no space around it, so a note, a recording, a film,
      // a paper and a plane are all things it can only say the name of.
      //
      // Without this the paragraph fell to `default`, which finds the token has
      // no children and pushes no block at all: a line that vanished.
      case 'embed': {
        const link = token.link as Wikilink | undefined
        if (!link) break

        const named = embedSize(link.alias) === null ? (link.alias ?? '') : ''
        out.push({
          kind: 'paragraph',
          spans: [
            embedKind(link.target) === 'image'
              ? { text: named, picture: link.target }
              : { text: shownText(link) },
          ],
        })
        break
      }

      case 'blockquote': {
        const quote = token as Tokens.Blockquote
        const inside = callout(blocksOf(quote.tokens, notes))
        out.push({ kind: 'quote', label: inside.label, blocks: inside.blocks })
        break
      }

      case 'list': {
        const list = token as Tokens.List
        out.push({
          kind: 'list',
          ordered: list.ordered,
          start: typeof list.start === 'number' ? list.start : 1,
          items: list.items.map((item) => itemOf(item, notes)),
        })
        break
      }

      case 'table': {
        const table = token as Tokens.Table
        out.push({
          kind: 'table',
          align: table.align.map(alignOf),
          head: table.header.map((cell) => spansOf(cell.tokens)),
          rows: table.rows.map((row) => row.map((cell) => spansOf(cell.tokens))),
        })
        break
      }

      case 'definitionList':
        out.push({
          kind: 'terms',
          entries: (token.items as { term: Token[]; details: Token[][] }[]).map((entry) => ({
            term: spansOf(entry.term),
            details: entry.details.map((detail) => spansOf(detail)),
          })),
        })
        break

      case 'hr':
        out.push({ kind: 'rule' })
        break

      case 'html': {
        // A page break is the one piece of markup that means something to a writer, and
        // the words a block holds are words here too: every other surface shows them.
        const html = String((token as Tokens.Generic).text ?? '')
        if (PAGE_BREAK.test(html)) out.push({ kind: 'break' })
        for (const words of wordsOfHtml(html)) {
          // A break is a span of its own, as `br` is above.
          const spans = words
            .split('\n')
            .flatMap((text, at) => (at ? [{ text: '\n' }, { text }] : [{ text }]))
          out.push({ kind: 'paragraph', spans })
        }
        break
      }

      default: {
        const spans = spansOf((token as Tokens.Generic).tokens)
        if (spans.length) out.push({ kind: 'paragraph', spans })
        break
      }
    }
  }

  return out
}

/** Elements whose words are no words of the page: never drawn, or what a browser draws
 *  only where it cannot draw them. */
const NOT_SHOWN =
  /^(?:script|style|template|head|title|noscript|textarea|select|svg|canvas|object|video|audio|iframe|embed|dialog)$/i

/** What keeps an element off the page wherever it is. An open dialog is drawn. */
const HIDDEN =
  /\shidden(?:[\s=/>])|\sstyle\s*=\s*(?:"[^"]*display\s*:\s*none[^"]*"|'[^']*display\s*:\s*none[^']*')/i

/** Elements that have no end of their own. */
const VOID = /^(?:area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/i

/** Elements that start a line of their own. A cell does not: a row is the line. */
const STARTS_LINE =
  /^(?:address|article|aside|blockquote|center|dd|details|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|menu|nav|ol|p|pre|section|summary|table|tbody|tfoot|thead|tr|ul)$/i

/** Latin-1 from 160 on, in order, which is most of what a note names by name. */
const LATIN =
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml'

const ENTITIES = new Map<string, string>([
  ...LATIN.split(' ').map((name, at): [string, string] => [name, String.fromCodePoint(160 + at)]),
  ['nbsp', ' '],
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['ndash', '–'],
  ['mdash', '\u2014'],
  ['lsquo', '‘'],
  ['rsquo', '’'],
  ['sbquo', '‚'],
  ['ldquo', '“'],
  ['rdquo', '”'],
  ['bdquo', '„'],
  ['hellip', '…'],
  ['bull', '•'],
  ['euro', '€'],
  ['trade', '™'],
  ['larr', '←'],
  ['rarr', '→'],
  ['uarr', '↑'],
  ['darr', '↓'],
  ['minus', '−'],
  ['ne', '≠'],
  ['le', '≤'],
  ['ge', '≥'],
  ['dagger', '†'],
])

function entitiesRead(text: string): string {
  return text.replace(/&(?:#(\d+)|#x([\da-f]+)|(\w+));/gi, (whole, ten, hex, name: string) => {
    if (name) return ENTITIES.get(name) ?? whole
    const code = ten ? Number(ten) : Number.parseInt(String(hex), 16)
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
  })
}

/** The words of a block of raw HTML, a paragraph for each block element in it. No DOM,
 *  since this reading of a note is pure, and no more of HTML than where words are. */
function wordsOfHtml(html: string): string[] {
  const out: string[] = []
  let line = ''
  /** The element being passed over, and how many of its name are open inside it. */
  let skipping: { name: string; depth: number } | null = null
  let pre = 0
  let at = 0

  const read = (raw: string) => {
    if (skipping !== null) return
    line += entitiesRead(pre ? raw : raw.replace(/\s+/g, ' '))
  }
  const end = () => {
    const said = line.replace(/[ \t]*\n[ \t]*/g, '\n').trim()
    if (said) out.push(said)
    line = ''
  }

  for (const found of html.matchAll(
    /<!--[\s\S]*?(?:-->|$)|<[!?][^>]*>|<(\/?)([a-z][\w-]*)(?:"[^"]*"|'[^']*'|[^'">])*>/gi,
  )) {
    read(html.slice(at, found.index))
    at = found.index + found[0].length

    const [tag, closing, written = ''] = found
    if (!written) continue
    const name = written.toLowerCase()
    const alone = VOID.test(name) || tag.endsWith('/>')
    if (skipping !== null) {
      if (name === skipping.name && !alone) skipping.depth += closing ? -1 : 1
      if (skipping.depth === 0) skipping = null
      continue
    }
    const drawn = name === 'dialog' && /\sopen[\s=/>]/i.test(tag)
    if (!closing && (HIDDEN.test(tag) || (NOT_SHOWN.test(name) && !drawn))) {
      if (!alone) skipping = { name, depth: 1 }
    } else if (name === 'br') line += '\n'
    else if (STARTS_LINE.test(name)) {
      end()
      if (name === 'pre') pre += closing ? -1 : 1
    } else if (/^t[dh]$/.test(name) && !closing && line.trim()) line += ' '
  }
  read(html.slice(at))
  end()

  return out
}

/** What a document is called: the front matter's title, else the first heading,
 *  else the file's own name. Every export reads it from here - the running text
 *  on paper, the `<title>` of a page, the Word property, the ePub metadata - so
 *  one note cannot come out under two names. */
export function titleOf(source: string, name: string): string {
  return frontMatterValue(source, 'title') ?? documentTitle(source) ?? stemOf(name)
}

export interface DocumentOptions {
  /** Whether a single newline breaks the line. Left out, the app's own answer is
   *  used - the same one the reading view, a canvas card and a published page
   *  read - so a writer never has to remember to ask. A test passes it to say
   *  which answer it is about. */
  hardBreaks?: boolean
}

/** The note read into blocks. `name` is the file's, and stands in for a title
 *  when neither the front matter nor a first heading gives one. */
export function documentOf(source: string, name: string, options: DocumentOptions = {}): Doc {
  const notes: Footnote[] = []
  const hard = options.hardBreaks ?? hardBreaks()
  // Front matter is metadata, a block's name is a marker and a comment is a note
  // to the writer, exactly as the HTML renderer treats all three.
  const body = withoutComments(withoutBlockIds(stripFrontMatter(source)))

  // The note's cover, where it names one, as the document's first picture: the
  // banner is the top of the note, so a note whose cover is a photograph opens on
  // the photograph in Word as it does in the app. A picture like any other from
  // here on - `picturesIn` finds it, so it is read and embedded with the rest.
  const cover = coverOf(source)
  const banner: Block[] = cover
    ? [{ kind: 'paragraph', spans: [{ text: '', picture: cover.src }] }]
    : []

  const blocks = [...banner, ...flowed(blocksOf(lexMarkdown(body), notes), hard)]

  return {
    title: titleOf(source, name),
    named: frontMatterValue(source, 'title') !== null || documentTitle(source) !== null,
    author: frontMatterValue(source, 'author'),
    lang: frontMatterValue(source, 'lang') ?? 'en',
    date: frontMatterValue(source, 'date'),
    blocks,
    notes: notes.map((note) => ({ ...note, spans: flowedSpans(note.spans, hard) })),
  }
}

/** A paragraph's own line breaks, as the switch says they are.
 *
 *  Off - which is CommonMark, and the default - a paragraph hard wrapped in the
 *  file is one paragraph and a single newline in the middle of it is a space. That
 *  is what a browser does with it, so it is what the reading view, every published
 *  page and the HTML export already say, and `flowing` in @orden/glasses says the
 *  same out loud. These blocks are what Word, RTF and plain text are written from,
 *  and they kept the newline: a note wrapped at eighty columns arrived broken at
 *  eighty columns.
 *
 *  On, the note reads the way it was typed and the newline stays, which is what
 *  the one renderer already does for every other surface. A newline in a span is
 *  a line break to all three writers - Word's own `<w:br/>`, RTF's `\line`, and a
 *  newline in a plain text file - so keeping it is the whole of it.
 *
 *  The spaces around the newline go either way: they are the wrapping, not words,
 *  and a line that ends in one would otherwise break after a trailing space.
 *
 *  Last of all, once the blocks are built, because a callout's marker line ends
 *  at a newline and `callout` above reads it off the spans. */
function flowing(text: string, hard: boolean): string {
  return text.replace(/[ \t]*\n[ \t]*/gu, hard ? '\n' : ' ')
}

/** A hard break is a span of its own that is exactly a newline, and the writer
 *  asked for it with two spaces or a backslash. A wrapped line is a newline
 *  among words. Only the second answers to the switch. */
function flowedSpans(spans: Span[], hard: boolean): Span[] {
  return spans.map((span) =>
    span.text === '\n' ? span : { ...span, text: flowing(span.text, hard) },
  )
}

function flowed(blocks: Block[], hard: boolean): Block[] {
  const spans = (one: Span[]) => flowedSpans(one, hard)

  return blocks.map((block): Block => {
    switch (block.kind) {
      case 'heading':
      case 'paragraph':
        return { ...block, spans: spans(block.spans) }

      case 'quote':
        return { ...block, blocks: flowed(block.blocks, hard) }

      case 'list':
        return {
          ...block,
          items: block.items.map((item) => ({
            ...item,
            spans: spans(item.spans),
            blocks: flowed(item.blocks, hard),
          })),
        }

      case 'table':
        return {
          ...block,
          head: block.head.map(spans),
          rows: block.rows.map((row) => row.map(spans)),
        }

      case 'terms':
        return {
          ...block,
          entries: block.entries.map((entry) => ({
            term: spans(entry.term),
            details: entry.details.map(spans),
          })),
        }

      // Code and maths are written as they stand, and a rule and a page break
      // hold no words at all.
      case 'code':
      case 'maths':
      case 'rule':
      case 'break':
        return block
    }
  })
}

/** Every picture the document names, in the order it names them, each once. */
export function picturesIn(doc: Doc): string[] {
  const found = new Set<string>()

  const walk = (blocks: readonly Block[]) => {
    for (const block of blocks) {
      if (block.kind === 'quote') walk(block.blocks)
      else if (block.kind === 'list') {
        for (const item of block.items) {
          take(item.spans)
          walk(item.blocks)
        }
      } else if (block.kind === 'table') {
        block.head.forEach(take)
        for (const row of block.rows) row.forEach(take)
      } else if (block.kind === 'terms') {
        for (const entry of block.entries) {
          take(entry.term)
          entry.details.forEach(take)
        }
      } else if ('spans' in block) take(block.spans)
    }
  }

  const take = (spans: readonly Span[]) => {
    for (const span of spans) {
      if (span.picture !== undefined) found.add(span.picture)
    }
  }

  walk(doc.blocks)
  for (const note of doc.notes) take(note.spans)

  return [...found]
}
