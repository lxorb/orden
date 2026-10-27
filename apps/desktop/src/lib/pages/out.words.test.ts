// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest'
import { decodePDFRawStream, PDFDocument, type PDFRawStream } from 'pdf-lib'
import { added, emptyPages } from '@nib/markdown/pages'
import type { Canvas, CanvasNode, PageNode } from '../canvas/format'

/** What is on a page besides the ink (B541): the words typed onto it and the ruling it
 *  is printed with. The reader sees both on the page, so every way out shows both. */

vi.mock('../bytes', () => ({ fileBytes: () => Promise.resolve(null) }))
vi.mock('../link-index.svelte', () => ({
  links: {
    version: 1,
    index: (path: string | null) => ({ notes: [], path, read: () => Promise.resolve(null) }),
    targetOf: () => null,
  },
}))

const { pagesPdf, pageSvg } = await import('./out')

const out = (canvas: Canvas) => ({ canvas, palette: {}, name: 'P', path: '/s/P.pages', root: '/s' })

/** Two pages, the first one ruled, with words typed onto each. */
function note(pattern: PageNode['pattern'] = 'blank'): Canvas {
  const one = emptyPages()
  const grown = added(one, one.nodes[0]!.id).canvas
  const ruled = grown.nodes.map((node, at) => (at === 0 ? { ...node, pattern } : node))
  const two = { ...grown, nodes: ruled }
  const [a, b] = two.nodes.filter((node): node is PageNode => node.type === 'page')
  const words = (id: string, text: string, page: PageNode): CanvasNode => ({
    id,
    type: 'text',
    text,
    bare: true,
    x: page.x + 40,
    y: page.y + 40,
    width: 220,
    height: 60,
  })
  return {
    ...two,
    nodes: [...two.nodes, words('w1', 'Exam on Friday', a!), words('w2', 'Second sheet', b!)],
  }
}

/** Every content stream of one sheet, as text. */
async function contentOf(bytes: Uint8Array, at: number): Promise<string> {
  const doc = await PDFDocument.load(bytes)
  const sheet = doc.getPage(at)
  const contents = sheet.node.Contents()
  const streams =
    contents && 'asArray' in contents ? contents.asArray() : contents ? [contents] : []
  return streams
    .map((one) => decodePDFRawStream(doc.context.lookup(one as never) as PDFRawStream).decode())
    .map((one) => new TextDecoder().decode(one))
    .join('\n')
}

const hex = (text: string) =>
  Array.from(text, (one) => one.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase()).join('')

describe('words typed on a page', () => {
  test('reach its sheet of the PDF as real text, and only that sheet', async () => {
    const bytes = (await pagesPdf(out(note())))!
    const first = await contentOf(bytes, 0)
    const second = await contentOf(bytes, 1)

    expect(first).toMatch(/Tj/)
    expect(first).toContain(hex('Exam on Friday'))
    expect(first).not.toContain(hex('Second sheet'))
    expect(second).toContain(hex('Second sheet'))
  })

  test('wrap to the width of their box in the PDF', async () => {
    const canvas = note()
    const card = canvas.nodes.find((node) => node.id === 'w1') as CanvasNode & { text: string }
    card.text = 'one two three four five six seven eight nine ten eleven twelve'
    card.height = 200
    const first = await contentOf((await pagesPdf(out(canvas)))!, 0)

    expect(first.match(/Tj/g)?.length ?? 0).toBeGreaterThan(1)
  })

  test('keep going when a character has no glyph in the PDF font', async () => {
    const canvas = note()
    const card = canvas.nodes.find((node) => node.id === 'w1') as CanvasNode & { text: string }
    card.text = 'Exam 試験 on Friday ✓'
    const first = await contentOf((await pagesPdf(out(canvas)))!, 0)

    expect(first).toContain(hex('Exam'))
  })

  test('reach the SVG of their page, and the PNG picture of it', () => {
    const canvas = note()
    const pages = canvas.nodes.filter((node): node is PageNode => node.type === 'page')
    const svg = pageSvg(out(canvas), pages[0]!, 1)
    const plain = pageSvg(out(canvas), pages[0]!, 1, true)

    expect(svg).toContain('Exam on Friday')
    expect(svg).not.toContain('Second sheet')
    expect(plain).toContain('Exam on Friday')
    expect(plain).not.toContain('foreignObject')
  })
})

describe('the ruling of a page', () => {
  test('is drawn on its SVG', () => {
    const canvas = note('lines')
    const pages = canvas.nodes.filter((node): node is PageNode => node.type === 'page')

    expect(pageSvg(out(canvas), pages[0]!, 1)).toMatch(/<pattern/)
    expect(pageSvg(out(canvas), pages[1]!, 2)).not.toMatch(/<pattern/)
  })

  test('is drawn on its sheet of the PDF', async () => {
    const bytes = (await pagesPdf(out(note('grid'))))!
    const ruled = await contentOf(bytes, 0)
    const blank = await contentOf(bytes, 1)

    expect((ruled.match(/ re$/gm) ?? []).length).toBeGreaterThan(20)
    expect((blank.match(/ re$/gm) ?? []).length).toBeLessThan(3)
  })
})
