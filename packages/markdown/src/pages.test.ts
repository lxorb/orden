import { describe, expect, test } from 'vitest'
import { linearly } from '../../../scripts/growth'
import { emptyCanvas, isPage, type PageNode, PAPERS, readCanvas, writeCanvas } from './canvas'
import {
  added,
  blankPages,
  columnHeight,
  emptyPages,
  GROWTH,
  GUTTER,
  grown,
  holderOf,
  laidOut,
  lowestOf,
  moved,
  newPage,
  onPage,
  pageAt,
  pageCount,
  pagesFromPdf,
  pageShowing,
  paperOf,
  pagesOf,
  pdfPage,
  removed,
  reshaped,
  settled,
} from './pages'

function page(id: string, extra: Partial<PageNode> = {}): PageNode {
  return { ...newPage(), id, ...extra }
}

function carrying(pages: PageNode[]) {
  const placed = laidOut(pages)
  const at = (one: PageNode) => ({ x: one.x + 20, y: one.y + 20 })
  const sized = { type: 'text' as const, width: 80, height: 30, text: '' }
  const inked = { tool: 'pen' as const, color: '1', size: 2 }
  const point = (one: PageNode) => ({ pressure: 0.5, tiltX: 0, tiltY: 0, t: 0, ...at(one) })
  const cards = placed.map((one) => ({ ...sized, ...at(one), id: `on:${one.id}` }))
  const ink = placed.map((one) => ({ ...inked, id: `on:${one.id}`, points: [point(one)] }))
  return { ...emptyCanvas(), nodes: [...placed, ...cards], ink }
}

function strays(canvas: ReturnType<typeof emptyCanvas>): string[] {
  const off = (id: string, point: { x: number; y: number } | undefined) =>
    !point || pageAt(pagesOf(canvas), point)?.id !== id.slice(3)
  const nodes = canvas.nodes.filter((node) => !isPage(node) && off(node.id, node))
  const ink = canvas.ink.filter((stroke) => off(stroke.id, stroke.points[0]))
  return [...nodes, ...ink].map((one) => one.id)
}

describe('a page note as a file', () => {
  test('a blank one is one A4 page', () => {
    const canvas = readCanvas(blankPages())
    const pages = pagesOf(canvas)

    expect(pages).toHaveLength(1)
    expect(pages[0]?.width).toBe(PAPERS.a4.width)
    expect(pages[0]?.height).toBe(PAPERS.a4.height)
    expect(pages[0]?.pattern).toBe('blank')
  })

  test('starts on the paper it was asked for, which is what a new one is given', () => {
    for (const paper of ['a4', 'letter', 'long'] as const) {
      const pages = pagesOf(readCanvas(blankPages(paper)))

      expect(pages).toHaveLength(1)
      expect(pages[0]?.paper, paper).toBe(paper)
      expect(pages[0]?.width, paper).toBe(PAPERS[paper].width)
      expect(pages[0]?.height, paper).toBe(PAPERS[paper].height)
    }
  })

  test('writes each page as a spec node, so the file is JSON Canvas', () => {
    const written = JSON.parse(blankPages()) as {
      nodes: { id: string; type: string; label?: string }[]
      orden: { pages: { id: string }[] }
    }

    expect(written.nodes).toHaveLength(1)
    expect(written.nodes[0]?.type).toBe('group')
    expect(written.nodes[0]?.label).toBe('Page 1')
    expect(written.orden.pages).toHaveLength(1)
    expect(written.orden.pages[0]?.id).toBe(written.nodes[0]?.id)
  })

  test('a page with a PDF behind it is a file node with the page in its subpath', () => {
    const canvas = pagesFromPdf('Paper.pdf', [
      { width: 600, height: 800 },
      { width: 600, height: 800 },
    ])

    const written = JSON.parse(writeCanvas(canvas)) as {
      nodes: { type: string; file?: string; subpath?: string }[]
    }

    expect(written.nodes.map((node) => node.type)).toEqual(['file', 'file'])
    expect(written.nodes[0]?.file).toBe('Paper.pdf')
    expect(written.nodes[0]?.subpath).toBe('#page=1')
    expect(written.nodes[1]?.subpath).toBe('#page=2')
  })

  test('reads back everything it wrote, whole', () => {
    const paper = pagesFromPdf('Paper.pdf', [{ width: 600, height: 800 }])
    const first = pagesOf(paper)[0]
    if (!first) throw new Error('no page')

    const before = reshaped(added(paper).canvas, first.id, { pattern: 'grid' })
    expect(pagesOf(readCanvas(writeCanvas(before)))).toEqual(pagesOf(before))
  })

  test('written back byte for byte', () => {
    const once = writeCanvas(pagesFromPdf('Paper.pdf', [{ width: 600, height: 800 }]))
    expect(writeCanvas(readCanvas(once))).toBe(once)
  })

  test('a canvas with no pages is written exactly as it was, with no pages key', () => {
    const plain = writeCanvas(emptyCanvas())
    expect(plain).not.toContain('pages')
  })

  test('a record naming a card is not a page: the card stays a card', () => {
    const file = JSON.stringify({
      nodes: [{ id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 40, text: 'hello' }],
      edges: [],
      orden: { version: 1, pages: [{ id: 'a', paper: 'a4', pattern: 'lines' }] },
    })

    const canvas = readCanvas(file)
    expect(pagesOf(canvas)).toHaveLength(0)
    expect(canvas.nodes[0]?.type).toBe('text')
  })

  test('a page whose record was lost degrades to the frame it looks like', () => {
    const file = JSON.stringify({
      nodes: [{ id: 'a', type: 'group', x: 0, y: 0, width: 794, height: 1123, label: 'Page 1' }],
      edges: [],
    })

    const canvas = readCanvas(file)
    expect(pagesOf(canvas)).toHaveLength(0)
    expect(canvas.nodes[0]?.type).toBe('group')
  })

  test('a page keeps its place among the cards', () => {
    const canvas = emptyPages()
    const sheet = pagesOf(canvas)[0]
    const card = {
      id: 'card',
      type: 'text' as const,
      x: 10,
      y: 10,
      width: 100,
      height: 40,
      text: 'x',
    }

    const both = { ...canvas, nodes: [...canvas.nodes, card] }
    const back = readCanvas(writeCanvas(both))

    expect(back.nodes.map((node) => node.id)).toEqual([sheet?.id, 'card'])
  })
})

