/** A note as blocks the panel can set.
 *
 *  The grammar is the app's own - `lexMarkdown` in `@nib/markdown`, the same
 *  tokens the reading view and a published page are built from - and this turns
 *  those tokens into something flat: a list of blocks, each already carrying how
 *  far it is indented, how many quote bars sit to its left, and where in the
 *  file it began. Flat because the panel is 288 pixels tall and pages are filled
 *  a line at a time; a tree would have to be walked again to answer the only
 *  question a page ever asks, which is what comes next.
 *
 *  Nothing here touches a canvas or measures anything. Widths arrive later, from
 *  the measurer the caller hands to `layout.ts`. */

import { lexMarkdown, shownText, stripFrontMatter, type Wikilink } from '@nib/markdown'
import type { LigatureScope } from '@nib/editor'
import type { Token, Tokens } from 'marked'
import type { CodeSpan } from './code'
import { MUTED_GREY } from './style'
import {
  BODY,
  CODE_SIZE,
  type Family,
  headingStyle,
  inlineCodeStyle,
  type TextStyle,
} from './style'
import { type Run, textRuns } from './runs'
import { FURNITURE } from './style'
import { WHITE } from './panel'

/** How far one step of list nesting, or one quote bar, pushes a block in. */
export const INDENT_STEP = 16
export const QUOTE_STEP = 12

export type Align = 'left' | 'center' | 'right'

interface Placed {
  /** Offset in the note of the first character of this block. */
  from: number
  /** How far in the block is set, in pixels. */
  indent: number
  /** How many quote bars are drawn to its left. */
  quote: number
}

export type Block =
  | (Placed & { kind: 'heading'; level: number; runs: Run[] })
  | (Placed & { kind: 'text'; runs: Run[] })
  | (Placed & { kind: 'item'; marker: Run[]; runs: Run[] })
  | (Placed & { kind: 'code'; language: string; lines: CodeSpan[][] })
  | (Placed & { kind: 'rule' })
  | (Placed & { kind: 'table'; head: Run[][]; rows: Run[][][]; align: Align[] })
  | (Placed & { kind: 'math'; tex: string })
  | (Placed & { kind: 'picture'; source: string; alt: string })

export interface BlockOptions {
  /** How much of the note the ligature glyphs are drawn over; the account's own
   *  setting, straight through. */
  scope: LigatureScope
  /** A fence's lines, already told apart into token kinds. Handed in rather
   *  than worked out here because loading a language's parser is asynchronous
   *  and laying a note out is not; see `code.ts`. */
  fence: (code: string, language: string) => CodeSpan[][]
}

/** Where each block began in the file.
 *
 *  marked gives every token the text it was made from, so a walk in document
 *  order can find each one after the last. A container is looked up without
 *  being consumed, so the tokens inside it are found within it; a blockquote is
 *  the exception, since the lexer hands its children the lines with the `>`
 *  already taken off and there is nothing left to search for. Those fall back to
 *  the start of the quote, which is where a reader taken there would want to be
 *  anyway. */
class Locator {
  private at = 0

  constructor(private readonly source: string) {}

  /** The offset of `raw`, and the cursor moved past it. */
  take(raw: string): number {
    const from = this.find(raw)
    if (from !== null) this.at = from + raw.length
    return from ?? this.at
  }

  /** The offset of `raw` without moving on, for a block that holds others. */
  peek(raw: string): number {
    return this.find(raw) ?? this.at
  }

  private find(raw: string): number | null {
    if (!raw) return null
    const found = this.source.indexOf(raw, this.at)
    return found < 0 ? null : found
  }
}

function textOf(token: Token): string {
  return 'text' in token && typeof token.text === 'string' ? token.text : ''
}

function rawOf(token: Token): string {
  return 'raw' in token && typeof token.raw === 'string' ? token.raw : ''
}

function childrenOf(token: Token): Token[] {
  return 'tokens' in token && Array.isArray(token.tokens) ? (token.tokens as Token[]) : []
}

