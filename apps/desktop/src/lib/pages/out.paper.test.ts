import { afterEach, describe, expect, test, vi } from 'vitest'
import { decodePDFRawStream, type PDFArray, PDFDocument, type PDFRawStream } from 'pdf-lib'
import { emptyPages, pagesFromPdf } from '@orden/markdown/pages'
import { busy } from '../busy.svelte'
import type { Canvas, PageNode } from '../canvas/format'

/** What of a paper goes out with the sheets that were made from it: its page under the
 *  ink in a PNG and an SVG, and a paper pdf-lib will not copy from still goes out. */

/** A white pixel, which is as much of a page as these tests need. */
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='

const held = vi.hoisted(() => ({
  bytes: null as Uint8Array | null,
  drawn: [] as string[],
  asked: [] as number[],
  zipped: [] as { path: string; body: unknown }[],
}))

vi.mock('../bytes', () => ({ fileBytes: () => Promise.resolve(held.bytes) }))
vi.mock('./raster', () => ({
  svgToPng: (svg: string) => {
    held.drawn.push(svg)
    return Promise.resolve(new Uint8Array([1]))
  },
  cssColour: (colour: string) => colour,
  paperPicture: (_at: unknown, number: number) => {
    held.asked.push(number)
    return Promise.resolve(number <= 2 ? PIXEL : null)
  },
}))
vi.mock('../export/zip', () => ({
  zipOf: (entries: { path: string; body: unknown }[]) => {
    held.zipped = entries
    return Promise.resolve(new Uint8Array())
  },
}))
vi.mock('../export/save', () => ({ download: () => undefined }))

const { exportPagesPng, exportPagesSvg, pagesPdf } = await import('./out')

const SIZES = [
  { width: 816, height: 1056 },
  { width: 816, height: 1056 },
]

function inked(canvas: Canvas, page: PageNode, id: string, colour: string) {
  const point = { x: page.x + 40, y: page.y + 40, pressure: 0.5, tiltX: 0, tiltY: 0, t: 0 }
  canvas.ink = [...(canvas.ink ?? []), { id, tool: 'pen', color: colour, size: 4, points: [point] }]
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

/** A PDF locked by its owner the way a published paper is: anyone may open it, and pdf-lib
 *  refuses to copy from it. The trailer is written after the table, so nothing moves. */
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
  held.asked = []
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

  test('and in the picture a PNG is rasterised from', async () => {
    await exportPagesPng(out(paperNote()))

    expect(held.drawn).toHaveLength(2)
    expect(held.drawn[0]).toContain(`<image href="${PIXEL}"`)
  })

  test('a sheet of its own has no paper to ask for', async () => {
    await exportPagesSvg(out(emptyPages()))

    expect(held.asked).toEqual([])
    expect(String(held.zipped[0]?.body)).not.toContain('<image')
  })
})

describe('a paper pdf-lib will not copy from', () => {
  test('goes out with its pages as pictures under the ink, and says so', async () => {
    held.bytes = await ownerLocked()

    const bytes = await pagesPdf(out(paperNote()))

    const doc = await PDFDocument.load(bytes!)
    expect(doc.isEncrypted).toBe(false)
    expect(doc.getPageCount()).toBe(2)
    const first = await contentOf(bytes!, 0)
    expect(first.match(/ Do$/gm)).toHaveLength(1)
    expect(first.indexOf(' Do')).toBeLessThan(first.indexOf('1 0 0 rg'))
    expect(busy.trouble).toBeTruthy()
  })
})

describe('one page of a paper on two sheets', () => {
  test('makes two sheets, each with its own ink', async () => {
    held.bytes = await (await paper()).save()
    const canvas = paperNote()
    const [first, second] = canvas.nodes as [PageNode, PageNode]
    second.page = first.page
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
