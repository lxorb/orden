import type { PaperTwips } from '../page-setup'
import type { Align, Block, Doc, Item, Span } from './document'
import type { Picture } from './pictures'

const BLACK = 1
const GREY = 2
const LINK = 3
const SHADE = 4
const WASH = 5

const TONE_COLOURS: Record<number, number> = { 1: 6, 2: 7, 4: 8, 5: 9, 6: 10 }

const TONE_WASHES = [
  '\\red250\\green210\\blue215',
  '\\red251\\green225\\blue199',
  '\\red201\\green240\\blue216',
  '\\red199\\green238\\blue238',
  '\\red225\\green217\\blue251',
].join(';')

const HEADER = [
  '{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1',
  '{\\fonttbl',
  '{\\f0\\froman\\fcharset0 Georgia{\\*\\falt Times New Roman};}',
  '{\\f1\\fswiss\\fcharset0 Segoe UI{\\*\\falt Arial};}',
  '{\\f2\\fmodern\\fcharset0 Consolas{\\*\\falt Courier New};}',
  '}',
  '{\\colortbl;\\red0\\green0\\blue0;\\red90\\green90\\blue90;\\red17\\green85\\blue204;',
  '\\red238\\green238\\blue238;\\red255\\green242\\blue160;',
  `${TONE_WASHES};}`,
].join('')

const STEP = 720

const BODY = '\\sa180\\sl276\\slmult1\\f0\\fs22'

const TIGHT = '\\sa60\\f0\\fs22'

const TERM = '\\sb120\\sa40\\f0\\fs22'

const QUOTE = '\\brdrl\\brdrs\\brdrw20\\brsp80'

const RULE = '\\pard\\brdrb\\brdrs\\brdrw10\\brsp20\\par\n'

const BORDERS = ['t', 'l', 'b', 'r'].map((side) => `\\clbrdr${side}\\brdrs\\brdrw10`).join('')

const SPECIAL: Record<number, string> = {
  0x5c: '\\\\',
  0x7b: '\\{',
  0x7d: '\\}',
  0x09: '\\tab ',
  0x0a: '\\line ',
  0x0d: '',
}

function escaped(text: string): string {
  let out = ''

  for (let at = 0; at < text.length; at += 1) {
    const unit = text.charCodeAt(at)
    const special = SPECIAL[unit]

    if (special !== undefined) out += special
    else if (unit === 0xa0) out += '\\~'
    else if (unit < 0x80) out += String.fromCharCode(unit)
    else out += `\\u${unit >= 0x8000 ? unit - 0x10000 : unit}?`
  }

  return out
}

function page(paper: PaperTwips): string {
  const width = paper.landscape ? paper.height : paper.width
  const height = paper.landscape ? paper.width : paper.height
  const margin = `\\margl${paper.margin}\\margr${paper.margin}\\margt${paper.margin}\\margb${paper.margin}`

  return `\\paperw${width}\\paperh${height}${margin}${paper.landscape ? '\\landscape' : ''}\\ftnbj`
}

function running(paper: PaperTwips): string {
  const line = (word: string, text: string) =>
    `{\\${word}\\pard\\plain\\qc\\f0\\fs18\\cf${GREY} ${escaped(text)}\\par}`

  return (
    (paper.header ? line('header', paper.header) : '') +
    (paper.footer ? line('footer', paper.footer) : '')
  )
}

function columnOf(paper: PaperTwips): number {
  const width = paper.landscape ? paper.height : paper.width

  return Math.max(STEP, width - 2 * paper.margin)
}

interface Mark {
  of: (span: Span) => boolean
  on: string | ((span: Span) => string)
  off: string
}

const MARKS: readonly Mark[] = [
  { of: (span) => span.bold === true, on: '\\b', off: '\\b0' },
  { of: (span) => span.italic === true, on: '\\i', off: '\\i0' },
  { of: (span) => span.strike === true, on: '\\strike', off: '\\strike0' },
  {
    of: (span) => span.mark === true,
    on: (span) => `\\highlight${TONE_COLOURS[span.tone ?? 0] ?? WASH}`,
    off: '\\highlight0',
  },
  { of: (span) => span.sup === true, on: '\\super', off: '\\nosupersub' },
  { of: (span) => span.sub === true, on: '\\sub', off: '\\nosupersub' },
  { of: (span) => span.maths === true, on: '\\f2', off: '\\f0' },
  { of: (span) => span.code === true, on: `\\f2\\cf${GREY}`, off: `\\cf${BLACK}\\f0` },
]

