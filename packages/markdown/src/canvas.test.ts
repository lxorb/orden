import { describe, expect, test } from 'vitest'
import { blankCanvas, type Canvas, freshId, readCanvas, writeCanvas } from './canvas'

/** A canvas written the way the spec's own examples are: every node type, every
 *  optional field, and edges naming their sides and their ends.
 *
 *  https://jsoncanvas.org/spec/1.0/ */
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
  const canvas = readCanvas(JSON.stringify(SPEC_EXAMPLE))

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

  test('leaves out what an edge does not say, so the defaults stay the defaults', () => {
    expect(canvas.edges[1]).toEqual({ id: 'e2', fromNode: 'b', toNode: 'c' })
  })

  test('is an empty canvas for a file that is not one', () => {
    const empty = { nodes: [], edges: [], ink: [], at: {}, gone: {} }
    expect(readCanvas('')).toEqual(empty)
    expect(readCanvas('nonsense')).toEqual(empty)
    expect(readCanvas('[]')).toEqual(empty)
    expect(readCanvas('{}')).toEqual(empty)
  })
})

describe('reading a canvas somebody else wrote', () => {
  test('drops a node with no id, no known type, or nothing of its own in it', () => {
    const canvas = readCanvas(
      JSON.stringify({
        nodes: [
          { type: 'text', x: 0, y: 0, width: 10, height: 10, text: 'no id' },
          { id: 'x', type: 'sticky', x: 0, y: 0, width: 10, height: 10 },
          { id: 'y', type: 'text', x: 0, y: 0, width: 10, height: 10 },
          { id: 'z', type: 'file', x: 0, y: 0, width: 10, height: 10, file: '' },
          { id: 'ok', type: 'text', x: 0, y: 0, width: 10, height: 10, text: '' },
        ],
      }),
    )

    expect(canvas.nodes.map((node) => node.id)).toEqual(['ok'])
  })

  test('fills in a position and a size that were never written', () => {
    const [node] = readCanvas(
      JSON.stringify({ nodes: [{ id: 'a', type: 'text', text: '' }] }),
    ).nodes

    expect(node).toMatchObject({ x: 0, y: 0, width: 250, height: 60 })
  })

  test('rounds a position to whole pixels, which is what the spec says', () => {
    const [node] = readCanvas(
      JSON.stringify({ nodes: [{ id: 'a', type: 'text', text: '', x: 10.6, y: -3.2 }] }),
    ).nodes

    expect(node).toMatchObject({ x: 11, y: -3 })
  })

  test('keeps the first of two nodes sharing an id, which is what every edge meant', () => {
    const canvas = readCanvas(
      JSON.stringify({
        nodes: [
          { id: 'a', type: 'text', x: 0, y: 0, width: 10, height: 10, text: 'first' },
          { id: 'a', type: 'text', x: 0, y: 0, width: 10, height: 10, text: 'second' },
        ],
      }),
    )

    expect(canvas.nodes).toHaveLength(1)
    expect(canvas.nodes[0]).toMatchObject({ text: 'first' })
  })

  test('drops an edge that names a node the canvas does not hold', () => {
    const canvas = readCanvas(
      JSON.stringify({
        nodes: [{ id: 'a', type: 'text', x: 0, y: 0, width: 10, height: 10, text: '' }],
        edges: [
          { id: 'e', fromNode: 'a', toNode: 'gone' },
          { id: 'f', fromNode: 'a', toNode: 'a' },
        ],
      }),
    )

    expect(canvas.edges.map((edge) => edge.id)).toEqual(['f'])
  })

  test('drops a side, an end or a background style it has never heard of', () => {
    const canvas = readCanvas(
      JSON.stringify({
        nodes: [
          { id: 'a', type: 'text', x: 0, y: 0, width: 10, height: 10, text: '' },
          {
            id: 'g',
            type: 'group',
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            backgroundStyle: 'stretched',
          },
        ],
        edges: [{ id: 'e', fromNode: 'a', toNode: 'a', fromSide: 'sideways', toEnd: 'circle' }],
      }),
    )

    expect(canvas.nodes[1]).not.toHaveProperty('backgroundStyle')
    expect(canvas.edges[0]).not.toHaveProperty('fromSide')
    expect(canvas.edges[0]).not.toHaveProperty('toEnd')
  })

  test('drops a colour that is neither a preset nor a hex string', () => {
    const canvas = readCanvas(
      JSON.stringify({
        nodes: [
          { id: 'a', type: 'text', x: 0, y: 0, width: 1, height: 1, text: '', color: 'red' },
          { id: 'b', type: 'text', x: 0, y: 0, width: 1, height: 1, text: '', color: '7' },
          { id: 'c', type: 'text', x: 0, y: 0, width: 1, height: 1, text: '', color: '#0f0' },
        ],
      }),
    )

    expect(canvas.nodes.map((node) => node.color)).toEqual([undefined, undefined, '#0f0'])
  })

  test('drops a subpath that does not begin with a hash, as the spec says it must', () => {
    const canvas = readCanvas(
      JSON.stringify({
        nodes: [
          { id: 'a', type: 'file', x: 0, y: 0, width: 1, height: 1, file: 'a.md', subpath: 'Top' },
        ],
      }),
    )

    expect(canvas.nodes[0]).not.toHaveProperty('subpath')
  })
})