/** A callout is a blockquote whose first line names a kind; see `callouts` in
 *  the markdown package. The label becomes a line of its own, as it does on a
 *  page, and the marker is dropped from the body. */
const CALLOUT = /^\s*\[!(note|tip|important|warning|caution)\]\s*/i

const HTML_TAG = /<[^>]*>/g

/** Runs for a list of inline tokens, under one style. */
function inlineRuns(tokens: readonly Token[], style: TextStyle, options: BlockOptions): Run[] {
  const out: Run[] = []
  const plain = (text: string, its = style, code = false) =>
    out.push(...textRuns(text, its, { scope: options.scope, code }))

  for (const token of tokens) {
    const kids = childrenOf(token)

    switch (token.type) {
      case 'strong':
        out.push(...inlineRuns(kids, { ...style, weight: 'bold' }, options))
        break

      case 'em':
        out.push(...inlineRuns(kids, { ...style, slant: 'italic' }, options))
        break

      case 'del':
        out.push(...inlineRuns(kids, { ...style, strike: true }, options))
        break

      case 'codespan': {
        // Its own face and a box behind it, the way the app draws an inline
        // span. Code, so the `code` ligature scope reaches it.
        const its = { ...inlineCodeStyle(), grey: style.grey }
        for (const run of textRuns(textOf(token), its, { scope: options.scope, code: true })) {
          out.push({ ...run, box: FURNITURE.codeBox })
        }
        break
      }

      case 'link': {
        const its = { ...style, underline: true }
        // The address itself is not prose, and `//` in it is not a glyph; see
        // the nodes the editor leaves alone.
        if (kids.length) out.push(...inlineRuns(kids, its, options))
        else out.push({ text: textOf(token), style: its })
        break
      }

      case 'image':
        // A picture with words around it cannot be a picture on a 288 pixel
        // panel, so it reads as what it was described as.
        plain(textOf(token) || 'image', { ...style, slant: 'italic', grey: MUTED_GREY })
        break

      case 'br':
        out.push({ text: '', style, break: true })
        break

      case 'html':
        // Markup is not words. What is left when the tags come off is.
        plain(textOf(token).replace(HTML_TAG, ''))
        break

      case 'escape':
        plain(textOf(token))
        break

      case 'text':
        if (kids.length) out.push(...inlineRuns(kids, style, options))
        else plain(textOf(token))
        break

      default:
        out.push(...extensionRuns(token, style, options))
    }
  }

  return out
}

/** The inline tokens this repo adds to the grammar. Kept apart from the switch
 *  above because marked types them all as one shape and each has to be read
 *  field by field. */
function extensionRuns(token: Token, style: TextStyle, options: BlockOptions): Run[] {
  const scoped = { scope: options.scope, code: false }

  switch (token.type) {
    case 'highlight':
      // Inverse video: the one mark on a panel with no colours that cannot be
      // mistaken for emphasis.
      return textRuns(textOf(token), { ...style, grey: 0 }, scoped).map((run) => ({
        ...run,
        box: WHITE,
      }))

    case 'superscript':
      return raised(token, style, options, 1)

    case 'subscript':
      return raised(token, style, options, -1)

    case 'inlineMath':
      // Drawn as a picture; the TeX is what shows if the drawing fails.
      return [{ text: textOf(token), style, math: { tex: textOf(token), display: false } }]

    case 'emoji':
      return [{ text: textOf(token), style }]

    case 'footnoteRef': {
      const id = 'id' in token && typeof token.id === 'string' ? token.id : ''
      return [
        {
          text: id,
          style: { ...style, size: Math.round(style.size * 0.7) },
          rise: Math.round(style.size * 0.35),
        },
      ]
    }

    case 'wikilink': {
      const link = 'link' in token ? (token.link as Wikilink | undefined) : undefined
      const shown = link ? shownText(link) : textOf(token)
      return textRuns(shown, { ...style, underline: true }, scoped)
    }

    case 'embed': {
      // An embed with nothing to embed reads as the words it showed, which is
      // what an export does with one too.
      const link = 'link' in token ? (token.link as Wikilink | undefined) : undefined
      return textRuns(link ? shownText(link) : textOf(token), { ...style, underline: true }, scoped)
    }

    default:
      return textRuns(textOf(token), style, scoped)
  }
}

