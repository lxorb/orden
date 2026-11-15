import { describe, expect, test } from 'vitest'
import type { CanvasNode } from '@orden/markdown/canvas'
import { type FarPicture, type FarScene, FarSheets, farWords, paintFar } from './far'

function pen(words: string[], pictures: { image: unknown; to: number[] }[], bars: number[][]) {
  return {
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    font: '',
    textBaseline: 'alphabetic',
    setTransform: () => undefined,
    clearRect: () => undefined,
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    stroke: () => undefined,
    strokeRect: () => undefined,
    fillRect: (...box: number[]) => bars.push(box),
    fillText: (text: string) => words.push(text),
    measureText: (text: string) => ({ width: text.length * 7 }),
    drawImage: (image: unknown, ...box: number[]) => pictures.push({ image, to: box.slice(-4) }),
  }
}

function painted() {
  const words: string[] = []
  const pictures: { image: unknown; to: number[] }[] = []
  const bars: number[][] = []
  const sheetPictures: { image: unknown; to: number[] }[] = []
  const papers: unknown[] = []
  const sheets = new FarSheets((width, height) => {
    const paper = { width, height, getContext: () => pen(words, sheetPictures, []) }
    papers.push(paper)
    return paper as unknown as HTMLCanvasElement
  })
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => pen([], pictures, bars),
  } as unknown as HTMLCanvasElement
  return { canvas, words, pictures, sheetPictures, papers, bars, sheets }
}

function scene(nodes: CanvasNode[], scale: number, extra: Partial<FarScene> = {}): FarScene {
  return {
    nodes,
    edges: [],
    picked: new Set(),
    dimmed: false,
    skip: null,
    view: { x: -10_000, y: -10_000, width: 20_000, height: 20_000 },
    scale,
    originX: 0,
    originY: 0,
    width: 800,
    height: 600,
    palette: {},
    ratio: 1,
    font: 'serif',
    picture: () => null,
    sheets: new FarSheets(() => null),
    ...extra,
  }
}

const card = (text: string): CanvasNode => ({
  id: 'a',
  type: 'text',
  text,
  x: 0,
  y: 0,
  width: 300,
  height: 200,
})

const photo: CanvasNode = {
  id: 'p',
  type: 'file',
  file: 'pictures/cat.png',
  x: 400,
  y: 0,
  width: 200,
  height: 100,
}

describe('a card seen from far away (#2079)', () => {
  test('still shows its words, not grey bars', () => {
    const { canvas, words, pictures, papers, sheets } = painted()
    paintFar(
      canvas,
      scene([card('# Groceries\n\n- **milk** and [[eggs|two eggs]]')], 0.3, { sheets }),
    )

    expect(words).toEqual(['Groceries', 'milk and two eggs'])
    expect(pictures).toEqual([{ image: papers[0], to: [0, 0, 300, 200] }])
  })

  test('wraps its words to the card and stops at its bottom', () => {
    const { canvas, words, sheets } = painted()
    const long = Array.from({ length: 200 }, () => 'word').join(' ')
    paintFar(canvas, scene([card(long)], 0.3, { sheets }))

    expect(words.length).toBeGreaterThan(1)
    expect(words.length).toBeLessThanOrEqual(Math.floor((200 - 16) / (13 * 1.55)))
    for (const line of words) expect(line.length * 7).toBeLessThanOrEqual(300 - 24)
  })

  test('keeps the cheap bars once the words would be too small to read', () => {
    const { canvas, words, bars, sheets } = painted()
    paintFar(canvas, scene([card('milk')], 0.1, { sheets }))

    expect(words).toEqual([])
    expect(bars.length).toBeGreaterThan(1)
  })

  test('shows a picture card its picture, filling the card', () => {
    const { canvas, pictures, sheetPictures, papers, sheets } = painted()
    const image = { kind: 'cat' }
    const asked: string[] = []
    const picture = (file: string): FarPicture => {
      asked.push(file)
      return { image: image as unknown as CanvasImageSource, width: 400, height: 400 }
    }
    paintFar(canvas, scene([photo], 0.3, { picture, sheets }))

    expect(asked).toEqual(['pictures/cat.png'])
    expect(sheetPictures).toEqual([{ image, to: [0, 0, 200, 100] }])
    expect(pictures).toEqual([{ image: papers[0], to: [400, 0, 200, 100] }])
  })

  test('asks for no picture while its card is only a speck', () => {
    const { canvas, pictures, sheets } = painted()
    const asked: string[] = []
    const picture = (file: string) => (asked.push(file), null)
    paintFar(canvas, scene([photo], 0.02, { picture, sheets }))

    expect(asked).toEqual([])
    expect(pictures).toEqual([])
  })
})

describe('the cards seen from far away, kept cheap', () => {
  const many = Array.from({ length: 100 }, (_, at) => ({
    ...card(`card ${String(at)}`),
    id: `c${String(at)}`,
  }))

  test('writes the words of each card once, not on every paint of a zoom', () => {
    const { canvas, words, sheets } = painted()
    while (paintFar(canvas, scene(many, 0.3, { sheets })));
    const written = words.length
    expect(written).toBe(100)

    expect(paintFar(canvas, scene(many, 0.31, { sheets }))).toBe(false)
    expect(words).toHaveLength(written)
  })

  test('writes only a few cards a paint, and asks for another paint for the rest', () => {
    const { canvas, words, bars, sheets } = painted()

    expect(paintFar(canvas, scene(many, 0.3, { sheets }))).toBe(true)
    expect(words.length).toBeGreaterThan(0)
    expect(words.length).toBeLessThan(100)
    expect(bars.length).toBeGreaterThan(0)
  })

  test('writes them again, sharper, when the zoom has doubled', () => {
    const { canvas, words, sheets } = painted()
    while (paintFar(canvas, scene(many, 0.25, { sheets })));
    while (paintFar(canvas, scene(many, 0.5, { sheets })));

    expect(words).toHaveLength(200)
  })
})

describe('the words of a card, plainly', () => {
  test('lose their marks and keep what they say', () => {
    expect(
      farWords(
        '## Plan\n> quoted\n1. first\n- [ ] todo\n![shot](a.png) see [site](https://x.y) and `code`\n\n---\n*soft* _too_ snake_case',
      ),
    ).toEqual(['Plan', 'quoted', 'first', 'todo', 'see site and code', 'soft too snake_case'])
  })

  test('leave out fenced code marks but keep the code', () => {
    expect(farWords('```js\nlet a = 1\n```')).toEqual(['let a = 1'])
  })
})
