import { describe, expect, test } from 'vitest'
import {
  type Canvas,
  type CanvasNode,
  emptyCanvas,
  type InkStroke,
  readCanvas,
  writeCanvas,
} from './canvas'
import { mergeCanvasFiles, merged, stamped, TOMBSTONE_KEPT } from './canvas-merge'

function card(id: string, text = id, x = 0): CanvasNode {
  return { id, type: 'text', x, y: 0, width: 100, height: 50, text }
}

function stroke(id: string, x = 0): InkStroke {
  return {
    id,
    tool: 'pen',
    color: '#000000',
    size: 3,
    points: [
      { x, y: 0, pressure: 0.5, tiltX: 0, tiltY: 0, t: 0 },
      { x: x + 10, y: 10, pressure: 0.5, tiltX: 0, tiltY: 0, t: 8 },
    ],
  }
}

function plane(over: Partial<Canvas> = {}): Canvas {
  return { ...emptyCanvas(), ...over }
}

const ids = (canvas: Canvas) => canvas.nodes.map((node) => node.id)

describe('stamping an edit', () => {
  test('gives everything a time the first time it is seen', () => {
    const after = stamped(plane(), plane({ nodes: [card('a'), card('b')] }), 100)
    expect(after.at).toEqual({ a: 100, b: 100 })
  })

  test('leaves the time of anything the edit handed straight back', () => {
    const a = card('a')
    const b = card('b')
    const before = stamped(plane(), plane({ nodes: [a, b] }), 100)
    const after = stamped(before, { ...before, nodes: [a, { ...b, x: 40 }] }, 200)

    expect(after.at).toEqual({ a: 100, b: 200 })
  })

  test('buries what the edit took away, and only that', () => {
    const before = stamped(plane(), plane({ nodes: [card('a'), card('b')] }), 100)
    const after = stamped(before, { ...before, nodes: [before.nodes[0]!] }, 200)

    expect(after.gone).toEqual({ b: 200 })
    expect(after.at).toEqual({ a: 100 })
  })

  test('digs one back up when it comes back, so an undo is not undone by a sync', () => {
    const one = stamped(plane(), plane({ nodes: [card('a')] }), 100)
    const gone = stamped(one, { ...one, nodes: [] }, 200)
    const back = stamped(gone, { ...gone, nodes: [card('a')] }, 300)

    expect(back.gone).toEqual({})
    expect(back.at).toEqual({ a: 300 })
  })

  test('forgets a tombstone older than the window, so a file does not grow for ever', () => {
    const old = plane({ nodes: [card('a')], gone: { ancient: 1 } })
    const after = stamped(old, { ...old, nodes: [card('a')] }, TOMBSTONE_KEPT + 2)

    expect(after.gone).toEqual({})
  })

  test('stamps a stroke of ink like anything else', () => {
    const after = stamped(plane(), plane({ ink: [stroke('s')] }), 100)
    expect(after.at).toEqual({ s: 100 })
  })
})

