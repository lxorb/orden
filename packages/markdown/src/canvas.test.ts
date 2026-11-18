import { describe, expect, test, vi } from 'vitest'
import { linearly } from '../../../scripts/growth'
import {
  blankCanvas,
  type Canvas,
  CANVAS_RUNS,
  canvasIconEdit,
  canvasRuns,
  clampOpacity,
  DEFAULT_INK,
  freshId,
  FURTHEST,
  isShape,
  nodeOf,
  readCanvas,
  SHAPES,
  writeCanvas,
} from './canvas'
import { mergeCanvasFiles } from './canvas-merge'
import { emptyPages, pagesFromPdf } from './pages'

const read = (file: object) => readCanvas(JSON.stringify(file))
const card = (id: string, more: object = {}) => ({
  id,
  type: 'text',
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  text: '',
  ...more,
})
const EMPTY = { nodes: [], edges: [], ink: [], at: {}, gone: {}, icon: null, iconColor: null }

const SPEC_EXAMPLE = {
  nodes: [
    { id: 'a', type: 'text', x: 0, y: 0, width: 250, height: 60, text: '# Hello', color: '1' },
    {
      id: 'b',
      type: 'file',
      x: 300,
      y: 0,
      width: 400,
      height: 400,
      file: 'Notes/Plan.md',
      subpath: '#Heading',
    },
    { id: 'c', type: 'link', x: 0, y: 200, width: 250, height: 80, url: 'https://example.com' },
    {
      id: 'd',
      type: 'group',
      x: -40,
      y: -40,
      width: 800,
      height: 500,
      label: 'Everything',
      background: 'assets/paper.png',
      backgroundStyle: 'cover',
      color: '#ff0000',
    },
  ],
  edges: [
    {
      id: 'e1',
      fromNode: 'a',
      fromSide: 'right',
      fromEnd: 'arrow',
      toNode: 'b',
      toSide: 'left',
      toEnd: 'none',
      color: '4',
      label: 'leads to',
    },
    { id: 'e2', fromNode: 'b', toNode: 'c' },
  ],
}

describe('reading a canvas', () => {
  const canvas = read(SPEC_EXAMPLE)

  test('takes every kind of node the spec names', () => {
    expect(canvas.nodes.map((node) => node.type)).toEqual(['text', 'file', 'link', 'group'])
  })

  test('keeps what each kind of node is made of', () => {
    const [text, file, link, group] = canvas.nodes
    expect(text).toMatchObject({ text: '# Hello', color: '1', x: 0, width: 250 })
    expect(file).toMatchObject({ file: 'Notes/Plan.md', subpath: '#Heading' })
    expect(link).toMatchObject({ url: 'https://example.com' })
    expect(group).toMatchObject({
      label: 'Everything',
      background: 'assets/paper.png',
      backgroundStyle: 'cover',
      color: '#ff0000',
    })
  })

  test('keeps the sides, the ends, the colour and the words of an edge', () => {
    expect(canvas.edges[0]).toEqual({
      id: 'e1',
      fromNode: 'a',
      fromSide: 'right',
      fromEnd: 'arrow',
      toNode: 'b',
      toSide: 'left',
      toEnd: 'none',
      color: '4',
      label: 'leads to',
    })
  })

  test('leaves out what an edge does not say, so the defaults stay the defaults; is an empty canvas for a file that is not one', () => {
    expect(canvas.edges[1]).toEqual({ id: 'e2', fromNode: 'b', toNode: 'c' })
    for (const text of ['', 'nonsense', '[]', '{}']) expect(readCanvas(text)).toEqual(EMPTY)
  })
})

