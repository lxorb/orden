import { describe, expect, test } from 'vitest'
import type { InkPoint, InkStroke } from './format'
import { INK_TOOLS } from './format'
import {
  assisted,
  erased,
  INK_STYLES,
  insidePolygon,
  nearStroke,
  outlineOf,
  simplified,
  strokeBox,
  strokesBox,
  strokesInLasso,
  tidied,
  tidyShape,
  transformed,
} from './ink'

function point(x: number, y: number, pressure = 0.5, t = 0): InkPoint {
  return { x, y, pressure, tiltX: 0, tiltY: 0, t }
}

function stroke(points: InkPoint[], over: Partial<InkStroke> = {}): InkStroke {
  return { id: 's', tool: 'pen', color: '#000000', size: 4, points, ...over }
}

/** A line of points along the x axis, one unit apart. */
function line(count: number, y = 0): InkPoint[] {
  return Array.from({ length: count }, (_one, index) => point(index, y, 0.5, index * 4))
}

describe('the outline of a stroke', () => {
  test('is a ring around the points, for every tool there is', () => {
    for (const tool of INK_TOOLS) {
      const ring = outlineOf(stroke(line(12), { tool }))
      expect(ring.length, tool).toBeGreaterThan(3)

      const box = strokeBox(stroke(line(12), { tool }))
      for (const one of ring) {
        expect(one.x, tool).toBeGreaterThanOrEqual(box.x - 1)
        expect(one.x, tool).toBeLessThanOrEqual(box.x + box.width + 1)
      }
    }
  })

  /** A flat nib is broad across the stroke and vanishes along it, which is what
   *  a chisel-tipped pen does and what perfect-freehand's round nib cannot. */
  test('is a ribbon for the flat nib and a body for the round ones', () => {
    expect(INK_STYLES.calligraphy.nib).not.toBeNull()
    expect(INK_STYLES.pen.nib).toBeNull()

    const flat = outlineOf(stroke(line(8), { tool: 'calligraphy' }))
    // One point out one way and one back the other, for every sample.
    expect(flat).toHaveLength(16)
  })

  test('every tool says how it behaves rather than the renderer guessing', () => {
    for (const tool of INK_TOOLS) {
      const style = INK_STYLES[tool]
      expect(style.opacity, tool).toBeGreaterThan(0)
      expect(style.opacity, tool).toBeLessThanOrEqual(1)
      expect(style.size, tool).toBeGreaterThan(0)
    }

    // The two that darken what they cross rather than covering it.
    expect(INK_STYLES.highlighter.multiply).toBe(true)
    expect(INK_STYLES.pencil.grain).toBe(true)
  })
})

describe('the box a stroke covers', () => {
  test('holds every point, with room for the nib', () => {
    const box = strokeBox(stroke([point(0, 0), point(100, 50)], { size: 10 }))

    expect(box).toEqual({ x: -10, y: -10, width: 120, height: 70 })
  })

  test('round several is the box round the lot', () => {
    const both = strokesBox([
      stroke([point(0, 0), point(10, 10)], { size: 0 }),
      stroke([point(50, -20), point(60, 0)], { size: 0 }),
    ])

    expect(both).toEqual({ x: 0, y: -20, width: 60, height: 30 })
  })

  test('is nothing for nothing', () => {
    expect(strokesBox([])).toBeNull()
  })
})

describe('smoothing a stroke', () => {
  /** A digitiser reports far more points than a line needs, and the ones it
   *  drops are the ones that say nothing. */
  test('drops the middle of a straight run and keeps both ends', () => {
    const kept = simplified(line(50), 0.5)

    expect(kept).toHaveLength(2)
    expect(kept[0]).toMatchObject({ x: 0 })
    expect(kept.at(-1)).toMatchObject({ x: 49 })
  })

  test('keeps a corner', () => {
    const corner = [...line(10), ...Array.from({ length: 10 }, (_one, i) => point(9, i + 1))]
    const kept = simplified(corner, 0.5)

    expect(kept).toHaveLength(3)
    expect(kept[1]).toMatchObject({ x: 9, y: 0 })
  })

  test('carries the pressure and the tilt of the points it keeps', () => {
    const kept = simplified([point(0, 0, 0.2, 0), point(1, 0, 0.9, 4), point(2, 0, 0.4, 8)], 0.5)

    expect(kept.map((one) => one.pressure)).toEqual([0.2, 0.4])
  })

  test('a stroke of two points is already as short as it goes', () => {
    expect(simplified([point(0, 0), point(1, 1)], 0.5)).toHaveLength(2)
  })

  test('tidying uses the nib as the measure, so a fat pen is smoothed harder', () => {
    const wobbly = Array.from({ length: 40 }, (_one, i) => point(i, i % 2 === 0 ? 0 : 0.3))

    expect(tidied(stroke(wobbly, { size: 1 })).points.length).toBeGreaterThan(
      tidied(stroke(wobbly, { size: 20 })).points.length,
    )
  })
})