describe('writing a canvas', () => {
  test('writes only the fields the spec defines', () => {
    const written = JSON.parse(writeCanvas(readCanvas(JSON.stringify(SPEC_EXAMPLE)))) as {
      nodes: Record<string, unknown>[]
      edges: Record<string, unknown>[]
    }

    expect(Object.keys(written.nodes[0] ?? {})).toEqual([
      'id',
      'type',
      'x',
      'y',
      'width',
      'height',
      'color',
      'text',
    ])
    expect(Object.keys(written.edges[1] ?? {})).toEqual(['id', 'fromNode', 'toNode'])
  })

  test('leaves out what is absent rather than writing it as null', () => {
    const written = writeCanvas({
      nodes: [{ id: 'a', type: 'text', x: 0, y: 0, width: 1, height: 1, text: '' }],
      edges: [],
      ink: [],
      at: {},
      gone: {},
    })

    expect(written).not.toContain('color')
    expect(written).not.toContain('null')
  })

  test('is read back as what went in', () => {
    const canvas = readCanvas(JSON.stringify(SPEC_EXAMPLE))
    expect(readCanvas(writeCanvas(canvas))).toEqual(canvas)
  })

  test('is byte for byte the same on its own output', () => {
    const once = writeCanvas(readCanvas(JSON.stringify(SPEC_EXAMPLE)))
    const twice = writeCanvas(readCanvas(once))

    expect(twice).toBe(once)
  })

  test('holds two empty lists before anybody has drawn on it', () => {
    expect(readCanvas(blankCanvas())).toEqual({ nodes: [], edges: [], ink: [], at: {}, gone: {} })
    // Nothing of Nib's in a canvas that has none of Nib's in it.
    expect(blankCanvas()).not.toContain('nib')
    expect(blankCanvas().endsWith('\n')).toBe(true)
  })

  test('keeps the order the nodes were in, which is the order they stack in', () => {
    const canvas: Canvas = {
      nodes: ['c', 'a', 'b'].map((id) => ({
        id,
        type: 'text' as const,
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        text: '',
      })),
      edges: [],
      ink: [],
      at: {},
      gone: {},
    }

    expect(readCanvas(writeCanvas(canvas)).nodes.map((node) => node.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('a fresh id', () => {
  test('is sixteen hex characters, which is what Obsidian writes', () => {
    expect(freshId()).toMatch(/^[0-9a-f]{16}$/)
  })

  test('is not the last one', () => {
    const seen = new Set(Array.from({ length: 200 }, () => freshId()))
    expect(seen.size).toBe(200)
  })
})

/** What Nib keeps beyond the spec, and where.
 *
 *  Obsidian's own reader was checked to settle this: an unknown top-level key is
 *  kept whole through a load and a save, an unknown key on a node is swept into
 *  `unknownData` and written back, but a node whose `type` it does not know is
 *  skipped on load and gone from the file on the next save, taking its edges
 *  with it. So ink and shapes go under one top-level key and never into `nodes`,
 *  and these tests hold that line. */
describe('what Nib keeps beyond the spec', () => {
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
  }

  const written = writeCanvas(drawn)
  const parsed = JSON.parse(written) as Record<string, unknown>

  test('writes the spec half as the spec, with no shape in it', () => {
    expect((parsed.nodes as { id: string }[]).map((node) => node.id)).toEqual(['card'])
  })

  test('keeps everything else under one key of its own', () => {
    expect(Object.keys(parsed)).toEqual(['nodes', 'edges', 'nib'])
  })

  test('reads its own file back exactly, shapes, ink, order and times', () => {
    expect(readCanvas(written)).toEqual(drawn)
  })

  test('is byte for byte the same on its own output', () => {
    expect(writeCanvas(readCanvas(written))).toBe(written)
  })

  test('keeps the z order a shape sits at among the cards', () => {
    const back: Canvas = { ...drawn, nodes: [drawn.nodes[1]!, drawn.nodes[0]!, drawn.nodes[2]!] }
    expect(readCanvas(writeCanvas(back)).nodes.map((node) => node.id)).toEqual([
      'box',
      'card',
      'ray',
    ])
  })

  test('still opens a canvas whose nib block is nonsense', () => {
    const canvas = readCanvas(
      JSON.stringify({
        nodes: [{ id: 'a', type: 'text', x: 0, y: 0, width: 1, height: 1, text: '' }],
        nib: 'what',
      }),
    )

    expect(canvas.nodes).toHaveLength(1)
    expect(canvas.ink).toEqual([])
  })

  test('drops a stroke with no points to draw between and a shape with no shape', () => {
    const canvas = readCanvas(
      JSON.stringify({
        nodes: [],
        nib: {
          ink: [{ id: 'a', tool: 'pen', color: '1', size: 2, points: [1, 2, 0.5, 0, 0, 0] }],
          shapes: [{ id: 'b', shape: 'blob', x: 0, y: 0, width: 1, height: 1 }],
        },
      }),
    )

    expect(canvas.ink).toEqual([])
    expect(canvas.nodes).toEqual([])
  })

  test('a card Obsidian added to a canvas of ours arrives on top', () => {
    const theirs = JSON.parse(written) as { nodes: Record<string, unknown>[] }
    theirs.nodes.push({ id: 'new', type: 'text', x: 9, y: 9, width: 1, height: 1, text: 'theirs' })

    expect(readCanvas(JSON.stringify(theirs)).nodes.map((node) => node.id)).toEqual([
      'card',
      'box',
      'ray',
      'new',
    ])
  })
})