describe('the column', () => {
  test('lays the pages out top to bottom with a gutter between them', () => {
    const laid = laidOut([page('a'), page('b'), page('c')])

    expect(laid[0]?.y).toBe(0)
    expect(laid[1]?.y).toBe(PAPERS.a4.height + GUTTER)
    expect(laid[2]?.y).toBe(2 * (PAPERS.a4.height + GUTTER))
  })

  test('centres every page on the same middle, whatever their sizes', () => {
    const laid = laidOut([page('a'), page('b', { width: 500 })])

    expect(laid[0]?.x).toBe(-PAPERS.a4.width / 2)
    expect(laid[1]?.x).toBe(-250)
  })

  test('hands back the very same pages when nothing moved', () => {
    const pages = laidOut([page('a'), page('b')])
    expect(laidOut(pages)).toEqual(pages)
    expect(laidOut(pages)[0]).toBe(pages[0])
  })

  test('a canvas already settled is handed straight back', () => {
    const canvas = emptyPages()
    expect(settled(canvas)).toBe(canvas)
  })

  test('is as tall as its pages and their gutters, with no gutter after the last', () => {
    expect(columnHeight([page('a'), page('b')])).toBe(2 * PAPERS.a4.height + GUTTER)
    expect(columnHeight([])).toBe(0)
  })
})

