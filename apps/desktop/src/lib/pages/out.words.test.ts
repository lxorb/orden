// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest'
import { decodePDFRawStream, PDFDocument, type PDFRawStream } from 'pdf-lib'
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
/** How wide text is set, stood in for with widths a real face has: a CJK character
 *  is a full em, the wide Cyrillic letters most of one, everything else a little over
 *  half. */
const emOf = (one: string) =>
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}。、]/u.test(one)
    ? 1
    : /[ЖЩШЮМжщшюм]/.test(one)
      ? 0.85
      : 0.55
/** And a run of kana as a browser measures it: wider as a whole than its characters
 *  one by one, as Chromium's are by up to seven per cent - so a breaker that adds up
 *  single characters overruns the card. */
const widthOf = (text: string, size: number) => {
  const sum = Array.from(text).reduce((all, one) => all + emOf(one) * size, 0)
  return Array.from(text).length > 1 && /\p{Script=Hiragana}/u.test(text) ? sum * 1.07 : sum
}
vi.mock('./raster', () => ({
  svgToPng: (svg: string) => {
    raster.drawn.push(svg)
    return Promise.resolve(raster.refuse ? null : raster.png)
  },
  textWidth: (text: string, size: number) => widthOf(text, size),
}))
vi.mock('../link-index.svelte', () => ({
  links: {
    version: 1,
    index: (path: string | null) => ({ notes: [], path, read: () => Promise.resolve(null) }),
    targetOf: () => null,
  },
}))

