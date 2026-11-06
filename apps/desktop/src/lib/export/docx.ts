import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  type FileChild,
  Footer,
  FootnoteReferenceRun,
  Header,
  HeadingLevel,
  HighlightColor,
  type INumberingOptions,
  type IParagraphPropertiesOptions,
  type ISectionPropertiesOptions,
  type IRunPropertiesOptions,
  type IStylesOptions,
  ImageRun,
  LevelFormat,
  LineRuleType,
  Math as Maths,
  PageBreak,
  PageOrientation,
  Packer,
  Paragraph,
  type ParagraphChild,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import { fromBase64 } from '../bytes'
import { type PaperTwips, TWIPS_PER_INCH } from '../page-setup'
import type { Align, Block, Doc, Entry, Item, Span } from './document'
import { ommlFor } from './omml'
import type { Picture } from './pictures'
import { legalXml } from './xml-legal'

const MONOSPACE = 'Consolas'

const INK = '1A1A1A'
const CODE_INK = '3F3F46'
const CODE_FILL = 'F5F5F5'
const HEAD_FILL = 'EFEFEF'
const LINE = 'BFBFBF'

const STEP = 720

const ORDERED = 'nib-ordered'

const RUNGS = [0, 1, 2, 3, 4]

const PER_INCH = 96

const CHECKS = { open: '☐ ', done: '☑ ' }

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
]

const BODY = {
  run: { font: 'Calibri', size: 22 },
  paragraph: { spacing: { after: 160, line: 276, lineRule: LineRuleType.AUTO } },
}

function heading(size: number, before: number) {
  return {
    run: { size, bold: true, color: size >= 24 ? INK : CODE_INK },
    paragraph: { spacing: { before, after: Math.round(before / 2) } },
  }
}

const CODE_BORDER = { style: BorderStyle.SINGLE, size: 2, color: 'E4E4E7', space: 4 }

const STYLES: IStylesOptions = {
  default: {
    document: BODY,
    title: { run: { size: 52, bold: true, color: INK }, paragraph: { spacing: { after: 280 } } },
    heading1: heading(32, 320),
    heading2: heading(28, 280),
    heading3: heading(24, 240),
    heading4: heading(22, 220),
    heading5: heading(22, 200),
    heading6: heading(20, 200),
  },
  paragraphStyles: [
    { id: 'Normal', name: 'Normal', quickFormat: true, ...BODY },
    {
      id: 'CodeBlock',
      name: 'Code Block',
      basedOn: 'Normal',
      next: 'Normal',
      quickFormat: true,
      run: { font: MONOSPACE, size: 18, color: CODE_INK },
      paragraph: {
        shading: { fill: CODE_FILL },
        spacing: { before: 0, after: 0, line: 240, lineRule: LineRuleType.AUTO },
        contextualSpacing: true,
        border: {
          top: CODE_BORDER,
          bottom: CODE_BORDER,
          left: CODE_BORDER,
          right: CODE_BORDER,
        },
      },
    },
    {
      id: 'Quote',
      name: 'Quote',
      basedOn: 'Normal',
      next: 'Normal',
      quickFormat: true,
      run: { italics: true, color: '52525B' },
      paragraph: {
        indent: { left: STEP },
        border: { left: { style: BorderStyle.SINGLE, size: 12, color: LINE, space: 12 } },
        spacing: { after: 120 },
      },
    },
    {
      id: 'Caption',
      name: 'Caption',
      basedOn: 'Normal',
      next: 'Normal',
      quickFormat: true,
      run: { size: 18, italics: true, color: '52525B' },
      paragraph: { alignment: AlignmentType.CENTER, spacing: { before: 60, after: 240 } },
    },
  ],
  characterStyles: [
    {
      id: 'Code',
      name: 'Code',
      run: { font: MONOSPACE, size: 18, color: CODE_INK, shading: { fill: CODE_FILL } },
    },
  ],
}

const NUMBERING: INumberingOptions = {
  config: [
    {
      reference: ORDERED,
      levels: RUNGS.map((level) => ({
        level,
        format: LevelFormat.DECIMAL,
        text: `%${level + 1}.`,
        alignment: AlignmentType.START,
        style: { paragraph: { indent: { left: STEP * (level + 1), hanging: 360 } } },
      })),
    },
  ],
}

const IMAGE_TYPES: Record<string, 'png' | 'jpg' | 'gif' | 'bmp'> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
}

const JPEG_FRAMES = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

interface Size {
  width: number
  height: number
}

