import { describe, expect, test } from 'vitest'
import { selectionBlocks, type SelectionRect } from './shape'

/** A line of text, as the view measures it: 28 pixels tall, and the text column
 *  from 60 to 500. */
const TOP = 100
const LINE = 28
const LEFT = 60
const RIGHT = 500
const RADIUS = 6

function rect(left: number, top: number, width: number, height = LINE): SelectionRect {
  return { left, top, width, height }
}

/** The rows a selection over several lines is measured as: the first line from
 *  where it started to the right edge, one band for everything between, and the
 *  last line up to where it ended. */
function overLines(from: number, to: number, lines = 3): SelectionRect[] {
  const middle = TOP + LINE
  const last = TOP + LINE * (lines - 1)

  return [
    rect(from, TOP, RIGHT - from),
    rect(LEFT, middle, RIGHT - LEFT, last - middle),
    rect(LEFT, last, to - LEFT),
  ]
}

interface Command {
  name: string
  numbers: number[]
}

/** A path read back as the commands in it, so a test can ask what shape it is
 *  rather than compare strings. */
function commands(path: string): Command[] {
  const found: Command[] = []

  for (const part of path.matchAll(/([MLAZ])([^MLAZ]*)/g)) {
    const numbers = (part[2] ?? '')
      .split(/[\s,]+/)
      .filter((one) => one !== '')
      .map(Number)
    found.push({ name: part[1] ?? '', numbers })
  }

  return found
}

/** Every arc in a path, as its radius and which way it bends. */
function arcs(path: string): { radius: number; sweep: number }[] {
  return commands(path)
    .filter((one) => one.name === 'A')
    .map((one) => ({ radius: one.numbers[0] ?? 0, sweep: one.numbers[4] ?? 0 }))
}

/** Every point a path names, in order. */
function points(path: string): { x: number; y: number }[] {
  const at: { x: number; y: number }[] = []

  for (const command of commands(path)) {
    const numbers = command.numbers
    if (command.name === 'A') at.push({ x: numbers[5] ?? 0, y: numbers[6] ?? 0 })
    else if (command.name !== 'Z') at.push({ x: numbers[0] ?? 0, y: numbers[1] ?? 0 })
  }

  return at
}

/** The only block a set of rectangles adds up to. */
function only(rects: SelectionRect[], radius = RADIUS) {
  const blocks = selectionBlocks(rects, radius)
  expect(blocks).toHaveLength(1)

  const block = blocks[0]
  if (!block) throw new Error('no block')

  return block
}

describe('one row', () => {
  test('is a rounded box, four corners and no fillet', () => {
    const block = only([rect(120, TOP, 90)])

    expect(block).toMatchObject({ left: 120, top: TOP, width: 90, height: LINE })
    expect(arcs(block.path)).toHaveLength(4)
    expect(arcs(block.path).every((arc) => arc.sweep === 1)).toBe(true)
    expect(arcs(block.path).every((arc) => arc.radius === RADIUS)).toBe(true)
  })

  test('closes, and starts where a path has to start', () => {
    const path = only([rect(120, TOP, 90)]).path

    expect(path.startsWith('M ')).toBe(true)
    expect(path.endsWith('Z')).toBe(true)
    // Lines and arcs, and nothing a browser has to guess at.
    expect(path).not.toMatch(/[^MLAZ0-9.\-\s]/)
    expect(path).not.toMatch(/NaN|Infinity|undefined/)
  })

  test('a selection narrower than the radius keeps the arcs inside it', () => {
    const block = only([rect(120, TOP, 7, 9)])

    expect(arcs(block.path).every((arc) => arc.radius === 3.5)).toBe(true)
    for (const at of points(block.path)) {
      expect(at.x).toBeGreaterThanOrEqual(0)
      expect(at.x).toBeLessThanOrEqual(block.width)
      expect(at.y).toBeGreaterThanOrEqual(0)
      expect(at.y).toBeLessThanOrEqual(block.height)
    }
  })

  test('a single letter is as round as it can be', () => {
    // Half the shorter side: what is left is a pill rather than a box with
    // corners bitten out of it.
    expect(arcs(only([rect(120, TOP, 9, 28)]).path).map((arc) => arc.radius)).toEqual([
      4.5, 4.5, 4.5, 4.5,
    ])
  })
})

