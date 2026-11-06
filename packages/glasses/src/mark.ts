import { lexMarkdown, noteWithoutComments, stripFrontMatter } from '@orden/markdown'
import * as emoji from 'node-emoji'
import { useEmoji } from '@orden/markdown/engines'
import { calloutOf, opensCallout } from '@orden/markdown/callouts'
import { readChart } from '@orden/markdown/chart'
import { captionIn, languageIn } from '@orden/markdown/code'
import { blockIdsBlanked, embedKind, type Wikilink } from '@orden/markdown/links'
import type { Token, Tokens } from 'marked'
import {
  type Compaction,
  COMPACTIONS,
  DEFAULT_COMPACTION,
  isCompaction,
  MARKS,
  type Marks,
} from './choices'
import { fit, fold, ruleOf, SPACE, width } from './firmware'

useEmoji(emoji)

export interface Line {
  text: string
  from: number
  at: number
  glued: boolean
  level: number
  under: boolean
}

export { type Compaction, COMPACTIONS, DEFAULT_COMPACTION, isCompaction, MARKS, type Marks }

export interface MarkOptions {
  inner: number
  marks?: Marks
  compaction?: Compaction
  rootIndent?: boolean
}

const STEP = '   '

const QUOTE = '│ '

const BULLETS = ['•', '·', '-'] as const
const TASK_OPEN = '□'
const TASK_DONE = '■'

const PICTURE = '▤'

const FENCE = '```'

const SUPERS = '⁰¹²³⁴⁵⁶⁷⁸⁹'
const SUBS = '₀₁₂₃₄₅₆₇₈₉'

const MARKERS = [...BULLETS, TASK_OPEN, TASK_DONE, PICTURE, ':', '\\d+\\.']
const FURNITURE = new RegExp(`^(?:${QUOTE})*(?: *)(?:${MARKERS.join('|')})? ?`, 'u')

export function hangOf(text: string): string {
  const found = FURNITURE.exec(text)?.[0] ?? ''
  if (found === '') return ''

  const bars = QUOTE.repeat(found.match(new RegExp(QUOTE, 'gu'))?.length ?? 0)
  const spare = Math.max(0, Math.round((width(found) - width(bars)) / width(' ')))

  return bars + ' '.repeat(spare)
}

function raise(text: string, digits: string): string | null {
  if (!/^\d+$/.test(text)) return null

  let out = ''
  for (const one of text) out += digits[Number(one)] ?? one
  return out
}

export interface Work {
  blocks: number
  lines: number
  folded: number
  searched: number
}

function nothing(): Work {
  return { blocks: 0, lines: 0, folded: 0, searched: 0 }
}

const work = nothing()

export function workDone(): Work {
  const done = { ...work }
  Object.assign(work, nothing())
  return done
}

class Locator {
  constructor(
    private readonly source: string,
    private at = 0,
  ) {}

  take(raw: string): number {
    const from = this.find(raw)
    if (from !== null) this.at = from + raw.length
    return from ?? this.at
  }

  peek(raw: string): number {
    return this.find(raw) ?? this.at
  }

  private find(raw: string): number | null {
    if (!raw) return null

    const found = this.source.indexOf(raw, this.at)
    work.searched += (found < 0 ? this.source.length : found + raw.length) - this.at
    return found < 0 ? null : found
  }
}

class Lines {
  private readonly starts: number[] = [0]

  constructor(source: string) {
    for (let at = 0; at < source.length; at++) {
      if (source[at] === '\n') this.starts.push(at + 1)
    }
  }

  startOf(line: number): number | undefined {
    return this.starts[line - 1]
  }

  at(offset: number): number {
    let low = 0
    let high = this.starts.length - 1
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if ((this.starts[middle] ?? 0) <= offset) low = middle
      else high = middle - 1
    }

    return low + 1
  }
}

function textOf(token: Token): string {
  return 'text' in token && typeof token.text === 'string' ? token.text : ''
}

function rawOf(token: Token): string {
  return 'raw' in token && typeof token.raw === 'string' ? token.raw : ''
}

function childrenOf(token: Token): Token[] {
  return 'tokens' in token && Array.isArray(token.tokens) ? token.tokens : []
}

