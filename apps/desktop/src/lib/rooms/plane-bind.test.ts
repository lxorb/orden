import { describe, expect, test } from 'vitest'
import { readPlane, seedPlane } from '@nib/rooms/plane'
import * as Y from 'yjs'
import { stamped } from '@nib/markdown/canvas-merge'
import {
  type Canvas,
  type CanvasNode,
  emptyCanvas,
  type InkPoint,
  type InkStroke,
  writeCanvas,
} from '../canvas/format'
import type { Hand, PlaneSurface, Reachable, SharedPlane } from '../canvas/shared'
import { PlaneBinding } from './plane-bind'

/** A device drawing on one plane: the surface, the room's copy of the plane, and
 *  the binding between them. Which is the whole of the client apart from the
 *  socket, so what these tests measure is whether two devices end up agreeing
 *  rather than whether a WebSocket works.
 *
 *  The surface is the little of `CanvasStore` a binding touches, written out here
 *  so that a test measures the binding and not a store: it holds the plane, takes
 *  on what the room says, and stamps every edit the way the real one does. */
class Device implements PlaneSurface {
  readonly doc = new Y.Doc()
  canvas: Canvas = emptyCanvas()
  shared: SharedPlane | null = null
  hands: readonly Hand[] = []
  /** What the binding last said there is to take back, which is what the bar's two
   *  arrows are drawn from. */
  reachable: Reachable = { undo: false, redo: false }
  /** How many times the surface has been handed a whole plane. What says whether a
   *  stroke arriving cost the plane or cost the stroke. */
  arrivals = 0

  private readonly binding: PlaneBinding
  private clock = 1000

  private constructor(file: Canvas) {
    this.canvas = file
    // One canvas the whole way through here: a plane the surface has moved on from is
    // plane.test.ts.
    this.binding = new PlaneBinding(this.doc, this, () => true)
  }

  /** The first device into a room. The Worker has already seeded the room from the
   *  file the account holds, so the room opens on the same plane the file does. */
  static opening(file: Canvas): Device {
    const device = new Device(file)
    device.doc.transact(() => seedPlane(device.doc, file), 'room')
    device.join()
    return device
  }

  /** A device joining a room that already holds a plane, with `file` on its own
   *  disk. Everything of both is kept, which is the promise a canvas makes. */
  static joining(room: Device, file: Canvas = emptyCanvas()): Device {
    const device = new Device(file)
    Y.applyUpdate(device.doc, Y.encodeStateAsUpdate(room.doc), 'room')
    device.join()
    return device
  }

  arrived(canvas: Canvas) {
    this.canvas = canvas
    this.arrivals++
  }

  handsAre(hands: readonly Hand[]) {
    this.hands = hands
  }

  historyIs(reachable: Reachable) {
    this.reachable = reachable
  }

  /** An edit made here, the way the store makes one: stamped, then whatever changed
   *  written into the room. */
  edit(next: Canvas) {
    const before = this.canvas
    const after = stamped(before, next, (this.clock += 1000))
    this.canvas = after
    this.binding.push(before, after)
  }

  undo(): boolean {
    return this.binding.undo()
  }

  redo(): boolean {
    return this.binding.redo()
  }

  get canUndo(): boolean {
    return this.reachable.undo
  }

  /** The plane as the room holds it. The same as `canvas` at every moment the
   *  binding is doing its job. */
  get inRoom(): Canvas {
    return readPlane(this.doc)
  }

  part() {
    this.binding.part()
  }

  private join() {
    this.binding.together()
    this.shared = {
      push: (before, after) => this.binding.push(before, after),
      undo: () => this.binding.undo(),
      redo: () => this.binding.redo(),
      hand: () => undefined,
    }
  }
}

/** Everything one device holds, handed to another, the way a room passes an update
 *  on. */
function carry(from: Device, to: Device) {
  Y.applyUpdate(to.doc, Y.encodeStateAsUpdate(from.doc, Y.encodeStateVector(to.doc)), 'room')
}

function both(one: Device, other: Device) {
  const first = Y.encodeStateAsUpdate(one.doc, Y.encodeStateVector(other.doc))
  const second = Y.encodeStateAsUpdate(other.doc, Y.encodeStateVector(one.doc))
  Y.applyUpdate(other.doc, first, 'room')
  Y.applyUpdate(one.doc, second, 'room')
}

function card(id: string, x = 0, y = 0): CanvasNode {
  return { id, type: 'text', x, y, width: 250, height: 60, text: id }
}