function marked(span: Span, words: string): string {
  const on: string[] = []
  const off: string[] = []

  for (const mark of MARKS) {
    if (!mark.of(span)) continue
    on.push(typeof mark.on === 'string' ? mark.on : mark.on(span))
    off.unshift(mark.off)
  }

  return on.length ? `{${on.join('')} ${words}${off.join('')}}` : words
}

function hyperlink(href: string, words: string): string {
  const address = escaped(href.replace(/"/g, '%22'))
  return `{\\field{\\*\\fldinst{HYPERLINK "${address}"}}{\\fldrslt{\\cf${LINK}\\ul ${words}}}}`
}

function bolded(spans: readonly Span[]): Span[] {
  return spans.map((span) => ({ ...span, bold: true }))
}

interface Sheet {
  doc: Doc
  pictures: Map<string, Picture>
  open: Set<string>
  column: number
}

function footnote(label: string, sheet: Sheet): string {
  const found = sheet.doc.notes.find((note) => note.label === label)
  if (!found || sheet.open.has(label)) return `{\\super ${escaped(label)}}`

  sheet.open.add(label)
  const words = runs(found.spans, sheet)
  sheet.open.delete(label)

  return `{\\super\\chftn}{\\footnote\\pard\\plain\\fs20\\chftn\\space\\tab ${words}}`
}

interface Size {
  width: number
  height: number
}

function be16(bytes: Uint8Array, at: number): number | null {
  const high = bytes[at]
  const low = bytes[at + 1]

  return high === undefined || low === undefined ? null : high * 256 + low
}

function be32(bytes: Uint8Array, at: number): number | null {
  const high = be16(bytes, at)
  const low = be16(bytes, at + 2)

  return high === null || low === null ? null : high * 65536 + low
}

function sized(width: number | null, height: number | null): Size | null {
  if (width === null || height === null || width < 1 || height < 1) return null

  return { width, height }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const IHDR = 0x49484452

function pngSize(bytes: Uint8Array): Size | null {
  if (PNG_SIGNATURE.some((byte, at) => bytes[at] !== byte)) return null
  if (be32(bytes, 12) !== IHDR) return null

  return sized(be32(bytes, 16), be32(bytes, 20))
}

const BARE = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9])

function isFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
}

function jpegSize(bytes: Uint8Array): Size | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null

  let at = 2
  while (at + 1 < bytes.length) {
    if (bytes[at] !== 0xff) return null

    const marker = bytes[at + 1]
    if (marker === undefined) return null
    if (marker === 0xff) {
      at += 1
      continue
    }
    if (BARE.has(marker)) {
      at += 2
      continue
    }

    const length = be16(bytes, at + 2)
    if (length === null || length < 2) return null
    if (isFrame(marker)) return sized(be16(bytes, at + 7), be16(bytes, at + 5))

    at += 2 + length
  }

  return null
}

const BLIPS: Record<string, { word: string; size: (bytes: Uint8Array) => Size | null }> = {
  'image/png': { word: '\\pngblip', size: pngSize },
  'image/jpeg': { word: '\\jpegblip', size: jpegSize },
}

const PER_PIXEL = 1440 / 96

function goal(size: Size, column: number): Size {
  const width = Math.round(size.width * PER_PIXEL)
  const height = Math.round(size.height * PER_PIXEL)
  if (width <= column) return { width, height }

  return { width: column, height: Math.round((height * column) / width) }
}

const HEX_WIDTH = 120

function hex(bytes: Uint8Array): string {
  const digits: string[] = []
  for (const byte of bytes) digits.push(byte.toString(16).padStart(2, '0'))

  const all = digits.join('')
  const lines: string[] = []
  for (let at = 0; at < all.length; at += HEX_WIDTH) lines.push(all.slice(at, at + HEX_WIDTH))

  return lines.join('\n')
}