const HTML_TAG = /<[^>]*>/g

function flowing(text: string, flow: boolean): string {
  if (!flow) return text.replace(/[ \t]*\n[ \t]*/gu, '\n')
  return text.replace(/[ \t]*\n[ \t]*/gu, ' ')
}

const AROUND: Readonly<Record<string, [string, keyof Marks]>> = {
  strong: ['**', 'bold'],
  em: ['*', 'italic'],
  del: ['~~', 'strike'],
  highlight: ['==', 'highlight'],
}

function around(words: string, type: string, marks: Marks): string {
  const found = AROUND[type]
  if (!found || !marks[found[1]]) return words

  return `${found[0]}${words}${found[0]}`
}

function linked(token: Token, kids: readonly Token[], marks: Marks, flow: boolean): string {
  const shown = kids.length ? inlineWords(kids, marks, flow) : textOf(token)
  if (!marks.link) return shown

  const href = 'href' in token && typeof token.href === 'string' ? token.href : ''
  return href ? `[${shown}](${href})` : shown
}

function inlineWords(tokens: readonly Token[], marks: Marks, flow: boolean): string {
  let out = ''

  for (const token of tokens) {
    const kids = childrenOf(token)

    switch (token.type) {
      case 'strong':
      case 'em':
      case 'del':
      case 'highlight':
        out += around(inlineWords(kids, marks, flow), token.type, marks)
        break

      case 'codespan':
        out += marks.code ? `\`${textOf(token)}\`` : textOf(token)
        break

      case 'inlineMath':
        out += `$${textOf(token)}$`
        break

      case 'superscript':
      case 'subscript': {
        const inside = kids.length ? inlineWords(kids, marks, flow) : textOf(token)
        const digits = token.type === 'superscript' ? SUPERS : SUBS
        out += raise(inside, digits) ?? inside
        break
      }

      case 'link':
        out += linked(token, kids, marks, flow)
        break

      case 'wikilink':
      case 'embed':
        out += textOf(token)
        break

      case 'image':
        out +=
          textOf(token) || ('href' in token && typeof token.href === 'string' ? token.href : '')
        break

      case 'footnoteRef': {
        const id = 'id' in token && typeof token.id === 'string' ? token.id : ''
        out += raise(id, SUPERS) ?? `[^${id}]`
        break
      }

      case 'br':
        out += '\n'
        break

      case 'html':
        out += textOf(token).replace(HTML_TAG, '')
        break

      case 'emoji':
      case 'escape':
      case 'text':
        out += kids.length ? inlineWords(kids, marks, flow) : flowing(textOf(token), flow)
        break

      default:
        out += kids.length ? inlineWords(kids, marks, flow) : flowing(textOf(token), flow)
    }
  }

  return out
}

const CHEVRON = '›'
const UNDERLINES: Readonly<Record<number, string>> = { 1: '═', 2: '─' }

function heading(level: number, words: string, from: number, nest: Nest, sheet: Sheet): void {
  const hashes = sheet.marks.heading ? `${'#'.repeat(level)} ` : ''
  const lead = level >= 4 ? `${CHEVRON.repeat(level - 3)} ` : ''
  sheet.add(`${hashes}${lead}${words.toUpperCase()}`, from, nest, { level })

  const rule = UNDERLINES[level]
  if (rule) sheet.add(ruleOf(rule, sheet.width), from, nest, { glued: true, under: true })
}

type Align = 'left' | 'center' | 'right'

const ALIGNS = new Set<Align>(['left', 'center', 'right'])

function pad(text: string, room: number, align: Align): string {
  const spare = Math.max(0, Math.floor((room - width(text)) / SPACE))
  if (align === 'right') return ' '.repeat(spare) + text
  if (align === 'center') {
    const before = Math.floor(spare / 2)
    return ' '.repeat(before) + text + ' '.repeat(spare - before)
  }

  return text + ' '.repeat(spare)
}

const GUTTER = '  '