function raised(token: Token, style: TextStyle, options: BlockOptions, up: 1 | -1): Run[] {
  const small = { ...style, size: Math.round(style.size * 0.72) }
  const rise = Math.round(style.size * 0.3) * up
  const kids = childrenOf(token)
  const runs = kids.length
    ? inlineRuns(kids, small, options)
    : textRuns(textOf(token), small, { scope: options.scope, code: false })

  return runs.map((run) => ({ ...run, rise }))
}

/** The bullet or the number in front of a list item. */
function markerRuns(ordered: boolean, at: number, task: boolean, done: boolean): Run[] {
  const style: TextStyle = { ...BODY, grey: FURNITURE.marker }
  if (task) return [{ text: done ? '☑' : '☐', style }]

  return [{ text: ordered ? `${at}.` : '•', style }]
}

interface Nest {
  indent: number
  quote: number
}

/** Every block of a note, in the order it is read. `offset` is added to every
 *  position, so front matter that was taken off the front still counts. */
function walk(
  tokens: readonly Token[],
  where: Locator,
  nest: Nest,
  options: BlockOptions,
  out: Block[],
): void {
  for (const token of tokens) {
    block(token, where, nest, options, out)
  }
}

function block(
  token: Token,
  where: Locator,
  nest: Nest,
  options: BlockOptions,
  out: Block[],
): void {
  const raw = rawOf(token)
  const kids = childrenOf(token)

  switch (token.type) {
    case 'space':
    case 'def':
    case 'abbrDef':
      where.take(raw)
      break

    case 'heading': {
      const level = 'depth' in token && typeof token.depth === 'number' ? token.depth : 1
      out.push({
        kind: 'heading',
        level,
        runs: inlineRuns(kids, headingStyle(level), options),
        from: where.take(raw),
        ...nest,
      })
      break
    }

    case 'hr':
      out.push({ kind: 'rule', from: where.take(raw), ...nest })
      break

    case 'code': {
      const language = ('lang' in token && typeof token.lang === 'string' ? token.lang : '').trim()
      out.push({
        kind: 'code',
        language,
        lines: options.fence(textOf(token), language),
        from: where.take(raw),
        ...nest,
      })
      break
    }

    case 'blockMath':
      out.push({ kind: 'math', tex: textOf(token), from: where.take(raw), ...nest })
      break

    case 'paragraph': {
      const picture = onlyPicture(kids)
      const from = where.take(raw)
      if (picture) out.push({ ...picture, from, ...nest })
      else out.push({ kind: 'text', runs: inlineRuns(kids, BODY, options), from, ...nest })
      break
    }

    case 'text':
      out.push({
        kind: 'text',
        runs: kids.length
          ? inlineRuns(kids, BODY, options)
          : textRuns(textOf(token), BODY, { scope: options.scope, code: false }),
        from: where.take(raw),
        ...nest,
      })
      break

    case 'html':
      out.push({
        kind: 'text',
        runs: textRuns(textOf(token).replace(HTML_TAG, '').trim(), BODY, {
          scope: options.scope,
          code: false,
        }),
        from: where.take(raw),
        ...nest,
      })
      break

    case 'blockquote':
      quote(token, where, nest, options, out)
      break

    case 'list':
      list(token, where, nest, options, out)
      break

    case 'table':
      table(token, where, nest, options, out)
      break

    case 'definitionList':
      definitions(token, where, nest, options, out)
      break

    case 'footnoteDef':
      footnote(token, where, nest, options, out)
      break

    default:
      // Anything the grammar knows and this does not yet: its words, set as a
      // paragraph, which is better than a hole in the note.
      out.push({
        kind: 'text',
        runs: textRuns(textOf(token), BODY, { scope: options.scope, code: false }),
        from: where.take(raw),
        ...nest,
      })
  }
}