function reader(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function pngSize(bytes: Uint8Array): Size | null {
  if (bytes.length < 24) return null

  const png = reader(bytes)
  if (png.getUint32(0) !== 0x89504e47) return null

  return { width: png.getUint32(16), height: png.getUint32(20) }
}

function jpegSize(bytes: Uint8Array): Size | null {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null

  const jpeg = reader(bytes)
  let at = 2

  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) {
      at++
      continue
    }

    const marker = bytes[at + 1] ?? 0
    if (JPEG_FRAMES.has(marker)) {
      return { width: jpeg.getUint16(at + 7), height: jpeg.getUint16(at + 5) }
    }

    if (marker === 0xff) at++
    else if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) at += 2
    else at += 2 + Math.max(jpeg.getUint16(at + 2), 2)
  }

  return null
}

function gifSize(bytes: Uint8Array): Size | null {
  if (bytes.length < 10) return null

  const gif = reader(bytes)
  return { width: gif.getUint16(6, true), height: gif.getUint16(8, true) }
}

function bmpSize(bytes: Uint8Array): Size | null {
  if (bytes.length < 26) return null

  const bmp = reader(bytes)
  return { width: bmp.getInt32(18, true), height: Math.abs(bmp.getInt32(22, true)) }
}

function sizeOf(bytes: Uint8Array, mime: string): Size | null {
  if (mime === 'image/png') return pngSize(bytes)
  if (mime === 'image/jpeg') return jpegSize(bytes)
  if (mime === 'image/gif') return gifSize(bytes)
  if (mime === 'image/bmp') return bmpSize(bytes)

  return null
}

function fitted(size: Size, column: number): Size {
  if (size.width <= column) return size

  return { width: column, height: Math.round((size.height * column) / size.width) }
}

interface Drawn {
  readonly picture: Picture
  readonly type: 'png' | 'jpg' | 'gif' | 'bmp'
  readonly size: Size
}

interface Writer {
  readonly pictures: ReadonlyMap<string, Picture>
  readonly notes: ReadonlyMap<string, number>
  lists: number
  readonly column: number
}

interface Nesting {
  readonly level: number
  readonly style: string | null
}

const OUTERMOST: Nesting = { level: 0, style: null }

function drawnPicture(src: string, writer: Writer): Drawn | null {
  const picture = writer.pictures.get(src)
  if (picture === undefined) return null

  const type = IMAGE_TYPES[picture.mime]
  if (type === undefined) return null

  const size = sizeOf(picture.bytes, picture.mime)
  if (size === null || size.width <= 0 || size.height <= 0) return null

  return { picture, type, size: fitted(size, writer.column) }
}

function pictureWords(span: Span): string {
  return span.text ? `[${span.text}]` : '[picture]'
}

function pictureRun(span: Span, drawn: Drawn | null): ParagraphChild {
  if (drawn === null) return new TextRun({ text: pictureWords(span) })

  return new ImageRun({
    type: drawn.type,
    data: drawn.picture.bytes,
    transformation: drawn.size,
    altText: {
      name: legalXml(drawn.picture.name),
      ...(span.text ? { description: span.text } : {}),
    },
  })
}

const HIGHLIGHTS: Record<number, (typeof HighlightColor)[keyof typeof HighlightColor]> = {
  1: HighlightColor.RED,
  2: HighlightColor.DARK_YELLOW,
  4: HighlightColor.GREEN,
  5: HighlightColor.CYAN,
  6: HighlightColor.MAGENTA,
}

function marksOf(span: Span): IRunPropertiesOptions {
  return {
    ...(span.bold ? { bold: true } : {}),
    ...(span.italic ? { italics: true } : {}),
    ...(span.strike ? { strike: true } : {}),
    ...(span.mark ? { highlight: HIGHLIGHTS[span.tone ?? 0] ?? HighlightColor.YELLOW } : {}),
    ...(span.sup ? { superScript: true } : {}),
    ...(span.sub ? { subScript: true } : {}),
    ...(span.code ? { style: 'Code' } : span.href === undefined ? {} : { style: 'Hyperlink' }),
  }
}

function textRuns(span: Span): TextRun[] {
  const marks = marksOf(span)

  return span.text
    .split('\n')
    .map((line, at) => new TextRun({ text: line, ...marks, ...(at > 0 ? { break: 1 } : {}) }))
}

function mathsRuns(span: Span): ParagraphChild[] {
  const omml = ommlFor(span.text)
  if (omml !== null) return [new Maths({ children: omml })]

  return [new TextRun({ text: span.text, style: 'Code' })]
}

