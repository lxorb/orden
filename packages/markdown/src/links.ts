import { closingTicks, CodeBlocks, OPENS, WORDS } from './fences'
import { frontMatterBlock } from './front-matter'
import { readInQuotes } from './yaml'

export interface Wikilink {
  target: string
  heading: string | null
  block: string | null
  alias: string | null
  embed: boolean
}

export type LinkKind = 'wikilink' | 'markdown'

export interface FoundLink extends Wikilink {
  kind: LinkKind
  from: number
  to: number
  targetFrom: number
  targetTo: number
  line: number
}

export const WIKILINK_INNER = '[^[\\]\\n]+'

const WIKILINK = new RegExp(`(${WIKILINK_INNER})\\]\\]`, 'y')

const LONGEST_LINK = 1000

const DEEPEST_PARENS = 32

const BLANK = /\s/

function endsTarget(one: string): boolean {
  return (one <= ' ' || one >= '\u0080') && BLANK.test(one)
}

interface MarkdownLink {
  label: string
  written: string
  writtenFrom: number
  to: number
}

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

export const MOST_LINKS = 5000

const BLOCK_ID = /(?:^|[ \t])\^([A-Za-z0-9-]+)[ \t]*(?=\r?$)/

function schemeOf(target: string): string {
  if (target.startsWith('//')) return 'https'
  return /^([a-z][a-z\d+.-]*):/i.exec(target)?.[1]?.toLowerCase() ?? ''
}

export function foldName(name: string): string {
  return name.normalize('NFC').toLowerCase()
}

export function isNoteTarget(target: string): boolean {
  return schemeOf(target) === ''
}

export const PDF_SIDECAR = '.highlights.json'

export function isPdfTarget(target: string): boolean {
  return /\.pdf$/i.test(target.trim())
}

export function isCanvasTarget(target: string): boolean {
  return /\.canvas$/i.test(target.trim())
}

export function isBaseTarget(target: string): boolean {
  return /\.base$/i.test(target.split('#')[0]?.trim() ?? '')
}

export function isChatTarget(target: string): boolean {
  return /\.chat$/i.test(target)
}

export function isApplicationTarget(target: string | null): boolean {
  return target !== null && /\.application$/i.test(target)
}

export function isTermTarget(target: string | null): boolean {
  return target !== null && /\.term$/i.test(target)
}

export function isPagesTarget(target: string): boolean {
  return /\.pages$/i.test(target.trim())
}

export function isWebTarget(target: string): boolean {
  return /\.(url|webloc)$/i.test(target.trim())
}

const IMAGE = /\.(a?png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i

export function isImageTarget(target: string): boolean {
  return IMAGE.test(target.trim())
}

const AUDIO = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|weba)$/i

const VIDEO = /\.(mp4|m4v|webm|mov|ogv|mkv|avi)$/i

export function isAudioTarget(target: string): boolean {
  return AUDIO.test(target.trim())
}

export function isVideoTarget(target: string): boolean {
  return VIDEO.test(target.trim())
}

export type EmbedKind = 'image' | 'audio' | 'video' | 'pdf' | 'canvas' | 'base'

export function embedKind(target: string): EmbedKind | null {
  if (isImageTarget(target)) return 'image'
  if (isVideoTarget(target)) return 'video'
  if (isAudioTarget(target)) return 'audio'
  if (isPdfTarget(target)) return 'pdf'
  if (isCanvasTarget(target)) return 'canvas'
  if (isBaseTarget(target)) return 'base'

  return null
}

export function isTabFile(target: string): boolean {
  return (
    isPdfTarget(target) ||
    isCanvasTarget(target) ||
    isPagesTarget(target) ||
    isWebTarget(target) ||
    isBaseTarget(target)
  )
}

const SIZE = /^(\d+)(?:x(\d+))?$/

export function embedSize(alias: string | null): { width: number; height: number | null } | null {
  const found = alias === null ? null : SIZE.exec(alias)
  if (!found || Number(found[1]) === 0) return null

  const height = found[2]
  return { width: Number(found[1]), height: height === undefined ? null : Number(height) }
}

export function sizedAlt(alt: string): {
  alt: string
  size: { width: number; height: number | null } | null
} {
  const found = /^(.*?)\\?\|(\d+(?:x\d+)?)$/su.exec(alt)
  const size = found ? embedSize(found[2] ?? '') : null
  return found && size ? { alt: found[1] ?? '', size } : { alt, size: null }
}