/** A paragraph that holds one picture and nothing else. */
function onlyPicture(
  tokens: readonly Token[],
): { kind: 'picture'; source: string; alt: string } | null {
  const shown = tokens.filter((one) => one.type !== 'text' || textOf(one).trim() !== '')
  const first = shown[0]
  if (shown.length !== 1 || !first || first.type !== 'image') return null

  const source = 'href' in first && typeof first.href === 'string' ? first.href : ''
  return source ? { kind: 'picture', source, alt: textOf(first) } : null
}

function quote(
  token: Token,
  where: Locator,
  nest: Nest,
  options: BlockOptions,
  out: Block[],
): void {
  const kids = childrenOf(token)
  const from = where.peek(rawOf(token))
  const inside: Nest = { indent: nest.indent, quote: nest.quote + 1 }

  const first = kids[0]
  const kind = first ? CALLOUT.exec(textOf(first))?.[1] : undefined
  if (kind) {
    const label = kind.charAt(0).toUpperCase() + kind.slice(1)
    out.push({
      kind: 'text',
      runs: [{ text: label, style: { ...BODY, weight: 'bold' } }],
      from,
      ...inside,
    })
  }

  const body = kind
    ? kids.map((one, at) => (at === 0 ? stripCallout(one) : one))
    : (kids as readonly Token[])
  walk(body, where, inside, options, out)
}

/** The first token of a callout with its `[!note]` marker taken off. */
function stripCallout(token: Token): Token {
  const kids = childrenOf(token)
  const first = kids[0]
  if (first && first.type === 'text') {
    return {
      ...token,
      tokens: [{ ...first, text: textOf(first).replace(CALLOUT, '') }, ...kids.slice(1)],
    } as Token
  }

  return { ...token, text: textOf(token).replace(CALLOUT, '') } as Token
}

function list(token: Token, where: Locator, nest: Nest, options: BlockOptions, out: Block[]): void {
  const ordered = 'ordered' in token && token.ordered === true
  const start = 'start' in token && typeof token.start === 'number' ? token.start : 1
  const items = 'items' in token && Array.isArray(token.items) ? (token.items as Token[]) : []
  where.peek(rawOf(token))

  items.forEach((item, at) => {
    const from = where.peek(rawOf(item))
    const task = 'task' in item && item.task === true
    const done = 'checked' in item && item.checked === true
    const inside: Nest = { indent: nest.indent + INDENT_STEP, quote: nest.quote }
    const all = childrenOf(item)

    // A task's `[ ]` is a token of its own. The marker already says whether it
    // is done, so the brackets are consumed and dropped.
    const box = all[0]
    if (box?.type === 'checkbox') where.take(rawOf(box))
    const kids = box?.type === 'checkbox' ? all.slice(1) : all

    // The item's own words share the line with its bullet; anything else in it -
    // a second paragraph, a fence, a list under it - follows as its own block,
    // set to the same hanging indent.
    const lead = kids[0]
    const rest = lead && isLeading(lead) ? kids.slice(1) : kids
    out.push({
      kind: 'item',
      marker: markerRuns(ordered, start + at, task, done),
      runs: lead && isLeading(lead) ? leadingRuns(lead, options) : [],
      from,
      ...inside,
    })
    if (lead && isLeading(lead)) where.take(rawOf(lead))

    walk(rest, where, inside, options, out)
  })
}

/** Whether an item's first token is the words that go beside its bullet. */
function isLeading(token: Token): boolean {
  return token.type === 'text' || token.type === 'paragraph'
}

function leadingRuns(token: Token, options: BlockOptions): Run[] {
  const kids = childrenOf(token)
  return kids.length
    ? inlineRuns(kids, BODY, options)
    : textRuns(textOf(token), BODY, { scope: options.scope, code: false })
}

const ALIGNS = new Set<Align>(['left', 'center', 'right'])

