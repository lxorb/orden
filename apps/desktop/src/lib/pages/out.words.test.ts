// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest'
import {
  decodePDFRawStream,
  PDFDict,
  PDFDocument,
  PDFName,
  type PDFRawStream,
  StandardFonts,
} from 'pdf-lib'
import { added, emptyPages } from '@nib/markdown/pages'
import { type Canvas, type CanvasNode, type PageNode, writeCanvas } from '../canvas/format'

/** What is on a page besides the ink (B541): the words typed onto it and the ruling it
 *  is printed with. The reader sees both on the page, so every way out shows both. */

vi.mock('../bytes', () => ({ fileBytes: () => Promise.resolve(null) }))
/** The browser's rasteriser, stood in for: jsdom draws no pictures. It answers with a
 *  one pixel PNG, or with nothing where a test says the browser refused. */
const raster = vi.hoisted(() => ({
  drawn: [] as string[],
  refuse: false,
  png: Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    ),
    (one) => one.charCodeAt(0),
  ),
}))
/** The browser's layout of a card, stood in for: jsdom lays nothing out. Each line of
 *  a card's text is one run 20px under the last, at 7px a character - or whatever a
 *  test puts in `layouts` for a card. */
const layout = vi.hoisted(() => ({
  runs: new Map<string, unknown[]>(),
  asked: [] as string[],
}))
vi.mock('./laid', () => ({
  laidOut: (cards: { id: string; text: string; bare?: boolean }[]) => {
    const laid = new Map<string, unknown[]>()
    for (const card of cards) {
      layout.asked.push(card.id)
      laid.set(
        card.id,
        layout.runs.get(card.id) ??
          card.text.split('\n').map((text, at) => ({
            text,
            x: 6,
            y: 20 + at * 20,
            width: text.length * 7,
            size: 16,
            family: '"iA Writer Quattro", "Orden Arabic", ui-sans-serif',
            weight: 400,
            italic: false,
            mono: false,
            colour: 'rgb(26, 29, 35)',
          })),
      )
    }
    return Promise.resolve(laid)
  },
  localFaces: () => '',
}))
vi.mock('./raster', () => ({
  svgToPng: (svg: string) => {
    raster.drawn.push(svg)
    return Promise.resolve(raster.refuse ? null : raster.png)
  },
  cssColour: (colour: string) => colour,
}))
vi.mock('../link-index.svelte', () => ({
  links: {
    version: 1,
    index: (path: string | null) => ({ notes: [], path, read: () => Promise.resolve(null) }),
    targetOf: () => null,
  },
}))

const { laidOf, pagesOutOf, pagesPdf, pageSvg } = await import('./out')

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

