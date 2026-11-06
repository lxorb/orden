import { closingTicks, CodeBlocks, WORDS } from './fences'
import { frontMatterBlock } from './front-matter'

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

const NOT_IN_WIKILINK = /[#^[\]|]/

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

export function withoutCode(line: string): string {
  let out = ''
  let at = 0

  while (at < line.length) {
    const tick = line.indexOf('`', at)
    if (tick === -1) {
      out += line.slice(at)
      break
    }

    let openEnd = tick
    while (openEnd < line.length && line[openEnd] === '`') openEnd++
    const marks = line.slice(tick, openEnd)
    const close = closingTicks(line, openEnd, marks.length)

    out += line.slice(at, tick)
    if (close === -1) {
      out += line.slice(tick)
      break
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
    if (!row.code) collect(withoutCode(row.text), row.from, row.line, found)
  }

  return found.length > MOST_LINKS ? found.slice(0, MOST_LINKS) : found
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

const HEADING = /^\s{0,3}(#{1,6})\s+(.*)\r?$/

const HEADING_LINE = /^[ \t]{0,3}#{1,6}((?:[ \t].*)?)\r?$/

const CLOSING_HASHES = /[ \t]+#+[ \t]*$/

export function headingText(line: string): string {
  const found = HEADING_LINE.exec(line)
  if (found === null) return line.trim()

  return (found[1] ?? '').replace(CLOSING_HASHES, '').trim()
}

export function headingsOf(text: string): string[] {
  const found: string[] = []

  for (const row of lines(text)) {
    if (row.code) continue
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

export function ownLine(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith('^') && blockIdOf(trimmed) === trimmed.slice(1)
}

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

  for (const row of lines(text)) {
    if (!row.code && row.text.trim() === '') {
      current = null
      continue
    }

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
