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
import { stemOf } from '../../files-out/src/api'

export interface Span {
  text: string
  bold?: boolean
  italic?: boolean
  strike?: boolean
  code?: boolean
  mark?: boolean
  tone?: number
  sup?: boolean
  sub?: boolean
  href?: string
  picture?: string
  maths?: boolean
  note?: string
}

export type Align = 'left' | 'center' | 'right' | null

export interface Item {
  spans: Span[]
  blocks: Block[]
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

export interface Doc {
  title: string
  named: boolean
  author: string | null
  lang: string
  date: string | null
  blocks: Block[]
  notes: Footnote[]
}

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

function spansOf(tokens: readonly Token[] | undefined, marks: Marks = {}): Span[] {
  const out: Span[] = []
  let passing: string | null = null
  for (const token of tokens ?? []) {
    if (token.type === 'html') {
      const [, closing, written] = /^<(\/?)([a-z][\w-]*)/i.exec(token.raw.trim()) ?? []
      const name = written?.toLowerCase()
      if (passing !== null) {
        if (closing && name === passing) passing = null
        continue
      }
      const opens = name && !closing && !VOID.test(name) && !token.raw.trimEnd().endsWith('/>')
      if (opens && (NOT_SHOWN.test(name) || HIDDEN.test(token.raw))) {
        passing = name
        continue
      }
    }
    if (passing === null) for (const span of spansOfToken(token, marks)) out.push(span)
  }

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
      return [{ ...marks, text: link ? shownText(link) : token.raw }]
    }

    case 'br':
      return [{ ...marks, text: '\n' }]

    case 'html':
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

      const text: unknown = (token as Tokens.Generic).text
      return typeof text === 'string' ? [{ ...marks, text }] : []
    }
  }
}

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

function callout(blocks: Block[]): { label: string | null; blocks: Block[] } {
  const first = blocks[0]
  if (first?.kind !== 'paragraph') return { label: null, blocks }

  if (!first.spans.length) return { label: null, blocks }

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
        const html = String((token as Tokens.Generic).text ?? '')
        if (PAGE_BREAK.test(html)) out.push({ kind: 'break' })
        for (const words of wordsOfHtml(html)) {
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

const NOT_SHOWN =
  /^(?:script|style|template|head|title|noscript|textarea|select|svg|canvas|object|video|audio|iframe|embed|dialog)$/i

const HIDDEN =
  /\shidden(?:[\s=/>])|\sstyle\s*=\s*(?:"[^"]*display\s*:\s*none[^"]*"|'[^']*display\s*:\s*none[^']*')/i

const VOID = /^(?:area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/i

const STARTS_LINE =
  /^(?:address|article|aside|blockquote|center|dd|details|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|menu|nav|ol|p|pre|section|summary|table|tbody|tfoot|thead|tr|ul)$/i

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

function wordsOfHtml(source: string): string[] {
  const out: string[] = []
  let line = ''
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

  const comment = source.lastIndexOf('<!--')
  const html =
    comment !== -1 && !source.includes('-->', comment) ? source.slice(0, comment) : source
  for (const found of html
    .slice(0, html.lastIndexOf('>') + 1)
    .matchAll(
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

export function titleOf(source: string, name: string): string {
  return frontMatterValue(source, 'title') ?? documentTitle(source) ?? stemOf(name)
}

export interface DocumentOptions {
  hardBreaks?: boolean
}

export function documentOf(source: string, name: string, options: DocumentOptions = {}): Doc {
  const notes: Footnote[] = []
  const hard = options.hardBreaks ?? hardBreaks()
  const body = withoutComments(withoutBlockIds(stripFrontMatter(source)))

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

function flowing(text: string, hard: boolean): string {
  return text.replace(/[ \t]*\n[ \t]*/gu, hard ? '\n' : ' ')
}

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

      case 'code':
      case 'maths':
      case 'rule':
      case 'break':
        return block
    }
  })
}

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
