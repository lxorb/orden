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

  /** The whole reason the times can be kept honest in one place: an edit hands
   *  back the very same objects for what it did not touch, so "what changed" is
   *  a handful of identity comparisons. */
  test('leaves the time of anything the edit handed straight back', () => {
    const a = card('a')
    const b = card('b')
    const before = stamped(plane(), plane({ nodes: [a, b] }), 100)
    const after = stamped(before, { ...before, nodes: [a, { ...b, x: 40 }] }, 200)

    expect(after.at).toEqual({ a: 100, b: 200 })
  })

  test('buries what the edit took away, and only that', () => {
    const before = stamped(plane(), plane({ nodes: [card('a'), card('b')] }), 100)
    // The very same object for the card that stayed, which is what every edit
    // hands back and what lets the time stand.
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
  /** The case the whole design is for: two devices drawing at the same time. */
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

  /** The other half of the rule, and the one that stops a delete being a
   *  one-way door: put the card back and putting it back is the newer word. */
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

    // Written out rather than compared as objects, because the file is the
    // thing two devices have to agree on.
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

  test('keeps a canvas neither side changed exactly as it was', () => {
    const shared = stamped(plane(), plane({ nodes: [card('a'), card('b')] }), 100)
    expect(writeCanvas(merged(shared, shared, 1000))).toBe(writeCanvas(shared))
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

  /** A file that got truncated on one device is never a reason to lose the
   *  drawing on the other. */
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

/** The one thing on a canvas there is only one of. It is not a card and has no
 *  time of its own, so it is merged by the rule the rest of the file already
 *  follows: everything on either side is kept, and a tie goes to whichever sorts
 *  first, so two devices reach the same file without talking. */
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

    // `anchor` sorts first, so both devices keep it - and teal with it, because
    // violet was chosen for a picture that is no longer there.
    expect(merged(ours, theirs, 1000)).toMatchObject({ icon: 'anchor', iconColor: 'teal' })
    expect(merged(theirs, ours, 1000)).toMatchObject({ icon: 'anchor', iconColor: 'teal' })
  })

  test('a colour on one side of the same icon is kept', () => {
    const ours = plane({ icon: 'rocket', iconColor: 'violet' })
    const theirs = plane({ icon: 'rocket' })

    expect(merged(ours, theirs, 1000).iconColor).toBe('violet')
    expect(merged(theirs, ours, 1000).iconColor).toBe('violet')
  })

  /** A canvas nobody has drawn on is not a truncated file, and the icon somebody
   *  chose for it is a reason to keep it rather than take the other side whole. */
  test('survives a merge with a copy that has cards and no icon', () => {
    const ours = writeCanvas(plane({ icon: 'rocket' }))
    const theirs = writeCanvas(stamped(plane(), plane({ nodes: [card('a')] }), 120))
    const both = readCanvas(mergeCanvasFiles(ours, theirs, 1000))

    expect(both.icon).toBe('rocket')
    expect(ids(both)).toEqual(['a'])
  })
})

/** What stamping an edit costs, counted.
 *
 *  Every gesture ends in one of these, and an eraser ends in one per point of the
 *  drag. It used to build two maps over every node, every edge and every stroke and
 *  look each one up: on a plane of ten thousand strokes the browser blamed the
 *  pointer coming up for a hundred and fifty milliseconds, and three of the walks in
 *  it were here.
 *
 *  What changed is found by identity - the operations hand back the very same objects
 *  for what they did not touch - so what is counted is the ids compared. A stroke
 *  drawn on a plane of six hundred compares one, not twelve hundred. A count rather
 *  than a clock, for the reason the rest of this suite gives. */
describe('what stamping an edit compares', () => {
  /** A plane of `count` strokes whose ids say how often they were read. */
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

    // Six hundred and one ids on the plane, and the walk that writes a time against
    // each of them reads every one. What it no longer does is read them all again
    // twice over to work out which one moved: the comparison is the one stroke.
    expect(reads.ids).toBeLessThanOrEqual(ink.length + 2)
    expect(after.at.drawn).toBe(2000)
    // And every other stroke keeps the time it had.
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

  test('a plane read from a file gets a time against everything on it', () => {
    // Another app's canvas, or one written before any of this: no times at all.
    const arrived = plane({ nodes: [card('a'), card('b')], at: {} })
    const stampedNow = stamped(arrived, { ...arrived, nodes: [...arrived.nodes, card('c')] }, 3000)

    expect(stampedNow.at).toEqual({ a: 3000, b: 3000, c: 3000 })
  })
})