describe('reading a canvas somebody else wrote', () => {
  test('drops a node with no id, no known type, or nothing of its own in it', () => {
    const canvas = read({
      nodes: [
        { ...card(''), id: undefined, text: 'no id' },
        { id: 'x', type: 'sticky', x: 0, y: 0, width: 10, height: 10 },
        card('y', { text: undefined }),
        { ...card('z', { type: 'file', file: '' }), text: undefined },
        card('ok'),
      ],
    })
    expect(canvas.nodes.map((node) => node.id)).toEqual(['ok'])
  })

  test('fills in a position and a size that were never written, rounding a position to whole pixels', () => {
    expect(read({ nodes: [{ id: 'a', type: 'text', text: '' }] }).nodes[0]).toMatchObject({
      x: 0,
      y: 0,
      width: 250,
      height: 60,
    })
    const [node] = read({ nodes: [{ id: 'a', type: 'text', text: '', x: 10.6, y: -3.2 }] }).nodes
    expect(node).toMatchObject({ x: 11, y: -3 })
  })

  test('of two nodes sharing an id, the first keeps it, which is what every edge meant, and the second is kept under its own', () => {
    const canvas = read({ nodes: [card('a', { text: 'first' }), card('a', { text: 'second' })] })
    expect(canvas.nodes).toHaveLength(2)
    expect(canvas.nodes[0]).toMatchObject({ id: 'a', text: 'first' })
    expect(canvas.nodes[1]).toMatchObject({ text: 'second' })
    expect(canvas.nodes[1]?.id).not.toBe('a')
  })

  test('drops an edge that names a node the canvas does not hold', () => {
    const edges = [
      { id: 'e', fromNode: 'a', toNode: 'gone' },
      { id: 'f', fromNode: 'a', toNode: 'a' },
    ]
    expect(read({ nodes: [card('a')], edges }).edges.map((edge) => edge.id)).toEqual(['f'])
  })

  test('drops a side, an end or a background style it has never heard of', () => {
    const canvas = read({
      nodes: [
        card('a'),
        card('g', { type: 'group', text: undefined, backgroundStyle: 'stretched' }),
      ],
      edges: [{ id: 'e', fromNode: 'a', toNode: 'a', fromSide: 'sideways', toEnd: 'circle' }],
    })
    expect(canvas.nodes[1]).not.toHaveProperty('backgroundStyle')
    expect(canvas.edges[0]).not.toHaveProperty('fromSide')
    expect(canvas.edges[0]).not.toHaveProperty('toEnd')
  })

  test('drops a colour that is neither a preset nor a hex string; drops a subpath that does not begin with a hash, as the spec says it must', () => {
    const nodes = ['red', '7', '#0f0'].map((color, at) => card(String(at), { color }))
    expect(read({ nodes }).nodes.map((node) => node.color)).toEqual([undefined, undefined, '#0f0'])
    const file = card('a', { type: 'file', text: undefined, file: 'a.md', subpath: 'Top' })
    expect(read({ nodes: [file] }).nodes[0]).not.toHaveProperty('subpath')
  })
})

