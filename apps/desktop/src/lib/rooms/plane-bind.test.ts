import { describe, expect, test } from 'vitest'
import { readPlane, seedPlane } from '@orden/rooms/plane'
import * as Y from 'yjs'
import { stamped } from '@orden/markdown/canvas-merge'
import {
  type Canvas,
  type CanvasNode,
  emptyCanvas,
  type InkPoint,
  type InkStroke,
  writeCanvas,
} from '../canvas/format'
import { ordered } from '../canvas/arrange'
import type { Hand, PlaneSurface, Reachable, SharedPlane } from '../canvas/shared'
import { PlaneBinding } from './plane-bind'

class Device implements PlaneSurface {
  readonly doc = new Y.Doc()
  canvas: Canvas = emptyCanvas()
  shared: SharedPlane | null = null
  hands: readonly Hand[] = []
  reachable: Reachable = { undo: false, redo: false }
  arrivals = 0

  private readonly binding: PlaneBinding
  private clock = 1000

  private constructor(file: Canvas) {
    this.canvas = file
    this.binding = new PlaneBinding(this.doc, this, () => true)
  }

  static opening(file: Canvas): Device {
    const device = new Device(file)
    device.doc.transact(() => seedPlane(device.doc, file), 'room')
    device.join()
    return device
  }

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

describe('the stack on a shared plane', () => {
  const stack = (canvas: Canvas) => canvas.nodes.map((node) => node.id)
  const board = () => withNodes(emptyCanvas(), [card('a'), card('b'), card('c')])

  test('a card brought to the front is at the front on the other device', () => {
    const one = Device.opening(board())
    const two = Device.joining(one)

    one.edit(ordered(one.canvas, ['a'], 'front'))
    carry(one, two)
    expect(stack(two.canvas)).toEqual(['b', 'c', 'a'])
  })

  test('and stays there here when something else arrives', () => {
    const one = Device.opening(board())
    const two = Device.joining(one)

    one.edit(ordered(one.canvas, ['c'], 'back'))
    two.edit({ ...two.canvas, nodes: two.canvas.nodes.map((n) => ({ ...n, x: n.x + 1 })) })
    both(one, two)
    expect(stack(one.canvas)).toEqual(['c', 'a', 'b'])
    expect(stack(two.canvas)).toEqual(['c', 'a', 'b'])
  })

  test('a card moved while another device typed in it keeps those words', () => {
    const one = Device.opening(board())
    const away = withNodes(
      one.canvas,
      one.canvas.nodes.map((node) => (node.id === 'a' ? { ...card('a'), x: 99 } : node)),
    )
    const typed = stamped(one.canvas, away, Date.now() - 1000)

    one.edit(ordered(one.canvas, ['a'], 'front'))
    const two = Device.joining(one, typed)
    carry(two, one)
    expect(stack(two.canvas)).toEqual(['b', 'c', 'a'])
    expect(two.canvas.nodes.at(-1)?.x).toBe(99)
  })

  test('undo takes the move back', () => {
    const one = Device.opening(board())
    one.edit(ordered(one.canvas, ['a'], 'forward'))
    expect(stack(one.canvas)).toEqual(['b', 'a', 'c'])

    one.undo()
    expect(stack(one.canvas)).toEqual(['a', 'b', 'c'])
  })

  test('a move made while away is kept by the merge of joining', () => {
    const one = Device.opening(board())
    const away = stamped(one.canvas, ordered(one.canvas, ['c'], 'back'), Date.now() + 1000)

    const two = Device.joining(one, away)
    carry(two, one)
    expect(stack(two.canvas)).toEqual(['c', 'a', 'b'])
    expect(stack(one.canvas)).toEqual(['c', 'a', 'b'])
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
  function plane(count: number): Canvas {
    return {
      ...emptyCanvas(),
      ink: Array.from({ length: count }, (_, at) => stroke(`s${at}`, 20)),
      at: Object.fromEntries(Array.from({ length: count }, (_, at) => [`s${at}`, 1])),
    }
  }

  test('puts the stroke on the wire and never the plane', () => {
    function sent(strokes: number): number {
      const device = Device.opening(plane(strokes))
      const before = Y.encodeStateVector(device.doc)
      device.edit(withInk(device.canvas, [...device.canvas.ink, stroke('fresh', 300)]))
      return Y.encodeStateAsUpdate(device.doc, before).length
    }

    const one = sent(50)
    const forty = sent(2000)

    expect(forty).toBeLessThan(one * 1.1)
    expect(one).toBeGreaterThan(1000)
  })

  test('and the strokes it did not touch come back as the very same objects', () => {
    const one = Device.opening(plane(200))
    const two = Device.joining(one)
    const before = two.canvas.ink

    one.edit(withInk(one.canvas, [...one.canvas.ink, stroke('fresh', 40)]))
    carry(one, two)

    expect(two.canvas.ink[0]).toBe(before[0])
    expect(two.canvas.ink[199]).toBe(before[199])
    expect(two.canvas.ink[200]?.id).toBe('fresh')
  })
})

function strokesOf(file: string): string[] {
  const held: string[] = []
  for (const match of file.matchAll(/"id": "([^"]+)"/g)) held.push(match[1] ?? '')
  return held
}