function points(count: number): InkPoint[] {
  return Array.from({ length: count }, (_, at) => ({
    x: at * 3,
    y: at,
    pressure: 0.5,
    tiltX: 0,
    tiltY: 0,
    t: at * 8,
  }))
}

function stroke(id: string, count = 4): InkStroke {
  return { id, tool: 'pen', color: '1', size: 6, points: points(count) }
}

function withInk(canvas: Canvas, ink: InkStroke[]): Canvas {
  return { ...canvas, ink }
}

function withNodes(canvas: Canvas, nodes: CanvasNode[]): Canvas {
  return { ...canvas, nodes }
}

function drawn(...ink: InkStroke[]): Canvas {
  return { ...emptyCanvas(), ink }
}

describe('a plane bound to a room', () => {
  test('opens on the plane the file holds, and the room holds the same', () => {
    const one = Device.opening(drawn(stroke('first', 8)))

    expect(one.canvas.ink.map((held) => held.id)).toEqual(['first'])
    expect(writeCanvas(one.inRoom)).toBe(writeCanvas(one.canvas))
  })

  test('the first device into an empty room puts its own plane in', () => {
    const device = Device.joining(Device.opening(emptyCanvas()), drawn(stroke('mine', 6)))

    expect(device.inRoom.ink.map((held) => held.id)).toEqual(['mine'])
  })

  test('a stroke drawn here reaches the other device', () => {
    const one = Device.opening(emptyCanvas())
    const two = Device.joining(one)

    one.edit(drawn(stroke('drawn', 300)))
    carry(one, two)

    expect(two.canvas.ink[0]?.id).toBe('drawn')
    expect(two.canvas.ink[0]?.points).toHaveLength(300)
  })

  test('two devices drawing at once keep both strokes, in the same order', () => {
    const one = Device.opening(drawn(stroke('base')))
    const two = Device.joining(one)

    one.edit(withInk(one.canvas, [...one.canvas.ink, stroke('mine')]))
    two.edit(withInk(two.canvas, [...two.canvas.ink, stroke('yours')]))
    both(one, two)

    expect(one.canvas.ink.map((held) => held.id)).toEqual(two.canvas.ink.map((held) => held.id))
    expect(one.canvas.ink).toHaveLength(3)
  })

  test('whichever order two strokes arrive in, both devices hold one plane', () => {
    /** The same pair of strokes, drawn in the order the two names give. Answers the
     *  file each device ends up with. */
    function run(order: 'here-first' | 'there-first'): [string, string] {
      const one = Device.opening(drawn(stroke('base')))
      const two = Device.joining(one)

      const here = () => one.edit(withInk(one.canvas, [...one.canvas.ink, stroke('a')]))
      const there = () => two.edit(withInk(two.canvas, [...two.canvas.ink, stroke('b')]))

      if (order === 'here-first') {
        here()
        carry(one, two)
        there()
        carry(two, one)
      } else {
        there()
        carry(two, one)
        here()
        carry(one, two)
      }

      return [writeCanvas(one.canvas), writeCanvas(two.canvas)]
    }

    for (const order of ['here-first', 'there-first'] as const) {
      const [here, there] = run(order)
      expect(here, order).toBe(there)
      expect(strokesOf(here).sort(), order).toEqual(['a', 'b', 'base'])
    }
  })

  test('a device that drew while it was away keeps both drawings when it joins', () => {
    const one = Device.opening(drawn(stroke('shared')))
    one.edit(withInk(one.canvas, [...one.canvas.ink, stroke('while-away-here')]))

    // A device whose file holds the shared stroke and one of its own, joining the
    // room for the first time.
    const away = Device.joining(one, drawn(stroke('shared'), stroke('while-away-there')))
    carry(away, one)

    for (const device of [one, away]) {
      expect(new Set(device.canvas.ink.map((held) => held.id))).toEqual(
        new Set(['shared', 'while-away-here', 'while-away-there']),
      )
    }
  })

  test('a card moved here and coloured there keeps both', () => {
    const one = Device.opening(withNodes(emptyCanvas(), [card('a')]))
    const two = Device.joining(one)

    one.edit(withNodes(one.canvas, [{ ...card('a'), x: 300 }]))
    two.edit(withNodes(two.canvas, [{ ...card('a'), color: '4' }]))
    both(one, two)

    for (const device of [one, two]) {
      expect(device.canvas.nodes[0]).toMatchObject({ x: 300, color: '4' })
    }
  })

  test('a delete travels, and a plane read afresh says the same thing', () => {
    const one = Device.opening(withNodes(emptyCanvas(), [card('a'), card('b')]))
    const two = Device.joining(one)

    one.edit(withNodes(one.canvas, [card('b')]))
    carry(one, two)

    expect(two.canvas.nodes.map((node) => node.id)).toEqual(['b'])
    expect(writeCanvas(two.canvas)).toBe(writeCanvas(two.inRoom))
  })
})

