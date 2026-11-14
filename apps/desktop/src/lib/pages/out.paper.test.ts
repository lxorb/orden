import { afterEach, describe, expect, test, vi } from 'vitest'
import { decodePDFRawStream, type PDFArray, PDFDocument, type PDFRawStream } from 'pdf-lib'
import { emptyPages, pagesFromPdf } from '@orden/markdown/pages'
import { busy } from '../busy.svelte'
import type { Canvas, PageNode } from '../canvas/format'

const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='

const held = vi.hoisted(() => ({
  bytes: null as Uint8Array | null,
  drawn: [] as string[],
  under: [] as unknown[],
  asked: [] as number[],
  at: [] as unknown[],
  locked: false,
  zipped: [] as { path: string; body: unknown }[],
}))

vi.mock('../platform/src/bytes', () => ({ fileBytes: () => Promise.resolve(held.bytes) }))
vi.mock('./raster', () => ({
  svgToPng: async (
    svg: string,
    _width: number,
    _height: number,
    under: (() => unknown) | null = null,
  ) => {
    held.drawn.push(svg)
    held.under.push(under ? await under() : null)
    return new Uint8Array([1])
  },
  cssColour: (colour: string) => colour,
  sharpness: (_width: number, _height: number, wanted: number) => wanted,
  paperIsLocked: () => Promise.resolve(held.locked),
  paperPicture: (at: unknown, number: number) => {
    held.asked.push(number)
    held.at.push(at)
    return Promise.resolve(number <= 2 ? PIXEL : null)
  },
  paperUnder: (at: unknown, number: number) => {
    held.asked.push(number)
    held.at.push(at)
    return Promise.resolve(number <= 2 ? { width: 1, page: number } : null)
  },
}))
vi.mock('../export/zip', () => ({
  zipOf: (entries: { path: string; body: unknown }[]) => {
    held.zipped = entries
    return Promise.resolve(new Uint8Array())
  },
}))
vi.mock('../export/save', () => ({ download: () => undefined }))

const { exportPagesPng, exportPagesSvg, pagesPdf, printPages, sheetStyle } = await import('./out')

const SIZES = [
  { width: 816, height: 1056 },
  { width: 816, height: 1056 },
]

function inked(canvas: Canvas, page: PageNode, id: string, colour: string) {
  const point = { x: page.x + 40, y: page.y + 40, pressure: 0.5, tiltX: 0, tiltY: 0, t: 0 }
  canvas.ink = [...canvas.ink, { id, tool: 'pen', color: colour, size: 4, points: [point] }]
}

function paperNote(): Canvas {
  const canvas = pagesFromPdf('Paper.pdf', SIZES)
  inked(canvas, canvas.nodes[0] as PageNode, 'a', '#ff0000')
  return canvas
}

const out = (canvas: Canvas) => ({
  canvas,
  palette: {},
  name: 'Paper',
  path: '/notes/Paper.canvas',
  root: '/notes',
})

async function paper(pages = 2): Promise<PDFDocument> {
  const doc = await PDFDocument.create()
  for (let at = 0; at < pages; at += 1) doc.addPage([612, 792])
  return doc
}

async function ownerLocked(): Promise<Uint8Array> {
  const plain = await (await paper()).save({ useObjectStreams: false })
  const text = String.fromCharCode(...plain)
  expect(text).toContain('trailer\n<<')
  const locked = text.replace('trailer\n<<', 'trailer\n<<\n/Encrypt 1 0 R')
  return Uint8Array.from(locked, (one) => one.charCodeAt(0))
}

async function contentOf(bytes: Uint8Array, at: number): Promise<string> {
  const sheet = (await PDFDocument.load(bytes)).getPage(at)
  return (sheet.node.Contents() as PDFArray)
    .asArray()
    .map((one) => decodePDFRawStream(sheet.doc.context.lookup(one) as PDFRawStream).decode())
    .map((one) => new TextDecoder().decode(one))
    .join('\n')
}

afterEach(() => {
  held.bytes = null
  held.drawn = []
  held.under = []
  held.asked = []
  held.at = []
  held.locked = false
  held.zipped = []
  busy.clear()
})