describe('adding and taking away', () => {
  test('a page goes on the end and the note is laid out round it', () => {
    const { canvas, id } = added(emptyPages())
    const pages = pagesOf(canvas)

    expect(pages).toHaveLength(2)
    expect(pages[1]?.id).toBe(id)
    expect(pages[1]?.y).toBe(PAPERS.a4.height + GUTTER)
  })

  test('a page added after one goes after that one', () => {
    const three = added(added(emptyPages()).canvas).canvas
    const first = pagesOf(three)[0]
    const { canvas, id } = added(three, first?.id)

    expect(pagesOf(canvas).map((one) => one.id)[1]).toBe(id)
  })

  test('a page takes the size and the ruling of the one it follows', () => {
    const start = emptyPages()
    const sheet = pagesOf(start)[0]
    if (!sheet) throw new Error('no page')

    const { canvas } = added(reshaped(start, sheet.id, { pattern: 'lines' }))
    expect(pagesOf(canvas)[1]?.pattern).toBe('lines')
  })

  test('taking a page away takes what was written on it', () => {
    const two = added(emptyPages()).canvas
    const pages = pagesOf(two)
    const second = pages[1]
    if (!second) throw new Error('no second page')

    const withInk = {
      ...two,
      nodes: [
        ...two.nodes,
        {
          id: 'card',
          type: 'text' as const,
          x: second.x + 10,
          y: second.y + 10,
          width: 80,
          height: 30,
          text: 'on the second',
        },
      ],
      ink: [
        {
          id: 'stroke',
          tool: 'pen' as const,
          color: '1',
          size: 2,
          points: [{ x: second.x + 5, y: second.y + 5, pressure: 0.5, tiltX: 0, tiltY: 0, t: 0 }],
        },
      ],
    }

    const left = removed(withInk, second.id)
    expect(pagesOf(left)).toHaveLength(1)
    expect(left.nodes.some((node) => node.id === 'card')).toBe(false)
    expect(left.ink).toHaveLength(0)
  })

  test('the pages after one taken away take what is on them along', () => {
    const left = removed(carrying([page('a'), page('b'), page('c')]), 'a')
    expect(left.nodes.map((node) => node.id)).toEqual(['b', 'c', 'on:b', 'on:c'])
    expect(strays(left)).toEqual([])
  })

  test('a card that reaches over the edge onto the next page stays with the page it sits on', () => {
    const three = laidOut([page('a'), page('b'), page('c')])
    const [first, second] = three
    if (!first || !second) throw new Error('no pages')
    const card = (id: string, y: number) => ({
      id,
      type: 'text' as const,
      x: first.x + 10,
      y,
      width: 80,
      height: 200,
      text: id,
    })
    const plane = {
      ...emptyCanvas(),
      nodes: [...three, card('low', first.y + first.height - 150), card('high', second.y - 50)],
    }

    const left = removed(plane, 'b')
    expect(left.nodes.map((node) => node.id)).toEqual(['a', 'c', 'low'])
    expect(left.nodes.find((node) => node.id === 'low')?.y).toBe(first.y + first.height - 150)

    const gone = removed(plane, 'a')
    const high = gone.nodes.find((node) => node.id === 'high')
    expect(gone.nodes.map((node) => node.id)).toEqual(['b', 'c', 'high'])
    expect(high?.y).toBe((pagesOf(gone)[0]?.y ?? 0) - 50)
  })

  test('a stroke begun in the gap between pages goes with the page it is written on', () => {
    const three = laidOut([page('a'), page('b'), page('c')])
    const second = three[1]
    if (!second) throw new Error('no pages')
    const at = (y: number) => ({ x: second.x + 50, y, pressure: 0.5, tiltX: 0, tiltY: 0, t: 0 })
    const stroke = {
      id: 'over',
      tool: 'pen' as const,
      color: '1',
      size: 2,
      points: [at(second.y - 20), at(second.y + 300)],
    }
    const plane = { ...emptyCanvas(), nodes: three, ink: [stroke] }

    expect(removed(plane, 'b').ink).toEqual([])

    const moved = removed(plane, 'a').ink[0]?.points[0]?.y
    expect(moved).toBe((pagesOf(removed(plane, 'a'))[0]?.y ?? 0) - 20)
  })

  test('the last page is never taken away', () => {
    const one = emptyPages()
    expect(removed(one, pagesOf(one)[0]?.id ?? '')).toBe(one)
  })
})

describe('reordering', () => {
  test('a page moved carries what is on it', () => {
    const two = added(emptyPages()).canvas
    const pages = pagesOf(two)
    const second = pages[1]
    if (!second) throw new Error('no second page')

    const withCard = {
      ...two,
      nodes: [
        ...two.nodes,
        {
          id: 'card',
          type: 'text' as const,
          x: second.x + 10,
          y: second.y + 20,
          width: 80,
          height: 30,
          text: 'on the second',
        },
      ],
    }

    const swapped = moved(withCard, second.id, 0)
    const card = swapped.nodes.find((node) => node.id === 'card')

    expect(pagesOf(swapped)[0]?.id).toBe(second.id)
    expect(card?.y).toBe(20)
  })

  test('every page that moves in a reorder carries what is on it', () => {
    const turned = moved(carrying([page('a'), page('b'), page('c')]), 'a', 2)
    expect(pagesOf(turned).map((one) => one.id)).toEqual(['b', 'c', 'a'])
    expect(strays(turned)).toEqual([])
  })

  test('a page already where it is asked to go comes back unchanged', () => {
    const two = added(emptyPages()).canvas
    expect(moved(two, pagesOf(two)[0]?.id ?? '', 0)).toBe(two)
  })

  test('an id that names no page changes nothing', () => {
    const one = emptyPages()
    expect(moved(one, 'nothing', 3)).toBe(one)
  })
})