describe('several rows', () => {
  test('are one block with a fillet at each step', () => {
    const block = only(overLines(180, 260))

    expect(block).toMatchObject({ left: LEFT, top: TOP, width: RIGHT - LEFT, height: LINE * 3 })

    const bends = arcs(block.path)
    expect(bends.filter((arc) => arc.sweep === 0)).toHaveLength(2)
    expect(bends.filter((arc) => arc.sweep === 1)).toHaveLength(6)
  })

  test('every corner of the outline is inside the block', () => {
    const block = only(overLines(180, 260))

    for (const at of points(block.path)) {
      expect(at.x).toBeGreaterThanOrEqual(0)
      expect(at.x).toBeLessThanOrEqual(block.width)
      expect(at.y).toBeGreaterThanOrEqual(0)
      expect(at.y).toBeLessThanOrEqual(block.height)
    }
  })

  test('rows of the same width are one box, with no step in the side', () => {
    const block = only([rect(LEFT, TOP, RIGHT - LEFT), rect(LEFT, TOP + LINE, RIGHT - LEFT)])

    expect(arcs(block.path)).toHaveLength(4)
    expect(block.height).toBe(LINE * 2)
  })

  test('a step of less than half a pixel is not a step', () => {
    const block = only([rect(LEFT, TOP, 200), rect(LEFT + 0.2, TOP + LINE, 199.8)])

    expect(arcs(block.path)).toHaveLength(4)
  })

  test('an arc is held to half the side it sits on', () => {
    // The last line ends four pixels past the left edge, so the bottom of the
    // block is four pixels wide and the two corners on it are two.
    const block = only(overLines(180, LEFT + 4))
    const held = arcs(block.path).filter((arc) => arc.radius < RADIUS)

    expect(held.map((arc) => arc.radius)).toEqual([2, 2])
    expect(held.every((arc) => arc.sweep === 1)).toBe(true)
  })

  test('left edges that differ are a fillet of their own', () => {
    // A list: the first line starts inside the indent, the block below it at the
    // margin, and nothing between them is a straight side.
    const block = only([rect(120, TOP, RIGHT - 120), rect(LEFT, TOP + LINE, RIGHT - LEFT)])
    const bends = arcs(block.path)

    expect(bends.filter((arc) => arc.sweep === 0)).toHaveLength(1)
    expect(block.left).toBe(LEFT)
  })

  test('right to left reads as the same shape mirrored', () => {
    const mirror = (one: SelectionRect): SelectionRect => ({
      ...one,
      left: RIGHT + LEFT - one.left - one.width,
    })
    const forwards = only(overLines(180, 260))
    const backwards = only(overLines(180, 260).map(mirror))

    expect(
      arcs(backwards.path)
        .map((arc) => arc.sweep)
        .join(''),
    ).not.toBe('')
    expect(backwards.width).toBe(forwards.width)
    expect(backwards.height).toBe(forwards.height)
    expect(arcs(backwards.path)).toHaveLength(arcs(forwards.path).length)
    expect(arcs(backwards.path).filter((arc) => arc.sweep === 0)).toHaveLength(2)
  })
})

describe('what is not there', () => {
  test('nothing selected is nothing drawn', () => {
    expect(selectionBlocks([], RADIUS)).toEqual([])
  })

  test('a row of no width is dropped, and the block starts below it', () => {
    // A selection that ends where a line begins: the view reports the last row
    // as a rectangle of no width at the margin.
    const rects = [...overLines(180, 260), rect(LEFT, TOP + LINE * 3, 0)]
    const block = only(rects)

    expect(block.height).toBe(LINE * 3)
  })

  test('a row of no height is dropped', () => {
    const block = only([rect(120, TOP, 90), rect(120, TOP + LINE, 90, 0)])

    expect(block.height).toBe(LINE)
  })

  test('only rows of no width is no block at all', () => {
    expect(selectionBlocks([rect(LEFT, TOP, 0)], RADIUS)).toEqual([])
  })

  test('a radius of nothing is a box with hard corners', () => {
    const block = only([rect(120, TOP, 90)], 0)

    expect(arcs(block.path)).toHaveLength(0)
    expect(commands(block.path).filter((one) => one.name === 'L')).toHaveLength(3)
  })
})

describe('more than one block', () => {
  test('rows that do not meet are blocks of their own', () => {
    const blocks = selectionBlocks([rect(120, TOP, 90), rect(120, TOP + LINE * 2, 90)], RADIUS)

    expect(blocks).toHaveLength(2)
    expect(blocks.every((block) => arcs(block.path).length === 4)).toBe(true)
  })

  test('rows that meet without overlapping are blocks of their own', () => {
    const blocks = selectionBlocks([rect(300, TOP, 200), rect(LEFT, TOP + LINE, 100)], RADIUS)

    expect(blocks).toHaveLength(2)
  })

  test('a line reading both ways keeps the block and puts its far run beside it', () => {
    // The selection is in one place in the text and in two on the screen. The
    // run under the one above it carries the block on; the other is its own.
    const blocks = selectionBlocks(
      [
        rect(LEFT, TOP, RIGHT - LEFT),
        rect(LEFT, TOP + LINE, 80),
        rect(300, TOP + LINE, 80),
        rect(LEFT, TOP + LINE * 2, 120),
      ],
      RADIUS,
    )

    expect(blocks).toHaveLength(2)
    // The block runs all three lines; what is left is the one run beside it.
    expect(blocks.map((block) => block.height)).toEqual([LINE * 3, LINE])
    expect(blocks.map((block) => block.left)).toEqual([LEFT, 300])
  })

  test('two runs that meet on one line are one', () => {
    const blocks = selectionBlocks([rect(LEFT, TOP, 80), rect(LEFT + 80, TOP, 60)], RADIUS)

    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.width).toBe(140)
  })
})