describe('a sheet made from a paper, as a picture', () => {
  test('carries the paper’s page under its ink in an SVG', async () => {
    await exportPagesSvg(out(paperNote()))

    const first = String(held.zipped[0]?.body)
    expect(first).toContain(`<image href="${PIXEL}"`)
    expect(first.indexOf('<image')).toBeLessThan(first.indexOf('<path'))
    expect(held.asked).toEqual([1, 2])
  })

  test('and under the picture a PNG is rasterised from, drawn as it is rather than encoded into it', async () => {
    await exportPagesPng(out(paperNote()))

    expect(held.drawn).toHaveLength(2)
    expect(held.under).toEqual([
      { width: 1, page: 1 },
      { width: 1, page: 2 },
    ])
    expect(held.drawn[0]).not.toContain('<image')
    expect(held.drawn[0]).not.toContain('fill="#ffffff"')
    expect(held.drawn[0]).toContain('<path')
    expect(held.asked).toEqual([1, 2])
  })

  test('a sheet of its own has no paper to ask for', async () => {
    await exportPagesSvg(out(emptyPages()))

    expect(held.asked).toEqual([])
    expect(String(held.zipped[0]?.body)).not.toContain('<image')
  })
})

describe('a paper locked by its owner', () => {
  const WORD = 'This PDF is locked by its owner'

  test('does not go out as a PDF, and says why', async () => {
    held.bytes = await ownerLocked()

    expect(await pagesPdf(out(paperNote()))).toBeNull()
    expect(busy.trouble).toBe(WORD)
  })

  test('and is not printed', async () => {
    held.bytes = await ownerLocked()
    const printing = vi.fn()
    vi.doMock('../export', () => ({ printInFrame: printing }))

    await printPages(out(paperNote()))

    expect(printing).not.toHaveBeenCalled()
    expect(busy.trouble).toBe(WORD)
  })

  test('leaves its page out of a PNG and an SVG, which keep the ink, and says why', async () => {
    held.locked = true

    await exportPagesSvg(out(paperNote()))
    expect(String(held.zipped[0]?.body)).not.toContain('<image')
    expect(String(held.zipped[0]?.body)).toContain('<path')
    expect(busy.trouble).toBe(WORD)

    busy.clear()
    await exportPagesPng(out(paperNote()))
    expect(held.drawn[0]).not.toContain('<image')
    expect(busy.trouble).toBe(WORD)
    expect(held.asked).toEqual([])
  })
})

describe('a note shared on its own', () => {
  test('asks for its paper by the note’s id on the account', async () => {
    await exportPagesSvg({ ...out(paperNote()), shared: 'note-1' })
    expect(held.at[0]).toMatchObject({ shared: 'note-1' })
  })
})

describe('one page of a paper on two sheets', () => {
  test('makes two sheets, each with its own ink', async () => {
    held.bytes = await (await paper()).save()
    const canvas = paperNote()
    const [, second] = canvas.nodes as [PageNode, PageNode]
    second.page = 1
    inked(canvas, second, 'b', '#0000ff')

    const bytes = await pagesPdf(out(canvas))

    expect((await PDFDocument.load(bytes!)).getPageCount()).toBe(2)
    const [one, two] = [await contentOf(bytes!, 0), await contentOf(bytes!, 1)]
    expect(one).toContain('1 0 0 rg')
    expect(one).not.toContain('0 0 1 rg')
    expect(two).toContain('0 0 1 rg')
    expect(two).not.toContain('1 0 0 rg')
  })
})

describe('pages of more than one size, printed', () => {
  test('give every sheet a paper of its own size', () => {
    const style = sheetStyle([
      { width: 816, height: 1056 },
      { width: 1056, height: 816 },
    ])

    expect(style).toContain('@page s0{size:816px 1056px;margin:0}')
    expect(style).toContain('@page s1{size:1056px 816px;margin:0}')
    expect(style).toContain('.s1{page:s1;width:1056px;height:816px}')
    expect(style).not.toMatch(/\.sheet\{[^}]*width:/)
  })
})