describe('merging two copies of a canvas', () => {
  test('a canvas read without times keeps each side’s edit to its own card', () => {
    const [a, b, c] = [card('a'), card('b'), card('c')]
    const file = plane({ nodes: [a, b, c] })
    const moved = stamped(file, { ...file, nodes: [a, b, { ...c, x: 200 }] }, 100)
    const typed = stamped(file, { ...file, nodes: [card('a', 'typed'), b, c] }, 200)

    for (const both of [merged(moved, typed, 1000), merged(typed, moved, 1000)]) {
      expect(both.nodes.find((node) => node.id === 'a')).toMatchObject({ text: 'typed' })
      expect(both.nodes.find((node) => node.id === 'c')?.x).toBe(200)
    }
    expect(typed.at).toEqual({ a: 200 })
  })

  test('keeps everything both sides added', () => {
    const shared = stamped(plane(), plane({ nodes: [card('shared')] }), 100)
    const ours = stamped(shared, { ...shared, nodes: [...shared.nodes, card('mine')] }, 200)
    const theirs = stamped(shared, { ...shared, nodes: [...shared.nodes, card('yours')] }, 210)

    expect(ids(merged(ours, theirs, 1000)).sort()).toEqual(['mine', 'shared', 'yours'])
  })

  test('keeps both strokes when two pens are on one plane', () => {
    const shared = stamped(plane(), plane({ ink: [stroke('a')] }), 100)
    const ours = stamped(shared, { ...shared, ink: [...shared.ink, stroke('mine', 50)] }, 200)
    const theirs = stamped(shared, { ...shared, ink: [...shared.ink, stroke('yours', 90)] }, 210)

    expect(
      merged(ours, theirs, 1000)
        .ink.map((one) => one.id)
        .sort(),
    ).toEqual(['a', 'mine', 'yours'])
  })

  test('takes the later of two versions of the same card', () => {
    const shared = stamped(plane(), plane({ nodes: [card('a', 'first')] }), 100)
    const ours = stamped(shared, { ...shared, nodes: [card('a', 'ours')] }, 200)
    const theirs = stamped(shared, { ...shared, nodes: [card('a', 'theirs')] }, 300)

    const both = merged(ours, theirs, 1000)
    expect(both.nodes[0]).toMatchObject({ text: 'theirs' })
    expect(both.at.a).toBe(300)
  })

  test('lets a delete beat an edit made before it', () => {
    const shared = stamped(plane(), plane({ nodes: [card('a'), card('b')] }), 100)
    const ours = stamped(shared, { ...shared, nodes: [card('a', 'edited')] }, 150)
    const theirs = stamped(shared, { ...shared, nodes: [shared.nodes[0]!] }, 300)

    expect(ids(merged(ours, theirs, 1000))).toEqual(['a'])
    expect(merged(ours, theirs, 1000).gone.b).toBe(300)
  })

  test('lets an edit made after a delete bring the card back', () => {
    const shared = stamped(plane(), plane({ nodes: [card('a'), card('b')] }), 100)
    const deleted = stamped(shared, { ...shared, nodes: [shared.nodes[0]!] }, 200)
    const ours = stamped(shared, { ...shared, nodes: [card('a'), card('b', 'still here')] }, 400)

    const both = merged(ours, deleted, 1000)
    expect(ids(both).sort()).toEqual(['a', 'b'])
    expect(both.nodes.find((node) => node.id === 'b')).toMatchObject({ text: 'still here' })
  })

  test('is the same whichever side asks', () => {
    const shared = stamped(plane(), plane({ nodes: [card('a'), card('b'), card('c')] }), 100)
    const ours = stamped(
      shared,
      { ...shared, nodes: [card('a', 'ours'), card('b'), card('c'), card('d')] },
      200,
    )
    const theirs = stamped(
      shared,
      { ...shared, nodes: [card('a'), card('b', 'theirs'), card('e')] },
      250,
    )

    expect(writeCanvas(merged(ours, theirs, 1000))).toBe(writeCanvas(merged(theirs, ours, 1000)))
  })

  test('drops an edge whose card the merge did not keep', () => {
    const shared = stamped(
      plane(),
      plane({
        nodes: [card('a'), card('b')],
        edges: [{ id: 'e', fromNode: 'a', toNode: 'b' }],
      }),
      100,
    )

    const ours = stamped(shared, { ...shared, nodes: [shared.nodes[0]!] }, 300)
    expect(merged(ours, shared, 1000).edges).toEqual([])
  })

  test('keeps the time of an edge or a stroke it kept over a tombstone', () => {
    const now = 10_000_000
    const ours = plane({
      nodes: [card('a'), card('b')],
      edges: [{ id: 'e', fromNode: 'a', toNode: 'b' }],
      ink: [stroke('s')],
      at: { a: now - 9000, b: now - 9000, e: now - 1000, s: now - 1000 },
    })
    const theirs = plane({
      nodes: [card('a'), card('b')],
      at: { a: now - 9000, b: now - 9000 },
      gone: { e: now - 5000, s: now - 5000 },
    })

    for (const once of [merged(ours, theirs, now), merged(theirs, ours, now)]) {
      expect(once.at).toMatchObject({ e: now - 1000, s: now - 1000 })

      const twice = merged(once, theirs, now)
      expect(twice.edges.map((edge) => edge.id)).toEqual(['e'])
      expect(twice.ink.map((one) => one.id)).toEqual(['s'])
    }
  })

  test('and keeps them through the files the sync writes, merge after merge', () => {
    const now = 10_000_000
    const ours = writeCanvas(
      plane({
        nodes: [card('a'), card('b')],
        edges: [{ id: 'e', fromNode: 'a', toNode: 'b' }],
        ink: [stroke('s')],
        at: { a: now - 9000, b: now - 9000, e: now - 1000, s: now - 1000 },
      }),
    )
    const theirs = writeCanvas(
      plane({
        nodes: [card('a'), card('b')],
        at: { a: now - 9000, b: now - 9000 },
        gone: { e: now - 5000, s: now - 5000 },
      }),
    )

    const once = mergeCanvasFiles(ours, theirs, now)
    const twice = readCanvas(mergeCanvasFiles(once, theirs, now))
    expect(twice.edges.map((edge) => edge.id)).toEqual(['e'])
    expect(twice.ink.map((one) => one.id)).toEqual(['s'])
  })

  test('forgets the time of an edge or a stroke a tombstone did take', () => {
    const now = 10_000_000
    const ours = plane({ ink: [stroke('s')], at: { s: now - 5000 } })
    const theirs = plane({ gone: { s: now - 1000 } })

    const one = merged(ours, theirs, now)
    expect(one.ink).toEqual([])
    expect(one.at).toEqual({})
    expect(one.gone).toEqual({ s: now - 1000 })
  })

  test('keeps a canvas neither side changed exactly as it was', () => {
    const shared = stamped(plane(), plane({ nodes: [card('a'), card('b')] }), 100)
    expect(writeCanvas(merged(shared, shared, 1000))).toBe(writeCanvas(shared))
  })

  test('keeps a card where the side that moved it later put it', () => {
    const ours = plane({ nodes: [card('b'), card('a')], at: { a: 200, b: 100 } })
    const theirs = plane({
      nodes: [card('a'), card('b'), card('c')],
      at: { a: 100, b: 100, c: 210 },
    })

    expect(ids(merged(ours, theirs, 1000))).toEqual(['b', 'a', 'c'])
    expect(ids(merged(theirs, ours, 1000))).toEqual(['b', 'a', 'c'])
  })

  test('settles a tie without either side having to ask the other', () => {
    const shared = stamped(plane(), plane({ nodes: [card('a', 'first')] }), 100)
    const ours = stamped(shared, { ...shared, nodes: [card('a', 'ours')] }, 200)
    const theirs = stamped(shared, { ...shared, nodes: [card('a', 'theirs')] }, 200)

    expect(merged(ours, theirs, 1000)).toEqual(merged(theirs, ours, 1000))
  })
})

