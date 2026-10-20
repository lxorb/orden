import { describe, expect, test } from 'vitest'
import {
  type Camera,
  CLOSEST,
  clampScale,
  framing,
  FURTHEST,
  graphPoint,
  nodeAt,
  NOTCH,
  panned,
  screenPoint as onScreen,
  settledTurn,
  SMALLEST_DOT,
  snapped,
  TURN_DEADBAND,
  TURN_SNAP,
  turned,
  Twist,
  unsnapped,
  wheelZoom,
  zoomed,
} from './camera'

const WIDTH = 400
const HEIGHT = 300

const at = (...values: number[]) => new Float64Array(values)

/** The transform the paint uses, so a test can say where a node is drawn without
 *  the canvas being there. */
function screenPoint(camera: Camera, x: number, y: number): { x: number; y: number } {
  return {
    x: (x - camera.x) * camera.scale + WIDTH / 2,
    y: (y - camera.y) * camera.scale + HEIGHT / 2,
  }
}

describe('where the graph is looked at from', () => {
  test('the middle of the view is the point the camera is on', () => {
    const camera: Camera = { x: 40, y: -20, scale: 2 }

    expect(graphPoint(camera, WIDTH, HEIGHT, WIDTH / 2, HEIGHT / 2)).toEqual({ x: 40, y: -20 })
  })

  test('a screen point and a graph point say the same thing both ways round', () => {
    const camera: Camera = { x: 12, y: 8, scale: 1.7 }
    const point = graphPoint(camera, WIDTH, HEIGHT, 310, 60)
    const back = screenPoint(camera, point.x, point.y)

    expect(back.x).toBeCloseTo(310)
    expect(back.y).toBeCloseTo(60)
  })

  test('framing puts every node on screen, with room around it', () => {
    const x = at(-500, 500, 0)
    const y = at(-300, 300, 0)
    const camera = framing(x, y, 3, WIDTH, HEIGHT, 24)

    for (let one = 0; one < 3; one++) {
      const point = screenPoint(camera, x[one] ?? 0, y[one] ?? 0)
      expect(point.x).toBeGreaterThanOrEqual(23)
      expect(point.x).toBeLessThanOrEqual(WIDTH - 23)
      expect(point.y).toBeGreaterThanOrEqual(23)
      expect(point.y).toBeLessThanOrEqual(HEIGHT - 23)
    }
  })

  test('framing centres on the middle of what there is', () => {
    const camera = framing(at(100, 200), at(-40, 40), 2, WIDTH, HEIGHT, 24)

    expect(camera.x).toBe(150)
    expect(camera.y).toBe(0)
  })

  test('framing does not blow a small graph up to fill the view', () => {
    expect(framing(at(-5, 5), at(-5, 5), 2, WIDTH, HEIGHT, 24).scale).toBe(1)
  })

  test('framing nothing is a camera that still works', () => {
    expect(framing(at(), at(), 0, WIDTH, HEIGHT, 24)).toEqual({ x: 0, y: 0, scale: 1 })
  })

  test('the view goes only so far in and so far out', () => {
    expect(clampScale(1000)).toBe(CLOSEST)
    expect(clampScale(0)).toBe(FURTHEST)
    expect(clampScale(1.5)).toBe(1.5)
  })
})

describe('scrolling to zoom', () => {
  test('keeps whatever was under the pointer under it', () => {
    const camera: Camera = { x: 0, y: 0, scale: 1 }
    const under = graphPoint(camera, WIDTH, HEIGHT, 340, 40)

    const closer = zoomed(camera, WIDTH, HEIGHT, 340, 40, 1.4)
    const still = screenPoint(closer, under.x, under.y)

    expect(closer.scale).toBeCloseTo(1.4)
    expect(still.x).toBeCloseTo(340)
    expect(still.y).toBeCloseTo(40)
  })

  test('and does the same on the way back out', () => {
    const camera: Camera = { x: 30, y: -70, scale: 2.2 }
    const under = graphPoint(camera, WIDTH, HEIGHT, 90, 260)

    const further = zoomed(camera, WIDTH, HEIGHT, 90, 260, 0.5)
    const still = screenPoint(further, under.x, under.y)

    expect(still.x).toBeCloseTo(90)
    expect(still.y).toBeCloseTo(260)
  })

  test('never past the ends', () => {
    const camera: Camera = { x: 0, y: 0, scale: CLOSEST }

    expect(zoomed(camera, WIDTH, HEIGHT, 0, 0, 10).scale).toBe(CLOSEST)
  })
})

