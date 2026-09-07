import { describe, expect, test } from 'vitest'
import {
  coloured,
  connected,
  copied,
  movedBy,
  pasted,
  placedAt,
  removed,
  resizedNode,
  subset,
  withLabel,
  withNode,
  withText,
} from './edits'
import type { Canvas, CanvasNode } from './format'
import { GRID } from './geometry'

function card(id: string, x = 0, y = 0, width = 100, height = 100): CanvasNode {
  return { id, type: 'text', x, y, width, height, text: id }
}

function canvasOf(nodes: CanvasNode[], edges: Canvas['edges'] = []): Canvas {
  return { nodes, edges }
}

const positions = (canvas: Canvas) => canvas.nodes.map((node) => [node.id, node.x, node.y])

describe('moving cards', () => {
  const canvas = canvasOf([card('a'), card('b', 200, 0)])

  test('carries only what is picked', () => {
    expect(positions(movedBy(canvas, ['a'], GRID, GRID * 2))).toEqual([
      ['a', GRID, GRID * 2],
      ['b', 200, 0],
    ])
  })

  /** Snapping the offset rather than each card keeps a row of cards a row:
   *  snapping each one on its own would pull them into a single column. */
  test('snaps the offset, so a selection keeps its shape', () => {
    const off = canvasOf([card('a', 3, 7), card('b', 45, 7)])
    const moved = movedBy(off, ['a', 'b'], GRID + 2, 0)

    expect(positions(moved)).toEqual([
      ['a', 3 + GRID, 7],
      ['b', 45 + GRID, 7],
    ])
  })

  test('leaves the canvas exactly as it was when nothing is picked', () => {
    expect(movedBy(canvas, [], 40, 40)).toBe(canvas)
  })

  test('gives back new cards and keeps the untouched ones as they were', () => {
    const moved = movedBy(canvas, ['a'], GRID, 0)

    expect(moved.nodes[0]).not.toBe(canvas.nodes[0])
    expect(moved.nodes[1]).toBe(canvas.nodes[1])
  })
})

describe('resizing a card', () => {
  test('changes the one card and nothing else', () => {
    const canvas = canvasOf([card('a'), card('b', 300, 0)])
    const wider = resizedNode(canvas, 'a', 'se', GRID, 0)

    expect(wider.nodes[0]).toMatchObject({ width: 100 + GRID, height: 100 })
    expect(wider.nodes[1]).toBe(canvas.nodes[1])
  })
})

describe('deleting', () => {
  test('takes the edges that touched what went', () => {
    const canvas = canvasOf(
      [card('a'), card('b', 300, 0), card('c', 600, 0)],
      [
        { id: 'ab', fromNode: 'a', toNode: 'b' },
        { id: 'bc', fromNode: 'b', toNode: 'c' },
      ],
    )

    const left = removed(canvas, ['b'])
    expect(left.nodes.map((node) => node.id)).toEqual(['a', 'c'])
    expect(left.edges).toEqual([])
  })

  test('takes a group and what is inside it', () => {
    const canvas = canvasOf([
      { id: 'g', type: 'group', x: 0, y: 0, width: 400, height: 400 },
      card('in', 50, 50),
      card('out', 900, 900),
    ])

    expect(removed(canvas, ['g']).nodes.map((node) => node.id)).toEqual(['out'])
  })

  test('can also take an edge on its own', () => {
    const canvas = canvasOf(
      [card('a'), card('b', 300, 0)],
      [{ id: 'ab', fromNode: 'a', toNode: 'b' }],
    )

    const left = removed(canvas, ['ab'])
    expect(left.nodes).toHaveLength(2)
    expect(left.edges).toEqual([])
  })
})

describe('connecting two cards', () => {
  const canvas = canvasOf([card('a'), card('b', 300, 0)])

  test('records both sides', () => {
    const joined = connected(canvas, 'a', 'right', 'b', 'left')

    expect(joined.edges[0]).toMatchObject({
      fromNode: 'a',
      fromSide: 'right',
      toNode: 'b',
      toSide: 'left',
    })
    expect(joined.edges[0]?.id).toMatch(/^[0-9a-f]{16}$/)
  })

  test('refuses a card to itself, and a card the canvas does not hold', () => {
    expect(connected(canvas, 'a', 'right', 'a', 'left')).toBe(canvas)
    expect(connected(canvas, 'a', 'right', 'gone', 'left')).toBe(canvas)
  })

  test('does not draw the same connector twice', () => {
    const once = connected(canvas, 'a', 'right', 'b', 'left')
    expect(connected(once, 'a', 'right', 'b', 'left')).toBe(once)
    // The other way round is another connector, and so is another pair of sides.
    expect(connected(once, 'b', 'left', 'a', 'right').edges).toHaveLength(2)
    expect(connected(once, 'a', 'top', 'b', 'left').edges).toHaveLength(2)
  })
})