describe('merging two canvas files', () => {
  test('is the union of what each one holds', () => {
    const ours = writeCanvas(stamped(plane(), plane({ nodes: [card('a')] }), 100))
    const theirs = writeCanvas(stamped(plane(), plane({ nodes: [card('b')] }), 100))

    expect(ids(readCanvas(mergeCanvasFiles(ours, theirs))).sort()).toEqual(['a', 'b'])
  })

  test('hands back what it was given when the two are the same file', () => {
    const ours = writeCanvas(stamped(plane(), plane({ nodes: [card('a')] }), 100))
    expect(mergeCanvasFiles(ours, ours)).toBe(ours)
  })

  test('takes the side that has something when the other has nothing at all', () => {
    const ours = writeCanvas(stamped(plane(), plane({ nodes: [card('a')] }), 100))

    expect(mergeCanvasFiles(ours, '')).toBe(ours)
    expect(mergeCanvasFiles('', ours)).toBe(ours)
    expect(mergeCanvasFiles('not json', ours)).toBe(ours)
  })

  test('reads back as a canvas', () => {
    const ours = writeCanvas(
      stamped(plane(), plane({ nodes: [card('a')], ink: [stroke('s')] }), 100),
    )
    const theirs = writeCanvas(stamped(plane(), plane({ nodes: [card('b')] }), 120))
    const both = readCanvas(mergeCanvasFiles(ours, theirs))

    expect(ids(both).sort()).toEqual(['a', 'b'])
    expect(both.ink.map((one) => one.id)).toEqual(['s'])
  })
})

describe('the icon two copies of a canvas wear', () => {
  test('is kept from whichever side has one', () => {
    expect(merged(plane({ icon: 'rocket' }), plane(), 1000).icon).toBe('rocket')
    expect(merged(plane(), plane({ icon: 'rocket' }), 1000).icon).toBe('rocket')
  })

  test('is nothing where neither does', () => {
    expect(merged(plane(), plane(), 1000).icon).toBeNull()
  })

  test('and where both name one, the same one on both devices', () => {
    const ours = plane({ icon: 'rocket' })
    const theirs = plane({ icon: 'anchor' })

    expect(merged(ours, theirs, 1000).icon).toBe('anchor')
    expect(merged(theirs, ours, 1000).icon).toBe('anchor')
  })

  test('and its colour comes with it, from the side whose icon was kept', () => {
    const ours = plane({ icon: 'anchor', iconColor: 'teal' })
    const theirs = plane({ icon: 'rocket', iconColor: 'violet' })

    expect(merged(ours, theirs, 1000)).toMatchObject({ icon: 'anchor', iconColor: 'teal' })
    expect(merged(theirs, ours, 1000)).toMatchObject({ icon: 'anchor', iconColor: 'teal' })
  })

  test('a colour on one side of the same icon is kept', () => {
    const ours = plane({ icon: 'rocket', iconColor: 'violet' })
    const theirs = plane({ icon: 'rocket' })

    expect(merged(ours, theirs, 1000).iconColor).toBe('violet')
    expect(merged(theirs, ours, 1000).iconColor).toBe('violet')
  })

  test('survives a merge with a copy that has cards and no icon', () => {
    const ours = writeCanvas(plane({ icon: 'rocket' }))
    const theirs = writeCanvas(stamped(plane(), plane({ nodes: [card('a')] }), 120))
    const both = readCanvas(mergeCanvasFiles(ours, theirs, 1000))

    expect(both.icon).toBe('rocket')
    expect(ids(both)).toEqual(['a'])
  })
})