describe('what a point is near', () => {
  const one = stroke([point(0, 0), point(100, 0)], { size: 4 })

  test('counts the nib, so a fat line is hit where it looks like it is', () => {
    expect(nearStroke(one, { x: 50, y: 1 }, 0)).toBe(true)
    expect(nearStroke(one, { x: 50, y: 20 }, 0)).toBe(false)
    expect(nearStroke(one, { x: 50, y: 20 }, 20)).toBe(true)
  })

  test('is nothing at all a long way off, without walking the whole line', () => {
    expect(nearStroke(one, { x: 5000, y: 5000 }, 5)).toBe(false)
  })
})

describe('the eraser', () => {
  const one = stroke(line(21), { size: 0 })

  test('leaves the stroke exactly as it was when it met nothing', () => {
    expect(erased(one, { x: 500, y: 500 }, 2)).toEqual([one])
    expect(erased(one, { x: 500, y: 500 }, 2)[0]).toBe(one)
  })

  /** The whole point of a partial eraser: rubbing through the middle of a line
   *  leaves the two ends, which is what a stroke eraser deliberately does not
   *  do. */
  test('rubbed through the middle leaves the two ends', () => {
    const pieces = erased(one, { x: 10, y: 0 }, 2)

    expect(pieces).toHaveLength(2)
    expect(pieces[0]?.points.at(-1)?.x).toBe(7)
    expect(pieces[1]?.points[0]?.x).toBe(13)
  })

  test('the first piece keeps the name, so a sync has nothing to argue over', () => {
    expect(erased(one, { x: 10, y: 0 }, 2)[0]?.id).toBe('s')
    expect(erased(one, { x: 10, y: 0 }, 2)[1]?.id).not.toBe('s')
  })

  test('counts each piece from its own beginning', () => {
    const [, second] = erased(one, { x: 10, y: 0 }, 2)
    expect(second?.points[0]?.t).toBe(0)
  })

  test('rubbed off one end shortens the line and leaves one piece', () => {
    expect(erased(one, { x: 0, y: 0 }, 3)).toHaveLength(1)
    expect(erased(one, { x: 0, y: 0 }, 3)[0]?.points[0]?.x).toBe(4)
  })

  test('rubbed over the whole of it leaves nothing', () => {
    expect(erased(one, { x: 10, y: 0 }, 100)).toEqual([])
  })

  test('a speck with nothing to draw between is not ink', () => {
    // Two points left either side would each be one point on their own.
    expect(
      erased(stroke([point(0, 0), point(10, 0), point(20, 0)], { size: 0 }), { x: 10, y: 0 }, 2),
    ).toEqual([])
  })
})

describe('the lasso', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ]

  test('knows what is inside a loop', () => {
    expect(insidePolygon(square, { x: 50, y: 50 })).toBe(true)
    expect(insidePolygon(square, { x: 150, y: 50 })).toBe(false)
  })

  /** Half a word dragged away from the other half is the one thing a lasso must
   *  never do. */
  test('catches only a stroke it went right round', () => {
    const inside = stroke([point(10, 10), point(20, 20)], { id: 'in' })
    const half = stroke([point(90, 50), point(140, 50)], { id: 'half' })
    const outside = stroke([point(200, 200), point(210, 210)], { id: 'out' })

    expect(strokesInLasso([inside, half, outside], square)).toEqual(['in'])
  })

  test('a loop of two points has caught nothing', () => {
    expect(strokesInLasso([stroke(line(3))], square.slice(0, 2))).toEqual([])
  })
})