const { pagesOutOf, pagesPdf, pageSvg } = await import('./out')

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

  test('that the PDF font cannot spell go onto the sheet as a picture of the card', async () => {
    raster.drawn = []
    const canvas = note()
    const card = canvas.nodes.find((node) => node.id === 'w1') as CanvasNode & { text: string }
    card.text = 'Kolokwium w środę 試験 ✓'
    const first = await contentOf((await pagesPdf(out(canvas)))!, 0)

    expect(raster.drawn).toHaveLength(1)
    expect(setLines(raster.drawn[0] ?? '').lines.join(' ')).toBe('Kolokwium w środę 試験 ✓')
    expect(first).toMatch(/ Do$/m)
    expect(first).not.toContain(hex('Kolokwium'))
    // The other sheet's words are still text.
    expect(await contentOf((await pagesPdf(out(canvas)))!, 1)).toContain(hex('Second sheet'))
  })

  test('are never lost: a refused picture leaves the letters the font has', async () => {
    raster.refuse = true
    const canvas = note()
    const card = canvas.nodes.find((node) => node.id === 'w1') as CanvasNode & { text: string }
    card.text = 'Kolokwium w środę'
    const first = await contentOf((await pagesPdf(out(canvas)))!, 0)
    raster.refuse = false

    expect(first).toContain(hex('Kolokwium w'))
  })

  test('keep a tab as space, which needs no picture', async () => {
    raster.drawn = []
    const canvas = note()
    const card = canvas.nodes.find((node) => node.id === 'w1') as CanvasNode & { text: string }
    card.text = 'Exam\tFriday'
    const first = await contentOf((await pagesPdf(out(canvas)))!, 0)

    expect(raster.drawn).toHaveLength(0)
    expect(first).toContain(hex('Exam'))
    expect(first).toContain(hex('Friday'))
  })

  test('in a colour of three hex digits print in that colour', async () => {
    const canvas = note()
    const card = canvas.nodes.find((node) => node.id === 'w1') as CanvasNode & { color?: string }
    card.color = '#f00'
    const first = await contentOf((await pagesPdf(out(canvas)))!, 0)

    expect(first).toMatch(/^1 0 0 rg$/m)
  })

  test('of a long paragraph are set without freezing the app', async () => {
    const canvas = note()
    const card = canvas.nodes.find((node) => node.id === 'w1') as CanvasNode & { text: string }
    card.text = Array.from({ length: 2000 }, (_, at) => `word${at}`).join(' ')
    card.height = 4000
    const began = performance.now()
    await pagesPdf(out(canvas))

    expect(performance.now() - began).toBeLessThan(400)
  })

  test('are set only as far as their card shows them', async () => {
    const canvas = note()
    const card = canvas.nodes.find((node) => node.id === 'w1') as CanvasNode & { text: string }
    card.text = Array.from({ length: 2000 }, (_, at) => `word${at}`).join(' ')
    const first = await contentOf((await pagesPdf(out(canvas)))!, 0)

    // A card 60px tall shows three lines of 24.8px; one more is clipped half way.
    expect(first.match(/Tj/g)?.length).toBeLessThanOrEqual(4)
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

/** The lines of words a picture sets, and the size they are set at. */
function setLines(svg: string): { lines: string[]; size: number } {
  const size = Number(/<text[^>]*font-size="([\d.]+)"/.exec(svg)?.[1])
  const lines = [...svg.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map((one) =>
    (one[1] ?? '').replace(/&amp;/g, '&'),
  )
  return { lines, size }
}

describe('words set as a picture', () => {
  const japanese =
    '今日は大学で日本語の授業がありました。先生はとても親切でした。宿題は明日までです。'
  const russian = 'Широкий шрифт: Жжж Щщщ Шшш Ююю Ммм широкий шрифт Жжж Щщщ'

  test.each([japanese, russian])('fit the card and lose nothing: %s', async (text) => {
    raster.drawn = []
    const canvas = note()
    const card = canvas.nodes.find((node) => node.id === 'w1') as CanvasNode & {
      text: string
      bare?: boolean
    }
    card.bare = false
    card.text = text
    card.width = 300
    card.height = 400
    await pagesPdf(out(canvas))

    const { lines, size } = setLines(raster.drawn[0] ?? '')
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) expect(widthOf(line, size)).toBeLessThanOrEqual(300 - 24)
    expect(lines.join('').replace(/ /g, '')).toBe(text.replace(/ /g, ''))
  })

  test('fit the card in the PNG picture of the page too', () => {
    const canvas = note()
    const card = canvas.nodes.find((node) => node.id === 'w1') as CanvasNode & { text: string }
    card.text = japanese
    const pages = canvas.nodes.filter((node): node is PageNode => node.type === 'page')
    const svg = pageSvg(out(canvas), pages[0]!, 1, true)

    const { lines, size } = setLines(svg.slice(svg.indexOf('<text')))
    for (const line of lines) expect(widthOf(line, size)).toBeLessThanOrEqual(220 - 12)
    expect(lines.join('')).toBe(japanese)
  })

  test('fit the card when a run is wider than its characters', async () => {
    raster.drawn = []
    const canvas = note()
    const card = canvas.nodes.find((node) => node.id === 'w1') as CanvasNode & { text: string }
    card.text =
      'ましたしてもらいましたけれどもそういうことでしたらまたあしたにしましょうね。わかりました。それではまたあした。'
    card.width = 300
    card.height = 400
    await pagesPdf(out(canvas))

    const { lines, size } = setLines(raster.drawn[0] ?? '')
    for (const line of lines) expect(widthOf(line, size)).toBeLessThanOrEqual(300 - 12)
    expect(lines.join('')).toBe(card.text)
  })

  test('never split an emoji made of several', async () => {
    raster.drawn = []
    const canvas = note()
    const card = canvas.nodes.find((node) => node.id === 'w1') as CanvasNode & { text: string }
    card.text = Array.from({ length: 12 }, () => '👨‍👩‍👧‍👦🇩🇪').join('')
    card.width = 80
    card.height = 400
    await pagesPdf(out(canvas))

    const { lines } = setLines(raster.drawn[0] ?? '')
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) {
      expect(line).not.toMatch(/^\u200d|\u200d$/u)
      expect(line).not.toMatch(/^\u{1F1EA}/u)
    }
    expect(lines.join('')).toBe(card.text)
  })

  test('stay inside their card in the PNG picture of the page', () => {
    const canvas = note()
    const card = canvas.nodes.find((node) => node.id === 'w1') as CanvasNode & {
      text: string
      bare?: boolean
    }
    card.bare = false
    card.text = Array.from({ length: 40 }, () => 'overflowing').join(' ')
    card.width = 300
    card.height = 60
    const pages = canvas.nodes.filter((node): node is PageNode => node.type === 'page')
    const svg = pageSvg(out(canvas), pages[0]!, 1, true)

    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
    const text = doc.querySelector('tspan')?.closest('text')
    const box = text?.parentElement?.closest('svg')
    expect(box).not.toBe(doc.documentElement)
    expect(box?.getAttribute('x')).toBe(String(card.x))
    expect(box?.getAttribute('y')).toBe(String(card.y))
    expect(box?.getAttribute('width')).toBe('300')
    expect(box?.getAttribute('height')).toBe('60')
  })

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