describe('what stamping an edit compares', () => {
  function counted(count: number) {
    const reads = { ids: 0 }
    const ink = Array.from({ length: count }, (_, at) => {
      const held = stroke(`s${at}`, at)
      return {
        ...held,
        get id() {
          reads.ids += 1
          return held.id
        },
      }
    })

    return { reads, ink }
  }

  test('is the stroke that was drawn, not the plane it was drawn on', () => {
    const { reads, ink } = counted(600)
    const before = stamped(plane(), plane({ ink }), 1000)

    const drawn = stroke('drawn', 9999)
    reads.ids = 0
    const after = stamped(before, { ...before, ink: [...before.ink, drawn] }, 2000)

    expect(reads.ids).toBeLessThanOrEqual(ink.length + 2)
    expect(after.at.drawn).toBe(2000)
    expect(after.at.s0).toBe(1000)
    expect(after.at.s599).toBe(1000)
  })

  test('and one stroke erased is the one stroke, with a tombstone for it', () => {
    const { ink } = counted(600)
    const before = stamped(plane(), plane({ ink }), 1000)
    const after = stamped(before, { ...before, ink: before.ink.slice(0, -1) }, 2000)

    expect(after.ink).toHaveLength(599)
    expect(after.gone.s599).toBe(2000)
    expect(after.at.s599).toBeUndefined()
    expect(after.at.s0).toBe(1000)
  })

  test('and strokes cut far apart are only those strokes, not all that lies between', () => {
    const { reads, ink } = counted(600)
    const before = stamped(plane(), plane({ ink }), 1000)
    const cut = new Set([3, 300, 596])
    const after = before.ink.flatMap((one, at) =>
      cut.has(at) ? [stroke(`s${at}`, at + 0.5), stroke(`piece${at}`, at + 0.7)] : [one],
    )
    reads.ids = 0
    const out = stamped(before, { ...before, ink: after }, 2000)

    expect(reads.ids).toBeLessThanOrEqual(ink.length + cut.size * 4)
    expect(out.at.s3).toBe(2000)
    expect(out.at.piece300).toBe(2000)
    expect(out.at.s299).toBe(1000)
    expect(out.gone).toEqual({})
    expect(out.moved).toBeUndefined()
  })

  test('and strokes cut far apart hold in mind only those strokes, not all that lies between', () => {
    const { ink } = counted(600)
    const before = stamped(plane(), plane({ ink }), 1000)
    const cut = new Set([3, 300, 596])
    const after = before.ink.flatMap((one, at) =>
      cut.has(at) ? [stroke(`s${at}`, at + 0.5), stroke(`piece${at}`, at + 0.7)] : [one],
    )
    const add = Object.getOwnPropertyDescriptor(Set.prototype, 'add')?.value as (
      this: Set<unknown>,
      value: unknown,
    ) => Set<unknown>
    let held = 0
    Set.prototype.add = function (this: Set<unknown>, value: unknown) {
      held += 1
      return add.call(this, value)
    }
    try {
      stamped(before, { ...before, ink: after }, 2000)
    } finally {
      Set.prototype.add = add
    }

    expect(held).toBeLessThan(60)
  })

  test('and a stroke carried across others that stay is the one that moved', () => {
    const before = stamped(
      plane(),
      plane({ ink: [stroke('a'), stroke('b'), stroke('c'), stroke('d'), stroke('e')] }),
      1000,
    )
    const [a, b, c, d, e] = before.ink
    const out = stamped(before, { ...before, ink: [b!, c!, d!, a!, e!] }, 2000)
    const swapped = stamped(before, { ...before, ink: [{ ...a!, size: 9 }, c!, d!, e!, b!] }, 2000)

    expect(out.moved).toEqual({ a: 2000 })
    expect(out.at).toEqual({ a: 1000, b: 1000, c: 1000, d: 1000, e: 1000 })
    expect(swapped.moved).toEqual({ b: 2000 })
    expect(swapped.at.a).toBe(2000)
  })

  test('and a stroke rubbed out between others leaves a tombstone, and nothing moved', () => {
    const before = stamped(
      plane(),
      plane({ ink: [stroke('a'), stroke('b'), stroke('c'), stroke('d')] }),
      1000,
    )
    const out = stamped(
      before,
      { ...before, ink: [before.ink[0]!, before.ink[2]!, stroke('e')] },
      2000,
    )

    expect(out.gone).toEqual({ b: 2000, d: 2000 })
    expect(out.at).toEqual({ a: 1000, c: 1000, e: 2000 })
    expect(out.moved).toBeUndefined()
  })

  test('and strokes laid in a new order are the ones that moved', () => {
    const before = stamped(
      plane(),
      plane({ ink: [stroke('a'), stroke('b'), stroke('c'), stroke('d')] }),
      1000,
    )
    const [a, b, c, d] = before.ink
    const out = stamped(before, { ...before, ink: [a!, c!, { ...b!, size: 9 }, d!] }, 2000)

    expect(out.at).toEqual({ a: 1000, b: 2000, c: 1000, d: 1000 })
    expect(Object.keys(out.moved ?? {})).toHaveLength(1)
  })

  test('a plane read from a file times only what the edit touched, so the untouched lose to any edit elsewhere', () => {
    const arrived = plane({ nodes: [card('a'), card('b')], at: {} })
    const stampedNow = stamped(arrived, { ...arrived, nodes: [...arrived.nodes, card('c')] }, 3000)

    expect(stampedNow.at).toEqual({ c: 3000 })
  })
})