function tableLines(
  head: readonly string[],
  rows: readonly (readonly string[])[],
  align: readonly Align[],
  inner: number,
): string[] {
  const columns = Math.max(head.length, ...rows.map((row) => row.length), 1)
  const gap = width(GUTTER)
  const at = (row: readonly string[], column: number) => row[column] ?? ''
  const spread = (row: readonly string[]) =>
    Array.from({ length: columns }, (_one, column) => at(row, column))

  const natural = Array.from({ length: columns }, (_one, column) =>
    Math.max(width(at(head, column)), ...rows.map((row) => width(at(row, column))), 0),
  )

  const room = Math.max(width('…') * columns, inner - gap * (columns - 1))
  const wanted = natural.reduce((sum, one) => sum + one, 0)
  const share = wanted > room ? room / wanted : 1
  const widths = natural.map((one) => Math.max(width('…'), Math.floor(one * share)))

  const line = (row: readonly string[]) =>
    spread(row)
      .map((cell, column) => {
        const room_ = widths[column] ?? 0
        return pad(fit(cell, room_), room_, align[column] ?? 'left')
      })
      .join(GUTTER)
      .trimEnd()

  const across = widths.reduce((sum, one) => sum + one, 0) + gap * (columns - 1)

  return [line(head), ruleOf('─', Math.min(inner, across)), ...rows.map((row) => line(row))]
}

interface Nest {
  depth: number
  quote: number
  listed?: boolean
}

class Sheet {
  readonly lines: Line[] = []
  readonly marks: Marks
  readonly flow: boolean
  readonly compaction: Compaction
  private readonly rootIndent: boolean

  constructor(
    private readonly where: Lines,
    private readonly inner: number,
    options: MarkOptions,
  ) {
    this.marks = options.marks ?? MARKS
    this.compaction = options.compaction ?? DEFAULT_COMPACTION
    this.flow = this.compaction === 'aggressive'
    this.rootIndent = options.rootIndent ?? false
  }

  private stepsAt(depth: number, listed: boolean): number {
    if (this.rootIndent || listed) return depth
    return Math.max(0, depth - 1)
  }

  add(
    text: string,
    from: number,
    nest: Nest,
    options: { glued?: boolean; level?: number; under?: boolean } = {},
  ): void {
    const lead =
      QUOTE.repeat(nest.quote) + STEP.repeat(this.stepsAt(nest.depth, nest.listed === true))
    let hang = ''
    const first = this.where.at(from)
    for (const [at, part] of text.split('\n').entries()) {
      const whole = fold(at === 0 ? `${lead}${part.trimEnd()}` : `${hang}${part.trim()}`)
      if (at === 0) hang = hangOf(whole)

      const began = at === 0 ? from : (this.where.startOf(first + at) ?? from)

      work.lines += 1
      work.folded += whole.length
      this.lines.push({
        text: whole,
        from: began,
        at: first + at,
        glued: (at > 0 && this.flow) || options.glued === true,
        level: at === 0 ? (options.level ?? 0) : 0,
        under: at === 0 && options.under === true,
      })
    }
  }

  blank(from: number, line: number): void {
    work.lines += 1
    this.lines.push({ text: '', from, at: line, glued: false, level: 0, under: false })
  }

  lineAt(from: number): number {
    return this.where.at(from)
  }

  startOf(line: number): number | undefined {
    return this.where.startOf(line)
  }

  addAll(texts: readonly string[], from: number, nest: Nest): void {
    for (const [at, text] of texts.entries()) {
      this.add(text, from, nest, at === 0 ? {} : { glued: true })
    }
  }

  get width(): number {
    return this.inner
  }
}

function walk(tokens: readonly Token[], where: Locator, nest: Nest, sheet: Sheet): void {
  for (const token of tokens) {
    work.blocks += 1
    block(token, where, nest, sheet)
  }
}