function pictureRun(span: Span, sheet: Sheet): string {
  const found = sheet.pictures.get(span.picture ?? '')
  const blip = found ? BLIPS[found.mime] : undefined
  const size = found && blip ? blip.size(found.bytes) : null

  if (!found || !blip || !size) return `[${escaped(span.text === '' ? 'picture' : span.text)}]`

  const drawn = goal(size, sheet.column)
  const props = `${blip.word}\\picw${size.width}\\pich${size.height}`

  return `{\\pict${props}\\picwgoal${drawn.width}\\pichgoal${drawn.height}\n${hex(found.bytes)}}`
}

function runOf(span: Span, sheet: Sheet): string {
  if (span.picture !== undefined) return pictureRun(span, sheet)
  if (span.note !== undefined) return footnote(span.note, sheet)

  const words = marked(span, escaped(span.text))

  return span.href === undefined ? words : hyperlink(span.href, words)
}

function runs(spans: readonly Span[], sheet: Sheet): string {
  return spans.map((span) => runOf(span, sheet)).join('')
}

interface Frame {
  indent: number
  border: string
}

const ROOT: Frame = { indent: 0, border: '' }

function opened(frame: Frame, props: string, lead = ''): string {
  const indent = frame.indent > 0 ? `\\li${frame.indent}` : ''

  return `\\pard\\plain${frame.border}${lead}${indent}${props} `
}

function paragraph(spans: readonly Span[], sheet: Sheet, frame: Frame, props = BODY): string {
  return `${opened(frame, props)}${runs(spans, sheet)}\\par\n`
}

const HEADINGS = [
  { size: 36, before: 360, after: 160 },
  { size: 32, before: 320, after: 150 },
  { size: 28, before: 300, after: 140 },
  { size: 26, before: 280, after: 130 },
  { size: 24, before: 260, after: 120 },
  { size: 22, before: 240, after: 110 },
] as const

function heading(block: Extract<Block, { kind: 'heading' }>, sheet: Sheet, frame: Frame): string {
  const level = Math.min(Math.max(Math.round(block.level), 1), HEADINGS.length)
  const style = HEADINGS[level - 1] ?? HEADINGS[0]
  const air = `\\sb${style.before}\\sa${style.after}`
  const props = `\\keepn${air}\\outlinelevel${level - 1}\\f1\\fs${style.size}\\b`

  return `${opened(frame, props)}${runs(block.spans, sheet)}\\b0\\par\n`
}

function lined(text: string, frame: Frame, props: string): string {
  const lines = text.replace(/\n$/, '').split('\n')

  return lines
    .map((line, at) => {
      const air = at === lines.length - 1 ? 180 : 0
      return `${opened(frame, `\\sb0\\sa${air}${props}`)}${escaped(line)}\\par\n`
    })
    .join('')
}

function marker(block: Extract<Block, { kind: 'list' }>, at: number): string {
  if (!block.ordered) {
    return '{\\pntext\\f0\\bullet\\tab}{\\*\\pn\\pnlvlblt\\pnf0\\pnindent0{\\pntxtb\\bullet}}'
  }

  const number = block.start + at
  const pn = `\\pnlvlbody\\pnf0\\pnindent0\\pnstart${number}\\pndec{\\pntxta.}`

  return `{\\pntext\\f0 ${number}.\\tab}{\\*\\pn${pn}}`
}

const CHECKS = { true: '\\u9745?', false: '\\u9744?' }

function itemRtf(item: Item, lead: string, sheet: Sheet, frame: Frame): string {
  const inner: Frame = { ...frame, indent: frame.indent + STEP }
  const check = item.checked === null ? '' : `${CHECKS[item.checked ? 'true' : 'false']} `
  const own = `${opened(inner, '\\fi-360\\sa60\\f0\\fs22', lead)}${check}`

  return `${own}${runs(item.spans, sheet)}\\par\n${blocksRtf(item.blocks, sheet, inner)}`
}

const ALIGNS: Record<'left' | 'center' | 'right', string> = {
  left: '\\ql',
  center: '\\qc',
  right: '\\qr',
}

function alignWord(align: Align | undefined): string {
  return align == null ? '\\ql' : ALIGNS[align]
}