describe('ids an object would answer from its prototype', () => {
  const OBSIDIAN = JSON.stringify({
    nodes: [
      { id: 'constructor', type: 'text', x: 0, y: 0, width: 100, height: 50, text: 'c' },
      { id: 'toString', type: 'text', x: 0, y: 0, width: 100, height: 50, text: 't' },
    ],
    edges: [],
  })

  test('have no time until one is written, and the file stays readable', () => {
    const before = readCanvas(OBSIDIAN)
    const after = stamped(before, { ...before, nodes: [...before.nodes, card('a')] }, 100)

    expect(after.at).toEqual({ a: 100 })
    expect(ids(readCanvas(writeCanvas(after)))).toEqual(['constructor', 'toString', 'a'])
  })

  test('keep their times through a merge, `__proto__` among them', () => {
    const ours = stamped(plane(), plane({ nodes: [card('__proto__'), card('constructor')] }), 100)
    const theirs = stamped(ours, { ...ours, nodes: [card('constructor', 'moved')] }, 200)

    expect(Object.hasOwn(ours.at, '__proto__')).toBe(true)
    expect(readCanvas(writeCanvas(ours)).at).toEqual(ours.at)

    const both = merged(ours, theirs, 300)
    expect(ids(both)).toEqual(['constructor'])
    expect(both.nodes[0]).toMatchObject({ text: 'moved' })
    expect(Object.entries(both.gone)).toEqual([['__proto__', 200]])
  })

  test('are not taken for a time on a canvas built on a plain object', () => {
    const one = { ...plane({ nodes: [card('constructor')] }), at: { constructor: 50 }, gone: {} }
    const other = { ...plane({ nodes: [card('constructor', 'other')] }), at: {}, gone: {} }

    expect(merged(one, other, 100).at).toEqual({ constructor: 50 })
    expect(merged(other, one, 100).nodes[0]).toMatchObject({ text: 'constructor' })
  })
})

describe('merging two canvas files somebody else wrote in too', () => {
  const drawing = {
    id: 'x',
    type: 'excalidraw',
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    file: 'Drawing.excalidraw',
  }
  const card = (id: string, text: string) => ({
    id,
    type: 'text',
    text,
    x: 300,
    y: 0,
    width: 200,
    height: 60,
  })

  const ours = JSON.stringify({
    nodes: [drawing, { ...card('c', 'hello'), styleAttributes: { shape: 'pill' } }],
    edges: [{ id: 'e', fromNode: 'x', toNode: 'c' }],
    metadata: { version: '1.0-1.0' },
    orden: { version: 1, at: { c: 100 } },
  })
  const theirs = JSON.stringify({
    nodes: [card('c', 'hello'), card('d', 'from the other side')],
    edges: [],
    orden: { version: 1, at: { c: 100, d: 200 }, later: true },
  })

  test('keeps them, from whichever side held them', () => {
    const file = JSON.parse(mergeCanvasFiles(ours, theirs, 300)) as {
      nodes: { id: string; styleAttributes?: unknown }[]
      edges: { id: string }[]
      metadata?: unknown
      orden: Record<string, unknown>
    }

    expect(file.nodes.map((node) => node.id).sort()).toEqual(['c', 'd', 'x'])
    expect(file.nodes.find((node) => node.id === 'x')).toEqual(drawing)
    expect(file.nodes.find((node) => node.id === 'c')?.styleAttributes).toEqual({ shape: 'pill' })
    expect(file.edges.map((edge) => edge.id)).toEqual(['e'])
    expect(file.metadata).toEqual({ version: '1.0-1.0' })
    expect(file.orden.later).toBe(true)
  })

  test('is the same file whichever side asks', () => {
    expect(mergeCanvasFiles(theirs, ours, 300)).toBe(mergeCanvasFiles(ours, theirs, 300))
  })

  test('lets an edge go with the card the merge did not keep', () => {
    const deleted = JSON.stringify({
      nodes: [drawing],
      edges: [],
      orden: { version: 1, gone: { c: 250 } },
    })
    const file = JSON.parse(mergeCanvasFiles(ours, deleted, 300)) as {
      nodes: { id: string }[]
      edges: unknown[]
    }

    expect(file.nodes.map((node) => node.id)).toEqual(['x'])
    expect(file.edges).toEqual([])
  })

  test('counts a file of nothing but another app’s nodes as a canvas', () => {
    const only = JSON.stringify({ nodes: [drawing], edges: [] })
    const plain = writeCanvas(plane({ nodes: [card('c', 'hello') as CanvasNode], at: { c: 100 } }))
    const ids = (text: string) =>
      (JSON.parse(text) as { nodes: { id: string }[] }).nodes.map((one) => one.id)

    expect(ids(mergeCanvasFiles(only, plain, 300)).sort()).toEqual(['c', 'x'])
  })

  test('writes a canvas with nothing unread in it exactly as before', () => {
    const one = writeCanvas(plane({ nodes: [card('a', 'one') as CanvasNode], at: { a: 1 } }))
    const two = writeCanvas(plane({ nodes: [card('b', 'two') as CanvasNode], at: { b: 2 } }))

    expect(mergeCanvasFiles(one, two, 300)).toBe(
      writeCanvas(merged(readCanvas(one), readCanvas(two), 300)),
    )
  })
})

