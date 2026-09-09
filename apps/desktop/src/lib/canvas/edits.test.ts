import { describe, expect, test } from 'vitest'
import {
  coloured,
  connected,
  copied,
  grouped,
  movedBy,
  pasted,
  placedAt,
  reattached,
  removed,
  resizedPick,
  subset,
  ungrouped,
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
  return { nodes, edges, ink: [], at: {}, gone: {} }
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

  /** One offset for the whole selection keeps a row of cards a row: moving each
   *  one to its own nearest dot would pull them into a single column. Where the
   *  offset came from is the surface's business; see snap.ts. */
  test('applies one offset to everything picked, so a selection keeps its shape', () => {
    const off = canvasOf([card('a', 3, 7), card('b', 45, 7)])
    const moved = movedBy(off, ['a', 'b'], GRID, 0)

    expect(positions(moved)).toEqual([
      ['a', 3 + GRID, 7],
      ['b', 45 + GRID, 7],
    ])
  })

  test('rounds to whole pixels, which is what the spec says a position is', () => {
    expect(positions(movedBy(canvas, ['a'], 10.6, -3.2))).toEqual([
      ['a', 11, -3],
      ['b', 200, 0],
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

describe('resizing what is picked', () => {
  test('changes the one card and nothing else', () => {
    const canvas = canvasOf([card('a'), card('b', 300, 0)])
    const wider = resizedPick(canvas, ['a'], 'se', GRID, 0)

    expect(wider.nodes[0]).toMatchObject({ width: 100 + GRID, height: 100 })
    expect(wider.nodes[1]).toBe(canvas.nodes[1])
  })

  /** One box round the lot is pulled and everything keeps where it was in that
   *  box, which is what a hand dragging a corner of nine cards means. */
  test('scales several together, keeping each where it was in the box', () => {
    const canvas = canvasOf([card('a', 0, 0, 100, 100), card('b', 100, 0, 100, 100)])
    const wider = resizedPick(canvas, ['a', 'b'], 'e', 200, 0)

    expect(wider.nodes[0]).toMatchObject({ x: 0, width: 200 })
    expect(wider.nodes[1]).toMatchObject({ x: 200, width: 200 })
  })

  test('pulls the far edge and leaves the near one where it was', () => {
    const canvas = canvasOf([card('a', 100, 100, 100, 100)])
    const pulled = resizedPick(canvas, ['a'], 'nw', -40, -40)

    expect(pulled.nodes[0]).toMatchObject({ x: 60, y: 60, width: 140, height: 140 })
  })

  test('stops rather than turning a card inside out', () => {
    const canvas = canvasOf([card('a', 0, 0, 100, 100)])
    const squashed = resizedPick(canvas, ['a'], 'e', -1000, 0)

    expect(squashed.nodes[0]?.width).toBe(GRID * 2)
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
    const joined = connected(canvas, 'a', 'right', 'b', 'left').canvas

    expect(joined.edges[0]).toMatchObject({
      fromNode: 'a',
      fromSide: 'right',
      toNode: 'b',
      toSide: 'left',
    })
    expect(joined.edges[0]?.id).toMatch(/^[0-9a-f]{16}$/)
  })

  test('refuses a card to itself, and a card the canvas does not hold', () => {
    expect(connected(canvas, 'a', 'right', 'a', 'left').canvas).toBe(canvas)
    expect(connected(canvas, 'a', 'right', 'gone', 'left').canvas).toBe(canvas)
  })

  test('does not draw the same connector twice, and names the one that was there', () => {
    const once = connected(canvas, 'a', 'right', 'b', 'left')
    const again = connected(once.canvas, 'a', 'right', 'b', 'left')

    expect(again.canvas).toBe(once.canvas)
    expect(again.id).toBe(once.id)
    // The other way round is another connector, and so is another pair of sides.
    expect(connected(once.canvas, 'b', 'left', 'a', 'right').canvas.edges).toHaveLength(2)
    expect(connected(once.canvas, 'a', 'top', 'b', 'left').canvas.edges).toHaveLength(2)
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

/** A shape in a diagram is a shape with a name in it far more often than it is a
 *  shape, so it holds words the way a card does. */
describe('the words inside a shape', () => {
  const shape = (text?: string): CanvasNode => ({
    id: 's',
    type: 'shape',
    shape: 'rhombus',
    x: 0,
    y: 0,
    width: 100,
    height: 60,
    ...(text === undefined ? {} : { text }),
  })

  test('are written into it', () => {
    const next = withText(canvasOf([shape()]), 's', 'Ready?')
    expect(next.nodes[0]).toMatchObject({ text: 'Ready?' })
  })

  /** The field is optional in the format, so an empty one is taken away rather than
   *  written: a shape wearing `""` is a shape with nothing in it, said twice. */
  test('are taken away rather than written empty', () => {
    const next = withText(canvasOf([shape('Ready?')]), 's', '   ')
    expect(next.nodes[0]).not.toHaveProperty('text')
  })

  test('are the same object again when nothing changed', () => {
    const canvas = canvasOf([shape('Ready?')])
    expect(withText(canvas, 's', 'Ready?')).toBe(canvas)
  })
})

/** A group is a labelled box, and whatever sits inside it moves with it. Nothing is
 *  written into the cards themselves, so a canvas grouped here opens in Obsidian as the
 *  same cards inside the same frame. */
describe('grouping', () => {
  const canvas = canvasOf([card('a'), card('b', 300, 0)])

  test('puts a frame round everything picked, behind it', () => {
    const made = grouped(canvas, ['a', 'b'])
    const frame = made.canvas.nodes[0]

    expect(frame).toMatchObject({ id: made.id, type: 'group' })
    // Room enough round them to read as holding them rather than touching them.
    expect(frame!.x).toBeLessThan(0)
    expect(frame!.x + frame!.width).toBeGreaterThan(400)
  })

  test('carries what it holds when it is dragged, which is what a group is', () => {
    const made = grouped(canvas, ['a', 'b'])
    const moved = movedBy(made.canvas, [made.id], 50, 0)

    expect(positions(moved)).toEqual([
      [made.id, made.canvas.nodes[0]!.x + 50, made.canvas.nodes[0]!.y],
      ['a', 50, 0],
      ['b', 350, 0],
    ])
  })

  test('changes nothing at all with nothing picked', () => {
    expect(grouped(canvas, []).canvas).toBe(canvas)
  })
})

describe('ungrouping', () => {
  test('takes the frame away and leaves everything it held where it was', () => {
    const made = grouped(canvasOf([card('a'), card('b', 300, 0)]), ['a', 'b'])
    const undone = ungrouped(made.canvas, [made.id])

    expect(undone.canvas.nodes.map((node) => node.id)).toEqual(['a', 'b'])
    expect(positions(undone.canvas)).toEqual([
      ['a', 0, 0],
      ['b', 300, 0],
    ])
  })

  /** Ungrouping four cards and being left with nothing selected is a gesture that
   *  looks as though it deleted them. */
  test('leaves what the frame held picked', () => {
    const made = grouped(canvasOf([card('a'), card('b', 300, 0)]), ['a', 'b'])
    expect(ungrouped(made.canvas, [made.id]).ids.sort()).toEqual(['a', 'b'])
  })

  test('changes nothing when nothing picked is a frame', () => {
    const canvas = canvasOf([card('a')])
    expect(ungrouped(canvas, ['a']).canvas).toBe(canvas)
  })
})

/** An end of a connector dragged onto another card. The side it meets is dropped, so
 *  the drawing works it out from where the two cards ended up. */
describe('moving an end of a connector', () => {
  const canvas = canvasOf(
    [card('a'), card('b', 300, 0), card('c', 0, 300)],
    [{ id: 'e', fromNode: 'a', fromSide: 'right', toNode: 'b', toSide: 'left' }],
  )

  test('takes that end to the card it was dropped on', () => {
    const next = reattached(canvas, 'e', 'to', 'c')
    expect(next.edges[0]).toMatchObject({ fromNode: 'a', toNode: 'c' })
    expect(next.edges[0]).not.toHaveProperty('toSide')
    // And leaves the other end exactly as it was.
    expect(next.edges[0]).toMatchObject({ fromSide: 'right' })
  })

  test('moves the near end as readily as the far one', () => {
    expect(reattached(canvas, 'e', 'from', 'c').edges[0]).toMatchObject({
      fromNode: 'c',
      toNode: 'b',
    })
  })

  test('refuses an end dropped on the card at the other end', () => {
    expect(reattached(canvas, 'e', 'to', 'a')).toBe(canvas)
  })

  test('changes nothing for an end dropped back where it already was', () => {
    expect(reattached(canvas, 'e', 'to', 'b')).toBe(canvas)
  })

  test('changes nothing for a connector or a card that is not there', () => {
    expect(reattached(canvas, 'nope', 'to', 'c')).toBe(canvas)
    expect(reattached(canvas, 'e', 'to', 'nope')).toBe(canvas)
  })
})

/** A resize that holds the shape of the box: what Shift asks for, and what a picture
 *  under a thumb gets without being asked. */
describe('resizing with the shape of the box held', () => {
  const canvas = canvasOf([card('a', 0, 0, 100, 50)])

  test('keeps the ratio it started with', () => {
    const next = resizedPick(canvas, ['a'], 'se', 100, 0, true)
    const node = next.nodes[0]!

    expect(node.width / node.height).toBeCloseTo(2, 1)
  })

  test('stretches when it is not held, which is what a card wants', () => {
    const next = resizedPick(canvas, ['a'], 'se', 100, 0)
    expect(next.nodes[0]).toMatchObject({ width: 200, height: 50 })
  })
})
