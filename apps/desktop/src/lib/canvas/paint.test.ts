import { beforeAll, describe, expect, test, vi } from 'vitest'
import type { InkStroke } from './format'

/** What a repaint costs, counted.
 *
 *  Panning a plane of ten thousand strokes ran at twelve frames a second, and the
 *  hundred milliseconds a frame was not the fills: it was putting the batch paths
 *  together again. `addPath` copies a stroke's outline into the batch, so every
 *  frame of a drag copied a hundred thousand points of geometry that had not
 *  changed and were not going to. The paths are in plane coordinates, so the camera
 *  has nothing to do with what they are.
 *
 *  So what is counted here is strokes put into a batch, and what it has to say is
 *  "once, and then not again while the camera stays near". A count rather than a
 *  clock, for the reason the counter's own comment gives. */

/** A path that counts what is copied into it and draws nothing: this runs under
 *  node, where there is no canvas and no `Path2D`. */
class CountingPath {
  static copied = 0

  moveTo() {
    return undefined
  }

  quadraticCurveTo() {
    return undefined
  }

  closePath() {
    return undefined
  }

  addPath() {
    CountingPath.copied += 1
  }
}

/** And a context that accepts everything and remembers the fills. */
function context() {
  const fills: unknown[] = []
  return {
    fills,
    ctx: {
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      setTransform: () => undefined,
      clearRect: () => undefined,
      createPattern: () => null,
      fill: (path: unknown) => fills.push(path),
      stroke: () => undefined,
    } as unknown as CanvasRenderingContext2D,
  }
}

beforeAll(() => {
  vi.stubGlobal('Path2D', CountingPath)
})

const { paintInk, strokesBatched } = await import('./paint')

/** A plane of strokes laid out in a grid, each a short line, all in one ink - so
 *  they are one batch and the count is about gathering rather than about how many
 *  kinds of pen are on the plane. */
function plane(count: number, across = 40): InkStroke[] {
  const strokes: InkStroke[] = []

  for (let one = 0; one < count; one++) {
    const x = (one % across) * 120
    const y = Math.floor(one / across) * 120
    const points = []
    for (let step = 0; step < 6; step++) {
      points.push({
        x: x + step * 8,
        y: y + step * 2,
        pressure: 0.5,
        tiltX: 0,
        tiltY: 0,
        t: step * 10,
      })
    }

    strokes.push({ id: `s${one}`, tool: 'pen', color: 'ink', size: 3, points })
  }

  return strokes
}

const view = (x: number, y: number, scale = 1) => ({
  camera: { x, y, scale },
  width: 800,
  height: 600,
  ratio: 1,
})

describe('repainting the ink under the camera', () => {
  test('gathers the strokes once and not again while the camera stays near', () => {
    const strokes = plane(600)
    const { ctx } = context()

    const first = strokesBatched()
    paintInk(ctx, strokes, view(1000, 1000), {})
    const gathered = strokesBatched() - first

    // Something was gathered, and not the whole plane: the part of it near the view.
    expect(gathered).toBeGreaterThan(0)
    expect(gathered).toBeLessThan(strokes.length)

    // Forty frames of a drag, which is about a second of a hand moving. Not one
    // stroke is copied again: this is the twelve frames a second the comment above
    // is about, and it is now the fills alone.
    const before = strokesBatched()
    for (let frame = 0; frame < 40; frame++)
      paintInk(ctx, strokes, view(1000 + frame * 6, 1000), {})

    expect(strokesBatched() - before).toBe(0)
  })

  test('gathers again once the camera has left what was gathered', () => {
    const strokes = plane(600)
    const { ctx } = context()

    paintInk(ctx, strokes, view(1000, 1000), {})
    const before = strokesBatched()

    // Right across the plane, which is a long way outside a viewport of margin,
    // and still over strokes: what is counted is gathering, not finding nothing.
    paintInk(ctx, strokes, view(4000, 1000), {})
    expect(strokesBatched() - before).toBeGreaterThan(0)
  })

  test('puts one drawn stroke in on its own, not the plane again', () => {
    const strokes = plane(600)
    const { ctx } = context()

    paintInk(ctx, strokes, view(1000, 1000), {})
    const before = strokesBatched()

    // A stroke drawn where the camera is, which is a new list with the old one at
    // the front of it. One stroke goes in, not six hundred: this is the hundred
    // milliseconds the pen used to lift for.
    const drawn = { ...plane(1)[0]!, id: 'drawn' }
    drawn.points = drawn.points.map((point) => ({ ...point, x: point.x + 1000, y: point.y + 1000 }))
    paintInk(ctx, [...strokes, drawn], view(1000, 1000), {})

    expect(strokesBatched() - before).toBe(1)
  })

  test('gathers the plane again when the strokes in it changed rather than grew', () => {
    const strokes = plane(600)
    const { ctx } = context()

    paintInk(ctx, strokes, view(1000, 1000), {})
    const before = strokesBatched()

    // An eraser, a move, a colour: a list of the same length with other objects in
    // it, and nothing in the batches can be trusted.
    paintInk(ctx, plane(600), view(1000, 1000), {})
    expect(strokesBatched() - before).toBeGreaterThan(1)
  })

  test('fills once per kind of ink on the plane, however many strokes there are', () => {
    const strokes = plane(300)
    // Two inks that are not the first, and neither of them grainy: a grain is a
    // tile drawn on a canvas of its own, and there is no canvas under node.
    strokes[7] = { ...strokes[7]!, tool: 'fountain' }
    strokes[9] = { ...strokes[9]!, color: 'red' }
    const { ctx, fills } = context()

    paintInk(ctx, strokes, view(200, 200), {})

    // Three kinds of ink near the view, three fills - not one per stroke.
    expect(fills).toHaveLength(3)
  })

  test('keeps one plane per list of strokes, so two panes do not empty each other', () => {
    const one = plane(600)
    const other = plane(600, 30)
    const { ctx } = context()

    paintInk(ctx, one, view(1000, 1000), {})
    paintInk(ctx, other, view(1000, 1000), {})
    const before = strokesBatched()

    // Back and forth between two canvases, as two panes showing one each would
    // be. Neither is gathered again: what was gathered belongs to its own plane.
    for (let turn = 0; turn < 6; turn++) {
      paintInk(ctx, one, view(1000, 1000), {})
      paintInk(ctx, other, view(1000, 1000), {})
    }

    expect(strokesBatched() - before).toBe(0)
  })

  test('never paints fewer strokes than a fresh gather for the same view', () => {
    const strokes = plane(600)
    const fresh = context()
    const kept = context()

    // One camera reached in one step, and the same camera panned to. What was
    // gathered before covers a viewport either side of where it was asked for, so
    // it holds everything a fresh gather would hold and some of what it would not -
    // which is the one direction this may ever be wrong in: more than is needed,
    // never less.
    const drawn = paintInk(fresh.ctx, strokes, view(1300, 1000), {})

    paintInk(kept.ctx, strokes, view(1000, 1000), {})
    const again = paintInk(kept.ctx, strokes, view(1300, 1000), {})

    expect(again).toBeGreaterThanOrEqual(drawn)
  })
})