describe('a long page', () => {
  test('grows in whole steps to hold what reaches past it', () => {
    const start = emptyPages()
    const sheet = pagesOf(start)[0]
    if (!sheet) throw new Error('no page')

    const endless = reshaped(start, sheet.id, { paper: 'long' })
    const taller = grown(endless, new Map([[sheet.id, PAPERS.a4.height + 400]]))
    const height = pagesOf(taller)[0]?.height ?? 0

    expect(height).toBeGreaterThan(PAPERS.a4.height)
    expect((height - PAPERS.a4.height) % GROWTH).toBe(0)
  })

  test('the page under one that grew takes what is on it along', () => {
    const long = carrying([page('a', { paper: 'long' }), page('b', { paper: 'long' })])
    const taller = grown(long, new Map([['a', PAPERS.long.height + 400]]))
    expect(strays(taller)).toEqual([])
  })

  test('a page with nothing reaching past it is left where it is', () => {
    const start = emptyPages()
    const sheet = pagesOf(start)[0]
    if (!sheet) throw new Error('no page')

    const endless = reshaped(start, sheet.id, { paper: 'long' })
    expect(grown(endless, new Map([[sheet.id, 10]]))).toBe(endless)
  })

  test('A4 never grows: writing past the bottom of a sheet is writing off it', () => {
    const start = emptyPages()
    const sheet = pagesOf(start)[0]
    if (!sheet) throw new Error('no page')

    expect(grown(start, new Map([[sheet.id, 9_000]]))).toBe(start)
  })

  test('made A4 again it goes back to A4', () => {
    const start = emptyPages()
    const sheet = pagesOf(start)[0]
    if (!sheet) throw new Error('no page')

    const endless = reshaped(start, sheet.id, { paper: 'long' })
    const taller = grown(endless, new Map([[sheet.id, PAPERS.a4.height + 900]]))
    const back = reshaped(taller, sheet.id, { paper: 'a4' })

    expect(pagesOf(back)[0]?.height).toBe(PAPERS.a4.height)
  })
})

describe('which page a thing is on', () => {
  test('a point on a page, and a point in a gutter', () => {
    const pages = laidOut([page('a'), page('b')])
    const second = pages[1]
    if (!second) throw new Error('no second page')

    expect(pageAt(pages, { x: 0, y: 10 })?.id).toBe('a')
    expect(pageAt(pages, { x: 0, y: second.y + 10 })?.id).toBe('b')
    expect(pageAt(pages, { x: 0, y: PAPERS.a4.height + 5 })).toBeNull()
  })

  test('a stroke belongs to the page the pen went down on', () => {
    const pages = laidOut([page('a'), page('b')])
    const first = pages[0]
    if (!first) throw new Error('no page')

    const box = { x: first.x, y: first.y, width: first.width, height: first.height }
    const over = {
      points: [
        { x: 0, y: first.height - 4 },
        { x: 0, y: first.height + 200 },
      ],
    }

    expect(onPage(over, box)).toBe(true)
    expect(onPage({ points: [] }, box)).toBe(false)
  })

  test('the page being looked at is the one under the middle of the view', () => {
    const pages = laidOut([page('a'), page('b'), page('c')])

    expect(pageShowing(pages, 0, 600)).toBe(1)
    expect(pageShowing(pages, PAPERS.a4.height + GUTTER, 600)).toBe(2)
    expect(pageShowing(pages, 99_999, 600)).toBe(3)
    expect(pageShowing([], 0, 600)).toBe(0)
  })
})