describe('undo on a shared plane', () => {
  test('takes back what this device drew', () => {
    const one = Device.opening(emptyCanvas())
    one.edit(drawn(stroke('mine')))
    expect(one.canUndo).toBe(true)

    expect(one.undo()).toBe(true)
    expect(one.canvas.ink).toEqual([])
  })

  test('and never what somebody else drew', () => {
    const one = Device.opening(emptyCanvas())
    const two = Device.joining(one)

    two.edit(drawn(stroke('theirs')))
    carry(two, one)
    expect(one.canvas.ink.map((held) => held.id)).toEqual(['theirs'])

    // Nothing of this device's own, so there is nothing to take back and the other
    // device's stroke stays exactly where it is.
    expect(one.canUndo).toBe(false)
    expect(one.undo()).toBe(false)
    expect(one.canvas.ink.map((held) => held.id)).toEqual(['theirs'])
  })

  test('reaches past what arrived in between, without touching it', () => {
    const one = Device.opening(emptyCanvas())
    const two = Device.joining(one)

    one.edit(drawn(stroke('mine')))
    carry(one, two)
    two.edit(withInk(two.canvas, [...two.canvas.ink, stroke('theirs')]))
    carry(two, one)

    one.undo()

    expect(one.canvas.ink.map((held) => held.id)).toEqual(['theirs'])
  })

  test('joining is not a step to take back', () => {
    // The merge that brings the room and the file together is not something a
    // person did, so the first press of undo must not empty the plane.
    const one = Device.opening(drawn(stroke('from-the-file')))

    expect(one.canUndo).toBe(false)
    expect(one.undo()).toBe(false)
    expect(one.canvas.ink.map((held) => held.id)).toEqual(['from-the-file'])
  })

  test('and redo puts it back', () => {
    const one = Device.opening(emptyCanvas())
    one.edit(drawn(stroke('mine')))
    one.undo()

    expect(one.redo()).toBe(true)
    expect(one.canvas.ink.map((held) => held.id)).toEqual(['mine'])
  })
})

describe('what a stroke costs the plane it lands on', () => {
  /** A plane with `count` strokes already on it, seeded rather than drawn, which is
   *  what opening a file that has been drawn on for a year looks like. */
  function plane(count: number): Canvas {
    return {
      ...emptyCanvas(),
      ink: Array.from({ length: count }, (_, at) => stroke(`s${at}`, 20)),
      at: Object.fromEntries(Array.from({ length: count }, (_, at) => [`s${at}`, 1])),
    }
  }

  test('puts the stroke on the wire and never the plane', () => {
    /** How many bytes a stroke drawn on a plane of this size costs the room. */
    function sent(strokes: number): number {
      const device = Device.opening(plane(strokes))
      const before = Y.encodeStateVector(device.doc)
      device.edit(withInk(device.canvas, [...device.canvas.ink, stroke('fresh', 300)]))
      return Y.encodeStateAsUpdate(device.doc, before).length
    }

    const one = sent(50)
    const forty = sent(2000)

    // Forty times the plane and the same stroke: what crosses is the three hundred
    // points and the handful of bytes that say where they go. Counted rather than
    // timed, because a clock measures the machine and this measures the design.
    expect(forty).toBeLessThan(one * 1.1)
    expect(one).toBeGreaterThan(1000)
  })

  test('and the strokes it did not touch come back as the very same objects', () => {
    const one = Device.opening(plane(200))
    const two = Device.joining(one)
    const before = two.canvas.ink

    one.edit(withInk(one.canvas, [...one.canvas.ink, stroke('fresh', 40)]))
    carry(one, two)

    // The identity is what keeps a traced outline cached, which is the difference
    // between a stroke arriving and the whole plane being repainted.
    expect(two.canvas.ink[0]).toBe(before[0])
    expect(two.canvas.ink[199]).toBe(before[199])
    expect(two.canvas.ink[200]?.id).toBe('fresh')
  })
})

/** Which strokes a written canvas holds, by id. */
function strokesOf(file: string): string[] {
  const held: string[] = []
  for (const match of file.matchAll(/"id": "([^"]+)"/g)) held.push(match[1] ?? '')
  return held
}