describe('merging two copies after another app changed one of them', () => {
  const drawing = { id: 'x', type: 'excalidraw', x: 100, y: 0, width: 200, height: 100 }
  const card = { id: 'c', type: 'text', text: 'hello', x: 300, y: 0, width: 200, height: 60 }

  const written = writeCanvas(
    readCanvas(
      JSON.stringify({
        nodes: [drawing, { ...card, styleAttributes: { shape: 'pill' } }],
        edges: [{ id: 'e', fromNode: 'x', toNode: 'c' }],
        orden: { version: 1, at: { c: 100 } },
      }),
    ),
  )
  interface File {
    nodes: { id: string; x: number; styleAttributes?: { shape: string } }[]
    edges: { id: string }[]
    orden: Record<string, unknown>
  }
  const parse = (text: string) => JSON.parse(text) as File
  const outside = (text: string, edit: (file: File) => void) => {
    const file = parse(text)
    edit(file)
    return JSON.stringify(file, null, '\t')
  }
  const moveTo = (x: number) => (file: File) => {
    const node = file.nodes.find((one) => one.id === 'x')
    if (node) node.x = x
  }
  const throwAway = (file: File) => {
    file.nodes = file.nodes.filter((one) => one.id !== 'x')
    file.edges = []
  }

  test('records what it wrote, and counts nothing changed in its own file', () => {
    expect(parse(written).orden.outside).toBeDefined()
    const extras = readCanvas(written).extras
    expect([...(extras?.generations ?? [])].sort()).toEqual([
      ['edge:e', 0],
      ['field:c', 0],
      ['node:x', 0],
    ])
    expect(extras?.buried.size).toBe(0)
  })

  test('keeps the version another app changed, whichever side asks', () => {
    const moved = outside(written, (file) => {
      moveTo(50)(file)
      const other = file.nodes.find((one) => one.id === 'c')
      if (other) other.styleAttributes = { shape: 'square' }
    })
    const one = mergeCanvasFiles(written, moved, 300)
    expect(mergeCanvasFiles(moved, written, 300)).toBe(one)
    const file = parse(one)
    expect(file.nodes.find((node) => node.id === 'x')?.x).toBe(50)
    expect(file.nodes.find((node) => node.id === 'c')?.styleAttributes).toEqual({ shape: 'square' })
  })

  test('leaves what another app threw away gone, and its edge with it', () => {
    const thrown = outside(written, throwAway)
    for (const merged of [
      mergeCanvasFiles(written, thrown, 300),
      mergeCanvasFiles(thrown, written, 300),
    ]) {
      const file = parse(merged)
      expect(file.nodes.map((node) => node.id)).toEqual(['c'])
      expect(file.edges).toEqual([])
    }
  })

  test('keeps one thrown away on one side and changed on the other: it was still wanted', () => {
    const thrown = outside(written, throwAway)
    const moved = outside(written, moveTo(50))
    for (const merged of [
      mergeCanvasFiles(thrown, moved, 300),
      mergeCanvasFiles(moved, thrown, 300),
    ]) {
      expect(parse(merged).nodes.find((node) => node.id === 'x')?.x).toBe(50)
    }
  })

  test('keeps the change through a write, against a copy that never saw it', () => {
    const once = mergeCanvasFiles(written, outside(written, moveTo(50)), 300)
    expect(readCanvas(once).extras?.generations.get('node:x')).toBe(1)
    for (const again of [
      mergeCanvasFiles(once, written, 400),
      mergeCanvasFiles(written, once, 400),
    ]) {
      expect(parse(again).nodes.find((node) => node.id === 'x')?.x).toBe(50)
    }
    const gone = mergeCanvasFiles(written, outside(written, throwAway), 300)
    for (const again of [
      mergeCanvasFiles(gone, written, 400),
      mergeCanvasFiles(written, gone, 400),
    ]) {
      expect(parse(again).nodes.map((node) => node.id)).toEqual(['c'])
    }
  })

  test('keeps everything from two files Orden never wrote, as before', () => {
    const plain = JSON.stringify({ nodes: [drawing], edges: [] })
    const other = JSON.stringify({ nodes: [{ ...drawing, id: 'y' }], edges: [] })
    expect(
      parse(mergeCanvasFiles(plain, other, 300))
        .nodes.map((node) => node.id)
        .sort(),
    ).toEqual(['x', 'y'])
  })
})