/** One notch, everywhere.
 *
 *  The bar's own comment said the buttons and the wheel agree, and they did not:
 *  the buttons stepped by a fifth, the plane's wheel by two fifths and a page
 *  note's by a quarter, so a reader who zoomed with one and then the other felt
 *  three different surfaces. `wheelZoom` is what both of them ask now. */
describe('one notch of a zoom', () => {
  test('is the same for a wheel notch as for a button', () => {
    expect(wheelZoom(-100)).toBeCloseTo(NOTCH, 10)
    expect(wheelZoom(100)).toBeCloseTo(1 / NOTCH, 10)
  })

  test('and nothing at all for a wheel that did not move', () => {
    expect(wheelZoom(0)).toBe(1)
  })

  /** A trackpad sends dozens of small deltas where a wheel sends one notch, which
   *  is the whole reason this is an exponential: the same distance travelled comes
   *  to the same zoom however it arrived. */
  test('so a trackpad’s many small ones multiply up to the same thing', () => {
    let scale = 1
    for (let step = 0; step < 20; step++) scale *= wheelZoom(-5)

    expect(scale).toBeCloseTo(NOTCH, 10)
  })

  test('up is bigger, the way round every platform reads it', () => {
    expect(wheelZoom(-100)).toBeGreaterThan(1)
    expect(wheelZoom(100)).toBeLessThan(1)
  })
})

describe('what is under the pointer', () => {
  // Three nodes: two well apart, and one right beside the first.
  const x = at(0, 100, 4)
  const y = at(0, 0, 0)
  const radii = at(6, 6, 6)
  const camera: Camera = { x: 0, y: 0, scale: 1 }

  const hit = (screenX: number, screenY: number, slack = 3) =>
    nodeAt(x, y, radii, camera, WIDTH, HEIGHT, screenX, screenY, slack)

  test('the node the point is on', () => {
    expect(hit(WIDTH / 2 + 100, HEIGHT / 2)).toBe(1)
  })

  test('nothing, where there is nothing', () => {
    expect(hit(WIDTH / 2 + 50, HEIGHT / 2)).toBe(-1)
  })

  test('the nearer of two that overlap', () => {
    // A point three to the right of the first node is nearer it than the one at
    // four, and both circles cover it.
    expect(hit(WIDTH / 2 + 1, HEIGHT / 2)).toBe(0)
    expect(hit(WIDTH / 2 + 6, HEIGHT / 2)).toBe(2)
  })

  test('a little past the edge still counts, so a hand can hit a dot', () => {
    expect(hit(WIDTH / 2 + 108, HEIGHT / 2)).toBe(1)
    expect(hit(WIDTH / 2 + 120, HEIGHT / 2)).toBe(-1)
  })

  test('a node is a smaller target the further out the view is', () => {
    const far: Camera = { x: 0, y: 0, scale: 0.1 }
    // The second node is drawn ten units from the first at this scale, and its
    // circle is under a pixel across, so a point between them hits neither.
    expect(nodeAt(x, y, radii, far, WIDTH, HEIGHT, WIDTH / 2 + 5, HEIGHT / 2, 0)).toBe(-1)
    expect(nodeAt(x, y, radii, far, WIDTH, HEIGHT, WIDTH / 2 + 10, HEIGHT / 2, 0)).toBe(1)
  })

  test('a dot never shrinks below something a pointer can find', () => {
    const far: Camera = { x: 0, y: 0, scale: 0.0001 }

    expect(
      nodeAt(at(0), at(0), at(6), far, WIDTH, HEIGHT, WIDTH / 2 + SMALLEST_DOT, HEIGHT / 2, 0),
    ).toBe(0)
  })

  test('the camera moving moves what is under the pointer', () => {
    const shifted: Camera = { x: 100, y: 0, scale: 1 }

    expect(nodeAt(x, y, radii, shifted, WIDTH, HEIGHT, WIDTH / 2, HEIGHT / 2)).toBe(1)
  })

  test('nothing at all, in an empty graph', () => {
    expect(nodeAt(at(), at(), at(), camera, WIDTH, HEIGHT, 10, 10)).toBe(-1)
  })
})

