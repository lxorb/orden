import { describe, expect, test, vi } from 'vitest'
import * as Y from 'yjs'
import {
  type Canvas,
  type CanvasNode,
  emptyCanvas,
  type InkPoint,
  type InkStroke,
  readCanvas,
  writeCanvas,
} from '@orden/markdown/canvas'
import { merged, stamped } from '@orden/markdown/canvas-merge'
import {
  buriedOf,
  EXTRAS,
  planeIsEmpty,
  planeOf,
  pushPlane,
  readPlane,
  seedExtras,
  seedPlane,
} from './plane'

class Device {
  readonly doc = new Y.Doc()

  canvas: Canvas = emptyCanvas()

  changed = new Set<string>()

  constructor() {
    this.doc.on('afterTransaction', (transaction: Y.Transaction) => {
      if (transaction.local) return
      this.changed = touched(transaction)
      this.canvas = readPlane(this.doc, this.canvas, this.changed)
    })
  }

  edit(next: Canvas, now = 1000) {
    const before = this.canvas
    this.canvas = stamped(before, next, now)
    this.doc.transact(() => pushPlane(this.doc, before, this.canvas), 'here')
  }

  reread() {
    this.canvas = readPlane(this.doc)
  }
}

function touched(transaction: Y.Transaction): Set<string> {
  const ids = new Set<string>()

  for (const [type, keys] of transaction.changed) {
    const parent = type._item
    if (parent === null) {
      for (const key of keys) {
        if (key !== null) ids.add(key)
      }
      continue
    }

    let item = parent
    while (item.parent instanceof Y.AbstractType && item.parent._item) item = item.parent._item
    const key = item.parentSub
    if (key !== null) ids.add(key)
  }

  return ids
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

function card(id: string, x = 0, y = 0, text = id): CanvasNode {
  return { id, type: 'text', x, y, width: 250, height: 60, text }
}

function points(count: number): InkPoint[] {
  return Array.from({ length: count }, (_, at) => ({
    x: at * 3,
    y: Math.round(Math.sin(at / 5) * 40),
    pressure: 0.5,
    tiltX: 0,
    tiltY: 0,
    t: at * 8,
  }))
}

function stroke(id: string, count = 4, colour = '1'): InkStroke {
  return { id, tool: 'pen', color: colour, size: 6, points: points(count) }
}

function withNodes(canvas: Canvas, nodes: CanvasNode[]): Canvas {
  return { ...canvas, nodes }
}

function withInk(canvas: Canvas, ink: InkStroke[]): Canvas {
  return { ...canvas, ink }
}

describe('a canvas as a room holds it', () => {
  test('a room nobody has joined is empty, and a seeded one is not', () => {
    const doc = new Y.Doc()
    expect(planeIsEmpty(doc)).toBe(true)

    seedPlane(doc, { ...emptyCanvas(), nodes: [card('a')] })
    expect(planeIsEmpty(doc)).toBe(false)
  })

  test('a file seeded in and read back out is the same file', () => {
    const canvas: Canvas = {
      nodes: [
        card('a', 10, 20),
        { id: 'g', type: 'group', x: -40, y: -40, width: 400, height: 300, label: 'Ideas' },
        { id: 's', type: 'shape', shape: 'arrow', x: 0, y: 0, width: 120, height: 80, up: true },
      ],
      edges: [{ id: 'e', fromNode: 'a', toNode: 'g', toEnd: 'arrow' }],
      ink: [stroke('i', 6)],
      at: { a: 5, g: 6, s: 7, e: 8, i: 9 },
      gone: { old: 4 },
    }

    const doc = new Y.Doc()
    seedPlane(doc, canvas)

    expect(writeCanvas(readPlane(doc))).toBe(writeCanvas(canvas))
  })

  test('a stroke is one entry however many points it has', () => {
    const doc = new Y.Doc()
    seedPlane(doc, withInk(emptyCanvas(), [stroke('long', 300)]))

    const record = planeOf(doc).get('long')
    expect(record).toBeDefined()
    expect(record?.get('points')).toHaveLength(300 * 6)
    expect(readPlane(doc).ink[0]?.points).toHaveLength(300)
  })
})

describe('two devices on one plane', () => {
  test('edits to different objects never conflict', () => {
    const one = new Device()
    const two = new Device()
    one.edit(withNodes(emptyCanvas(), [card('a'), card('b')]))
    carry(one, two)

    one.edit(withNodes(one.canvas, [{ ...card('a'), x: 100 }, card('b')]), 2000)
    two.edit(withNodes(two.canvas, [card('a'), { ...card('b'), y: 200 }]), 2000)
    both(one, two)

    for (const device of [one, two]) {
      expect(device.canvas.nodes.find((node) => node.id === 'a')?.x).toBe(100)
      expect(device.canvas.nodes.find((node) => node.id === 'b')?.y).toBe(200)
    }
  })

  test('edits to the same object resolve one field at a time', () => {
    const one = new Device()
    const two = new Device()
    one.edit(withNodes(emptyCanvas(), [card('a')]))
    carry(one, two)

    one.edit(withNodes(one.canvas, [{ ...card('a'), x: 300, y: 40 }]), 2000)
    two.edit(withNodes(two.canvas, [{ ...card('a'), color: '4' }]), 2000)
    both(one, two)

    for (const device of [one, two]) {
      const node = device.canvas.nodes[0]
      expect(node?.x).toBe(300)
      expect(node?.y).toBe(40)
      expect(node?.color).toBe('4')
    }
  })

  test("edits to one card's words made apart are both kept, as prose merges", () => {
    const one = new Device()
    const two = new Device()
    one.edit(withNodes(emptyCanvas(), [card('a', 0, 0, 'We ship on Monday.')]))
    carry(one, two)

    one.edit(withNodes(one.canvas, [card('a', 0, 0, 'We ship on Monday morning.')]), 2000)
    two.edit(withNodes(two.canvas, [card('a', 0, 0, 'Maybe we ship on Monday.')]), 2100)
    both(one, two)

    for (const device of [one, two]) {
      const node = device.canvas.nodes[0]
      expect(node && 'text' in node ? node.text : null).toBe('Maybe we ship on Monday morning.')
    }
    expect(writeCanvas(one.canvas)).toBe(writeCanvas(two.canvas))
  })

  test('two strokes drawn at the same moment are both kept, in the same order', () => {
    const one = new Device()
    const two = new Device()
    one.edit(withInk(emptyCanvas(), [stroke('base')]))
    carry(one, two)

    one.edit(withInk(one.canvas, [...one.canvas.ink, stroke('mine', 5, '2')]), 2000)
    two.edit(withInk(two.canvas, [...two.canvas.ink, stroke('yours', 5, '3')]), 2000)
    both(one, two)

    expect(one.canvas.ink.map((held) => held.id)).toEqual(two.canvas.ink.map((held) => held.id))
    expect(new Set(one.canvas.ink.map((held) => held.id))).toEqual(
      new Set(['base', 'mine', 'yours']),
    )
    expect(one.canvas.ink[0]?.id).toBe('base')
  })

  test('a stroke crossing to the other device keeps every point', () => {
    const one = new Device()
    const two = new Device()
    one.edit(withInk(emptyCanvas(), [stroke('drawn', 300)]))
    carry(one, two)

    const held = two.canvas.ink[0]
    expect(held?.points).toHaveLength(300)
    expect(held?.points[299]).toMatchObject({ x: 299 * 3, t: 299 * 8 })
  })

  test('a delete travels, and stays deleted', () => {
    const one = new Device()
    const two = new Device()
    one.edit(withNodes(emptyCanvas(), [card('a'), card('b')]))
    carry(one, two)

    one.edit(withNodes(one.canvas, [card('b')]), 2000)
    carry(one, two)

    expect(two.canvas.nodes.map((node) => node.id)).toEqual(['b'])
    expect(two.canvas.gone.a).toBe(2000)
  })

  test('a card put back after a delete loses its tombstone', () => {
    const one = new Device()
    one.edit(withNodes(emptyCanvas(), [card('a')]))
    one.edit(withNodes(one.canvas, []), 2000)
    expect(buriedOf(one.doc).get('a')).toBe(2000)

    one.edit(withNodes(one.canvas, [card('a')]), 3000)
    expect(buriedOf(one.doc).get('a')).toBeUndefined()
    expect(one.canvas.nodes.map((node) => node.id)).toEqual(['a'])
  })

  test('a device that was away merges what it drew without losing either drawing', () => {
    const one = new Device()
    const two = new Device()
    one.edit(withInk(emptyCanvas(), [stroke('shared')]))
    carry(one, two)

    one.edit(withInk(one.canvas, [...one.canvas.ink, stroke('while-away-one')]), 2000)
    two.edit(withInk(two.canvas, [...two.canvas.ink, stroke('while-away-two')]), 2100)
    both(one, two)

    for (const device of [one, two]) {
      expect(new Set(device.canvas.ink.map((held) => held.id))).toEqual(
        new Set(['shared', 'while-away-one', 'while-away-two']),
      )
    }
  })

  test('a plane read afresh is the plane read a change at a time', () => {
    const one = new Device()
    const two = new Device()

    one.edit(withNodes(emptyCanvas(), [card('a'), card('b')]))
    carry(one, two)
    one.edit(withInk(withNodes(one.canvas, [card('a'), card('b'), card('c')]), [stroke('i')]), 2000)
    carry(one, two)
    one.edit(withNodes(one.canvas, [card('a'), card('c')]), 3000)
    carry(one, two)

    const followed = writeCanvas(two.canvas)
    two.reread()
    expect(writeCanvas(two.canvas)).toBe(followed)
  })

  test('an object the room did not touch comes back as the very same object', () => {
    const one = new Device()
    const two = new Device()
    one.edit(withInk(emptyCanvas(), [stroke('first', 200), stroke('second', 200)]))
    carry(one, two)

    const before = two.canvas.ink
    one.edit(withInk(one.canvas, [...one.canvas.ink, stroke('third')]), 2000)
    carry(one, two)

    expect(two.canvas.ink[0]).toBe(before[0])
    expect(two.canvas.ink[1]).toBe(before[1])
    expect(two.canvas.ink[2]?.id).toBe('third')
  })

  test('an edge whose card has gone is not written into the file', () => {
    const one = new Device()
    one.edit({
      ...emptyCanvas(),
      nodes: [card('a'), card('b')],
      edges: [{ id: 'e', fromNode: 'a', toNode: 'b' }],
    })

    one.edit({ ...one.canvas, nodes: [card('a')] }, 2000)
    expect(readPlane(one.doc).edges).toEqual([])
  })
})

describe('the room and the file say the same thing', () => {
  test('what the room settles to is what merging the two files gives', () => {
    const one = new Device()
    const two = new Device()
    one.edit(withInk(emptyCanvas(), [stroke('shared')]))
    carry(one, two)

    const base = one.canvas
    const mine = stamped(base, withInk(base, [...base.ink, stroke('mine')]), 2000)
    const yours = stamped(base, withInk(base, [...base.ink, stroke('yours')]), 2100)

    one.edit(withInk(base, [...base.ink, stroke('mine')]), 2000)
    two.edit(withInk(base, [...base.ink, stroke('yours')]), 2100)
    both(one, two)

    const asFiles = merged(mine, yours, 3000)
    expect(new Set(one.canvas.ink.map((held) => held.id))).toEqual(
      new Set(asFiles.ink.map((held) => held.id)),
    )
  })
})

describe('a plane holding what this app does not read', () => {
  const VAULT = JSON.stringify({
    nodes: [
      { id: 'x', type: 'excalidraw', x: 0, y: 0, width: 200, height: 100, file: 'D.excalidraw' },
      {
        id: 'a',
        type: 'text',
        text: 'a',
        x: 300,
        y: 0,
        width: 200,
        height: 60,
        styleAttributes: { s: 1 },
      },
    ],
    edges: [{ id: 'e', fromNode: 'x', toNode: 'a' }],
    metadata: { version: '1.0-1.0' },
  })

  const seeded = () => {
    const doc = new Y.Doc()
    const canvas = readCanvas(VAULT)
    seedPlane(doc, canvas)
    seedExtras(doc, canvas)
    return doc
  }

  const written = (doc: Y.Doc) =>
    JSON.parse(writeCanvas(readPlane(doc))) as {
      nodes: { id: string; styleAttributes?: unknown }[]
      edges: { id: string }[]
      metadata?: unknown
    }

  test('writes them back at the settle', () => {
    const file = written(seeded())
    expect(file.nodes.map((one) => one.id).sort()).toEqual(['a', 'x'])
    expect(file.nodes.find((one) => one.id === 'a')?.styleAttributes).toEqual({ s: 1 })
    expect(file.edges.map((one) => one.id)).toEqual(['e'])
    expect(file.metadata).toEqual({ version: '1.0-1.0' })
  })

  test('keeps them through an edit that did not touch them, writing nothing for them', () => {
    const doc = seeded()
    const before = readPlane(doc)
    const updates: Uint8Array[] = []
    doc.on('updateV2', (update: Uint8Array) => updates.push(update))
    const card = { id: 'b', type: 'text' as const, text: 'b', x: 0, y: 200, width: 100, height: 50 }
    pushPlane(doc, before, { ...before, nodes: [...before.nodes, card] })

    const other = new Y.Doc()
    Y.applyUpdateV2(other, Y.encodeStateAsUpdateV2(doc))
    expect(
      written(other)
        .nodes.map((one) => one.id)
        .sort(),
    ).toEqual(['a', 'b', 'x'])
    const touched = new Y.Doc()
    Y.applyUpdateV2(touched, updates[0] ?? new Uint8Array())
    expect(touched.getMap(EXTRAS).size).toBe(0)
  })

  test('reach another device in the room', () => {
    const doc = seeded()
    const there = new Y.Doc()
    Y.applyUpdateV2(there, Y.encodeStateAsUpdateV2(doc))
    expect(readPlane(there).extras?.nodes.has('x')).toBe(true)
  })

  test('hand the same extras back where nothing about them changed', () => {
    const doc = seeded()
    const first = readPlane(doc)
    expect(readPlane(doc, first, new Set(['a'])).extras).toBe(first.extras)
  })
})

describe('the order of the stack in a room', () => {
  const twoDevices = (...ids: string[]) => {
    const one = new Device()
    const two = new Device()
    one.edit({ ...emptyCanvas(), nodes: ids.map((id) => card(id)) })
    carry(one, two)
    return { one, two }
  }
  const moved = (canvas: Canvas, ...ids: string[]) => ({
    ...canvas,
    nodes: ids.map((id) => ({ ...canvas.nodes.find((node) => node.id === id)! })),
  })
  const order = (canvas: Canvas) => canvas.nodes.map((node) => node.id)

  test.each([
    ['to the front', ['b', 'c', 'a']],
    ['to the back', ['c', 'a', 'b']],
    ['one step forward', ['b', 'a', 'c']],
    ['one step back', ['a', 'c', 'b']],
  ])('a card moved %s reaches the other device', (_how, wanted) => {
    const { one, two } = twoDevices('a', 'b', 'c')
    one.edit(moved(one.canvas, ...wanted), 2000)
    carry(one, two)
    expect(order(two.canvas)).toEqual(wanted)
  })

  test('and stays where it was put on this device when something else arrives', () => {
    const { one, two } = twoDevices('a', 'b', 'c')
    one.edit(moved(one.canvas, 'b', 'c', 'a'), 2000)
    two.edit({ ...two.canvas, nodes: [...two.canvas.nodes, card('d')] }, 2000)
    both(one, two)
    expect(order(one.canvas)).toEqual(order(two.canvas))
    expect(order(one.canvas).indexOf('b')).toBeLessThan(order(one.canvas).indexOf('a'))
    expect(order(one.canvas).indexOf('c')).toBeLessThan(order(one.canvas).indexOf('a'))
  })

  test('a move writes the one thing that moved, with its time', () => {
    const { one, two } = twoDevices('a', 'b', 'c', 'd')
    let writes = 0
    two.doc.on('afterTransaction', (transaction: Y.Transaction) => {
      writes += touched(transaction).size
    })
    const same = { ...one.canvas, nodes: [...one.canvas.nodes.slice(1), one.canvas.nodes[0]!] }
    one.edit(same, 2000)
    carry(one, two)
    expect(writes).toBe(1)
    expect(two.canvas.moved?.a).toBe(2000)
    expect(two.canvas.at.a).toBe(1000)
    expect(order(two.canvas)).toEqual(['b', 'c', 'd', 'a'])
  })

  test('a card moved back and forth between the same two stays in order however often', () => {
    const { one, two } = twoDevices('low', 'a', 'b', 'high')
    for (let turn = 0; turn < 200; turn++) {
      const wanted = turn % 2 ? ['low', 'a', 'b', 'high'] : ['low', 'b', 'a', 'high']
      one.edit(moved(one.canvas, ...wanted), 2000 + turn)
      carry(one, two)
      expect(order(two.canvas)).toEqual(wanted)
    }
  })

  const places = (doc: Y.Doc) =>
    Object.fromEntries([...planeOf(doc)].map(([id, record]) => [id, record.get('z')]))

  test('two things in one place are told apart by id, and nothing is laid out for that', () => {
    const one = new Device()
    const two = new Device()
    const base = [card('a'), card('b'), card('c'), card('d')]
    one.edit({ ...emptyCanvas(), nodes: base })
    carry(one, two)
    one.edit({ ...one.canvas, nodes: [...one.canvas.nodes, card('x')] }, 2000)
    two.edit({ ...two.canvas, nodes: [...two.canvas.nodes, card('y')] }, 2000)
    both(one, two)
    expect(places(one.doc).x).toBe(places(one.doc).y)

    const was = places(one.doc)
    one.edit(moved(one.canvas, 'b', 'c', 'd', 'x', 'a', 'y'), 3000)
    const is = places(one.doc)
    expect(order(readPlane(one.doc))).toEqual(['b', 'c', 'd', 'x', 'a', 'y'])
    expect(is.b).toBe(was.b)
    expect(is.c).toBe(was.c)
    expect(is.d).toBe(was.d)
  })

  test('a tie with what sits above the move is got past as well', () => {
    const one = new Device()
    const two = new Device()
    one.edit({ ...emptyCanvas(), nodes: [card('a'), card('b')] })
    carry(one, two)
    one.edit({ ...one.canvas, nodes: [...one.canvas.nodes, card('x')] }, 2000)
    two.edit({ ...two.canvas, nodes: [...two.canvas.nodes, card('y')] }, 2000)
    both(one, two)

    const held = one.canvas.nodes
    const by = (id: string) => held.find((node) => node.id === id)!
    one.edit({ ...one.canvas, nodes: [by('b'), by('x'), by('a'), by('y')] }, 3000)
    expect(order(readPlane(one.doc))).toEqual(['b', 'x', 'a', 'y'])
  })

  test('no room left between two neighbours moves as few as it can, and not the list', () => {
    const { one, two } = twoDevices('a', 'b', 'c', 'high', 'top')
    for (let turn = 0; turn < 200; turn++) {
      const wanted = turn % 2 ? ['a', 'b', 'c', 'high', 'top'] : ['a', 'c', 'b', 'high', 'top']
      one.edit(moved(one.canvas, ...wanted), 2000 + turn)
    }
    carry(one, two)
    const is = places(one.doc)
    expect(is.a).toBe(0)
    expect(is.top).toBe(4)
    expect(order(two.canvas)).toEqual(['a', 'b', 'c', 'high', 'top'])
  })

  test('undo of a move onto a place somebody took since agrees on both devices', () => {
    const { one, two } = twoDevices('a', 'b', 'c', 'd')
    const history = new Y.UndoManager(planeOf(one.doc), {
      trackedOrigins: new Set(['here']),
      captureTimeout: 0,
    })

    one.edit(moved(one.canvas, 'b', 'c', 'd', 'a'), 2000)
    carry(one, two)
    two.edit(moved(two.canvas, 'd', 'b', 'c', 'a'), 3000)
    carry(two, one)
    expect(places(one.doc).d).toBe(0)

    history.undo()
    carry(one, two)
    expect(places(one.doc).a).toBe(0)
    expect(order(readPlane(one.doc))).toEqual(['a', 'd', 'b', 'c'])
    expect(order(readPlane(two.doc))).toEqual(['a', 'd', 'b', 'c'])
    one.reread()
    one.edit(moved(one.canvas, 'a', 'b', 'd', 'c'), 4000)
    expect(order(readPlane(one.doc))).toEqual(['a', 'b', 'd', 'c'])
    expect(places(one.doc).a).toBe(0)
  })

  test('the time of a move crosses the room, and a joining file is measured against it', () => {
    const { one, two } = twoDevices('a', 'b', 'c')
    one.edit({ ...one.canvas, nodes: [...one.canvas.nodes.slice(1), one.canvas.nodes[0]!] }, 5000)
    carry(one, two)
    expect(readPlane(two.doc).moved).toEqual({ a: 5000 })

    const stale = stamped(
      emptyCanvas(),
      { ...emptyCanvas(), nodes: [card('c'), card('a'), card('b')] },
      900,
    )
    const old = { ...stale, moved: { c: 1500 } }
    const room = readPlane(two.doc)
    const together = merged(old, room, 6000)
    expect(order(together)).toEqual(['c', 'b', 'a'])
  })

  test('a seed holds no time of a move, so every device still seeds the same bytes', () => {
    const doc = new Y.Doc()
    const file = {
      ...emptyCanvas(),
      nodes: [card('a'), card('b')],
      at: { a: 1, b: 1 },
      moved: { a: 5 },
    }
    seedPlane(doc, file)
    expect(planeOf(doc).get('a')?.has('moved')).toBe(false)
  })

  describe('a room seeded from a file with moves in it', () => {
    const file = {
      ...emptyCanvas(),
      nodes: [card('b'), card('a')],
      at: { a: 1, b: 1 },
      moved: { a: 5 },
    }
    const seeded = () => {
      const doc = new Y.Doc()
      seedPlane(doc, file)
      return doc
    }

    test('opens in the file’s order', () => {
      expect(order(readPlane(seeded()))).toEqual(['b', 'a'])
    })

    test('and a device holding that file puts the time back when it joins', () => {
      const doc = seeded()
      const held = readPlane(doc)
      doc.transact(() => pushPlane(doc, held, merged(file, held, 10)))
      expect(order(readPlane(doc))).toEqual(['b', 'a'])
      expect(readPlane(doc).moved).toEqual({ a: 5 })
    })

    test('but one with an older copy, joining first, has no time to lose to: by id', () => {
      const doc = seeded()
      const held = readPlane(doc)
      const stale = { ...emptyCanvas(), nodes: [card('a'), card('b')], at: { a: 1, b: 1 } }
      doc.transact(() => pushPlane(doc, held, merged(stale, held, 10)))
      expect(order(readPlane(doc))).toEqual(['a', 'b'])
    })

    test('and a move from before the seed, on a copy, beats a room that lost its time', () => {
      const doc = seeded()
      const held = readPlane(doc)
      const away = {
        ...emptyCanvas(),
        nodes: [card('a'), card('b')],
        at: { a: 1, b: 1 },
        moved: { b: 3 },
      }
      expect(order(merged(away, held, 10))).toEqual(['a', 'b'])
    })
  })

  test('a file that lists things in another order turns the room to that order', () => {
    const doc = new Y.Doc()
    const before = { ...emptyCanvas(), nodes: [card('a'), card('b'), card('c')] }
    seedPlane(doc, before)
    const file = { ...emptyCanvas(), nodes: [card('c'), card('a'), card('b')] }
    pushPlane(doc, before, file)
    expect(order(readPlane(doc))).toEqual(['c', 'a', 'b'])
  })

  test('a thing put in the middle sits in the middle', () => {
    const { one, two } = twoDevices('a', 'b')
    one.edit(
      { ...one.canvas, nodes: [one.canvas.nodes[0]!, card('m'), one.canvas.nodes[1]!] },
      2000,
    )
    carry(one, two)
    expect(order(two.canvas)).toEqual(['a', 'm', 'b'])
  })

  test('an edit that moved nothing writes no time of a move', () => {
    const { one } = twoDevices('a', 'b', 'c')
    one.edit(moved(one.canvas, 'b', 'c', 'a'), 2000)
    const record = planeOf(one.doc).get('a')
    const writes: unknown[] = []
    record?.observe((event) => writes.push(...event.keys.keys()))
    one.edit({ ...one.canvas, nodes: [...one.canvas.nodes, card('d')] }, 3000)
    expect(writes).toEqual([])
    expect(readPlane(one.doc).moved).toEqual({ a: 2000 })
  })

  test('nothing is written for an edit that moved nothing', () => {
    const { one } = twoDevices('a', 'b', 'c')
    const before = Y.encodeStateVector(one.doc)
    one.doc.transact(() => pushPlane(one.doc, one.canvas, { ...one.canvas }), 'here')
    expect(Y.encodeStateVector(one.doc)).toEqual(before)
  })

  test('joining writes the merged order into the room', () => {
    const { one, two } = twoDevices('a', 'b', 'c')
    const away = stamped(two.canvas, moved(two.canvas, 'c', 'a', 'b'), 5000)
    const held = readPlane(one.doc)
    one.doc.transact(() => pushPlane(one.doc, held, merged(away, held, 6000)), 'join')
    expect(order(readPlane(one.doc))).toEqual(['c', 'a', 'b'])
  })
})

describe('what an edit on a heavy plane reads', () => {
  const heavy = (count: number) => {
    const one = new Device()
    one.edit(
      withInk(
        emptyCanvas(),
        Array.from({ length: count }, (_, at) => stroke(`s${at}`)),
      ),
    )
    return one
  }
  const ids = (canvas: Canvas) => canvas.ink.map((one) => one.id)
  const reading = (edit: () => void) => {
    const get = vi.spyOn(Y.Map.prototype, 'get')
    try {
      edit()
      return get.mock.calls.length
    } finally {
      get.mockRestore()
    }
  }

  test('strokes cut far apart read only those strokes and their neighbours, not the plane', () => {
    const one = heavy(600)
    const cut = new Set([3, 300, 596])
    const after = one.canvas.ink.flatMap((thing, at) =>
      cut.has(at) ? [stroke(`${thing.id}a`), stroke(`${thing.id}b`)] : [thing],
    )
    const places = new Map([...planeOf(one.doc)].map(([id, record]) => [id, record.get('z')]))

    const reads = reading(() => one.edit(withInk(one.canvas, after), 2000))

    expect(reads).toBeLessThan(100)
    expect(ids(readPlane(one.doc))).toEqual(ids(withInk(one.canvas, after)))
    expect(planeOf(one.doc).get('s299')?.get('z')).toBe(places.get('s299'))
    expect(planeOf(one.doc).has('s300')).toBe(false)
  })

  test('a stroke drawn on top reads only the one beneath it', () => {
    const one = heavy(600)
    const reads = reading(() =>
      one.edit(withInk(one.canvas, [...one.canvas.ink, stroke('new')]), 2000),
    )

    expect(reads).toBeLessThan(20)
    expect(ids(readPlane(one.doc)).at(-1)).toBe('new')
  })

  test('things rubbed out read nothing of what stays', () => {
    const one = heavy(600)
    const after = one.canvas.ink.filter((_, at) => at !== 10 && at !== 500)
    const reads = reading(() => one.edit(withInk(one.canvas, after), 2000))

    expect(reads).toBeLessThan(20)
    expect(readPlane(one.doc).ink).toHaveLength(598)
    expect(readPlane(one.doc).gone).toEqual({ s10: 2000, s500: 2000 })
  })

  test('a change from another device reads only what it changed, and reads as a fresh read does', () => {
    const one = heavy(600)
    const two = new Device()
    carry(one, two)
    const after = one.canvas.ink.flatMap((thing, at) =>
      at === 3 || at === 300 ? [stroke(`${thing.id}a`), stroke(`${thing.id}b`)] : [thing],
    )
    one.edit(withInk(one.canvas, after.slice(0, -1)), 2000)

    const reads = reading(() => carry(one, two))

    expect(reads).toBeLessThan(400)
    expect(ids(two.canvas)).toEqual(ids(readPlane(two.doc)))
    expect(two.canvas.at).toEqual(readPlane(two.doc).at)
    expect(two.canvas.gone).toEqual(readPlane(two.doc).gone)
  })

  test('a file whose order the room does not hold still turns the room to its order', () => {
    const doc = new Y.Doc()
    seedPlane(doc, withInk(emptyCanvas(), [stroke('c'), stroke('a'), stroke('b')]))
    const file = withInk(emptyCanvas(), [stroke('a'), stroke('b'), stroke('c')])
    const next = withInk(emptyCanvas(), [stroke('a'), stroke('n'), stroke('b'), stroke('c')])

    doc.transact(() => pushPlane(doc, file, next))

    expect(ids(readPlane(doc))).toEqual(['a', 'n', 'b', 'c'])
  })

  test('a stroke slipped between two that share a place still lands between them', () => {
    const one = new Device()
    const two = new Device()
    one.edit(withInk(emptyCanvas(), [stroke('a')]))
    carry(one, two)
    one.edit(withInk(one.canvas, [...one.canvas.ink, stroke('x')]), 2000)
    two.edit(withInk(two.canvas, [...two.canvas.ink, stroke('y')]), 2000)
    both(one, two)
    const [a, x, y] = one.canvas.ink

    one.edit(withInk(one.canvas, [a!, x!, stroke('m'), y!]), 3000)

    expect(ids(readPlane(one.doc))).toEqual(['a', 'x', 'm', 'y'])
  })
})