describe('moving and scaling ink', () => {
  const one = stroke([point(0, 0), point(10, 0)], { size: 4 })

  test('carries every point by the same offset', () => {
    const moved = transformed(one, { dx: 5, dy: -3, sx: 1, sy: 1, turn: 0, about: { x: 0, y: 0 } })

    expect(moved.points.map((p) => [p.x, p.y])).toEqual([
      [5, -3],
      [15, -3],
    ])
    expect(moved.size).toBe(4)
  })

  /** Writing pulled to twice the size is writing that was written twice as big,
   *  nib and all. */
  test('grows the nib with the drawing', () => {
    const bigger = transformed(one, { dx: 0, dy: 0, sx: 2, sy: 2, turn: 0, about: { x: 0, y: 0 } })

    expect(bigger.size).toBe(8)
    expect(bigger.points.at(-1)?.x).toBe(20)
  })

  test('takes the smaller of two scales for the nib, since a nib is round', () => {
    const squashed = transformed(one, {
      dx: 0,
      dy: 0,
      sx: 3,
      sy: 1,
      turn: 0,
      about: { x: 0, y: 0 },
    })
    expect(squashed.size).toBe(4)
  })

  test('turns about a point', () => {
    const turned = transformed(one, {
      dx: 0,
      dy: 0,
      sx: 1,
      sy: 1,
      turn: Math.PI / 2,
      about: { x: 0, y: 0 },
    })

    expect(turned.points.at(-1)?.x).toBeCloseTo(0)
    expect(turned.points.at(-1)?.y).toBeCloseTo(10)
  })

  test('keeps the pressure and the tilt, which belong to the pen not the plane', () => {
    const moved = transformed(stroke([point(0, 0, 0.9), point(1, 1, 0.2)]), {
      dx: 100,
      dy: 0,
      sx: 2,
      sy: 2,
      turn: 0,
      about: { x: 0, y: 0 },
    })

    expect(moved.points.map((p) => p.pressure)).toEqual([0.9, 0.2])
  })
})

describe('what a held pen meant to draw', () => {
  test('a nearly straight stroke is a line', () => {
    const nearly = Array.from({ length: 20 }, (_one, i) => point(i * 5, i % 3 === 0 ? 0.4 : -0.4))
    expect(assisted(stroke(nearly, { size: 2 }))).toBe('line')
  })

  test('a wandering stroke is left alone', () => {
    const wandering = Array.from({ length: 20 }, (_one, i) => point(i * 5, Math.sin(i) * 30))
    expect(assisted(stroke(wandering, { size: 2 }))).toBeNull()
  })

  test('a closed round stroke is an ellipse', () => {
    const ring = Array.from({ length: 40 }, (_one, i) => {
      const a = (i / 39) * Math.PI * 2
      return point(100 + Math.cos(a) * 50, 100 + Math.sin(a) * 50)
    })

    expect(assisted(stroke(ring, { size: 2 }))).toBe('ellipse')
  })

  test('a closed cornered stroke is a rectangle', () => {
    const corners = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
      { x: 0, y: 0 },
    ]
    const box: InkPoint[] = []
    for (let side = 1; side < corners.length; side++) {
      const from = corners[side - 1]!
      const to = corners[side]!
      for (let step = 0; step < 10; step++) {
        box.push(
          point(from.x + ((to.x - from.x) * step) / 10, from.y + ((to.y - from.y) * step) / 10),
        )
      }
    }

    expect(assisted(stroke(box, { size: 2 }))).toBe('rectangle')
  })

  test('a scribble too short to mean anything is left alone', () => {
    expect(assisted(stroke(line(4), { size: 20 }))).toBeNull()
  })

  test('the tidied shape has the same ink and an even pressure', () => {
    const nearly = Array.from({ length: 20 }, (_one, i) => point(i * 5, i % 3 === 0 ? 0.4 : -0.4))
    const one = stroke(nearly, { size: 2, color: '#ff0000', tool: 'marker' })
    const tidy = tidyShape(one, 'line')

    expect(tidy.points).toHaveLength(2)
    expect(tidy.color).toBe('#ff0000')
    expect(tidy.tool).toBe('marker')
    expect(new Set(tidy.points.map((p) => p.pressure)).size).toBe(1)
  })

  test('a tidied ring is a ring', () => {
    const ring = Array.from({ length: 40 }, (_one, i) => {
      const a = (i / 39) * Math.PI * 2
      return point(100 + Math.cos(a) * 50, 100 + Math.sin(a) * 50)
    })

    const tidy = tidyShape(stroke(ring, { size: 2 }), 'ellipse')
    const middle = { x: 100, y: 100 }
    const radii = tidy.points.map((p) => Math.hypot(p.x - middle.x, p.y - middle.y))

    expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(1)
  })
})