function block(token: Token, where: Locator, nest: Nest, sheet: Sheet): void {
  const raw = rawOf(token)
  const kids = childrenOf(token)

  switch (token.type) {
    case 'space': {
      const from = where.take(raw)
      if (sheet.compaction !== 'none') break

      const blanks = (raw.match(/\n/gu)?.length ?? 0) - 1
      const first = sheet.lineAt(from) + 1
      for (let at = 0; at < blanks; at++) sheet.blank(from, first + at)
      break
    }

    case 'def':
    case 'abbrDef':
      where.take(raw)
      break

    case 'heading': {
      const level = 'depth' in token && typeof token.depth === 'number' ? token.depth : 1
      heading(level, inlineWords(kids, sheet.marks, sheet.flow), where.take(raw), nest, sheet)
      break
    }

    case 'hr':
      sheet.add(ruleOf('─', sheet.width), where.take(raw), nest)
      break

    case 'code':
      fence(token, where, nest, sheet)
      break

    case 'blockMath': {
      const from = where.take(raw)
      sheet.addAll(['$$', ...textOf(token).split('\n'), '$$'], from, nest)
      break
    }

    case 'paragraph': {
      const from = where.take(raw)
      const picture = onlyPicture(kids)
      if (picture) {
        sheet.add(`${PICTURE} ${picture}`, from, nest)
        break
      }
      const words = inlineWords(kids, sheet.marks, sheet.flow)
      if (words) sheet.add(words, from, nest)
      break
    }

    case 'embed': {
      const from = where.take(raw)
      const link = 'link' in token ? (token.link as Wikilink) : null
      const name = textOf(token)
      const file = link !== null && embedKind(link.target) !== null

      sheet.add(file ? `${PICTURE} ${name}` : name, from, nest)
      break
    }

    case 'text':
      sheet.add(
        kids.length ? inlineWords(kids, sheet.marks, sheet.flow) : textOf(token),
        where.take(raw),
        nest,
      )
      break

    case 'html':
      sheet.add(textOf(token).replace(HTML_TAG, '').trim(), where.take(raw), nest)
      break

    case 'blockquote':
      quote(token, where, nest, sheet)
      break

    case 'list':
      list(token, where, nest, sheet)
      break

    case 'table':
      table(token, where, nest, sheet)
      break

    case 'definitionList':
      definitions(token, where, nest, sheet)
      break

    case 'footnoteDef':
      footnote(token, where, nest, sheet)
      break

    default:
      sheet.add(textOf(token), where.take(raw), nest)
  }
}

function fence(token: Token, where: Locator, nest: Nest, sheet: Sheet): void {
  const info = ('lang' in token && typeof token.lang === 'string' ? token.lang : '').trim()
  const language = languageIn(info)
  const caption = captionIn(info)
  const raw = rawOf(token)
  const code = textOf(token)
  const from = where.take(raw)

  const drawn = language.toLowerCase() === 'chart' ? readChart(code) : null
  const called = drawn?.title ?? caption
  if (drawn && called) {
    sheet.add(`${PICTURE} ${called}`, from, nest)
    return
  }

  if (caption) sheet.add(caption, from, nest)

  let inside = from + Math.max(0, raw.indexOf(code))

  const marked = sheet.marks.fence
  if (marked) sheet.add(`${FENCE}${language}`, from, nest, { glued: caption !== '' })
  for (const [at, line] of code.split('\n').entries()) {
    sheet.add(line, inside, nest, { glued: marked || at > 0 })
    inside += line.length + 1
  }
  if (marked) {
    sheet.add(FENCE, from + raw.trimEnd().lastIndexOf('\n') + 1, nest, { glued: true })
  }
}

function onlyPicture(tokens: readonly Token[]): string | null {
  const shown = tokens.filter((one) => one.type !== 'text' || textOf(one).trim() !== '')
  const first = shown[0]
  if (shown.length !== 1 || first?.type !== 'image') return null

  const source = 'href' in first && typeof first.href === 'string' ? first.href : ''
  return textOf(first) || source || null
}

function quote(token: Token, where: Locator, nest: Nest, sheet: Sheet): void {
  const kids = childrenOf(token)
  const from = where.peek(rawOf(token))
  const inside: Nest = { depth: nest.depth, quote: nest.quote + 1 }

  const first = kids[0]
  const found = first && opensCallout(first) ? calloutOf(textOf(first)) : null
  if (found) {
    sheet.add(found.title || found.label.toUpperCase(), from, inside)
  }

  const cut = found ? found.taken : 0
  const body = found ? kids.map((one, at) => (at === 0 ? withoutCallout(one, cut) : one)) : kids
  walk(body, where, inside, sheet)
}