describe('a turned view (#351)', () => {
  const camera = { x: 40, y: -20, scale: 1.5, turn: Math.PI / 6 }
  const W = 800
  const H = 600

  test('a point of the plane and where it is on screen are one transform, both ways', () => {
    for (const point of [
      { x: 0, y: 0 },
      { x: 120, y: -75 },
      { x: -300, y: 410 },
    ]) {
      const seen = onScreen(camera, W, H, point)
      const back = graphPoint(camera, W, H, seen.x, seen.y)
      expect(back.x).toBeCloseTo(point.x)
      expect(back.y).toBeCloseTo(point.y)
    }
  })

  test('a quarter turn clockwise puts what was to the right below', () => {
    const quarter = { x: 0, y: 0, scale: 1, turn: Math.PI / 2 }
    const seen = onScreen(quarter, W, H, { x: 100, y: 0 })
    expect(seen.x).toBeCloseTo(W / 2)
    expect(seen.y).toBeCloseTo(H / 2 + 100)
  })

  test('a click on a card turned with the view lands on the card', () => {
    const card = { x: 100, y: 50, width: 200, height: 80 }
    const middle = onScreen(camera, W, H, { x: 200, y: 90 })
    const under = graphPoint(camera, W, H, middle.x, middle.y)
    expect(under.x).toBeGreaterThan(card.x)
    expect(under.x).toBeLessThan(card.x + card.width)
    expect(under.y).toBeGreaterThan(card.y)
    expect(under.y).toBeLessThan(card.y + card.height)
  })

  test('turned about a point keeps what is under it there, and the turn adds up', () => {
    const at = { x: 610, y: 140 }
    const before = graphPoint(camera, W, H, at.x, at.y)
    const next = turned(camera, W, H, at.x, at.y, Math.PI / 4)
    const after = graphPoint(next, W, H, at.x, at.y)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
    expect(next.turn).toBeCloseTo(Math.PI / 6 + Math.PI / 4)
    expect(next.scale).toBe(camera.scale)
  })

  test('turned all the way back is upright, with no turn left on it', () => {
    const next = turned(camera, W, H, W / 2, H / 2, -Math.PI / 6)
    expect(next.turn).toBeUndefined()
    expect(settledTurn(3 * Math.PI)).toBeCloseTo(Math.PI)
  })

  test('zoomed, it keeps its turn and what is under the pointer', () => {
    const before = graphPoint(camera, W, H, 120, 500)
    const next = zoomed(camera, W, H, 120, 500, 2)
    const after = graphPoint(next, W, H, 120, 500)
    expect(next.turn).toBe(camera.turn)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
  })

  test('panned, the plane goes with the hand whichever way the view is turned', () => {
    const under = onScreen(camera, W, H, { x: 10, y: 10 })
    const next = panned(camera, 30, -12)
    const moved = onScreen(next, W, H, { x: 10, y: 10 })
    expect(moved.x - under.x).toBeCloseTo(30)
    expect(moved.y - under.y).toBeCloseTo(-12)
  })

  test('a trackpad turn waits out the deadband, then follows every degree from there', () => {
    const twist = new Twist()
    const degree = Math.PI / 180
    expect(twist.to(0)).toBe(0)
    expect(twist.to(3 * degree)).toBe(0)
    expect(twist.to(8 * degree)).toBeCloseTo(8 * degree)
    expect(twist.to(10 * degree)).toBeCloseTo(2 * degree)
    expect(TURN_DEADBAND).toBeGreaterThan(3 * degree)
  })
})

describe('the rotation snap (#487)', () => {
  const degree = Math.PI / 180

  test('holds the view upright and at its right angles until the twist passes the snap', () => {
    expect(TURN_SNAP).toBeCloseTo(20 * degree)
    expect(snapped(19 * degree)).toBe(0)
    expect(snapped(-19 * degree)).toBe(0)
    expect(snapped(105 * degree)).toBeCloseTo(90 * degree)
    expect(snapped(-100 * degree)).toBeCloseTo(-90 * degree)
    expect(Math.abs(snapped(-175 * degree))).toBeCloseTo(Math.PI)
  })

  test('past the snap the view follows without a jump, and meets the fingers halfway', () => {
    expect(snapped(20.01 * degree)).toBeLessThan(0.1 * degree)
    expect(snapped(30 * degree)).toBeCloseTo(18 * degree)
    expect(snapped(45 * degree)).toBeCloseTo(45 * degree)
    expect(snapped(-60 * degree)).toBeCloseTo(-72 * degree)
  })

  test('a turn shown is the twist that shows it, a right angle the right angle', () => {
    for (const turn of [10, 30, 45, -60, 135, -170]) {
      expect(snapped(unsnapped(turn * degree))).toBeCloseTo(turn * degree)
    }
    expect(unsnapped(Math.PI / 2)).toBe(Math.PI / 2)
    expect(unsnapped(0)).toBe(0)
  })
})