function noteRuns(span: Span, writer: Writer): ParagraphChild[] {
  const label = span.note ?? ''
  const number = writer.notes.get(label)
  if (number !== undefined) return [new FootnoteReferenceRun(number)]

  return [new TextRun({ text: label, superScript: true })]
}

function runsOf(spans: readonly Span[], writer: Writer): ParagraphChild[] {
  return spans.flatMap((span) => {
    if (span.picture !== undefined) {
      return [pictureRun(span, drawnPicture(span.picture, writer))]
    }
    if (span.note !== undefined) return noteRuns(span, writer)
    if (span.maths === true) return mathsRuns(span)
    if (span.href !== undefined) {
      return [new ExternalHyperlink({ children: textRuns(span), link: span.href })]
    }

    return textRuns(span)
  })
}

function wordsOf(spans: readonly Span[]): string {
  return spans.map((span) => span.text).join('')
}

function alignmentOf(align: Align) {
  if (align === 'center') return AlignmentType.CENTER
  if (align === 'right') return AlignmentType.RIGHT

  return AlignmentType.LEFT
}

function nested(nesting: Nesting): IParagraphPropertiesOptions {
  return {
    ...(nesting.level > 0 ? { indent: { left: STEP * nesting.level } } : {}),
    ...(nesting.style === null ? {} : { style: nesting.style }),
  }
}

const CELL_EDGE = { style: BorderStyle.SINGLE, size: 2, color: LINE }
const CELL_BORDERS = { top: CELL_EDGE, bottom: CELL_EDGE, left: CELL_EDGE, right: CELL_EDGE }

function cellOf(spans: readonly Span[], align: Align, head: boolean, writer: Writer): TableCell {
  const shown = head ? spans.map((span) => ({ ...span, bold: true })) : spans

  return new TableCell({
    borders: CELL_BORDERS,
    ...(head ? { shading: { fill: HEAD_FILL } } : {}),
    children: [new Paragraph({ alignment: alignmentOf(align), children: runsOf(shown, writer) })],
  })
}

function tableOf(block: Extract<Block, { kind: 'table' }>, writer: Writer): Table {
  const row = (cells: readonly Span[][], head: boolean) =>
    new TableRow({
      ...(head ? { tableHeader: true } : {}),
      children: cells.map((cell, at) => cellOf(cell, block.align[at] ?? null, head, writer)),
    })

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [row(block.head, true), ...block.rows.map((cells) => row(cells, false))],
  })
}

function itemChildren(
  item: Item,
  ordered: boolean,
  instance: number,
  nesting: Nesting,
  writer: Writer,
): FileChild[] {
  const check =
    item.checked === null ? [] : [new TextRun({ text: item.checked ? CHECKS.done : CHECKS.open })]

  const own = new Paragraph({
    ...(ordered
      ? { numbering: { reference: ORDERED, level: nesting.level, instance } }
      : { bullet: { level: nesting.level } }),
    children: [...check, ...runsOf(item.spans, writer)],
  })

  return [own, ...childrenOf(item.blocks, writer, { ...nesting, level: nesting.level + 1 })]
}

function paragraphChildren(spans: readonly Span[], writer: Writer, nesting: Nesting): FileChild[] {
  const only = spans.length === 1 ? spans[0] : undefined
  const drawn = only?.picture === undefined ? null : drawnPicture(only.picture, writer)

  if (only !== undefined && drawn !== null) {
    const caption = only.text
      ? [new Paragraph({ style: 'Caption', children: [new TextRun({ text: only.text })] })]
      : []

    return [
      new Paragraph({ alignment: AlignmentType.CENTER, children: [pictureRun(only, drawn)] }),
      ...caption,
    ]
  }

  return [new Paragraph({ ...nested(nesting), children: runsOf(spans, writer) })]
}

function entryChildren(entry: Entry, writer: Writer, nesting: Nesting): FileChild[] {
  const term = entry.term.map((span) => ({ ...span, bold: true }))

  return [
    new Paragraph({ ...nested(nesting), children: runsOf(term, writer) }),
    ...entry.details.map(
      (detail) =>
        new Paragraph({
          ...nested(nesting),
          indent: { left: STEP * (nesting.level + 1) },
          children: runsOf(detail, writer),
        }),
    ),
  ]
}

function mathsChildren(tex: string): FileChild[] {
  const omml = ommlFor(tex)

  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children:
        omml === null
          ? [new TextRun({ text: tex, style: 'Code' })]
          : [new Maths({ children: omml })],
    }),
  ]
}

