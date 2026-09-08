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

import { documentTitle, frontMatterValue, lexMarkdown, type Wikilink } from '@nib/markdown'
import { shownText, withoutBlockIds } from '@nib/markdown/links'
import type { Token, Tokens } from 'marked'

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

export interface Footnote {
  label: string
  spans: Span[]
}

/** A whole note, ready for a writer. */
export interface Doc {
  title: string
  author: string | null
  lang: string
  date: string | null
  blocks: Block[]
  /** The footnote definitions, in the order they were defined. */
  notes: Footnote[]
}

/** `> [!note]` and friends: the marker that turns a quote into a callout. */
const CALLOUT = /^\s*\[!(\w+)\]\s*/

/** The `page-break` divs Typora writes, and the `---` a note may use for one.
 *  Recognised so a writer that has pages can start one. */
const PAGE_BREAK = /page-break-(?:after|before)\s*:\s*always/i

interface Marks {
  bold?: boolean
  italic?: boolean
  strike?: boolean
  mark?: boolean
  sup?: boolean
  sub?: boolean
  href?: string
}

/** The spans a list of inline tokens comes to, with the marks of everything
 *  around them already folded in. */
function spansOf(tokens: readonly Token[] | undefined, marks: Marks = {}): Span[] {
  const out: Span[] = []
  for (const token of tokens ?? []) out.push(...spansOfToken(token, marks))

  // An empty run says nothing, so it goes - but a picture and a footnote mark
  // both carry what they mean somewhere other than in their text.
  return out.filter(
    (span) => span.text !== '' || span.picture !== undefined || span.note !== undefined,
  )
}

function spansOfToken(token: Token, marks: Marks): Span[] {
  const inner = (extra: Marks = {}) =>
    spansOf((token as Tokens.Generic).tokens as Token[] | undefined, { ...marks, ...extra })

  switch (token.type) {
    case 'strong':
      return inner({ bold: true })
    case 'em':
      return inner({ italic: true })
    case 'del':
      return inner({ strike: true })
    case 'highlight':
      return inner({ mark: true })
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
      return [{ ...marks, text: image.text || image.title || '', picture: image.href }]
    }

    case 'codespan':
      return [{ ...marks, code: true, text: (token as Tokens.Codespan).text }]

    case 'inlineMath':
      return [{ ...marks, maths: true, text: String((token as Tokens.Generic).text ?? '') }]

    case 'footnoteRef':
      return [{ ...marks, note: String((token as Tokens.Generic).id ?? ''), text: '' }]

    case 'wikilink':
    case 'embed': {
      const link = (token as Tokens.Generic).link as Wikilink | undefined
      // A document has no space around it, so a wikilink reads as the words it
      // showed - the same answer the HTML export gives.
      return [{ ...marks, text: link ? shownText(link) : String(token.raw) }]
    }

    case 'br':
      return [{ ...marks, text: '\n' }]

    case 'html':
      // Raw HTML is markup, not words. A page break is the one piece of it that
      // means something to a writer, and it is picked up as a block.
      return []

    case 'text':
    case 'escape':
    case 'emoji': {
      const nested = (token as Tokens.Generic).tokens as Token[] | undefined
      if (nested?.length) return spansOf(nested, marks)
      return [{ ...marks, text: String((token as Tokens.Generic).text ?? '') }]
    }

    default: {
      const nested = (token as Tokens.Generic).tokens as Token[] | undefined
      if (nested?.length) return spansOf(nested, marks)

      const text = (token as Tokens.Generic).text
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

/** A quote turned into a callout: the label it names, and its body with the
 *  marker gone.
 *
 *  Taken off the spans rather than off the source, because by the time a quote
 *  is read the marker is the first few characters of an inline token and cutting
 *  the string would leave the tokens around it describing the wrong offsets. */
function callout(blocks: Block[]): { label: string | null; blocks: Block[] } {
  const first = blocks[0]
  if (first?.kind !== 'paragraph') return { label: null, blocks }

  const opening = first.spans[0]
  const match = opening && CALLOUT.exec(opening.text)
  if (!match?.[1]) return { label: null, blocks }

  const kind = match[1].toLowerCase()
  // The marker's own pattern already takes the line break after it with it.
  const text = opening.text.slice(match[0].length)
  const spans = text ? [{ ...opening, text }, ...first.spans.slice(1)] : first.spans.slice(1)
  // A marker on a line of its own leaves nothing behind, and an empty paragraph
  // would print as a blank line under the label.
  const rest = spans.length ? [{ ...first, spans }, ...blocks.slice(1)] : blocks.slice(1)

  return { label: kind.charAt(0).toUpperCase() + kind.slice(1), blocks: rest }
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
          label: String((token as Tokens.Generic).id ?? ''),
          spans: spansOf((token as Tokens.Generic).tokens as Token[] | undefined),
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
        const spans = spansOf((token as Tokens.Generic).tokens as Token[] | undefined)
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
        out.push({ kind: 'maths', tex: String((token as Tokens.Generic).text ?? '') })
        break

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
          entries: ((token as Tokens.Generic).items as { term: Token[]; details: Token[][] }[]).map(
            (entry) => ({
              term: spansOf(entry.term),
              details: entry.details.map((detail) => spansOf(detail)),
            }),
          ),
        })
        break

      case 'hr':
        out.push({ kind: 'rule' })
        break

      case 'html':
        if (PAGE_BREAK.test(String((token as Tokens.Generic).text ?? ''))) {
          out.push({ kind: 'break' })
        }
        break

      default: {
        const spans = spansOf((token as Tokens.Generic).tokens as Token[] | undefined)
        if (spans.length) out.push({ kind: 'paragraph', spans })
        break
      }
    }
  }

  return out
}

/** What a document is called: the front matter's title, else the first heading,
 *  else the file's own name. Every export reads it from here - the running text
 *  on paper, the `<title>` of a page, the Word property, the ePub metadata - so
 *  one note cannot come out under two names. */
export function titleOf(source: string, name: string): string {
  return frontMatterValue(source, 'title') ?? documentTitle(source) ?? name.replace(/\.[^.]+$/, '')
}

/** The note read into blocks. `name` is the file's, and stands in for a title
 *  when neither the front matter nor a first heading gives one. */
export function documentOf(source: string, name: string): Doc {
  const notes: Footnote[] = []
  // Front matter is metadata and a block's name is a marker, exactly as the
  // HTML renderer treats them.
  const body = withoutBlockIds(source.startsWith('---') ? stripFront(source) : source)

  return {
    title: titleOf(source, name),
    author: frontMatterValue(source, 'author'),
    lang: frontMatterValue(source, 'lang') ?? 'en',
    date: frontMatterValue(source, 'date'),
    blocks: blocksOf(lexMarkdown(body), notes),
    notes,
  }
}

/** Front matter off, keeping the rest character for character. Not imported
 *  from the renderer because that one also has to answer for a note that has
 *  none, and here the caller has already asked. */
function stripFront(source: string): string {
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
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