describe('a page note with many pages and strokes', () => {
  interface Box {
    x: number
    y: number
    width: number
    height: number
  }

  const pen = { tool: 'pen' as const, color: '1', size: 2 }
  const dot = (x: number, y: number) => ({ x, y, pressure: 0.5, tiltX: 0, tiltY: 0, t: 0 })

  function annotated(count: number, seed = 7) {
    let state = seed
    const next = () => ((state = (state * 1103515245 + 12345) % 2147483648), state / 2147483648)
    const pages = laidOut(Array.from({ length: count }, (_, at) => page(`p${at}`)))
    const last = pages[pages.length - 1]
    const tall = last ? last.y + last.height : 0
    const ink = Array.from({ length: count * 20 }, (_, at) => {
      const x = (next() - 0.5) * PAPERS.a4.width * 1.6
      const y = next() * tall
      return { ...pen, id: `s${at}`, points: [dot(x, y), dot(x + next() * 300, y + next() * 900)] }
    })
    const nodes = Array.from({ length: count * 2 }, (_, at) => ({
      type: 'text' as const,
      id: `c${at}`,
      text: '',
      x: (next() - 0.5) * PAPERS.a4.width * 1.6,
      y: next() * tall,
      width: 40 + next() * 400,
      height: 20 + next() * 900,
    }))
    return { ...emptyCanvas(), nodes: [...pages, ...nodes], ink }
  }

  function overlapOf(one: Box, other: Box): number {
    const across = Math.min(one.x + one.width, other.x + other.width) - Math.max(one.x, other.x)
    const down = Math.min(one.y + one.height, other.y + other.height) - Math.max(one.y, other.y)
    return across > 0 && down > 0 ? across * down : 0
  }

  function ownerOf(thing: Box, pages: readonly PageNode[]): PageNode | null {
    const x = thing.x + thing.width / 2
    const y = thing.y + thing.height / 2
    const held = pages.find(
      (one) => x >= one.x && x < one.x + one.width && y >= one.y && y < one.y + one.height,
    )
    if (held) return held
    let best: PageNode | null = null
    let most = 0
    for (const one of pages) {
      const area = overlapOf(thing, one)
      if (area > most) {
        most = area
        best = one
      }
    }
    return best
  }

  function inkOwnerOf(stroke: { points: { x: number; y: number }[] }, pages: readonly PageNode[]) {
    const held = pages.find((one) => onPage(stroke, one))
    if (held) return held
    const xs = stroke.points.map((one) => one.x)
    const ys = stroke.points.map((one) => one.y)
    const x = xs.reduce((low, one) => Math.min(low, one))
    const y = ys.reduce((low, one) => Math.min(low, one))
    const width = xs.reduce((high, one) => Math.max(high, one)) - x
    const height = ys.reduce((high, one) => Math.max(high, one)) - y
    return ownerOf({ x, y, width, height }, pages)
  }

  test('takes away with a page what was on it, the same as asking every page', () => {
    const canvas = annotated(40)
    const pages = pagesOf(canvas)
    for (const gone of [pages[0], pages[17], pages[39]]) {
      if (!gone) throw new Error('no page')
      const left = removed(canvas, gone.id)
      const kept = (id: string) => left.nodes.some((one) => one.id === id)
      for (const node of canvas.nodes) {
        if (isPage(node)) continue
        expect(kept(node.id)).toBe(ownerOf(node, pages) !== gone)
      }
      const inked = new Set(left.ink.map((one) => one.id))
      for (const stroke of canvas.ink) {
        expect(inked.has(stroke.id)).toBe(inkOwnerOf(stroke, pages) !== gone)
      }
    }
  })

  test('moves with a page what was on it, the same as asking every page', () => {
    const canvas = annotated(30, 11)
    const pages = pagesOf(canvas)
    const first = pages[0]
    if (!first) throw new Error('no page')
    const after = moved(canvas, first.id, 20)
    const placed = new Map(pagesOf(after).map((one) => [one.id, one]))
    const shift = (owner: PageNode | null) => {
      const now = owner && placed.get(owner.id)
      return now ? now.y - owner.y : 0
    }
    for (const [at, stroke] of canvas.ink.entries()) {
      const now = after.ink[at]
      expect((now?.points[0]?.y ?? 0) - (stroke.points[0]?.y ?? 0)).toBe(
        shift(inkOwnerOf(stroke, pages)),
      )
    }
  })

  function longPages(count: number) {
    const canvas = annotated(count, 5)
    return {
      ...canvas,
      nodes: canvas.nodes.map((node, at) =>
        isPage(node) && at % 3 !== 1 ? { ...node, paper: 'long' as const } : node,
      ),
    }
  }

  const boxOf = (stroke: { points: { x: number; y: number }[] }) => {
    const ys = stroke.points.map((one) => one.y)
    const y = ys.reduce((low, one) => Math.min(low, one))
    return { x: 0, y, width: 0, height: ys.reduce((high, one) => Math.max(high, one)) - y }
  }

  test('finds how far down each long page is written, the same as asking every page', () => {
    const canvas = longPages(30)
    const lowest = lowestOf(canvas, boxOf)
    for (const page of pagesOf(canvas)) {
      if (page.paper !== 'long') {
        expect(lowest.has(page.id)).toBe(false)
        continue
      }
      let reach = page.y
      for (const node of canvas.nodes) {
        if (node.id === page.id) continue
        if (node.x + node.width <= page.x || node.x >= page.x + page.width) continue
        if (node.y + node.height <= page.y || node.y >= page.y + page.height) continue
        reach = Math.max(reach, node.y + node.height)
      }
      for (const stroke of canvas.ink) {
        if (onPage(stroke, page)) reach = Math.max(reach, boxOf(stroke).y + boxOf(stroke).height)
      }
      expect(lowest.get(page.id)).toBe(reach)
    }
  })

  test('finds how far down long pages are written in time that grows with pages and strokes, not their product', () => {
    const made = new Map<number, ReturnType<typeof longPages>>()
    linearly((count) => {
      const canvas = made.get(count) ?? longPages(count)
      made.set(count, canvas)
      return lowestOf(canvas, boxOf)
    }, 800)
  })

  test('adds, moves and takes away a page in time that grows with pages and strokes, not their product', () => {
    const made = new Map<number, ReturnType<typeof annotated>>()
    const of = (count: number) => {
      const held = made.get(count) ?? annotated(count)
      made.set(count, held)
      return held
    }
    linearly((count) => {
      const canvas = of(count)
      const first = pagesOf(canvas)[0]
      if (!first) throw new Error('no page')
      added(canvas, first.id)
      moved(canvas, first.id, count - 1)
      return removed(canvas, first.id)
    }, 800)
  })
})