describe('copying and pasting', () => {
  const canvas = canvasOf(
    [card('a'), card('b', 300, 0), card('c', 900, 0)],
    [
      { id: 'ab', fromNode: 'a', toNode: 'b' },
      { id: 'bc', fromNode: 'b', toNode: 'c' },
    ],
  )

  test('takes the picked cards and the edges between them, and nothing else', () => {
    const taken = subset(canvas, ['a', 'b'])

    expect(taken.nodes.map((node) => node.id)).toEqual(['a', 'b'])
    expect(taken.edges.map((edge) => edge.id)).toEqual(['ab'])
  })

  test('gives what arrives fresh ids, and points the copied edges at them', () => {
    const made = pasted(canvas, subset(canvas, ['a', 'b']), 40, 40)
    const [first, second] = made.ids

    expect(made.ids).toHaveLength(2)
    expect(made.ids).not.toContain('a')
    expect(made.canvas.edges).toHaveLength(3)
    expect(made.canvas.edges[2]).toMatchObject({ fromNode: first, toNode: second })
  })

  test('moves what arrives by the offset it was given', () => {
    const made = pasted(canvas, subset(canvas, ['a']), 40, 60)
    const arrived = made.canvas.nodes.at(-1)

    expect(arrived).toMatchObject({ x: 40, y: 60 })
  })

  test('a duplicate lands a grid step along and is what ends up picked', () => {
    const made = copied(canvas, ['a'])
    const arrived = made.canvas.nodes.at(-1)

    expect(arrived).toMatchObject({ x: GRID, y: GRID })
    expect(made.ids).toEqual([arrived?.id])
  })

  test('nothing picked is nothing to copy', () => {
    expect(copied(canvas, []).canvas).toBe(canvas)
    expect(copied(canvas, []).ids).toEqual([])
  })
})

describe('colouring', () => {
  const canvas = canvasOf(
    [card('a'), card('b', 300, 0)],
    [{ id: 'ab', fromNode: 'a', toNode: 'b' }],
  )

  test('paints cards and connectors alike', () => {
    const painted = coloured(canvas, ['a', 'ab'], '3')

    expect(painted.nodes[0]?.color).toBe('3')
    expect(painted.nodes[1]?.color).toBeUndefined()
    expect(painted.edges[0]?.color).toBe('3')
  })

  test('takes the colour away rather than writing an empty one', () => {
    const painted = coloured(canvas, ['a'], '3')
    const bare = coloured(painted, ['a'], null)

    expect(bare.nodes[0]).not.toHaveProperty('color')
  })
})

describe('the words on things', () => {
  test('go on a group and come off it again', () => {
    const canvas = canvasOf([{ id: 'g', type: 'group', x: 0, y: 0, width: 100, height: 100 }])

    expect(withLabel(canvas, 'g', 'Ideas').nodes[0]).toMatchObject({ label: 'Ideas' })
    expect(withLabel(withLabel(canvas, 'g', 'Ideas'), 'g', '  ').nodes[0]).not.toHaveProperty(
      'label',
    )
  })

  test('go on an edge the same way', () => {
    const canvas = canvasOf(
      [card('a'), card('b', 300, 0)],
      [{ id: 'ab', fromNode: 'a', toNode: 'b' }],
    )

    expect(withLabel(canvas, 'ab', 'leads to').edges[0]).toMatchObject({ label: 'leads to' })
    expect(withLabel(withLabel(canvas, 'ab', 'x'), 'ab', '').edges[0]).not.toHaveProperty('label')
  })
})

describe("a card's words", () => {
  test('are replaced, and an unchanged card is left exactly as it was', () => {
    const canvas = canvasOf([card('a')])

    expect(withText(canvas, 'a', 'new').nodes[0]).toMatchObject({ text: 'new' })
    expect(withText(canvas, 'a', 'a')).toBe(canvas)
  })
})

describe('a card put down where the pointer was', () => {
  test('is centred on the point, with its corner on the grid', () => {
    // Centred is x - width / 2 and y - height / 2, each landing on a dot.
    expect(placedAt({ x: 100, y: 100 }, 200, 100)).toEqual({ x: 0, y: 60, width: 200, height: 100 })
  })
})

describe('a card added to the canvas', () => {
  test('goes on top, which is the end of the list', () => {
    const canvas = canvasOf([card('a')])
    const next = withNode(canvas, card('b'))

    expect(next.nodes.map((node) => node.id)).toEqual(['a', 'b'])
  })
})