describe('the order of the stack', () => {
  const base = (...ids: string[]) => {
    const things = ids.map((id) => card(id))
    return { ...plane({ nodes: things }), at: Object.fromEntries(ids.map((id) => [id, 100])) }
  }
  const moved = (canvas: Canvas, ...ids: string[]) => ({
    ...canvas,
    nodes: ids.map((id) => canvas.nodes.find((node) => node.id === id)!),
  })
  const order = (canvas: Canvas) => canvas.nodes.map((node) => node.id)

  test('stamped records a move even where every object is the very same one', () => {
    const before = base('a', 'b', 'c')
    const after = stamped(before, moved(before, 'b', 'c', 'a'), 200)
    expect(after.moved).toEqual({ a: 200 })
    expect(after.at).toEqual({ a: 100, b: 100, c: 100 })
  })

  test('stamped stamps nothing more than what moved, wherever in the list it was', () => {
    const before = base('a', 'b', 'c', 'd', 'e')
    const after = stamped(before, moved(before, 'a', 'd', 'b', 'c', 'e'), 200)
    expect(after.moved).toEqual({ d: 200 })
    expect(after.at).toEqual({ a: 100, b: 100, c: 100, d: 100, e: 100 })
  })

  test('a swap of the first two survives the merge', () => {
    const theirs = base('a', 'b', 'c')
    const ours = stamped(theirs, moved(theirs, 'b', 'a', 'c'), 200)
    expect(order(merged(ours, theirs, 300))).toEqual(['b', 'a', 'c'])
    expect(order(merged(theirs, ours, 300))).toEqual(['b', 'a', 'c'])
  })

  test('sending to the back survives the merge', () => {
    const theirs = base('a', 'b', 'c')
    const ours = stamped(theirs, moved(theirs, 'c', 'a', 'b'), 200)
    expect(order(merged(ours, theirs, 300))).toEqual(['c', 'a', 'b'])
    expect(order(merged(theirs, ours, 300))).toEqual(['c', 'a', 'b'])
  })

  test('one step back survives the merge', () => {
    const theirs = base('a', 'b', 'c')
    const ours = stamped(theirs, moved(theirs, 'a', 'c', 'b'), 200)
    expect(order(merged(ours, theirs, 300))).toEqual(['a', 'c', 'b'])
    expect(order(merged(theirs, ours, 300))).toEqual(['a', 'c', 'b'])
  })

  test('brought to the front, it sits over what the other side added before that', () => {
    const start = base('a', 'b')
    const ours = stamped(start, moved(start, 'b', 'a'), 300)
    const theirs = stamped(start, { ...start, nodes: [...start.nodes, card('x'), card('y')] }, 200)
    expect(order(merged(ours, theirs, 400))).toEqual(['b', 'x', 'y', 'a'])
    expect(order(merged(theirs, ours, 400))).toEqual(['b', 'x', 'y', 'a'])
  })

  test('and under what the other side added after it', () => {
    const start = base('a', 'b')
    const ours = stamped(start, moved(start, 'b', 'a'), 200)
    const theirs = stamped(start, { ...start, nodes: [...start.nodes, card('x')] }, 300)
    expect(order(merged(ours, theirs, 400))).toEqual(['b', 'a', 'x'])
    expect(order(merged(theirs, ours, 400))).toEqual(['b', 'a', 'x'])
  })

  test('what each side added stays where that side put it among the rest', () => {
    const start = base('a', 'b')
    const ours = stamped(start, { ...start, nodes: [card('m'), ...start.nodes] }, 200)
    const theirs = stamped(start, { ...start, nodes: [...start.nodes, card('n')] }, 200)
    expect(order(merged(ours, theirs, 300))).toEqual(['m', 'a', 'b', 'n'])
    expect(order(merged(theirs, ours, 300))).toEqual(['m', 'a', 'b', 'n'])
  })

  test('two copies that disagree with no times to go on come out the same either way', () => {
    const one = plane({ nodes: [card('a'), card('b'), card('c')] })
    const other = plane({ nodes: [card('c'), card('b'), card('a')] })
    expect(order(merged(one, other, 100))).toEqual(order(merged(other, one, 100)))
  })

  test('an id a hand wrote twice comes out once, and takes nothing with it', () => {
    const one = plane({ nodes: [card('a'), card('a'), card('b')] })
    const other = plane({ nodes: [card('a'), card('b'), card('c')] })
    expect(order(merged(one, other, 100))).toEqual(['a', 'b', 'c'])
  })

  describe('never at the price of what a card says', () => {
    const start = { ...plane({ nodes: [card('x', 'a'), card('y', 'y')] }), at: { x: 5, y: 5 } }
    const typed = (canvas: Canvas, text: string) => ({
      ...canvas,
      nodes: canvas.nodes.map((node) => (node.id === 'x' ? card('x', text) : node)),
    })
    const words = (canvas: Canvas) => canvas.nodes.find((node) => node.id === 'x')

    test('words typed on one side outlive a later move on a stale copy of the other', () => {
      const a = stamped(start, typed(start, 'ab'), 10)
      const b = stamped(start, moved(start, 'y', 'x'), 20)
      for (const both of [merged(a, b, 30), merged(b, a, 30)]) {
        expect(words(both)).toMatchObject({ text: 'ab' })
        expect(order(both)).toEqual(['y', 'x'])
        expect(both.at.x).toBe(10)
      }
    })

    test('and a move outlives words typed after it, on a copy that never moved', () => {
      const a = stamped(start, typed(start, 'ab'), 40)
      const b = stamped(start, moved(start, 'y', 'x'), 20)
      for (const both of [merged(a, b, 50), merged(b, a, 50)]) {
        expect(words(both)).toMatchObject({ text: 'ab' })
        expect(order(both)).toEqual(['y', 'x'])
      }
    })

    test('through the files as well', () => {
      const a = writeCanvas(stamped(start, typed(start, 'ab'), 10))
      const b = writeCanvas(stamped(start, moved(start, 'y', 'x'), 20))
      const both = readCanvas(mergeCanvasFiles(a, b, 30))
      expect(words(both)).toMatchObject({ text: 'ab' })
      expect(order(both)).toEqual(['y', 'x'])
      expect(both.moved).toEqual({ x: 20 })
    })

    test('a delete is not outlived by a move made after it', () => {
      const a = stamped(start, { ...start, nodes: start.nodes.slice(1) }, 10)
      const b = stamped(start, moved(start, 'y', 'x'), 20)
      expect(order(merged(a, b, 30))).toEqual(['y'])
      expect(merged(a, b, 30).moved).toBeUndefined()
    })
  })

  test('a thing the other side does not hold stands, whatever that side says of its moves', () => {
    const ours = { ...plane({ nodes: [card('x')] }), at: { x: 5 } }
    const theirs = plane({ moved: { x: 9 } })
    expect(order(merged(ours, theirs, 100))).toEqual(['x'])
    expect(order(merged(theirs, ours, 100))).toEqual(['x'])
  })

  test.fails('words typed on one side outlive a later drag of a stale copy', () => {
    const start = { ...plane({ nodes: [card('x', 'draft')] }), at: { x: 1 } }
    const a = stamped(start, { ...start, nodes: [card('x', 'draft', 50)] }, 3)
    const b = stamped(start, { ...start, nodes: [card('x', 'final')] }, 2)
    expect(merged(a, b, 4).nodes[0]).toMatchObject({ text: 'final', x: 50 })
  })

  describe('kept from edit to edit', () => {
    const before = base('a', 'b', 'c')
    const shifted = stamped(before, moved(before, 'b', 'c', 'a'), 200)

    test('is the very same record where nothing moved or went', () => {
      const drawn = stamped(shifted, { ...shifted, nodes: [...shifted.nodes, card('d')] }, 300)
      expect(drawn.moved).toBe(shifted.moved)
      const typed = stamped(
        shifted,
        {
          ...shifted,
          nodes: shifted.nodes.map((node) => (node.id === 'b' ? card('b', 'B') : node)),
        },
        300,
      )
      expect(typed.moved).toBe(shifted.moved)
    })

    test('and where what went had never moved', () => {
      const less = stamped(
        shifted,
        { ...shifted, nodes: shifted.nodes.filter((node) => node.id !== 'b') },
        300,
      )
      expect(less.moved).toBe(shifted.moved)
    })

    test('and a new one where something moved or what went had', () => {
      const again = stamped(shifted, moved(shifted, 'a', 'b', 'c'), 300)
      expect(again.moved).not.toBe(shifted.moved)
      const less = stamped(
        shifted,
        { ...shifted, nodes: shifted.nodes.filter((node) => node.id !== 'a') },
        300,
      )
      expect(less.moved).toBeUndefined()
    })
  })

  describe('in the file', () => {
    test('a plane nothing was moved on writes nothing new', () => {
      const file = writeCanvas(stamped(plane(), plane({ nodes: [card('a')] }), 100))
      expect(JSON.parse(file).orden.moved).toBeUndefined()
    })

    test('comes back as it went, and is the printer’s own JSON', () => {
      const before = base('a', 'b')
      const after = stamped(before, moved(before, 'b', 'a'), 200)
      const file = writeCanvas(after)
      expect(readCanvas(file).moved).toEqual(after.moved)
      expect(file).toBe(`${JSON.stringify(JSON.parse(file), null, '\t')}\n`)
    })

    test('leaves everything an older reader looks at as it was', () => {
      const before = base('a', 'b')
      const file = JSON.parse(writeCanvas(stamped(before, moved(before, 'b', 'a'), 200))) as {
        orden: { at: unknown }
        nodes: CanvasNode[]
      }
      expect(file.orden.at).toEqual({ a: 100, b: 100 })
      expect(file.nodes.map((node) => node.id)).toEqual(['b', 'a'])
    })

    test('is forgotten with the thing it was about', () => {
      const before = base('a', 'b')
      const after = stamped(before, moved(before, 'b', 'a'), 200)
      const gone = stamped(after, { ...after, nodes: [card('b')] }, 300)
      expect(gone.moved).toBeUndefined()
    })

    test('is no extra of another app’s', () => {
      const before = base('a', 'b')
      const read = readCanvas(writeCanvas(stamped(before, moved(before, 'b', 'a'), 200)))
      expect(read.extras).toBeUndefined()
    })

    test('two files from before it merge as they did', () => {
      const old = (...ids: string[]) =>
        JSON.stringify({
          nodes: ids.map((id) => card(id)),
          edges: [],
          orden: { version: 1, at: Object.fromEntries(ids.map((id) => [id, 100])) },
        })
      const both = readCanvas(mergeCanvasFiles(old('a', 'b'), old('a', 'b', 'c'), 300))
      expect(order(both)).toEqual(['a', 'b', 'c'])
      expect(both.moved).toBeUndefined()
    })
  })

  test('a merge is the same the second time', () => {
    const start = base('a', 'b', 'c')
    const ours = stamped(start, moved(start, 'c', 'a', 'b'), 200)
    const theirs = stamped(start, { ...start, nodes: [...start.nodes, card('x')] }, 300)
    const once = merged(ours, theirs, 400)
    expect(order(merged(once, theirs, 400))).toEqual(order(once))
    expect(order(merged(once, ours, 400))).toEqual(order(once))
  })
})