describe('a page out of a PDF', () => {
  test('is the size the paper says, page by page', () => {
    const canvas = pagesFromPdf('Paper.pdf', [
      { width: 600, height: 800 },
      { width: 800, height: 600 },
    ])
    const pages = pagesOf(canvas)

    expect(pages[0]).toMatchObject({ width: 600, height: 800, file: 'Paper.pdf', page: 1 })
    expect(pages[1]).toMatchObject({ width: 800, height: 600, file: 'Paper.pdf', page: 2 })
  })

  test('says which paper each page is, so a Letter paper is not called A4', () => {
    const canvas = pagesFromPdf('Paper.pdf', [
      { width: PAPERS.letter.width, height: PAPERS.letter.height },
      { width: PAPERS.a4.width, height: PAPERS.a4.height },
      { width: 400, height: 1200 },
    ])
    const pages = pagesOf(canvas)

    expect(pages.map((one) => one.paper)).toEqual(['letter', 'a4', 'a4'])
    expect(pages[2]).toMatchObject({ width: 400, height: 1200 })
  })

  test('a page named Letter keeps Letter when the file is read back', () => {
    const once = pagesFromPdf('Paper.pdf', [
      { width: PAPERS.letter.width, height: PAPERS.letter.height },
    ])
    expect(pagesOf(readCanvas(writeCanvas(once)))[0]?.paper).toBe('letter')
  })

  test('a paper with no pages still gives somewhere to write', () => {
    expect(pagesOf(pagesFromPdf('Paper.pdf', []))).toHaveLength(1)
  })

  test('one page is a page and nothing else', () => {
    const one = pdfPage('Paper.pdf', 3, 600, 800)
    expect(isPage(one)).toBe(true)
    expect(one.page).toBe(3)
  })

  test('counts its pages', () => {
    expect(pageCount(pagesFromPdf('Paper.pdf', [{ width: 1, height: 1 }]))).toBe(1)
    expect(pageCount(emptyCanvas())).toBe(0)
  })
})

describe('the paper a page note holds', () => {
  test('is the note with .pdf after it', () => {
    expect(paperOf('/s/Lecture 4.pages')).toBe('/s/Lecture 4.pages.pdf')
  })

  test('names the note it belongs to, and nothing else does', () => {
    expect(holderOf('/s/Lecture 4.pages.pdf')).toBe('/s/Lecture 4.pages')
    expect(holderOf('/s/Lecture 4.PAGES.PDF')).toBe('/s/Lecture 4.PAGES')
    expect(holderOf('/s/Lecture 4.pdf')).toBeNull()
    expect(holderOf('/s/Lecture 4.pages')).toBeNull()
  })
})