describe('writing a canvas', () => {
  test('writes only the fields the spec defines', () => {
    const written = JSON.parse(writeCanvas(read(SPEC_EXAMPLE))) as {
      nodes: Record<string, unknown>[]
      edges: Record<string, unknown>[]
    }
    expect(Object.keys(written.nodes[0] ?? {})).toEqual(
      'id type x y width height color text'.split(' '),
    )
    expect(Object.keys(written.edges[1] ?? {})).toEqual(['id', 'fromNode', 'toNode'])
  })

  test('leaves out what is absent rather than writing it as null; is read back as what went in, byte for byte the same on its own output', () => {
    const written = writeCanvas({ ...EMPTY, nodes: [{ ...card('a'), type: 'text' }] })
    expect(written).not.toContain('color')
    expect(written).not.toContain('null')
    const canvas = read(SPEC_EXAMPLE)
    expect(readCanvas(writeCanvas(canvas))).toEqual(canvas)
    expect(writeCanvas(readCanvas(writeCanvas(canvas)))).toBe(writeCanvas(canvas))
  })

  test('holds two empty lists before anybody has drawn on it; keeps the order the nodes were in, which is the order they stack in', () => {
    expect(readCanvas(blankCanvas())).toEqual(EMPTY)
    expect(blankCanvas()).not.toContain('orden')
    expect(blankCanvas().endsWith('\n')).toBe(true)
    const canvas: Canvas = {
      ...EMPTY,
      nodes: ['c', 'a', 'b'].map((id) => ({ ...card(id), type: 'text' })),
    }
    expect(readCanvas(writeCanvas(canvas)).nodes.map((node) => node.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('a fresh id', () => {
  test('is sixteen hex characters, which is what Obsidian writes, and not the last one', () => {
    expect(freshId()).toMatch(/^[0-9a-f]{16}$/)
    const seen = new Set(Array.from({ length: 200 }, () => freshId()))
    expect(seen.size).toBe(200)
  })
})

describe('what Orden keeps beyond the spec', () => {
  const drawn: Canvas = {
    nodes: [
      { id: 'card', type: 'text', x: 0, y: 0, width: 100, height: 50, text: 'hello' },
      { id: 'box', type: 'shape', shape: 'rect', x: 200, y: 0, width: 80, height: 40, color: '3' },
      { id: 'ray', type: 'shape', shape: 'arrow', x: 0, y: 200, width: 80, height: 40, up: true },
    ],
    edges: [],
    ink: [
      {
        id: 'ink1',
        tool: 'fountain',
        color: '#123456',
        size: 4,
        points: [
          { x: 1, y: 2, pressure: 0.4, tiltX: 3, tiltY: -4, t: 0 },
          { x: 5, y: 6, pressure: 0.8, tiltX: 3, tiltY: -4, t: 16 },
        ],
      },
    ],
    at: { card: 1000, box: 1001 },
    gone: { old: 900 },
    icon: null,
    iconColor: null,
  }

  const written = writeCanvas(drawn)
  const parsed = JSON.parse(written) as Record<string, unknown>

  test('writes the spec half as the spec, with no shape in it; keeps everything else under one key of its own; reads its own file back exactly, shapes, ink, order and times', () => {
    expect((parsed.nodes as { id: string }[]).map((node) => node.id)).toEqual(['card'])
    expect(Object.keys(parsed)).toEqual(['nodes', 'edges', 'orden'])
    expect(readCanvas(written)).toEqual(drawn)
  })

  test('is byte for byte the same on its own output; keeps the z order a shape sits at among the cards', () => {
    expect(writeCanvas(readCanvas(written))).toBe(written)
    const back: Canvas = { ...drawn, nodes: [drawn.nodes[1]!, drawn.nodes[0]!, drawn.nodes[2]!] }
    expect(readCanvas(writeCanvas(back)).nodes.map((node) => node.id)).toEqual([
      'box',
      'card',
      'ray',
    ])
  })

  test('keeps all seven shapes, and the words inside one', () => {
    const diagram: Canvas = {
      nodes: SHAPES.map((shape, at) => ({
        id: shape,
        type: 'shape' as const,
        shape,
        x: at * 100,
        y: 0,
        width: 80,
        height: 40,
        ...(shape === 'rhombus' ? { text: 'Ready?' } : {}),
      })),
      edges: [],
      ink: [],
      at: {},
      gone: {},
      icon: null,
      iconColor: null,
    }
    const back = readCanvas(writeCanvas(diagram))
    expect(back).toEqual(diagram)
    expect(JSON.parse(writeCanvas(diagram)).nodes).toEqual([])
  })

  test('drops words that are not words, and writes none where there are none', () => {
    const canvas = read({
      nodes: [],
      orden: {
        shapes: [
          { id: 'a', shape: 'rect', x: 0, y: 0, width: 1, height: 1, text: 7 },
          { id: 'b', shape: 'rect', x: 0, y: 0, width: 1, height: 1, text: '' },
        ],
      },
    })
    expect(canvas.nodes[0]).not.toHaveProperty('text')
    expect(canvas.nodes[1]).not.toHaveProperty('text')
  })

  test('a shape with no size falls back to the same box a card does; says which names are shapes', () => {
    const canvas = read({ nodes: [], orden: { shapes: [{ id: 'a', shape: 'rect', x: 0, y: 0 }] } })
    const card = read({ nodes: [{ id: 'b', type: 'text', text: 'hi' }] })
    expect(canvas.nodes[0]?.width).toBe(card.nodes[0]?.width)
    expect(canvas.nodes[0]?.height).toBe(card.nodes[0]?.height)
    for (const shape of SHAPES) expect(isShape(shape), shape).toBe(true)
    expect(isShape('blob')).toBe(false)
    expect(isShape(undefined)).toBe(false)
  })

  test('still opens a canvas whose orden block is nonsense', () => {
    const canvas = read({ nodes: [card('a')], orden: 'what' })
    expect(canvas.nodes).toHaveLength(1)
    expect(canvas.ink).toEqual([])
  })

  test('keeps a stroke of one point and drops a shape with no shape', () => {
    const canvas = read({
      nodes: [],
      orden: {
        ink: [{ id: 'a', tool: 'pen', color: '1', size: 2, points: [1, 2, 0.5, 0, 0, 0] }],
        shapes: [{ id: 'b', shape: 'blob', x: 0, y: 0, width: 1, height: 1 }],
      },
    })
    expect(canvas.ink.map((one) => one.points.length)).toEqual([1])
    expect(canvas.ink[0]?.points[0]).toEqual({
      x: 1,
      y: 2,
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
      t: 0,
    })
    expect(canvas.nodes).toEqual([])
  })

  test('drops a stroke with no points at all; a card Obsidian added to a canvas of ours arrives on top', () => {
    const canvas = read({
      nodes: [],
      orden: { ink: [{ id: 'a', tool: 'pen', color: '1', size: 2, points: [] }] },
    })
    expect(canvas.ink).toEqual([])
    const theirs = JSON.parse(written) as { nodes: Record<string, unknown>[] }
    theirs.nodes.push({ id: 'new', type: 'text', x: 9, y: 9, width: 1, height: 1, text: 'theirs' })
    expect(read(theirs).nodes.map((node) => node.id)).toEqual(['card', 'box', 'ray', 'new'])
  })
})

describe('how translucent a stroke was drawn', () => {
  const one = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      nodes: [],
      orden: {
        ink: [
          {
            id: 'a',
            tool: 'highlighter',
            color: '2',
            size: 18,
            points: [1, 2, 0.5, 0, 0, 0, 9, 8, 0.6, 0, 0, 16],
            ...over,
          },
        ],
      },
    })

  test('is not there at all in a canvas that never said; is read back as it was written; is written down only by a stroke that has one', () => {
    expect(readCanvas(one()).ink[0]?.opacity).toBeUndefined()
    expect(readCanvas(one({ opacity: 0.55 })).ink[0]?.opacity).toBe(0.55)
    const canvas = readCanvas(one())
    const plain = JSON.parse(writeCanvas(canvas)) as {
      orden: { ink: Record<string, unknown>[] }
    }
    expect(plain.orden.ink[0]).not.toHaveProperty('opacity')
  })

  test('rides through a whole write and read unchanged', () => {
    const drawn: Canvas = {
      nodes: [],
      edges: [],
      ink: [
        {
          id: 'a',
          tool: 'pen',
          color: '1',
          size: 3,
          opacity: 0.3,
          points: [
            { x: 0, y: 0, pressure: 0.5, tiltX: 0, tiltY: 0, t: 0 },
            { x: 4, y: 4, pressure: 0.5, tiltX: 0, tiltY: 0, t: 8 },
          ],
        },
      ],
      at: {},
      gone: {},
      icon: null,
      iconColor: null,
    }
    const written = writeCanvas(drawn)
    expect(readCanvas(written)).toEqual(drawn)
    expect(writeCanvas(readCanvas(written))).toBe(written)
  })

  test('is brought back inside what paint can use when a file says otherwise; a stroke nobody can see is not a stroke, so nought is not allowed', () => {
    expect(readCanvas(one({ opacity: 40 })).ink[0]?.opacity).toBe(1)
    expect(readCanvas(one({ opacity: -3 })).ink[0]?.opacity).toBe(0.05)
    expect(readCanvas(one({ opacity: 'blue' })).ink[0]?.opacity).toBeUndefined()
    expect(clampOpacity(0)).toBe(0.05)
    expect(clampOpacity(1)).toBe(1)
    expect(clampOpacity(0.4449)).toBe(0.44)
    expect(clampOpacity(Number.NaN)).toBe(1)
  })
})

describe('a canvas from somewhere else', () => {
  test('brings a node from beyond the plane back onto it', () => {
    const canvas = read({
      nodes: [{ id: 'a', type: 'text', x: 1e308, y: -1e308, width: 1e308, height: 5, text: 'far' }],
    })
    const [node] = canvas.nodes
    expect(node?.x).toBe(FURTHEST)
    expect(node?.y).toBe(-FURTHEST)
    expect(node?.width).toBe(FURTHEST)
    expect(Number.isFinite((node?.x ?? 0) + (node?.width ?? 0))).toBe(true)
  })

  test('brings a stroke drawn beyond the plane back onto it', () => {
    const canvas = read({
      nodes: [],
      orden: {
        ink: [
          {
            id: 'a',
            tool: 'pen',
            color: '1',
            size: 1e308,
            points: [1e308, -1e308, 400, 0, 0, 0, 2, 2, 0.5, 0, 0, 8],
          },
        ],
      },
    })
    const stroke = canvas.ink[0]
    expect(stroke?.points[0]).toMatchObject({ x: FURTHEST, y: -FURTHEST, pressure: 1 })
    expect(stroke?.size).toBeLessThanOrEqual(FURTHEST)
  })

  test('drops a stroke colour that is neither a preset, a hex, nor the page ink', () => {
    const one = (color: unknown) =>
      read({
        nodes: [],
        orden: {
          ink: [
            {
              id: 'a',
              tool: 'pen',
              color,
              size: 2,
              points: [0, 0, 0.5, 0, 0, 0, 1, 1, 0.5, 0, 0, 8],
            },
          ],
        },
      }).ink[0]?.color
    expect(one('3')).toBe('3')
    expect(one('#abcdef')).toBe('#abcdef')
    expect(one(DEFAULT_INK)).toBe(DEFAULT_INK)
    expect(one('"><script>alert(1)</script><path fill="')).toBe(DEFAULT_INK)
    expect(one('toString')).toBe(DEFAULT_INK)
  })
})

describe('the icon a canvas wears', () => {
  const applied = (text: string, name: string | null, tint: string | null = null) => {
    const edit = canvasIconEdit(text, name, tint)
    return edit === null ? null : text.slice(0, edit.from) + edit.insert + text.slice(edit.to)
  }

  test('is read off the key that already carries the ink; and an emoji, which is what a vault out of Iconize holds', () => {
    const file = JSON.stringify({ nodes: [], edges: [], orden: { version: 1, icon: 'rocket' } })
    expect(readCanvas(file).icon).toBe('rocket')
    expect(readCanvas('{"orden":{"icon":"🚀"}}').icon).toBe('🚀')
  })

  test('is nothing where the file says nothing it could be drawn from; is written first inside the key, and nowhere near the spec half', () => {
    expect(readCanvas('{"nodes":[],"edges":[]}').icon).toBeNull()
    expect(readCanvas('{"orden":{"icon":"   "}}').icon).toBeNull()
    expect(readCanvas('{"orden":{"icon":42}}').icon).toBeNull()
    expect(readCanvas('not json').icon).toBeNull()
    const written = writeCanvas({ ...readCanvas(blankCanvas()), icon: 'rocket' })
    const parsed = JSON.parse(written) as { orden: Record<string, unknown> }
    expect(Object.keys(parsed)).toEqual(['nodes', 'edges', 'orden'])
    expect(Object.keys(parsed.orden)).toEqual(['version', 'icon'])
  })

  test('rides a write and a read back unchanged', () => {
    const written = writeCanvas({ ...readCanvas(blankCanvas()), icon: 'file-text' })
    expect(readCanvas(written).icon).toBe('file-text')
    expect(writeCanvas(readCanvas(written))).toBe(written)
  })

  test('changes nothing in the file but the icon', () => {
    const vault = {
      nodes: [
        {
          id: 'b',
          type: 'excalidraw',
          x: 0,
          y: 0,
          width: 200,
          height: 100,
          file: 'Drawing.excalidraw',
        },
        {
          id: 'c',
          type: 'text',
          text: 'hello',
          x: 300,
          y: 0,
          width: 200,
          height: 60,
          styleAttributes: { shape: 'pill' },
        },
      ],
      edges: [{ id: 'e', fromNode: 'b', toNode: 'c' }],
      metadata: { version: '1.0-1.0', frontmatter: {} },
    }
    const before = JSON.stringify(vault, null, '\t')
    const after = applied(before, 'star')
    expect(after).not.toBeNull()
    expect(JSON.parse(after ?? '')).toEqual({ ...vault, orden: { version: 1, icon: 'star' } })
    expect(applied(after ?? '', null)).toBe(`${JSON.stringify(vault, null, '\t')}\n`)
  })

  test('and keeps what a newer build wrote under its own key; goes in as an edit of the few characters that moved; replaces the one that was there', () => {
    const file = JSON.stringify({ nodes: [], edges: [], orden: { version: 1, later: [1, 2] } })
    expect(JSON.parse(applied(file, 'rocket', 'blue') ?? '')).toEqual({
      nodes: [],
      edges: [],
      orden: { version: 1, icon: 'rocket', iconColor: 'blue', later: [1, 2] },
    })
    const before = blankCanvas()
    const edit = canvasIconEdit(before, 'rocket')
    expect(edit).not.toBeNull()
    expect(before.slice(0, edit?.from ?? 0)).toContain('"edges"')
    expect(edit?.insert).toContain('"icon": "rocket"')
    expect(readCanvas(applied(before, 'rocket') ?? '').icon).toBe('rocket')
    const marked = applied(blankCanvas(), 'rocket') ?? ''
    expect(readCanvas(applied(marked, 'anchor') ?? '').icon).toBe('anchor')
  })

  test('and taking it away leaves the file as it was before it', () => {
    const before = blankCanvas()
    const marked = applied(before, 'rocket') ?? ''
    expect(applied(marked, null)).toBe(before)
  })

  test('is no edit at all where the file already says that; is refused on a file that is not JSON, rather than written over it; but a file with nothing in it yet takes one', () => {
    const marked = applied(blankCanvas(), 'rocket') ?? ''
    expect(canvasIconEdit(marked, 'rocket')).toBeNull()
    expect(canvasIconEdit(blankCanvas(), null)).toBeNull()
    expect(canvasIconEdit('not json at all', 'rocket')).toBeNull()
    expect(canvasIconEdit('[1, 2, 3]', 'rocket')).toBeNull()
    expect(readCanvas(applied('', 'rocket') ?? '').icon).toBe('rocket')
  })

  test('takes a colour beside it, under a key of its own', () => {
    const marked = applied(blankCanvas(), 'rocket', 'violet') ?? ''
    const read = readCanvas(marked)
    expect(read.icon).toBe('rocket')
    expect(read.iconColor).toBe('violet')
    expect(Object.keys((JSON.parse(marked) as { orden: object }).orden)).toEqual([
      'version',
      'icon',
      'iconColor',
    ])
  })

  test('and a colour with no icon to colour is no colour at all', () => {
    const marked = applied(blankCanvas(), 'rocket', 'violet') ?? ''
    const bare = applied(marked, null, 'violet') ?? ''
    expect(readCanvas(bare).icon).toBeNull()
    expect(readCanvas(bare).iconColor).toBeNull()
    expect(bare).toBe(blankCanvas())
  })

  test('changing only the colour is still an edit; leaves the cards, the ink and the times exactly where they were', () => {
    const marked = applied(blankCanvas(), 'rocket', 'violet') ?? ''
    expect(readCanvas(applied(marked, 'rocket', 'teal') ?? '').iconColor).toBe('teal')
    expect(readCanvas(applied(marked, 'rocket', null) ?? '').iconColor).toBeNull()
    const drawn = readCanvas(writeCanvas({ ...readCanvas(blankCanvas()), at: { card: 7 } }))
    const after = readCanvas(applied(writeCanvas(drawn), 'rocket') ?? '')
    expect(after.at).toEqual(drawn.at)
    expect(after.nodes).toEqual(drawn.nodes)
  })
})

describe('writing a canvas a piece at a time', () => {
  function plane(count: number): Canvas {
    const ink = Array.from({ length: count }, (_, at) => ({
      id: `s${String(at)}`,
      tool: 'pen' as const,
      color: 'ink' as const,
      size: 3,
      points: [
        { x: at, y: 2, pressure: 0.5, tiltX: 0, tiltY: 0, t: 0 },
        { x: at + 8, y: 9, pressure: 0.5, tiltX: 0, tiltY: 0, t: 12 },
      ],
    }))
    return {
      nodes: [
        { id: 'card', type: 'text', x: 0, y: 0, width: 100, height: 50, text: 'a "quoted"\nline' },
        { id: 'box', type: 'shape', shape: 'rect', x: 200, y: 0, width: 80, height: 40 },
      ],
      edges: [{ id: 'e', fromNode: 'card', toNode: 'box' }],
      ink,
      at: Object.fromEntries([
        ...ink.map((one) => [one.id, 5]),
        ['12', 7],
        ['4294967295', 1],
        ['07', 2],
        ['card', 3],
      ]),
      gone: { '3': 1, old: 2 },
      icon: 'rocket',
      iconColor: 'teal',
    }
  }

  const printed = (text: string) => `${JSON.stringify(JSON.parse(text), null, '\t')}\n`

  test.each([
    ['an empty plane', readCanvas(blankCanvas())],
    ['the spec example', read(SPEC_EXAMPLE)],
    ['a drawn plane', plane(3)],
    [
      'a plane with no icon colour and no times',
      { ...plane(1), iconColor: null, at: {}, gone: {} },
    ],
    ['a page note', emptyPages()],
    [
      'words with no card round them',
      {
        ...plane(1),
        nodes: [
          ...plane(1).nodes,
          {
            id: 'words',
            type: 'text' as const,
            x: 0,
            y: 90,
            width: 240,
            height: 40,
            text: 'Hi',
            bare: true as const,
          },
        ],
      },
    ],
    [
      'a page note of a PDF',
      pagesFromPdf('paper.pdf', [
        { width: 600, height: 800 },
        { width: 600, height: 800 },
      ]),
    ],
  ])('comes to what the printer prints for %s', (_, canvas) => {
    const written = writeCanvas(canvas)
    expect(written).toBe(printed(written))
    expect(readCanvas(written)).toEqual(readCanvas(printed(written)))
  })

  test('always in the same runs, so two writes line up', () => {
    expect(canvasRuns(readCanvas(blankCanvas()))).toHaveLength(CANVAS_RUNS)
    expect(canvasRuns(plane(4))).toHaveLength(CANVAS_RUNS)
  })

  test('prints a stroke once, however often the plane is written', () => {
    const before = plane(200)
    writeCanvas(before)
    const after = { ...before, ink: [...before.ink, { ...before.ink[0]!, id: 'new' }] }
    const printing = vi.spyOn(JSON, 'stringify')
    const written = writeCanvas(after)
    const characters = printing.mock.results.reduce(
      (sum, one) => sum + (typeof one.value === 'string' ? one.value.length : 0),
      0,
    )
    printing.mockRestore()
    expect(characters).toBeLessThan(written.length / 5)
    expect(written).toBe(printed(written))
  })
})

describe('words with no card round them (#421)', () => {
  const canvas: Canvas = {
    ...readCanvas(blankCanvas()),
    nodes: [
      { id: 'card', type: 'text', x: 0, y: 0, width: 100, height: 50, text: 'A card' },
      { id: 'words', type: 'text', x: 0, y: 90, width: 240, height: 40, text: 'Words', bare: true },
    ],
  }
  const written = writeCanvas(canvas)
  const parsed = JSON.parse(written) as {
    nodes: Record<string, unknown>[]
    orden: { words: string[] }
  }

  test('are a card to anybody reading the spec, and listed as words under orden; come back as words, and the card as a card; as a room keeps them, field for field', () => {
    expect(parsed.nodes.map((node) => node.type)).toEqual(['text', 'text'])
    expect(parsed.nodes.some((node) => 'bare' in node)).toBe(false)
    expect(parsed.orden.words).toEqual(['words'])
    const back = readCanvas(written)
    expect(back.nodes).toEqual(canvas.nodes)
    expect(writeCanvas(back)).toBe(written)
    expect(nodeOf({ ...canvas.nodes[1] })).toEqual(canvas.nodes[1])
  })

  test('leave no key of ours in a file of plain cards', () => {
    const plain = writeCanvas({ ...canvas, nodes: [canvas.nodes[0]!] })
    expect(JSON.parse(plain)).not.toHaveProperty('orden')
  })
})

describe('something locked in place (#643)', () => {
  const canvas: Canvas = {
    ...readCanvas(blankCanvas()),
    nodes: [
      {
        id: 'photo',
        type: 'file',
        x: 0,
        y: 0,
        width: 400,
        height: 300,
        file: 'a.png',
        locked: true,
      },
      { id: 'card', type: 'text', x: 0, y: 320, width: 100, height: 50, text: 'A card' },
      {
        id: 'box',
        type: 'shape',
        shape: 'rect',
        x: 0,
        y: 400,
        width: 80,
        height: 80,
        locked: true,
      },
    ],
  }
  const written = writeCanvas(canvas)
  const parsed = JSON.parse(written) as {
    nodes: Record<string, unknown>[]
    orden: { locked: string[]; shapes: Record<string, unknown>[] }
  }

  test('is the record it was to anybody reading the spec, and listed as locked under orden; comes back locked, and the rest as it was; as a room keeps it, field for field', () => {
    expect(parsed.nodes.some((node) => 'locked' in node)).toBe(false)
    expect(parsed.orden.shapes.some((shape) => 'locked' in shape)).toBe(false)
    expect(parsed.orden.locked).toEqual(['photo', 'box'])
    const back = readCanvas(written)
    expect(back.nodes).toEqual(canvas.nodes)
    expect(writeCanvas(back)).toBe(written)
    expect(nodeOf({ ...canvas.nodes[0] })).toEqual(canvas.nodes[0])
    expect(nodeOf({ ...canvas.nodes[2] })).toEqual(canvas.nodes[2])
  })

  test('leaves no key of ours in a file of plain cards; unlocked on one copy later stays unlocked when the two are put together', () => {
    const plain = writeCanvas({ ...canvas, nodes: [canvas.nodes[1]!] })
    expect(JSON.parse(plain)).not.toHaveProperty('orden')
    const free = canvas.nodes.map(({ locked: _locked, ...node }) => node)
    const ours = writeCanvas({ ...canvas, at: { photo: 100, card: 100, box: 100 } })
    const theirs = writeCanvas({ ...canvas, nodes: free, at: { photo: 200, card: 100, box: 200 } })
    const both = mergeCanvasFiles(ours, theirs, 300)
    expect(readCanvas(both).nodes.some((node) => node.locked)).toBe(false)
    expect(JSON.parse(both).orden).not.toHaveProperty('locked')
  })
})

describe('a canvas holding another app’s things', () => {
  const VAULT = JSON.stringify(
    {
      nodes: [
        { id: 'x', type: 'excalidraw', x: 0, y: 0, width: 200, height: 100 },
        {
          id: 'a',
          type: 'text',
          text: 'a',
          x: 300,
          y: 0,
          width: 200,
          height: 60,
          styleAttributes: { s: 1 },
        },
      ],
      edges: [{ id: 'e', fromNode: 'x', toNode: 'a' }],
      metadata: { version: '1.0-1.0' },
    },
    null,
    '\t',
  )

  test('keeps them on what it reads, and writes them back', () => {
    const canvas = readCanvas(VAULT)
    expect(canvas.nodes.map((one) => one.id)).toEqual(['a'])
    expect(canvas.extras?.nodes.has('x')).toBe(true)
    const back = JSON.parse(writeCanvas(canvas)) as Record<string, unknown>
    expect(back.metadata).toEqual({ version: '1.0-1.0' })
    expect(JSON.stringify(back)).toContain('excalidraw')
    expect(JSON.stringify(back)).toContain('styleAttributes')
  })

  test('writes the same file in runs as whole', () => {
    const canvas = readCanvas(VAULT)
    expect(
      canvasRuns(canvas)
        .map((run) => run.join(''))
        .join(''),
    ).toBe(writeCanvas(canvas))
    expect(canvasRuns(canvas)).toHaveLength(CANVAS_RUNS)
  })

  test('holds nothing extra for a canvas of the spec’s own', () => {
    expect(readCanvas(blankCanvas()).extras).toBeUndefined()
    expect('extras' in readCanvas(writeCanvas(readCanvas(VAULT)))).toBe(true)
  })

  test('keeps the strokes and shapes of a newer Orden it cannot read, through edits and merges', () => {
    const points = [0, 0, 0.5, 0, 0, 0, 10, 10, 0.5, 0, 0, 8]
    const text = JSON.stringify(
      {
        nodes: [],
        edges: [],
        orden: {
          version: 1,
          ink: [
            { id: 'known', tool: 'pen', color: '#222222', size: 3, points },
            { id: 'later', tool: 'quill', color: '#222222', size: 3, points, flow: 2 },
          ],
          shapes: [
            { id: 'box', shape: 'rect', x: 0, y: 0, width: 50, height: 50 },
            { id: 'star', shape: 'star', x: 90, y: 0, width: 50, height: 50, arms: 5 },
          ],
        },
      },
      null,
      '\t',
    )
    const read = readCanvas(text)
    expect(read.ink.map((one) => one.id)).toEqual(['known'])
    const edited = writeCanvas({ ...read, ink: [...read.ink, { ...read.ink[0]!, id: 'mine' }] })
    const back = JSON.parse(edited) as {
      orden: { ink: { id: string }[]; shapes: { id: string }[] }
    }
    expect(back.orden.ink.map((one) => one.id).sort()).toEqual(['known', 'later', 'mine'])
    expect(back.orden.ink.find((one) => one.id === 'later')).toMatchObject({
      tool: 'quill',
      flow: 2,
    })
    expect(back.orden.shapes.map((one) => one.id).sort()).toEqual(['box', 'star'])
    const again = JSON.parse(writeCanvas(readCanvas(edited))) as typeof back
    expect(again.orden.ink.map((one) => one.id).sort()).toEqual(['known', 'later', 'mine'])
    expect(again.orden.shapes.map((one) => one.id).sort()).toEqual(['box', 'star'])
    const merged = JSON.parse(mergeCanvasFiles(text, edited, 0)) as typeof back
    expect(merged.orden.ink.map((one) => one.id).sort()).toEqual(['known', 'later', 'mine'])
    expect(merged.orden.shapes.map((one) => one.id).sort()).toEqual(['box', 'star'])
  })

  test('writes a line to a card the file lacks as nothing, and adds no empty block of its own', () => {
    const text = JSON.stringify(
      {
        nodes: [{ id: 'a', type: 'text', text: 'a', x: 0, y: 0, width: 200, height: 60 }],
        edges: [{ id: 'e', fromNode: 'a', toNode: 'gone' }],
      },
      null,
      '\t',
    )
    const back = JSON.parse(writeCanvas(readCanvas(text))) as Record<string, unknown>
    expect(back.edges).toEqual([])
    expect('orden' in back).toBe(false)
  })
})

describe('ids a canvas file uses twice', () => {
  const card = (id: string, text: string) => ({
    id,
    type: 'text',
    text,
    x: 0,
    y: 0,
    width: 100,
    height: 40,
  })
  const FILE = JSON.stringify({
    nodes: [card('1', 'first'), card('2', 'second'), card('1', 'third')],
    edges: [
      { id: '1', fromNode: '1', toNode: '2', label: 'one to two', weight: 3 },
      { id: '1', fromNode: '2', toNode: '1', label: 'two to one' },
    ],
    orden: {
      ink: [{ id: '2', tool: 'pen', color: '#000', size: 2, points: [0, 0, 0.5, 0, 0, 0] }],
    },
  })

  test('every card, line and stroke is read, each under an id of its own', () => {
    const canvas = readCanvas(FILE)
    const ids = [
      ...canvas.nodes.map((one) => one.id),
      ...canvas.edges.map((one) => one.id),
      ...canvas.ink.map((one) => one.id),
    ]
    expect(canvas.nodes.map((one) => (one.type === 'text' ? one.text : ''))).toEqual([
      'first',
      'second',
      'third',
    ])
    expect(canvas.edges.map((one) => one.label)).toEqual(['one to two', 'two to one'])
    expect(canvas.ink).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('and written back, nothing is lost, the fields Orden does not know included', () => {
    const again = JSON.parse(writeCanvas(readCanvas(FILE))) as {
      nodes: { text: string }[]
      edges: { label: string; weight?: number }[]
    }
    expect(again.nodes.map((one) => one.text)).toEqual(['first', 'second', 'third'])
    expect(again.edges.map((one) => [one.label, one.weight])).toEqual([
      ['one to two', 3],
      ['two to one', undefined],
    ])
  })

  test('the same file is read with the same ids each time; a file whose ids are all its own is read as it is', () => {
    expect(readCanvas(FILE)).toEqual(readCanvas(FILE))
    const plain = JSON.stringify({ nodes: [card('a', 'x')], edges: [] })
    expect(readCanvas(plain).nodes.map((one) => one.id)).toEqual(['a'])
  })

  test('a file whose cards all share one id is read in time that grows with the cards', () => {
    const shared = (count: number) =>
      JSON.stringify({ nodes: Array.from({ length: count }, () => card('a', 'x')), edges: [] })
    const read = linearly((count) => readCanvas(shared(count)), 4000)
    expect(read.nodes.map((one) => one.id).slice(0, 4)).toEqual([
      'a',
      'a-card',
      'a-card-2',
      'a-card-3',
    ])
    expect(new Set(read.nodes.map((one) => one.id)).size).toBe(read.nodes.length)
  })
})

describe('a stroke with a number that is not one', () => {
  const point = (x: number, tiltX = 0) => ({ x, y: 10, pressure: 0.5, tiltX, tiltY: 0, t: x })

  test('is written with the value left as it would be read, not as a hole', () => {
    const text = writeCanvas({
      ...readCanvas(blankCanvas()),
      ink: [
        { id: 's', tool: 'pen', color: DEFAULT_INK, size: 2, points: [point(1, NaN), point(2)] },
      ],
    })
    expect(text).not.toContain('null')
    expect(readCanvas(text).ink[0]?.points.map((one) => [one.x, one.tiltX])).toEqual([
      [1, 0],
      [2, 0],
    ])
  })

  test('read from a file keeps every point after it in its place', () => {
    const text = writeCanvas({
      ...readCanvas(blankCanvas()),
      ink: [
        {
          id: 's',
          tool: 'pen',
          color: DEFAULT_INK,
          size: 2,
          points: [1, 2, 3].map((x) => point(x)),
        },
      ],
    })
    const file = JSON.parse(text) as Record<string, { ink?: { points: unknown[] }[] }>
    const own = Object.values(file).find((one) => Array.isArray(one.ink))
    const stroke = own?.ink?.[0]
    if (!stroke) throw new Error('no ink written')
    stroke.points[3] = null
    const holed = JSON.stringify(file)
    expect(holed).toContain('null')
    expect(readCanvas(holed).ink[0]?.points.map((one) => [one.x, one.y, one.t])).toEqual([
      [1, 10, 1],
      [2, 10, 2],
      [3, 10, 3],
    ])
  })
})