function blockChildren(block: Block, writer: Writer, nesting: Nesting): FileChild[] {
  switch (block.kind) {
    case 'heading': {
      const level = Math.min(Math.max(block.level, 1), HEADINGS.length)

      return [
        new Paragraph({
          heading: HEADINGS[level - 1] ?? HeadingLevel.HEADING_1,
          keepNext: true,
          children: runsOf(block.spans, writer),
        }),
      ]
    }

    case 'paragraph':
      return paragraphChildren(block.spans, writer, nesting)

    case 'code':
      return block.code
        .split('\n')
        .map(
          (line) => new Paragraph({ style: 'CodeBlock', children: [new TextRun({ text: line })] }),
        )

    case 'maths':
      return mathsChildren(block.tex)

    case 'quote': {
      const label =
        block.label === null
          ? []
          : [
              new Paragraph({
                style: 'Quote',
                children: [new TextRun({ text: block.label, bold: true })],
              }),
            ]

      return [...label, ...childrenOf(block.blocks, writer, { ...nesting, style: 'Quote' })]
    }

    case 'list': {
      const instance = block.ordered ? writer.lists++ : 0

      return block.items.flatMap((item) =>
        itemChildren(item, block.ordered, instance, nesting, writer),
      )
    }

    case 'table':
      return [tableOf(block, writer)]

    case 'terms':
      return block.entries.flatMap((entry) => entryChildren(entry, writer, nesting))

    case 'rule':
      return [
        new Paragraph({
          ...nested(nesting),
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: LINE, space: 6 } },
        }),
      ]

    case 'break':
      return [new Paragraph({ children: [new PageBreak()] })]
  }
}

function childrenOf(blocks: readonly Block[], writer: Writer, nesting: Nesting): FileChild[] {
  return blocks.flatMap((block) => blockChildren(block, writer, nesting))
}

function titleChildren(doc: Doc): FileChild[] {
  const first = doc.blocks[0]
  const heads = first?.kind === 'heading' && wordsOf(first.spans).trim() === doc.title.trim()
  if (heads || !doc.named) return []

  return [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: doc.title })] }),
  ]
}

function footnotesOf(doc: Doc, writer: Writer): Record<string, { children: Paragraph[] }> {
  return Object.fromEntries(
    doc.notes.map((note, at) => [
      String(at + 1),
      { children: [new Paragraph({ children: runsOf(note.spans, writer) })] },
    ]),
  )
}

function columnPixels(paper: PaperTwips): number {
  const width = paper.landscape ? paper.height : paper.width

  return Math.max(PER_INCH, Math.round(((width - 2 * paper.margin) * PER_INCH) / TWIPS_PER_INCH))
}

function pageOf(paper: PaperTwips): ISectionPropertiesOptions {
  return {
    page: {
      size: {
        width: paper.width,
        height: paper.height,
        orientation: paper.landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
      },
      margin: {
        top: paper.margin,
        right: paper.margin,
        bottom: paper.margin,
        left: paper.margin,
      },
    },
  }
}

function runningOf(paper: PaperTwips) {
  const line = (text: string) =>
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text, size: 18, color: CODE_INK })],
    })

  return {
    ...(paper.header
      ? { headers: { default: new Header({ children: [line(paper.header)] }) } }
      : {}),
    ...(paper.footer
      ? { footers: { default: new Footer({ children: [line(paper.footer)] }) } }
      : {}),
  }
}

function legalStrings<T>(value: T): T {
  if (typeof value === 'string') return legalXml(value) as T
  if (Array.isArray(value)) return value.map(legalStrings) as T
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, one]) => [key, key === 'picture' ? one : legalStrings(one)]),
  ) as T
}

export async function toDocx(
  written: Doc,
  pictures: readonly Picture[],
  sheet: PaperTwips,
): Promise<Uint8Array> {
  const doc = legalStrings(written)
  const paper = legalStrings(sheet)
  const writer: Writer = {
    pictures: new Map(pictures.map((picture) => [picture.src, picture])),
    notes: new Map(doc.notes.map((note, at) => [note.label, at + 1])),
    lists: 0,
    column: columnPixels(paper),
  }

  const file = new Document({
    title: doc.title,
    ...(doc.author === null ? {} : { creator: doc.author }),
    styles: STYLES,
    numbering: NUMBERING,
    footnotes: footnotesOf(doc, writer),
    sections: [
      {
        properties: pageOf(paper),
        ...runningOf(paper),
        children: [...titleChildren(doc), ...childrenOf(doc.blocks, writer, OUTERMOST)],
      },
    ],
  })

  return fromBase64(await Packer.toBase64String(file))
}