/** One run a test lays out itself. */
const run = (text: string, more: Record<string, unknown> = {}) => ({
  text,
  x: 6,
  y: 20,
  width: 150,
  size: 16,
  family: 'ui-sans-serif',
  weight: 400,
  italic: false,
  mono: false,
  colour: 'rgb(26, 29, 35)',
  ...more,
})

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

  test('are drawn on the lines the browser set them on, as wide as it set them', async () => {
    layout.runs.set('w1', [
      run('Exam on', { x: 6, y: 20, width: 70 }),
      run('Friday', { x: 6, y: 44.8, width: 50 }),
    ])
    const canvas = note()
    const page = canvas.nodes[0] as PageNode
    const first = await contentOf((await pagesPdf(out(canvas)))!, 0)
    layout.runs.clear()

    const helvetica = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica)
    // The card is 40px into its page, so its lines are at 46 and 60 and 84.8 down it.
    expect(first).toMatch(/^1 0 0 1 46 -60 Tm$/m)
    expect(first).toMatch(/^1 0 0 1 46 -84\.8 Tm$/m)
    const squeeze = Number(/^([\d.]+) Tz$/m.exec(first)?.[1])
    expect((squeeze / 100) * helvetica.widthOfTextAtSize('Exam on', 16)).toBeCloseTo(70, 1)
    expect(page).toBeTruthy()
  })

  test('in bold, in italics and in code keep their face', async () => {
    layout.runs.set('w1', [
      run('bold', { weight: 700 }),
      run('slanted', { italic: true, y: 40 }),
      run('code', { mono: true, y: 60 }),
    ])
    const doc = await PDFDocument.load((await pagesPdf(out(note())))!)
    layout.runs.clear()

    const faces = doc.context
      .enumerateIndirectObjects()
      .map(([, one]) => (one instanceof PDFDict ? one.get(PDFName.of('BaseFont')) : undefined))
      .map((one) => (one instanceof PDFName ? one.asString() : ''))
    expect(faces).toContain('/Helvetica-Bold')
    expect(faces).toContain('/Helvetica-Oblique')
    expect(faces).toContain('/Courier')
  })

  test('in a colour the browser gives as rgb() print in that colour', async () => {
    layout.runs.set('w1', [run('Exam', { colour: 'rgb(255, 0, 0)' })])
    const first = await contentOf((await pagesPdf(out(note())))!, 0)
    layout.runs.clear()

    expect(first).toMatch(/^1 0 0 rg$/m)
  })

  test('in a colour of three hex digits print in that colour', async () => {
    const canvas = note()
    const card = canvas.nodes.find((node) => node.id === 'w1') as CanvasNode & {
      color?: string
      bare?: boolean
    }
    card.bare = false
    card.color = '#f00'
    const first = await contentOf((await pagesPdf(out(canvas)))!, 0)

    // The frame's edge.
    expect(first).toMatch(/^1 0 0 RG$/m)
  })

  test('that the PDF font cannot spell go onto the sheet as a picture of the card', async () => {
    raster.drawn = []
    layout.runs.set('w1', [
      run('Kolokwium w środę', { x: 6, y: 20, width: 140 }),
      run('試験 ✓', { y: 44.8, width: 40 }),
    ])
    const canvas = note()
    const card = canvas.nodes.find((node) => node.id === 'w1')!
    const first = await contentOf((await pagesPdf(out(canvas)))!, 0)
    layout.runs.clear()

    expect(raster.drawn).toHaveLength(1)
    const svg = raster.drawn[0] ?? ''
    expect(svg).toContain(`<tspan x="${card.x + 6}" y="${card.y + 20}">Kolokwium w środę</tspan>`)
    expect(svg).toContain(`<tspan x="${card.x + 6}" y="${card.y + 44.8}">試験 ✓</tspan>`)
    // As wide as the browser set it, whatever face the picture finds.
    expect(svg).toMatch(/textLength="140"/)
    expect(first).toMatch(/ Do$/m)
    expect(first).not.toContain(hex('Kolokwium'))
  })

  test('are never lost: a refused picture leaves the letters the font has', async () => {
    raster.refuse = true
    layout.runs.set('w1', [run('Kolokwium w środę')])
    const first = await contentOf((await pagesPdf(out(note())))!, 0)
    raster.refuse = false
    layout.runs.clear()

    expect(first).toContain(hex('Kolokwium w'))
  })

  test('reach the SVG of their page, and the PNG picture of it', async () => {
    const canvas = note()
    const pages = canvas.nodes.filter((node): node is PageNode => node.type === 'page')
    const laid = await laidOf(out(canvas))
    const svg = pageSvg(laid, pages[0]!, 1)
    const plain = pageSvg(laid, pages[0]!, 1, true)

    expect(svg).toContain('Exam on Friday')
    expect(svg).not.toContain('Second sheet')
    expect(plain).toContain('Exam on Friday')
    expect(plain).not.toContain('foreignObject')
  })

  test('stay inside their card in the PNG picture of the page', async () => {
    const canvas = note()
    const card = canvas.nodes.find((node) => node.id === 'w1')!
    const pages = canvas.nodes.filter((node): node is PageNode => node.type === 'page')
    const svg = pageSvg(await laidOf(out(canvas)), pages[0]!, 1, true)

    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
    const box = doc.querySelector('tspan')?.closest('text')?.parentElement?.closest('svg')
    expect(box).not.toBe(doc.documentElement)
    expect(box?.getAttribute('x')).toBe(String(card.x))
    expect(box?.getAttribute('y')).toBe(String(card.y))
    expect(box?.getAttribute('width')).toBe(String(card.width))
    expect(box?.getAttribute('height')).toBe(String(card.height))
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

describe('what else is on a page', () => {
  test('goes into the PDF as a picture: a shape, a link, a picture', async () => {
    raster.drawn = []
    const canvas = note()
    const page = canvas.nodes[0] as PageNode
    const at = { x: page.x + 40, y: page.y + 300, width: 120, height: 80 }
    canvas.nodes.push(
      { id: 's', type: 'shape', shape: 'rect', ...at },
      { id: 'l', type: 'link', url: 'https://example.com', ...at, y: at.y + 100 },
    )
    const first = await contentOf((await pagesPdf(out(canvas)))!, 0)

    expect(raster.drawn).toHaveLength(2)
    expect(first.match(/ Do$/gm)).toHaveLength(2)
  })
})

describe('ink in the pen with no colour of its own (B571)', () => {
  test('is the dark ink of white paper, whatever theme is on', () => {
    const sheet = document.createElement('style')
    sheet.textContent = [
      "[data-theme='dark'] { --text-strong: #f4f7fb; --text: #dde2ea; --canvas-dot: #2b323d }",
      "[data-theme='light'] { --text-strong: #0b0d10; --text: #1a1d23; --canvas-dot: #d5dce5 }",
    ].join('\n')
    document.head.append(sheet)
    document.documentElement.dataset.theme = 'dark'

    const canvas = note('lines')
    const page = canvas.nodes[0] as PageNode
    const point = { x: page.x + 50, y: page.y + 50, pressure: 0.5, tiltX: 0, tiltY: 0, t: 0 }
    canvas.ink = [{ id: 'i', tool: 'pen', color: 'ink', size: 3, points: [point] }]
    const open = pagesOutOf({ text: writeCanvas(canvas), name: 'P', path: null, root: null })
    const svg = pageSvg(open, page, 1)

    sheet.remove()
    delete document.documentElement.dataset.theme

    expect(svg).toContain('#0b0d10')
    expect(svg).not.toContain('#f4f7fb')
    expect(svg).toContain('#d5dce5')
    expect(svg).not.toContain('#2b323d')
  })
})

describe('a group', () => {
  test("keep a group's name, which sits above its box", async () => {
    raster.drawn = []
    const canvas = note()
    const page = canvas.nodes[0] as PageNode
    canvas.nodes.push({
      id: 'g',
      type: 'group',
      label: 'Week one',
      x: page.x + 40,
      y: page.y + 400,
      width: 200,
      height: 100,
    })
    await pagesPdf(out(canvas))

    const svg = raster.drawn[0] ?? ''
    const top = Number(/viewBox="[-\d.]+ ([-\d.]+)/.exec(svg)?.[1])
    const label = Number(/<text[^>]*y="([-\d.]+)"[^>]*>Week one/.exec(svg)?.[1])
    expect(label - 13).toBeGreaterThanOrEqual(top)
  })
})