export function pageFragment(fragment: string | null): number | null {
  const digits = fragment === null ? null : /^page=(\d+)$/i.exec(fragment.trim())?.[1]
  if (digits === undefined || digits === null) return null

  const page = Number(digits)
  return page >= 1 ? page : null
}

export function parseWikilink(inner: string, embed = false): Wikilink | null {
  const bar = inner.indexOf('|')
  const named = bar === -1 ? inner : inner.slice(0, bar).replace(/\\$/, '')
  const alias = bar === -1 ? null : inner.slice(bar + 1).trim()

  const hash = named.indexOf('#')
  const target = (hash === -1 ? named : named.slice(0, hash)).trim()
  const fragment = hash === -1 ? '' : named.slice(hash + 1).trim()

  const block = fragment.startsWith('^') ? fragment.slice(1) : null
  const heading = block === null && fragment ? fragment : null

  if (!target && !heading && !block) return null

  return { target, heading, block, alias: alias === '' ? null : alias, embed }
}

const NOT_IN_WIKILINK = /[#^[\]|`]/

export function wikilinkCannotName(name: string): boolean {
  return NOT_IN_WIKILINK.test(name)
}

export function formatWikilink(link: Wikilink): string {
  const alias = link.alias === null ? '' : `|${link.alias}`
  return `${link.embed ? '!' : ''}[[${linkTarget(link)}${alias}]]`
}

export function linkTarget(link: Wikilink): string {
  if (link.block !== null) return `${link.target}#^${link.block}`
  if (link.heading !== null) return `${link.target}#${link.heading}`
  return link.target
}

export function shownText(link: Wikilink): string {
  return link.alias ?? linkTarget(link)
}

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

function escaped(line: string, from: number, at: number): boolean {
  let slashes = 0
  while (at - slashes > from && line[at - slashes - 1] === '\\') slashes++
  return slashes % 2 === 1
}

export function withoutCode(line: string): string {
  let out = ''
  let at = 0

  while (at < line.length) {
    const tick = line.indexOf('`', at)
    if (tick === -1) {
      out += line.slice(at)
      break
    }

    if (escaped(line, at, tick)) {
      out += line.slice(at, tick + 1)
      at = tick + 1
      continue
    }

    let openEnd = tick
    while (openEnd < line.length && line[openEnd] === '`') openEnd++
    const marks = line.slice(tick, openEnd)
    const close = closingTicks(line, openEnd, marks.length)

    out += line.slice(at, tick)
    if (close === -1) {
      out += marks
      at = openEnd
      continue
    }

    out += ' '.repeat(close + marks.length - tick)
    at = close + marks.length
  }

  return out
}

export function findLinks(text: string): FoundLink[] {
  const found: FoundLink[] = []

  for (const row of lines(text)) {
    if (found.length >= MOST_LINKS) break
    if (row.matter) collectInMatter(row, found)
    else if (!row.code) collect(withoutCode(row.text), row.from, row.line, found)
  }

  return found.length > MOST_LINKS ? found.slice(0, MOST_LINKS) : found
}

function collectInMatter(row: Row, found: FoundLink[]) {
  const read = readInQuotes(row.text)
  const local: FoundLink[] = []
  collect(withoutCode(read.text), 0, row.line, local)
  const raw = (at: number) => row.from + (read.at[at] ?? row.text.length)

  for (const link of local) {
    found.push({
      ...link,
      from: raw(link.from),
      to: raw(link.to),
      targetFrom: raw(link.targetFrom),
      targetTo: raw(link.targetTo),
    })
  }
}

export interface Row {
  text: string
  from: number
  line: number
  code: boolean
  matter: boolean
  fenceName: string | null
}

export function* lines(text: string): Generator<Row> {
  const code = new CodeBlocks()
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

function collect(line: string, offset: number, at: number, found: FoundLink[]) {
  if (!line.includes('[')) return
  const ends = line.includes('](') ? labelEnds(line) : new Map<number, number>()

  for (let open = line.indexOf('['); open !== -1; open = line.indexOf('[', open + 1)) {
    if (line[open - 1] === '\\') continue

    const embed = line[open - 1] === '!' && line[open - 2] !== '\\'
    const from = offset + (embed ? open - 1 : open)

    if (line[open + 1] === '[') {
      WIKILINK.lastIndex = open + 2
      const inner = WIKILINK.exec(line)?.[1]
      if (inner === undefined) continue

      const link = parseWikilink(inner, embed)
      const closed = open + 2 + inner.length + 2
      if (link) {
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

const ESCAPES = /(?:%[0-9A-Fa-f]{2})+/g

const UTF8 = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true })

const WRITTEN = /\\([!-/:-@[-`{-~])|(?:%[0-9A-Fa-f]{2})+/g

const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

function bytesOf(run: string): Uint8Array {
  return Uint8Array.from(run.slice(1).split('%'), (hex) => Number.parseInt(hex, 16))
}

export function decodeTarget(target: string): string {
  try {
    return target.replace(WRITTEN, (run, mark?: string) => mark ?? STRICT_UTF8.decode(bytesOf(run)))
  } catch {
    return target
  }
}

export function encodeTarget(path: string): string {
  return encodeURI(path).replace(/[#?()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

export function decodeFragment(fragment: string): string {
  return fragment.replace(ESCAPES, (run) => UTF8.decode(bytesOf(run)))
}

export function blockIdOf(line: string): string | null {
  if (!line.includes('^')) return null
  return BLOCK_ID.exec(line)?.[1] ?? null
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s+/g, '-') || 'section'
  )
}

const HEADING = /^[ \t]{0,3}(#{1,6})[ \t]+(.*)\r?$/

const HEADING_LINE = /^[ \t]{0,3}#{1,6}((?:[ \t].*)?)\r?$/

const CLOSING_HASHES = /[ \t]+#+[ \t]*$/

export function isHeading(line: string): boolean {
  return HEADING.test(line)
}

export function headingText(line: string): string {
  const found = HEADING_LINE.exec(line)
  if (found === null) return line.trim()

  return (found[1] ?? '').replace(CLOSING_HASHES, '').trim()
}

export function headingsOf(text: string): string[] {
  const found: string[] = []

  for (const row of lines(text)) {
    if (row.code || row.matter) continue
    if (HEADING.test(row.text)) found.push(headingText(row.text))
  }

  return found
}

export function sectionOf(
  source: string,
  link: Pick<Wikilink, 'heading' | 'block'>,
): string | null {
  if (link.block !== null) return blockSection(source, link.block)
  if (link.heading !== null) return headingSection(source, link.heading)
  return source
}

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

function blockSection(source: string, wanted: string): string | null {
  const found = blockIds(source).find((one) => one.id === wanted)
  if (!found) return null

  const { first, last, indent } = blockSpan(rowsOf(source), found.line)
  return source
    .split('\n')
    .slice(first, last + 1)
    .map((line, at) => (first + at === found.line ? line.replace(BLOCK_ID, '') : line))
    .map((line) => line.slice(Math.min(indent, depthOf(line))))
    .join('\n')
    .trimEnd()
}

type Lined = Pick<Row, 'text' | 'code' | 'matter' | 'fenceName'>

const MATHS_CLOSE = /^\s*\$\$\s*(?:\^[\w-]+\s*)?$/u

const OPENERS: readonly {
  opens: RegExp
  closes: (line: string, tag: string) => boolean
}[] = [
  { opens: /^\s*\$\$\s*$/u, closes: (line) => MATHS_CLOSE.test(line) },
  { opens: /^\s*<!--/u, closes: (line) => line.includes('-->') },
  {
    opens: /^\s*<(pre|script|style|textarea)\b/iu,
    closes: (line, tag) => line.toLowerCase().includes(`</${tag}>`),
  },
]

export interface Held {
  first: number
  last: number
}

export function heldBlocks(rows: readonly Lined[]): Map<number, Held> {
  const held = new Map<number, Held>()
  const missing = new Set<string>()
  for (let at = 0; at < rows.length; at++) {
    const row = rows[at]
    if (!row || row.code || row.matter) continue
    const found = OPENERS.map((kind) => ({ kind, match: kind.opens.exec(row.text) })).find(
      (one) => one.match,
    )
    if (!found?.match) continue
    const tag = (found.match[1] ?? '').toLowerCase()
    const key = `${found.kind.opens.source}${tag}`
    const rest = row.text.slice(found.match.index + found.match[0].length)
    if (missing.has(key) || (found.match[0].includes('<') && found.kind.closes(rest, tag))) continue
    let last = at + 1
    while (
      last < rows.length &&
      !rows[last]?.matter &&
      !found.kind.closes(rows[last]?.text ?? '', tag)
    ) {
      last++
    }
    if (last >= rows.length || rows[last]?.matter) {
      missing.add(key)
      continue
    }
    const block = { first: at, last }
    for (let line = at; line <= last; line++) held.set(line, block)
    at = last
  }
  return held
}

export interface Layout {
  held: Map<number, Held>
  goesOn: boolean[]
  runOf: number[]
  unclosed: Set<number>
}

export function layoutOf(rows: readonly Lined[]): Layout {
  const runOf: number[] = []
  const unclosed = new Set<number>()
  const code = new CodeBlocks()
  let start = -1
  let fenced = false
  let closed = false
  const ends = () => {
    if (start !== -1 && fenced && !closed) unclosed.add(start)
  }
  for (let at = 0; at < rows.length; at++) {
    const row = rows[at]
    const open = code.fence
    const kind = !row || row.matter ? WORDS : code.line(row.text)
    if (kind === WORDS) {
      ends()
      start = -1
      runOf.push(-1)
      continue
    }
    if (kind === OPENS || start === -1 || closed) {
      ends()
      start = at
      fenced = kind === OPENS
      closed = false
    }
    runOf.push(start)
    if (kind !== OPENS && open !== null && code.fence === null) {
      if (!code.closedFence) unclosed.add(start)
      closed = true
    }
  }
  ends()

  const goesOn: boolean[] = new Array<boolean>(rows.length).fill(false)
  let next = -1
  for (let at = rows.length - 1; at >= 0; at--) {
    const row = rows[at]
    const blank = (row?.text.trim() ?? '') === ''
    goesOn[at] =
      row?.code === true &&
      (!blank || (next !== -1 && rows[next]?.code === true && runOf[next] === runOf[at]))
    if (!blank) next = at
  }
  return { held: heldBlocks(rows), goesOn, runOf, unclosed }
}

export interface BlockSpan {
  first: number
  last: number
  indent: number
  apart: boolean
}

export function blockSpan(rows: readonly Lined[], at: number): BlockSpan {
  const text = (line: number) => rows[line]?.text ?? ''
  const filled = (line: number) => text(line).trim() !== '' && rows[line]?.matter !== true
  const { held: blocks, goesOn, runOf } = layoutOf(rows)
  const held = (line: number) => filled(line) || goesOn[line] === true || blocks.has(line)
  const row = rows[at]

  if (row?.code && row.fenceName) {
    return { first: runOf[at] ?? at, last: at, indent: 0, apart: false }
  }

  const plain = (line: number) => rows[line]?.code !== true && !blocks.has(line)
  const reach = (from: number, apart = false) => {
    let first = from
    for (; first > 0 && held(first - 1) && blocks.get(first - 1) === blocks.get(first); first--) {
      const above = first - 1
      if (plain(above) && HEADING.test(text(above)) && !itemLines(rows, above, blocks)) break
      const loose = (line: number) => !itemLines(rows, line, blocks)
      if (apart && rows[first]?.code && plain(above) && loose(first)) break
      if (apart && plain(first) && rows[above]?.code && loose(first)) break
      const opens = plain(first) && LIST_ITEM.test(text(first))
      if (opens && plain(above) && !LIST_ITEM.test(text(above)) && loose(above)) break
    }
    return first
  }

  if (ownLine(text(at)) && !row?.code) {
    if (at > 0 && !held(at - 1)) {
      let last = at - 1
      while (last > 0 && !held(last)) last--
      const quote = quoteAround(rows, last)
      const first = quote && !itemLines(rows, quote.first, blocks) ? quote.first : reach(last, true)
      return { first, last, indent: 0, apart: true }
    }
    return {
      first: at > 0 && blocks.has(at - 1) ? reach(at - 1) : reach(at),
      last: at,
      indent: 0,
      apart: false,
    }
  }

  if (row && !row.code && HEADING.test(row.text)) {
    return { first: at, last: at, indent: 0, apart: false }
  }

  const item = itemLines(rows, at)
  if (item) return { ...item, apart: false }

  const inside = blocks.get(at) ?? quoteAround(rows, at)
  if (inside) return { first: inside.first, last: inside.last, indent: 0, apart: false }

  const quoted = quotedRows(rows)
  const stops = (line: number) => {
    const one = rows[line]
    return (
      !filled(line) ||
      !one ||
      one.code ||
      blocks.has(line) ||
      quoted[line] === true ||
      LIST_ITEM.test(one.text) ||
      HEADING.test(one.text)
    )
  }
  let first = at
  let last = at
  while (first > 0 && !stops(first - 1)) first--
  while (last + 1 < rows.length && !stops(last + 1)) last++
  return { first, last, indent: 0, apart: false }
}

export const LIST_ITEM = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]/

export function nameIndent(rows: readonly Lined[], at: number): string {
  const code = new CodeBlocks()
  for (let line = 0; line <= at && line < rows.length; line++) {
    const row = rows[line]
    if (row && !row.matter) code.line(row.text)
  }
  return ' '.repeat(code.listWidth)
}

export function openFenceIn(rows: readonly Lined[], first: number, last: number): boolean {
  const { runOf, unclosed } = layoutOf(rows)
  for (let line = first; line <= last; line++) {
    if (rows[line]?.code && unclosed.has(runOf[line] ?? -1)) return true
  }
  return false
}

export function quotedRows(rows: readonly Lined[]): boolean[] {
  const code = new CodeBlocks()
  const held = heldBlocks(rows)
  return rows.map((row, at) => {
    if (held.has(at)) {
      code.line('')
      return false
    }
    if (row.matter) return false
    code.line(row.text)
    return code.quoted
  })
}

export function quoteAround(rows: readonly Lined[], at: number): Held | null {
  const inQuote = quotedRows(rows)
  const quoted = (line: number) => inQuote[line] === true
  if (!quoted(at)) return null
  let first = at
  let last = at
  while (first > 0 && quoted(first - 1)) first--
  while (last + 1 < rows.length && quoted(last + 1)) last++
  return { first, last }
}

export function itemLines(
  rows: readonly Lined[],
  at: number,
  blocks: Map<number, Held> = heldBlocks(rows),
): { first: number; last: number; indent: number } | null {
  const first = itemStart(rows, at, blocks)
  if (first === null) return null

  const marker = LIST_ITEM.exec(rows[first]?.text ?? '')
  const indent = depthOf(marker?.[1] ?? '')
  const content = depthOf(marker?.[0].replace(/\S/gu, ' ') ?? '')
  const depth = (line: number) => depthOf(rows[line]?.text ?? '')
  let last = first
  while (last + 1 < rows.length) {
    const next = rows[last + 1]
    if (!next) break
    const held = blocks.get(last + 1)
    if (held && depth(held.first) >= content) {
      last = held.last
      continue
    }
    if (!next.code && !next.text.trim()) {
      let ahead = last + 2
      while (ahead < rows.length && !rows[ahead]?.text.trim()) ahead++
      if (ahead < rows.length && depth(ahead) >= content) {
        last = ahead - 1
        continue
      }
      break
    }
    if (
      next.code ? next.text.trim() !== '' && depth(last + 1) < content : depth(last + 1) <= indent
    ) {
      break
    }
    last++
  }
  return { first, last, indent: marker?.[1]?.length ?? 0 }
}

function itemStart(rows: readonly Lined[], at: number, blocks: Map<number, Held>): number | null {
  const line = rows[at]?.text ?? ''
  if (!rows[at]?.code && !blocks.has(at) && LIST_ITEM.test(line)) return at

  const block = rows[at]?.code === true || blocks.has(at)
  let opening = blocks.get(at)?.first ?? at
  while (rows[at]?.code && opening > 0 && rows[opening - 1]?.code) opening--
  const depth = depthOf(rows[opening]?.text ?? line)
  if (depth === 0) return null
  for (let up = opening - 1; up >= 0; up--) {
    const above = rows[up]
    if (!above || above.matter) return null
    if (!above.code && !above.text.trim()) {
      if (block) continue
      return null
    }
    const marker = above.code || blocks.has(up) ? null : LIST_ITEM.exec(above.text)
    const content = depthOf(marker?.[0].replace(/\S/gu, ' ') ?? '')
    if (marker && depthOf(marker[1] ?? '') < depth && (!block || depth >= content)) {
      return up
    }
    if (block && !above.code && !marker && depthOf(above.text) === 0) return null
  }
  return null
}

function depthOf(line: string): number {
  let width = 0
  for (const one of line) {
    if (one === '\t') width += 4 - (width % 4)
    else if (one === ' ') width++
    else break
  }
  return width
}

export function ownLine(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith('^') && blockIdOf(trimmed) === trimmed.slice(1)
}

export function freeBlockId(taken: ReadonlySet<string>): string {
  for (;;) {
    const id = Math.random().toString(36).slice(2, 8)
    if (id.length === 6 && !taken.has(id)) return id
  }
}

export function blockIds(text: string): { id: string; line: number }[] {
  const found: { id: string; line: number }[] = []

  for (const row of lines(text)) {
    const id = row.code ? row.fenceName : blockIdOf(row.text)
    if (id) found.push({ id, line: row.line })
  }

  return found
}

export interface NoteBlock {
  line: number
  text: string
  id: string | null
}

const BLOCK_LABEL = 80

export function blocksOf(text: string): NoteBlock[] {
  const found: NoteBlock[] = []
  let current: NoteBlock | null = null
  let run: NoteBlock | null = null
  let after = false

  let listing = false

  const rows = rowsOf(text)
  const { held: blocks, goesOn } = layoutOf(rows)
  const quoted = quotedRows(rows)
  for (const row of rows) {
    const holding = blocks.get(row.line)
    const inside = holding !== undefined && holding.first !== row.line
    const closed = blocks.get(row.line - 1)
    const bound =
      holding?.first === row.line ? holding : closed?.last === row.line - 1 ? closed : null
    const before = rows[row.line - 1]
    const turns = row.line > 0 && quoted[row.line] !== quoted[row.line - 1]
    const coded = !!before && !inside && row.code !== before.code
    const nested = listing && depthOf((bound ? rows[bound.first] : row)?.text ?? '') > 0
    const codeNested = listing && depthOf((row.code ? row : before)?.text ?? '') > 0
    const edge = ((!!bound || turns) && !nested) || (coded && !codeNested)
    if (row.matter || (row.text.trim() === '' && goesOn[row.line] !== true && !inside)) {
      current = null
      run = null
      after = false
      continue
    }

    const above = run ?? found.at(-1)
    if (above && !row.code && ownLine(row.text)) {
      above.id = blockIdOf(row.text)
      continue
    }

    const heading = !row.code && HEADING.test(row.text)
    const starts = heading || (!row.code && LIST_ITEM.test(row.text)) || after
    if (!current || (starts && !inside) || edge) {
      current = { line: row.line, text: firstWords(row.text), id: null }
      found.push(current)
      run ??= current
      listing = !row.code && !inside && LIST_ITEM.test(row.text)
    }

    after = heading
    const id = row.code ? row.fenceName : blockIdOf(row.text)
    if (id) current.id = id
  }

  return found
}

export function withoutBlockIds(text: string): string {
  return replacingBlockIds(text, (kept) => kept)
}

export function blockIdsBlanked(text: string): string {
  return replacingBlockIds(
    text,
    (kept, length, row) => kept + (row.code ? ' ' : '\t').repeat(length),
  )
}

const ANCHOR_OPEN = '\uE0F0'
const ANCHOR_CLOSE = '\uE0F1'

const TABLE_RULE = /^\s*\|?[\s:|-]+\|?\s*$/

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

export function blockMarksOff(text: string): string {
  if (!text.includes(ANCHOR_OPEN)) return text
  return text.replace(new RegExp(`\\s?${ANCHOR_OPEN}[\\w-]+${ANCHOR_CLOSE}`, 'g'), '')
}

export function blockAnchorsDrawn(html: string): string {
  if (!html.includes(ANCHOR_OPEN)) return html
  const mark = `${ANCHOR_OPEN}([\\w-]+)${ANCHOR_CLOSE}`
  const anywhere = new RegExp(`\\s?${mark}`, 'g')
  const anchor = (id: string) => `<span id="^${id}"></span>`
  return html
    .replace(/<[a-z/](?:"[^"]*"|'[^']*'|[^'"<>])*>/gi, (tag) => tag.replace(anywhere, ''))
    .replace(new RegExp(`<p>\\s*${mark}\\s*</p>`, 'g'), (_, id: string) => anchor(id))
    .replace(new RegExp(mark, 'g'), (_, id: string) => anchor(id))
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
    const before = text[caret - 1]
    const from = before === ' ' || before === '\t' ? caret - 1 : caret

    out += by(text.slice(at, from), end - from, row, id)
    at = end
  }

  return at === 0 ? text : out + text.slice(at)
}

function firstWords(line: string): string {
  return line
    .replace(BLOCK_ID, '')
    .replace(/^\s*>?\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)?/, '')
    .trim()
    .slice(0, BLOCK_LABEL)
}
