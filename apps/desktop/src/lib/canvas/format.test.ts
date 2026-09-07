import { describe, expect, test } from 'vitest'
import { blankCanvas, type Canvas, freshId, readCanvas, writeCanvas } from './format'

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
    expect(readCanvas('')).toEqual({ nodes: [], edges: [] })
    expect(readCanvas('nonsense')).toEqual({ nodes: [], edges: [] })
    expect(readCanvas('[]')).toEqual({ nodes: [], edges: [] })
    expect(readCanvas('{}')).toEqual({ nodes: [], edges: [] })
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
    expect(readCanvas(blankCanvas())).toEqual({ nodes: [], edges: [] })
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