function tableRtf(block: Extract<Block, { kind: 'table' }>, sheet: Sheet, frame: Frame): string {
  const rows = block.head.length ? [block.head, ...block.rows] : block.rows
  const columns = Math.max(1, ...rows.map((row) => row.length))
  const edges = Array.from(
    { length: columns },
    (_, at) => frame.indent + Math.round((sheet.column * (at + 1)) / columns),
  )

  const definition = (head: boolean) =>
    edges.map((edge) => `${BORDERS}${head ? `\\clcbpat${SHADE}` : ''}\\cellx${edge}`).join('')

  const cell = (spans: readonly Span[] | undefined, at: number, head: boolean) => {
    const bold = head ? '\\b' : ''
    const props = `\\intbl${alignWord(block.align[at])}\\f0\\fs22${bold}`
    const words = spans ? runs(spans, sheet) : ''

    return `\\pard\\plain${props} ${words}${head ? '\\b0' : ''}\\cell`
  }

  const row = (cells: readonly Span[][], head: boolean) => {
    const opening = `\\trowd\\trgaph108\\trleft${frame.indent}${definition(head)}\n`
    return `${opening}${edges.map((_, at) => cell(cells[at], at, head)).join('')}\\row\n`
  }

  return rows.map((cells, at) => row(cells, at === 0 && block.head.length > 0)).join('')
}

function blocksRtf(blocks: readonly Block[], sheet: Sheet, frame: Frame): string {
  const parts: string[] = []

  for (const block of blocks) {
    switch (block.kind) {
      case 'heading':
        parts.push(heading(block, sheet, frame))
        break

      case 'paragraph':
        parts.push(paragraph(block.spans, sheet, frame))
        break

      case 'code':
        parts.push(lined(block.code, frame, `\\cbpat${SHADE}\\f2\\fs18`))
        break

      case 'maths':
        parts.push(lined(block.tex, frame, '\\qc\\f2\\fs20'))
        break

      case 'quote': {
        const inner: Frame = { indent: frame.indent + STEP, border: QUOTE }
        if (block.label !== null) {
          parts.push(paragraph(bolded([{ text: block.label }]), sheet, inner, TIGHT))
        }
        parts.push(blocksRtf(block.blocks, sheet, inner))
        break
      }

      case 'list':
        block.items.forEach((item, at) => {
          parts.push(itemRtf(item, marker(block, at), sheet, frame))
        })
        break

      case 'table':
        parts.push(tableRtf(block, sheet, frame))
        break

      case 'terms': {
        const under: Frame = { ...frame, indent: frame.indent + STEP }
        for (const entry of block.entries) {
          parts.push(paragraph(bolded(entry.term), sheet, frame, TERM))
          for (const detail of entry.details) parts.push(paragraph(detail, sheet, under, TIGHT))
        }
        break
      }

      case 'rule':
        parts.push(RULE)
        break

      case 'break':
        parts.push('\\page\n')
        break
    }
  }

  return parts.join('')
}

const LANGS: Record<string, number> = {
  cs: 1029,
  da: 1030,
  de: 1031,
  en: 1033,
  es: 1034,
  fi: 1035,
  fr: 1036,
  it: 1040,
  ja: 1041,
  ko: 1042,
  nb: 1044,
  nl: 1043,
  no: 1044,
  pl: 1045,
  pt: 2070,
  ru: 1049,
  sv: 1053,
  tr: 1055,
  zh: 2052,
}

const DEFAULT_LANG = 1033

function langOf(lang: string): number {
  const base = lang.toLowerCase().split(/[-_]/)[0] ?? ''

  return LANGS[base] ?? DEFAULT_LANG
}

function info(doc: Doc): string {
  const parts: string[] = []
  if (doc.title !== '') parts.push(`{\\title ${escaped(doc.title)}}`)
  if (doc.author !== null && doc.author !== '') parts.push(`{\\author ${escaped(doc.author)}}`)

  return parts.length ? `{\\info${parts.join('')}}` : ''
}

export function toRtf(doc: Doc, pictures: readonly Picture[], paper: PaperTwips): string {
  const sheet: Sheet = {
    doc,
    pictures: new Map(pictures.map((picture) => [picture.src, picture])),
    open: new Set(),
    column: columnOf(paper),
  }

  const head = `${HEADER}\\deflang${langOf(doc.lang)}${page(paper)}${info(doc)}${running(paper)}`

  return `${head}\n${blocksRtf(doc.blocks, sheet, ROOT)}}`
}