function table(
  token: Token,
  where: Locator,
  nest: Nest,
  options: BlockOptions,
  out: Block[],
): void {
  const one = token as Tokens.Table
  const cells = (row: readonly Tokens.TableCell[], style: TextStyle) =>
    row.map((cell) => inlineRuns(cell.tokens, style, options))

  out.push({
    kind: 'table',
    head: cells(one.header, { ...BODY, weight: 'bold' }),
    rows: one.rows.map((row) => cells(row, BODY)),
    align: one.align.map((given) =>
      given !== null && ALIGNS.has(given as Align) ? (given as Align) : 'left',
    ),
    from: where.take(rawOf(token)),
    ...nest,
  })
}

interface Definition {
  term: Token[]
  details: Token[][]
}

function definitions(
  token: Token,
  where: Locator,
  nest: Nest,
  options: BlockOptions,
  out: Block[],
): void {
  const items = 'items' in token && Array.isArray(token.items) ? (token.items as Definition[]) : []
  const from = where.take(rawOf(token))

  for (const item of items) {
    out.push({
      kind: 'text',
      runs: inlineRuns(item.term, { ...BODY, weight: 'bold' }, options),
      from,
      ...nest,
    })
    for (const detail of item.details) {
      out.push({
        kind: 'text',
        runs: inlineRuns(detail, BODY, options),
        from,
        indent: nest.indent + INDENT_STEP,
        quote: nest.quote,
      })
    }
  }
}

function footnote(
  token: Token,
  where: Locator,
  nest: Nest,
  options: BlockOptions,
  out: Block[],
): void {
  const id = 'id' in token && typeof token.id === 'string' ? token.id : ''
  const from = where.peek(rawOf(token))
  const style: TextStyle = { ...BODY, grey: MUTED_GREY }

  out.push({
    kind: 'item',
    marker: [{ text: `${id}.`, style }],
    runs: [],
    from,
    indent: nest.indent + INDENT_STEP,
    quote: nest.quote,
  })
  walk(
    childrenOf(token),
    where,
    { indent: nest.indent + INDENT_STEP, quote: nest.quote },
    options,
    out,
  )
}

/** Which faces a note asks for, so the rasteriser can wait for exactly those.
 *  Every block is prose in the content face or code in the mono one; the UI
 *  face is not used on the panel at all. */
export function familiesUsed(blocks: readonly Block[]): Set<Family> {
  const used = new Set<Family>()
  for (const one of blocks) {
    if (one.kind === 'code') used.add('mono')
    else used.add('content')
    if (one.kind === 'text' || one.kind === 'heading' || one.kind === 'item') {
      for (const run of one.runs) used.add(run.style.family)
    }
  }

  return used
}

/** Every language a fence in the note names, so their parsers can be loaded
 *  before the note is laid out. */
export function fenceLanguagesIn(source: string): string[] {
  const found = new Set<string>()
  for (const token of lexMarkdown(stripFrontMatter(source))) {
    if (token.type === 'code') {
      const language = 'lang' in token && typeof token.lang === 'string' ? token.lang.trim() : ''
      if (language) found.add(language.split(/\s+/)[0] ?? '')
    }
  }

  return [...found].filter(Boolean)
}

/** The whole note as blocks. Positions count from the start of the file, front
 *  matter included, even though front matter is not set. */
export function blocksOf(source: string, options: BlockOptions): Block[] {
  const body = stripFrontMatter(source)
  const out: Block[] = []
  // The locator searches the file itself, so an offset it finds is the file's.
  walk(lexMarkdown(body), new Locator(source), { indent: 0, quote: 0 }, options, out)

  return out
}

/** The size a fence's lines are set at, said here because both the layout and
 *  the rasteriser need it and neither owns the fence. */
export const FENCE_STYLE: TextStyle = {
  family: 'mono',
  size: CODE_SIZE,
  weight: 'normal',
  slant: 'normal',
  grey: WHITE,
  underline: false,
  strike: false,
}