function withoutCallout(token: Token, cut: number): Token {
  const kids = childrenOf(token)
  const first = kids[0]
  if (first?.type === 'text') {
    return {
      ...token,
      tokens: [{ ...first, text: textOf(first).slice(cut) }, ...kids.slice(1)],
    }
  }

  return { ...token, text: textOf(token).slice(cut) }
}

function list(token: Token, where: Locator, nest: Nest, sheet: Sheet): void {
  const ordered = 'ordered' in token && token.ordered === true
  const start = 'start' in token && typeof token.start === 'number' ? token.start : 1
  const items = 'items' in token && Array.isArray(token.items) ? (token.items as Token[]) : []
  where.peek(rawOf(token))

  items.forEach((item, at) => {
    const from = where.peek(rawOf(item))
    const task = 'task' in item && item.task === true
    const done = 'checked' in item && item.checked === true
    const inside: Nest = { depth: nest.depth + 1, quote: nest.quote }
    const all = childrenOf(item)

    const box = all[0]
    if (box?.type === 'checkbox') where.take(rawOf(box))
    const kids = box?.type === 'checkbox' ? all.slice(1) : all

    const marker = task
      ? done
        ? TASK_DONE
        : TASK_OPEN
      : ordered
        ? `${String(start + at)}.`
        : (BULLETS[Math.min(nest.depth, BULLETS.length - 1)] ?? '-')

    const lead = kids[0]
    const leads = lead !== undefined && isLeading(lead)
    const words = leads
      ? inlineWords(childrenOf(lead).length ? childrenOf(lead) : [lead], sheet.marks, sheet.flow)
      : ''
    sheet.add(`${marker} ${words}`.trimEnd(), from, {
      depth: nest.depth,
      quote: nest.quote,
      listed: true,
    })
    if (leads) where.take(rawOf(lead))

    walk(leads ? kids.slice(1) : kids, where, inside, sheet)
  })
}

function isLeading(token: Token): boolean {
  return token.type === 'text' || token.type === 'paragraph'
}

function table(token: Token, where: Locator, nest: Nest, sheet: Sheet): void {
  const one = token as Tokens.Table
  const cells = (row: readonly Tokens.TableCell[]) =>
    row.map((cell) => inlineWords(cell.tokens, sheet.marks, sheet.flow))

  const lines = tableLines(
    cells(one.header),
    one.rows.map((row) => cells(row)),
    one.align.map((given) => (given !== null && ALIGNS.has(given) ? given : 'left')),
    sheet.width - width(QUOTE.repeat(nest.quote) + STEP.repeat(nest.depth)),
  )
  const from = where.take(rawOf(token))
  const first = sheet.lineAt(from)
  for (const [at, line] of lines.entries()) {
    sheet.add(line, at === 0 ? from : (sheet.startOf(first + at) ?? from), nest, { glued: at > 0 })
  }
}

interface Definition {
  term: Token[]
  details: Token[][]
}

function definitions(token: Token, where: Locator, nest: Nest, sheet: Sheet): void {
  const items = 'items' in token && Array.isArray(token.items) ? (token.items as Definition[]) : []
  const from = where.take(rawOf(token))

  for (const item of items) {
    sheet.add(inlineWords(item.term, sheet.marks, sheet.flow), from, nest)
    for (const detail of item.details) {
      sheet.add(`: ${inlineWords(detail, sheet.marks, sheet.flow)}`, from, {
        depth: nest.depth + 1,
        quote: nest.quote,
      })
    }
  }
}

function footnote(token: Token, where: Locator, nest: Nest, sheet: Sheet): void {
  const id = 'id' in token && typeof token.id === 'string' ? token.id : ''
  const from = where.peek(rawOf(token))
  const mark = raise(id, SUPERS) ?? `[^${id}]`

  sheet.add(mark, from, nest)
  walk(childrenOf(token), where, { depth: nest.depth + 1, quote: nest.quote }, sheet)
}

export function markLines(source: string, options: MarkOptions): Line[] {
  const kept = noteWithoutComments(blockIdsBlanked(source))
  const body = stripFrontMatter(kept)
  const sheet = new Sheet(new Lines(kept), options.inner, options)
  const where = new Locator(kept, kept.length - body.length)
  walk(lexMarkdown(body), where, { depth: 0, quote: 0 }, sheet)

  return sheet.lines
}
